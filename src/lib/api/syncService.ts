import { api } from './client';
import { AuditLogItem, Profile } from '../../types';

// Utilitário para gerar UUID v4
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface BootstrapData {
  user: Profile;
  profiles: Profile[];
  escolas: any[]; profissionais: any[]; turmas: any[]; alunos: any[]; pdis: any[];
  estudos_de_caso: any[]; peis: any[]; documentos: any[]; oficios: any[];
  auditLogs: AuditLogItem[];
}

export const fetchBootstrap = () => api<BootstrapData>('bootstrap');

export async function dbInsertAuditLog(log: AuditLogItem): Promise<void> {
  try { await api('audit', { method: 'POST', body: { acao: log.acao, tabela: log.tabela, registro_id: log.registro_id, detalhes: log.detalhes } }); } catch { /* auditoria não deve travar a tela */ }
}

export async function dbSalvarUsuario(p: Partial<Profile> & { senha?: string }): Promise<Profile> {
  const r = await api<{ user: Profile }>('users', { method: 'POST', body: p });
  return r.user;
}
export const dbStatusUsuario = (id: string, ativo: boolean) => api(`users/${id}/status`, { method: 'POST', body: { ativo } });
export const dbExcluirUsuario = (id: string) => api(`users/${id}`, { method: 'DELETE' });

export interface SyncResult { ok: boolean; errors: { id: string; error: string }[] }
export const dbSync = (module: string, upserts: unknown[], deletes: string[]) =>
  api<SyncResult>('sync', { method: 'POST', body: { module, upserts, deletes } });
