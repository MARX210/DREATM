import { neon } from '@neondatabase/serverless';
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const rl = createInterface({ input, output });
try {
  if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL no ambiente antes de executar.');
  const nome = (await rl.question('Nome do administrador: ')).trim();
  const email = (await rl.question('E-mail institucional: ')).trim().toLowerCase();
  const cargo = (await rl.question('Cargo (ex.: Diretor do Núcleo): ')).trim() || 'Diretor do Núcleo';
  const senha = await rl.question('Senha (mínimo 12 caracteres): ');
  if (!nome || !email.includes('@') || senha.length < 12) throw new Error('Dados inválidos. A senha deve ter no mínimo 12 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const hash = `${salt}:${scryptSync(senha, salt, 64).toString('hex')}`;
  const sql = neon(process.env.DATABASE_URL);
  await sql`INSERT INTO app_users(nome,email,cargo,papel,senha_hash) VALUES(${nome},${email},${cargo},'nucleo_diretor',${hash})
            ON CONFLICT (lower(email)) DO UPDATE SET nome=EXCLUDED.nome, cargo=EXCLUDED.cargo, senha_hash=EXCLUDED.senha_hash, papel='nucleo_diretor', ativo=true, updated_at=now()`;
  console.log('Administrador criado/atualizado. Guarde a senha com segurança.');
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { rl.close(); }
