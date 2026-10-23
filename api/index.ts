import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { put, get, del } from '@vercel/blob';

// ---------- infraestrutura ----------
const sql = () => { if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada'); return neon(process.env.DATABASE_URL); };
const secret = () => { const s = process.env.SESSION_SECRET; if (!s || s.length < 32) throw new Error('Configure SESSION_SECRET com pelo menos 32 caracteres'); return s; };
const hash = (senha: string) => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(senha, salt, 64).toString('hex')}`; };
const verify = (senha: string, stored: string) => {
  try { const [salt, hex] = stored.split(':'); const a = scryptSync(senha, salt, 64); const b = Buffer.from(hex, 'hex'); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; }
};
const sign = (v: string) => createHmac('sha256', secret()).update(v).digest('hex');
const tokenFor = (id: string) => { const p = Buffer.from(JSON.stringify({ id, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url'); return `${p}.${sign(p)}`; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODULES = ['escolas', 'profissionais', 'turmas', 'alunos', 'pdis', 'estudos_de_caso', 'peis', 'documentos', 'oficios'] as const;
const PAPEIS = ['nucleo_diretor', 'nucleo_tecnico', 'diretor_escola', 'secretaria_escola'];
const json = (res: VercelResponse, status: number, data: any) => res.status(status).json(data);
const isNucleo = (u: any) => u?.papel === 'nucleo_diretor' || u?.papel === 'nucleo_tecnico';
const publicUser = (u: any) => ({ id: u.id, nome: u.nome, email: u.email, cargo: u.cargo || '', papel: u.papel, escola_id: u.escola_id ?? null, ativo: u.ativo, created_at: u.created_at, ultimo_acesso: u.ultimo_acesso || undefined });

const getSession = async (req: VercelRequest) => {
  const raw = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('dre_session='))?.slice(12);
  if (!raw) return null;
  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!p.id || p.exp < Date.now()) return null;
    const rows = await sql()`SELECT id,nome,email,cargo,papel,escola_id,ativo,created_at,ultimo_acesso FROM app_users WHERE id=${p.id} AND ativo=true`;
    return rows[0] || null;
  } catch { return null; }
};

const audit = async (user: any, acao: string, tabela: string, registro_id?: string | null, detalhes?: any) => {
  try {
    await sql()`INSERT INTO audit_log(user_id,user_nome,acao,tabela,registro_id,detalhes) VALUES (${user?.id || null},${user?.nome || null},${String(acao).slice(0, 80)},${String(tabela).slice(0, 80)},${registro_id ? String(registro_id).slice(0, 80) : null},${detalhes ? JSON.stringify(detalhes).slice(0, 4000) : null}::jsonb)`;
  } catch (e: any) { console.error('audit', e?.message); }
};

// ---------- arquivos (Vercel Blob PRIVADO: nada é público, todo acesso passa por esta API) ----------
const MAX_ARQUIVO = 4 * 1024 * 1024; // limite do corpo de uma Função da Vercel é 4,5 MB
const sniff = (b: Buffer): string | null => {
  if (b.length < 12) return null;
  if (b.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return null;
};
const nomeSeguro = (n: string) => (n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-80)) || 'arquivo';

const nucleoAtivosDiretores = async () => Number((await sql()`SELECT count(*)::int AS c FROM app_users WHERE papel='nucleo_diretor' AND ativo=true`)[0].c);

// ---------- handler ----------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    // o vercel.json reescreve /api/* para /api/index?p=<caminho>; sem o parâmetro, usa a própria URL
    const qp = (req.query as any)?.p;
    const rawPath = qp !== undefined ? (Array.isArray(qp) ? qp.join('/') : String(qp)) : String(req.url || '').split('?')[0].replace(/^\/api\/?/, '');
    const path = decodeURIComponent(rawPath).split('/').filter(Boolean);
    const body = (req.body && typeof req.body === 'object') ? req.body : {};

    if (path[0] === 'health' && req.method === 'GET') { await sql()`SELECT 1`; return json(res, 200, { ok: true, database: 'connected' }); }

    // defesa CSRF: toda escrita exige o cabeçalho customizado enviado pelo front-end
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'dre-app') return json(res, 403, { error: 'Requisição não autorizada.' });

    // ----- login -----
    if (path[0] === 'auth' && path[1] === 'login' && req.method === 'POST') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const senha = typeof body.senha === 'string' ? body.senha : '';
      if (!email || !senha) return json(res, 400, { error: 'Informe e-mail e senha.' });
      const falhas = Number((await sql()`SELECT count(*)::int AS c FROM audit_log WHERE acao='LOGIN_FALHA' AND detalhes->>'email'=${email} AND created_at > now() - interval '15 minutes'`)[0].c);
      if (falhas >= 8) return json(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
      const rows = await sql()`SELECT id,nome,email,cargo,papel,escola_id,ativo,created_at,ultimo_acesso,senha_hash FROM app_users WHERE lower(email)=${email} LIMIT 1`;
      const u: any = rows[0];
      if (!u || !verify(senha, u.senha_hash)) { await audit(null, 'LOGIN_FALHA', 'auth', null, { email }); return json(res, 401, { error: 'E-mail ou senha inválidos.' }); }
      if (!u.ativo) return json(res, 403, { error: 'Este usuário está INATIVO. Procure o Núcleo da DRE Altamira para reativação do acesso.' });
      await sql()`UPDATE app_users SET ultimo_acesso=now() WHERE id=${u.id}`;
      res.setHeader('Set-Cookie', `dre_session=${tokenFor(u.id)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`);
      return json(res, 200, { user: publicUser({ ...u, ultimo_acesso: new Date().toISOString() }) });
    }
    if (path[0] === 'auth' && path[1] === 'logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'dre_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'); return json(res, 200, { ok: true });
    }

    const user: any = await getSession(req);
    if (!user) return json(res, 401, { error: 'Sessão expirada. Entre novamente.' });
    if (path[0] === 'auth' && path[1] === 'me' && req.method === 'GET') return json(res, 200, { user: publicUser(user) });

    // ----- carga inicial (já filtrada pelo perfil: equivale ao RLS do original) -----
    if (path[0] === 'bootstrap' && req.method === 'GET') {
      const nucleo = isNucleo(user);
      const rows: any[] = nucleo
        ? await sql()`SELECT module,id,data FROM app_records ORDER BY updated_at DESC`
        : await sql()`SELECT module,id,data FROM app_records WHERE module<>'oficios' AND escola_id=${user.escola_id} ORDER BY updated_at DESC`;
      const out: Record<string, any[]> = {}; MODULES.forEach(m => out[m] = []);
      for (const r of rows) out[r.module].push({ ...r.data, id: r.id });
      const users: any[] = nucleo ? await sql()`SELECT id,nome,email,cargo,papel,escola_id,ativo,created_at,ultimo_acesso FROM app_users ORDER BY nome` : [user];
      const logs: any[] = nucleo ? await sql()`SELECT id,user_id,user_nome,acao,tabela,registro_id,detalhes,created_at FROM audit_log ORDER BY created_at DESC LIMIT 500` : [];
      return json(res, 200, {
        user: publicUser(user), profiles: users.map(publicUser), ...out,
        auditLogs: logs.map(l => ({ id: String(l.id), user_id: l.user_id || '', user_nome: l.user_nome || 'Sistema', acao: l.acao, tabela: l.tabela, registro_id: l.registro_id || undefined, detalhes: l.detalhes || undefined, created_at: l.created_at })),
      });
    }

    // ----- gravação de registros (upserts + exclusões em lote) -----
    if (path[0] === 'sync' && req.method === 'POST') {
      const mod = String(body.module || '');
      if (!(MODULES as readonly string[]).includes(mod)) return json(res, 400, { error: 'Módulo inválido.' });
      const nucleo = isNucleo(user);
      if (mod === 'oficios' && !nucleo) return json(res, 403, { error: 'Apenas o Núcleo acessa ofícios.' });
      const upserts: any[] = Array.isArray(body.upserts) ? body.upserts.slice(0, 300) : [];
      const deletes: string[] = Array.isArray(body.deletes) ? body.deletes.slice(0, 300).map(String) : [];
      const errors: { id: string; error: string }[] = [];

      const prepared: { id: string; escola_id: string | null; data: any }[] = [];
      for (const o of upserts) {
        const id = o && typeof o.id === 'string' ? o.id.slice(0, 80) : '';
        if (!id) { errors.push({ id: '?', error: 'Registro sem id.' }); continue; }
        const escola_id = mod === 'escolas' ? id : (typeof o.escola_id === 'string' && o.escola_id ? o.escola_id : null);
        if (!nucleo) {
          if (mod === 'escolas' && id !== user.escola_id) { errors.push({ id, error: 'Acesso negado: escola de outra unidade.' }); continue; }
          if (mod !== 'escolas' && escola_id !== user.escola_id) { errors.push({ id, error: 'Acesso negado: você só pode gerenciar registros da sua escola.' }); continue; }
        }
        prepared.push({ id, escola_id, data: o });
      }

      const run = async (items: typeof prepared) => sql()`
        INSERT INTO app_records(module,id,escola_id,data,created_by)
        SELECT ${mod}, x.id, x.escola_id, x.data, ${user.id}::uuid
        FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb) AS x(id text, escola_id text, data jsonb)
        ON CONFLICT (module,id) DO UPDATE SET data=EXCLUDED.data, escola_id=EXCLUDED.escola_id, updated_at=now()
        WHERE ${nucleo} OR app_records.escola_id IS NOT DISTINCT FROM EXCLUDED.escola_id`;
      if (prepared.length) {
        try { await run(prepared); }
        catch {
          // alguma linha violou regra (código duplicado, nº de ofício repetido...): grava uma a uma e informa qual falhou
          for (const it of prepared) {
            try { await run([it]); } catch (e: any) {
              const m = String(e?.message || '');
              errors.push({ id: it.id, error: m.includes('duplicate') || m.includes('unique') ? 'Código/número já existe (duplicado).' : 'Não foi possível salvar este registro.' });
            }
          }
        }
      }
      if (deletes.length && mod === 'documentos') {
        try {
          const rows: any[] = nucleo
            ? await sql()`SELECT escola_id,data FROM app_records WHERE module='documentos' AND id = ANY(${deletes}::text[])`
            : await sql()`SELECT escola_id,data FROM app_records WHERE module='documentos' AND id = ANY(${deletes}::text[]) AND escola_id=${user.escola_id}`;
          const paths = rows.map(r => String(r.data?.storage_path || '')).filter((sp, i) => sp.startsWith(`alunos/${rows[i].escola_id}/`) && !sp.includes('..'));
          if (paths.length) await del(paths);
        } catch (e: any) { console.error('del blob', e?.message); }
      }
      if (deletes.length) {
        if (!nucleo && mod === 'escolas') errors.push({ id: deletes[0], error: 'Apenas o Núcleo exclui escolas.' });
        else if (nucleo) await sql()`DELETE FROM app_records WHERE module=${mod} AND id = ANY(${deletes}::text[])`;
        else await sql()`DELETE FROM app_records WHERE module=${mod} AND id = ANY(${deletes}::text[]) AND escola_id=${user.escola_id}`;
      }
      return json(res, errors.length ? 207 : 200, { ok: errors.length === 0, errors });
    }

    // ----- auditoria enviada pelo front-end (o usuário é sempre o da sessão) -----
    if (path[0] === 'audit' && req.method === 'POST') {
      await audit(user, String(body.acao || 'ACAO'), String(body.tabela || 'app'), body.registro_id, body.detalhes);
      return json(res, 200, { ok: true });
    }

    // ----- arquivos dos alunos: envio e abertura (privado, com checagem de escola) -----
    if (path[0] === 'files') {
      const q = new URL(req.url || '', 'http://x').searchParams;
      const nucleo = isNucleo(user);
      if (req.method === 'POST') {
        const alunoId = q.get('aluno_id') || '';
        const aluno: any = (await sql()`SELECT escola_id FROM app_records WHERE module='alunos' AND id=${alunoId}`)[0];
        if (!aluno) return json(res, 404, { error: 'Aluno não encontrado no banco. Aguarde alguns segundos após o cadastro e tente de novo.' });
        if (!nucleo && aluno.escola_id !== user.escola_id) return json(res, 403, { error: 'Acesso negado: aluno de outra escola.' });
        const buf: Buffer | null = Buffer.isBuffer(req.body) ? req.body : null;
        if (!buf || !buf.length) return json(res, 400, { error: 'Arquivo vazio ou não recebido.' });
        if (buf.length > MAX_ARQUIVO) return json(res, 413, { error: 'Arquivo acima de 4 MB. Reduza ou comprima o PDF e tente novamente.' });
        const contentType = sniff(buf);
        if (!contentType) return json(res, 415, { error: 'Formato não permitido. Envie PDF, JPG, PNG, WEBP ou DOCX.' });
        const pathname = `alunos/${aluno.escola_id}/${alunoId}/${randomUUID()}-${nomeSeguro(q.get('nome') || 'arquivo')}`;
        await put(pathname, buf, { access: 'private', contentType, addRandomSuffix: false });
        return json(res, 200, { pathname, size: buf.length, contentType });
      }
      if (req.method === 'GET') {
        const docId = q.get('doc') || '';
        const rec: any = (await sql()`SELECT escola_id,data FROM app_records WHERE module='documentos' AND id=${docId}`)[0];
        if (!rec) return json(res, 404, { error: 'Documento não encontrado.' });
        if (!nucleo && rec.escola_id !== user.escola_id) return json(res, 403, { error: 'Acesso negado.' });
        const sp = String(rec.data?.storage_path || '');
        // o caminho só vale se estiver dentro da pasta da própria escola do registro (impede apontar para arquivo de outra escola)
        if (!sp.startsWith(`alunos/${rec.escola_id}/`) || sp.includes('..')) return json(res, 404, { error: 'Este documento não tem arquivo armazenado (foi cadastrado só com o nome).' });
        const r = await get(sp, { access: 'private' });
        if (!r || r.statusCode !== 200 || !r.stream) return json(res, 404, { error: 'Arquivo não encontrado no armazenamento.' });
        const out = Buffer.from(await new Response(r.stream).arrayBuffer());
        const nome = nomeSeguro(String(rec.data?.file_name || rec.data?.titulo || 'documento'));
        res.setHeader('Content-Type', r.blob.contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
        await audit(user, 'DOWNLOAD_DOCUMENTO', 'documentos_aluno', docId, { titulo: rec.data?.titulo });
        return res.status(200).send(out);
      }
    }

    // ----- usuários (somente Núcleo) -----
    if (path[0] === 'users') {
      if (!isNucleo(user)) return json(res, 403, { error: 'Apenas o Núcleo pode administrar usuários.' });
      if (path.length === 1 && req.method === 'POST') {
        const nome = String(body.nome || '').trim(); const email = String(body.email || '').trim().toLowerCase();
        const papel = String(body.papel || ''); const cargo = String(body.cargo || '').trim();
        const senha = typeof body.senha === 'string' ? body.senha : '';
        const ativo = body.ativo !== false;
        if (!nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Informe nome e um e-mail válido.' });
        if (!PAPEIS.includes(papel)) return json(res, 400, { error: 'Perfil inválido.' });
        let escola_id: string | null = null;
        if (papel.startsWith('nucleo')) escola_id = null;
        else {
          escola_id = typeof body.escola_id === 'string' && body.escola_id ? body.escola_id : null;
          if (!escola_id) return json(res, 400, { error: 'Usuários de escola precisam estar vinculados a uma escola.' });
          const ex = await sql()`SELECT 1 FROM app_records WHERE module='escolas' AND id=${escola_id}`;
          if (!ex.length) return json(res, 400, { error: 'Escola não encontrada.' });
        }
        if (senha && senha.length < 12) return json(res, 400, { error: 'A senha deve ter no mínimo 12 caracteres.' });
        const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id.toLowerCase() : null;
        const atual: any = id ? (await sql()`SELECT id,papel,ativo FROM app_users WHERE id=${id}`)[0] : null;
        try {
          if (atual) {
            if ((atual.papel === 'nucleo_diretor' && (papel !== 'nucleo_diretor' || !ativo)) && (await nucleoAtivosDiretores()) <= 1)
              return json(res, 400, { error: 'Não é possível rebaixar ou desativar o único Diretor do Núcleo.' });
            if (senha) await sql()`UPDATE app_users SET nome=${nome},email=${email},cargo=${cargo},papel=${papel},escola_id=${escola_id},ativo=${ativo},senha_hash=${hash(senha)},updated_at=now() WHERE id=${id}`;
            else await sql()`UPDATE app_users SET nome=${nome},email=${email},cargo=${cargo},papel=${papel},escola_id=${escola_id},ativo=${ativo},updated_at=now() WHERE id=${id}`;
          } else {
            if (!senha) return json(res, 400, { error: 'Defina uma senha com no mínimo 12 caracteres.' });
            if (id) await sql()`INSERT INTO app_users(id,nome,email,cargo,papel,escola_id,ativo,senha_hash) VALUES(${id},${nome},${email},${cargo},${papel},${escola_id},${ativo},${hash(senha)})`;
            else await sql()`INSERT INTO app_users(nome,email,cargo,papel,escola_id,ativo,senha_hash) VALUES(${nome},${email},${cargo},${papel},${escola_id},${ativo},${hash(senha)})`;
          }
        } catch (e: any) {
          if (String(e?.message).includes('app_users_email_uq') || String(e?.message).includes('duplicate')) return json(res, 409, { error: 'Já existe um usuário com este e-mail.' });
          throw e;
        }
        const u: any = (await sql()`SELECT id,nome,email,cargo,papel,escola_id,ativo,created_at,ultimo_acesso FROM app_users WHERE lower(email)=${email}`)[0];
        return json(res, 200, { user: publicUser(u) });
      }
      if (path.length === 3 && path[2] === 'status' && req.method === 'POST') {
        const id = path[1]; const ativo = Boolean(body.ativo);
        if (!UUID.test(id)) return json(res, 400, { error: 'Usuário inválido.' });
        if (id === user.id) return json(res, 400, { error: 'Você não pode alterar o seu próprio acesso.' });
        const alvo: any = (await sql()`SELECT papel FROM app_users WHERE id=${id}`)[0];
        if (!alvo) return json(res, 404, { error: 'Usuário não encontrado.' });
        if (!ativo && alvo.papel === 'nucleo_diretor' && (await nucleoAtivosDiretores()) <= 1) return json(res, 400, { error: 'Não é possível desativar o único Diretor do Núcleo.' });
        await sql()`UPDATE app_users SET ativo=${ativo},updated_at=now() WHERE id=${id}`;
        return json(res, 200, { ok: true });
      }
      if (path.length === 2 && req.method === 'DELETE') {
        const id = path[1];
        if (!UUID.test(id)) return json(res, 400, { error: 'Usuário inválido.' });
        if (id === user.id) return json(res, 400, { error: 'Você não pode excluir o seu próprio usuário.' });
        const alvo: any = (await sql()`SELECT papel,ativo FROM app_users WHERE id=${id}`)[0];
        if (!alvo) return json(res, 404, { error: 'Usuário não encontrado.' });
        if (alvo.papel === 'nucleo_diretor' && (await nucleoAtivosDiretores()) <= (alvo.ativo ? 1 : 0)) return json(res, 400, { error: 'Não é possível excluir o único Diretor do Núcleo.' });
        await sql()`DELETE FROM app_users WHERE id=${id}`;
        return json(res, 200, { ok: true });
      }
    }
    return json(res, 404, { error: 'Rota não encontrada.' });
  } catch (e: any) {
    console.error('API error:', e?.message || e);
    return json(res, 500, { error: 'Erro interno do servidor.' });
  }
}
