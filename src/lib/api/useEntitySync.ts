import { useEffect, useRef } from 'react';
import { dbSync } from './syncService';

/**
 * Persistência automática no Neon: compara a lista em memória com o último estado
 * confirmado pelo servidor e envia só o que mudou (novos/alterados e excluídos).
 * `epoch` muda a cada carga inicial (login) e refaz a linha de base sem gravar nada.
 */
export function useEntitySync<T extends { id: string }>(
  module: string,
  items: T[],
  epoch: number,
  onResult: (module: string, ok: boolean, message?: string) => void,
) {
  const last = useRef<Map<string, string>>(new Map());
  const baseEpoch = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (epoch === 0) { baseEpoch.current = 0; last.current = new Map(); return; }
    if (baseEpoch.current !== epoch) {
      baseEpoch.current = epoch;
      last.current = new Map(items.map(i => [i.id, JSON.stringify(i)]));
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const current = new Map(items.map(i => [i.id, JSON.stringify(i)]));
      const upserts = items.filter(i => last.current.get(i.id) !== current.get(i.id));
      const deletes = [...last.current.keys()].filter(id => !current.has(id));
      if (!upserts.length && !deletes.length) return;
      try {
        const failed = new Set<string>(); let firstError = '';
        for (let i = 0; i < Math.max(upserts.length, 1); i += 250) {
          const r = await dbSync(module, upserts.slice(i, i + 250), i === 0 ? deletes : []);
          r.errors?.forEach(e => { failed.add(e.id); if (!firstError) firstError = e.error; });
        }
        const next = new Map(last.current);
        upserts.forEach(i => { if (!failed.has(i.id)) next.set(i.id, current.get(i.id)!); });
        deletes.forEach(id => { if (!failed.has(id)) next.delete(id); });
        last.current = next;
        onResult(module, failed.size === 0, firstError || undefined);
      } catch (e: any) {
        onResult(module, false, e?.message || 'Falha ao salvar no banco de dados.');
      }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [items, epoch]);
}
