import React from 'react';
import { Shield, School } from 'lucide-react';
import { useAppStore } from '../lib/store';

/** Mostra quem está conectado. (O antigo "simulador de perfis" foi removido: o acesso agora é por login real.) */
export const UserSwitcher: React.FC = () => {
  const { currentUser, ehNucleo, minhaEscola } = useAppStore();
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs max-w-[220px] sm:max-w-xs" title={`${currentUser.nome} · ${currentUser.cargo}`}>
      {ehNucleo ? <Shield className="w-4 h-4 text-sky-600 shrink-0" /> : <School className="w-4 h-4 text-emerald-600 shrink-0" />}
      <div className="min-w-0 leading-tight">
        <div className="font-bold text-slate-800 truncate">{currentUser.nome}</div>
        <div className="text-[10px] text-slate-500 truncate">{ehNucleo ? (currentUser.cargo || 'Núcleo DRE Altamira') : (minhaEscola?.nome || currentUser.cargo)}</div>
      </div>
    </div>
  );
};
