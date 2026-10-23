// Cliente da API do sistema (Vercel Functions + Neon PostgreSQL).
// Nenhuma chave de banco existe no navegador: a conexão com o Neon acontece só no servidor.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method || 'GET';
  const res = await fetch(`/api/${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dre-app' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({ error: 'Resposta inválida do servidor.' }));
  if (!res.ok && res.status !== 207) throw new ApiError(data?.error || `Erro ${res.status}`, res.status);
  return data as T;
}
