// Envio e abertura de arquivos dos alunos (Vercel Blob privado, sempre via API autenticada).
export const LIMITE_BYTES = 4 * 1024 * 1024;

/** Fotos de celular costumam ter 3 a 10 MB: reduz para JPEG legível (lado maior 2000 px) antes de enviar. */
async function comprimirImagem(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala); canvas.height = Math.round(bmp.height * escala);
    const ctx = canvas.getContext('2d'); if (!ctx) return file;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    return out && out.size < file.size ? out : file;
  } catch { return file; }
}

export interface ArquivoEnviado { pathname: string; size: number; contentType: string; nome: string }

export async function enviarArquivo(alunoId: string, file: File): Promise<ArquivoEnviado> {
  const corpo = await comprimirImagem(file);
  if (corpo.size > LIMITE_BYTES) throw new Error('Arquivo acima de 4 MB. Reduza ou comprima o PDF e tente novamente.');
  const nome = corpo === file ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg';
  const res = await fetch(`/api/files?aluno_id=${encodeURIComponent(alunoId)}&nome=${encodeURIComponent(nome)}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'dre-app' },
    body: corpo,
  });
  const data = await res.json().catch(() => ({ error: 'Resposta inválida do servidor.' }));
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status} ao enviar o arquivo.`);
  return { ...data, nome };
}

/** Busca o arquivo (com a sessão do usuário) e abre numa nova aba; DOCX é baixado. */
export async function abrirDocumento(docId: string, nomeArquivo = 'documento'): Promise<void> {
  const aba = window.open('', '_blank');
  try {
    const res = await fetch(`/api/files?doc=${encodeURIComponent(docId)}`, { credentials: 'include' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error || `Erro ${res.status}`); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (/pdf|image\//.test(blob.type) && aba) { aba.location.href = url; }
    else { aba?.close(); const a = document.createElement('a'); a.href = url; a.download = nomeArquivo; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e: any) {
    aba?.close();
    alert(e?.message || 'Não foi possível abrir o documento.');
  }
}
