import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Escola, 
  Profile, 
  Profissional, 
  Turma, 
  Aluno, 
  AlunoComStatus, 
  PDI, 
  Oficio, 
  DocumentoAluno, 
  AuditLogItem,
  PapelUsuario,
  EstudoDeCaso,
  PEIOfficial
} from '../types';
import { calcularStatusAtendimento, calcularPdiPendente, calcularIdade } from './status';
import {
  fetchBootstrap,
  dbInsertAuditLog,
  dbSalvarUsuario,
  dbStatusUsuario,
  dbExcluirUsuario,
  generateUUID,
} from './api/syncService';
import { api } from './api/client';
import { useEntitySync } from './api/useEntitySync';

// Perfil "vazio" usado apenas antes do login (nunca concede acesso a nada)
const GUEST: Profile = { id: '', nome: '', email: '', cargo: '', papel: 'secretaria_escola', escola_id: null, ativo: false, created_at: '' };

interface AppStoreContextType {
  // Autenticação & Sessão
  isAuthenticated: boolean;
  login: (emailOuNome: string, senha?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;

  // Usuário Atual & Permissões
  currentUser: Profile;
  setCurrentUser: (user: Profile) => void;
  ehNucleo: boolean;
  minhaEscolaId: string | null;
  minhaEscola: Escola | null;

  // Dados Brutos (Visíveis conforme escopo de quem acessa)
  escolas: Escola[];
  profissionais: Profissional[];
  turmas: Turma[];
  alunos: AlunoComStatus[];
  pdis: PDI[];
  estudosDeCaso: EstudoDeCaso[];
  peis: PEIOfficial[];
  oficios: Oficio[];
  documentos: DocumentoAluno[];
  usuarios: Profile[];
  auditLogs: AuditLogItem[];
  auditoriaLogs: AuditLogItem[];

  // Listagens Irrestritas (usadas pelo Núcleo ou para selects autorizados)
  todasEscolas: Escola[];

  // Ações CRUD com Auditoria e RLS
  salvarAluno: (dados: Partial<Aluno>) => Promise<{ success: boolean; id?: string; error?: string }>;
  inativarAluno: (id: string) => Promise<{ success: boolean; error?: string }>;
  salvarEscola: (dados: Partial<Escola>) => Promise<{ success: boolean; id?: string; error?: string }>;
  inativarEscola: (id: string) => Promise<{ success: boolean; error?: string }>;
  salvarTurma: (dados: Partial<Turma>) => Promise<{ success: boolean; id?: string; error?: string }>;
  excluirTurma: (id: string) => Promise<{ success: boolean; error?: string }>;
  salvarProfissional: (dados: Partial<Profissional>) => Promise<{ success: boolean; id?: string; error?: string }>;
  inativarProfissional: (id: string) => Promise<{ success: boolean; error?: string }>;
  salvarPDI: (dados: Partial<PDI>) => Promise<{ success: boolean; id?: string; error?: string }>;
  salvarEstudoDeCaso: (dados: Partial<EstudoDeCaso>) => Promise<{ success: boolean; id?: string; error?: string }>;
  excluirEstudoDeCaso: (id: string) => Promise<{ success: boolean; error?: string }>;
  salvarPEI: (dados: Partial<PEIOfficial>) => Promise<{ success: boolean; id?: string; error?: string }>;
  excluirPEI: (id: string) => Promise<{ success: boolean; error?: string }>;
  obterEstudoDeCaso: (alunoId: string) => EstudoDeCaso | undefined;
  obterPEI: (alunoId: string) => PEIOfficial | undefined;
  salvarDocumento: (doc: Omit<DocumentoAluno, 'id' | 'created_at'>) => Promise<{ success: boolean; id?: string; error?: string }>;
  excluirDocumento: (id: string) => Promise<{ success: boolean; error?: string }>;
  salvarOficio: (dados: Partial<Oficio>) => Promise<{ success: boolean; id?: string; error?: string }>;
  registrarRespostaOficio: (id: string, dataResp: string, protocolo: string, resumo: string) => Promise<{ success: boolean; error?: string }>;
  proximoNumeroOficio: (ano: number) => number;
  salvarUsuario: (dados: Partial<Profile>) => Promise<{ success: boolean; id?: string; error?: string }>;
  alternarStatusUsuario: (id: string) => Promise<{ success: boolean; error?: string }>;
  excluirUsuario: (id: string) => Promise<{ success: boolean; error?: string }>;
  registrarLog: (acao: string, tabela: string, registroId?: string, detalhes?: Record<string, unknown>) => void;
  importarLote: (
    escolasNovas: Partial<Escola>[],
    turmasNovas: Partial<Turma>[],
    profissionaisNovos: Partial<Profissional>[],
    alunosNovos: Partial<Aluno>[]
  ) => Promise<{ criados: number; atualizados: number; erros: string[] }>;
  importarAlunosEmLote: (linhasValidadas: any[]) => Promise<{ success: boolean; totalImportados: number; error?: string }>;

  // Estado da conexão com o banco (Neon)
  carregando: boolean;
  syncErro: string | null;
  limparSyncErro: () => void;
}

const AppStoreContext = createContext<AppStoreContextType | null>(null);

export const AppStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Todos os dados vêm do Neon (via API autenticada) após o login; nada fica salvo no navegador.
  const [escolasState, setEscolasState] = useState<Escola[]>([]);
  const [profilesState, setProfilesState] = useState<Profile[]>([]);
  const [profissionaisState, setProfissionaisState] = useState<Profissional[]>([]);
  const [turmasState, setTurmasState] = useState<Turma[]>([]);
  const [alunosState, setAlunosState] = useState<Aluno[]>([]);
  const [pdisState, setPdisState] = useState<PDI[]>([]);
  const [estudosDeCasoState, setEstudosDeCasoState] = useState<EstudoDeCaso[]>([]);
  const [peisState, setPeisState] = useState<PEIOfficial[]>([]);
  const [oficiosState, setOficiosState] = useState<Oficio[]>([]);
  const [documentosState, setDocumentosState] = useState<DocumentoAluno[]>([]);
  const [auditLogsState, setAuditLogsState] = useState<AuditLogItem[]>([]);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [carregando, setCarregando] = useState<boolean>(true);
  const [epoch, setEpoch] = useState<number>(0);
  const [syncErro, setSyncErro] = useState<string | null>(null);

  const aplicarBootstrap = useCallback((d: Awaited<ReturnType<typeof fetchBootstrap>>) => {
    setEscolasState(d.escolas as Escola[]);
    setProfilesState(d.profiles);
    setProfissionaisState(d.profissionais as Profissional[]);
    setTurmasState(d.turmas as Turma[]);
    setAlunosState(d.alunos as Aluno[]);
    setPdisState(d.pdis as PDI[]);
    setEstudosDeCasoState(d.estudos_de_caso as EstudoDeCaso[]);
    setPeisState(d.peis as PEIOfficial[]);
    setOficiosState(d.oficios as Oficio[]);
    setDocumentosState(d.documentos as DocumentoAluno[]);
    setAuditLogsState(d.auditLogs);
    setCurrentUserId(d.user.id);
    setIsAuthenticated(true);
    setSyncErro(null);
    setEpoch(e => e + 1);
  }, []);

  const limparSessaoLocal = useCallback(() => {
    setEpoch(0);
    setIsAuthenticated(false);
    setCurrentUserId('');
    setEscolasState([]); setProfilesState([]); setProfissionaisState([]); setTurmasState([]); setAlunosState([]);
    setPdisState([]); setEstudosDeCasoState([]); setPeisState([]); setOficiosState([]); setDocumentosState([]); setAuditLogsState([]);
  }, []);

  // Retoma a sessão (cookie seguro) ao abrir o sistema
  useEffect(() => {
    fetchBootstrap().then(aplicarBootstrap).catch(() => limparSessaoLocal()).finally(() => setCarregando(false));
  }, []);

  // Persistência automática no banco: grava só o que mudou
  const onSyncResult = useCallback((module: string, ok: boolean, message?: string) => {
    if (ok) setSyncErro(null);
    else setSyncErro(message || `Não foi possível salvar (${module}). Verifique a conexão.`);
  }, []);
  useEntitySync('escolas', escolasState, epoch, onSyncResult);
  useEntitySync('profissionais', profissionaisState, epoch, onSyncResult);
  useEntitySync('turmas', turmasState, epoch, onSyncResult);
  useEntitySync('alunos', alunosState, epoch, onSyncResult);
  useEntitySync('pdis', pdisState, epoch, onSyncResult);
  useEntitySync('estudos_de_caso', estudosDeCasoState, epoch, onSyncResult);
  useEntitySync('peis', peisState, epoch, onSyncResult);
  useEntitySync('documentos', documentosState, epoch, onSyncResult);
  useEntitySync('oficios', oficiosState, epoch, onSyncResult);

  const currentUser = useMemo(() => {
    return profilesState.find(p => p.id === currentUserId) || GUEST;
  }, [profilesState, currentUserId]);

  const ehNucleo = currentUser.papel === 'nucleo_diretor' || currentUser.papel === 'nucleo_tecnico';
  const minhaEscolaId = currentUser.escola_id || null;

  const minhaEscola = useMemo(() => {
    if (!minhaEscolaId) return null;
    return escolasState.find(e => e.id === minhaEscolaId) || null;
  }, [escolasState, minhaEscolaId]);

  const registrarLog = useCallback((acao: string, tabela: string, registroId?: string, detalhes?: Record<string, unknown>) => {
    const novoLog: AuditLogItem = {
      id: generateUUID(),
      user_id: currentUser.id,
      user_nome: currentUser.nome,
      acao,
      tabela,
      registro_id: registroId,
      detalhes,
      created_at: new Date().toISOString(),
    };
    setAuditLogsState(prev => [novoLog, ...prev.slice(0, 499)]); // limite de 500 logs
    dbInsertAuditLog(novoLog);
  }, [currentUser]);

  // Aplicação das políticas de segurança RLS sobre os dados expostos
  const escolas = useMemo(() => {
    if (ehNucleo) return escolasState;
    return escolasState.filter(e => e.id === minhaEscolaId);
  }, [escolasState, ehNucleo, minhaEscolaId]);

  const todasEscolas = escolasState;

  const profissionais = useMemo(() => {
    if (ehNucleo) return profissionaisState;
    return profissionaisState.filter(p => p.escola_id === minhaEscolaId);
  }, [profissionaisState, ehNucleo, minhaEscolaId]);

  const turmas = useMemo(() => {
    if (ehNucleo) return turmasState;
    return turmasState.filter(t => t.escola_id === minhaEscolaId);
  }, [turmasState, ehNucleo, minhaEscolaId]);

  const pdis = useMemo(() => {
    if (ehNucleo) return pdisState;
    return pdisState.filter(p => p.escola_id === minhaEscolaId);
  }, [pdisState, ehNucleo, minhaEscolaId]);

  const oficios = useMemo(() => {
    // Escolas NÃO têm acesso a ofícios (Regra 3.3 e RLS)
    if (!ehNucleo) return [];
    return oficiosState;
  }, [oficiosState, ehNucleo]);

  const documentos = useMemo(() => {
    if (ehNucleo) return documentosState;
    return documentosState.filter(d => d.escola_id === minhaEscolaId);
  }, [documentosState, ehNucleo, minhaEscolaId]);

  const usuarios = useMemo(() => {
    if (ehNucleo) return profilesState;
    // Usuários da escola só veem a si próprios
    return profilesState.filter(p => p.id === currentUser.id);
  }, [profilesState, ehNucleo, currentUser.id]);

  const auditLogs = useMemo(() => {
    if (ehNucleo) return auditLogsState;
    return [];
  }, [auditLogsState, ehNucleo]);

  // Alunos enriquecidos com status do semáforo (vw_alunos_status com RLS)
  const alunos = useMemo(() => {
    const baseAlunos = ehNucleo 
      ? alunosState.filter(a => a.ativo)
      : alunosState.filter(a => a.ativo && a.escola_id === minhaEscolaId);

    const escolaMap = new Map(escolasState.map(e => [e.id, e.nome]));
    const escolaMuniMap = new Map(escolasState.map(e => [e.id, e.municipio]));
    const turmaMap = new Map(turmasState.map(t => [t.id, t.nome]));
    const profMap = new Map(profissionaisState.map(p => [p.id, p.nome]));

    return baseAlunos.map(a => {
      const status_atendimento = calcularStatusAtendimento(a);
      const pdi_pendente = calcularPdiPendente(a, pdisState);
      const idade_calculada = calcularIdade(a.data_nascimento, a.idade_informada);

      return {
        ...a,
        tem_professor: Boolean(a.professor_aee_id),
        tem_acompanhante: Boolean(a.acompanhante_id),
        status_atendimento,
        pdi_pendente,
        escola_nome: escolaMap.get(a.escola_id) || 'Escola não identificada',
        escola_municipio: escolaMuniMap.get(a.escola_id) || 'Altamira',
        turma_nome: a.turma_id ? turmaMap.get(a.turma_id) || 'Sem Turma' : 'Sem Turma',
        professor_nome: a.professor_aee_id ? profMap.get(a.professor_aee_id) : undefined,
        acompanhante_nome: a.acompanhante_id ? profMap.get(a.acompanhante_id) : undefined,
        idade_calculada,
      };
    });
  }, [alunosState, ehNucleo, minhaEscolaId, escolasState, turmasState, profissionaisState, pdisState]);

  // Operações de CRUD
  const salvarAluno = useCallback(async (dados: Partial<Aluno>) => {
    try {
      // Validação de permissão: escola só pode salvar na própria escola
      const escolaAlvo = dados.escola_id || minhaEscolaId;
      if (!ehNucleo && escolaAlvo !== minhaEscolaId) {
        return { success: false, error: 'Acesso negado: você só pode gerenciar alunos da sua própria escola.' };
      }

      const now = new Date().toISOString();
      let alunoId = dados.id;

      if (alunoId) {
        // Atualizar
        let alunoAtualizado: Aluno | null = null;
        setAlunosState(prev => prev.map(item => {
          if (item.id === alunoId) {
            alunoAtualizado = {
              ...item,
              ...dados,
              updated_by: currentUser.id,
              updated_at: now,
            } as Aluno;
            return alunoAtualizado;
          }
          return item;
        }));
        if (alunoAtualizado) {
        }
        registrarLog('ATUALIZACAO_ALUNO', 'alunos', alunoId, { codigo: dados.codigo, nome: dados.nome });
      } else {
        // Criar
        alunoId = generateUUID();
        const novoAluno: Aluno = {
          id: alunoId,
          codigo: dados.codigo || `ALU-${Date.now().toString().slice(-4)}`,
          nome: dados.nome || '',
          data_nascimento: dados.data_nascimento,
          idade_informada: dados.idade_informada,
          sexo: dados.sexo,
          endereco: dados.endereco,
          escola_id: escolaAlvo!,
          turma_id: dados.turma_id || null,
          ciclo: dados.ciclo || 1,
          serie: dados.serie || '',
          situacao_doc: dados.situacao_doc || 'sem_laudo',
          cid: dados.cid?.toUpperCase() || '',
          numero_processo: dados.numero_processo || '',
          contrato_acompanhante: Boolean(dados.contrato_acompanhante),
          necessita_professor_aee: dados.necessita_professor_aee !== undefined ? dados.necessita_professor_aee : true,
          necessita_acompanhante: Boolean(dados.necessita_acompanhante),
          professor_aee_id: dados.professor_aee_id || null,
          acompanhante_id: dados.acompanhante_id || null,
          observacoes: dados.observacoes || '',
          ativo: true,
          created_by: currentUser.id,
          updated_by: currentUser.id,
          created_at: now,
          updated_at: now,
        };

        setAlunosState(prev => [novoAluno, ...prev]);
        registrarLog('CRIACAO_ALUNO', 'alunos', alunoId, { codigo: novoAluno.codigo, nome: novoAluno.nome });
      }

      return { success: true, id: alunoId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar aluno';
      return { success: false, error: msg };
    }
  }, [ehNucleo, minhaEscolaId, currentUser.id, registrarLog]);

  const inativarAluno = useCallback(async (id: string) => {
    const alvo = alunosState.find(a => a.id === id);
    if (!alvo) return { success: false, error: 'Aluno não encontrado' };
    if (!ehNucleo && alvo.escola_id !== minhaEscolaId) {
      return { success: false, error: 'Permissão negada' };
    }

    setAlunosState(prev => prev.map(a => a.id === id ? { ...a, ativo: false, updated_at: new Date().toISOString() } : a));
    registrarLog('INATIVACAO_ALUNO', 'alunos', id, { codigo: alvo.codigo, nome: alvo.nome });
    return { success: true };
  }, [alunosState, ehNucleo, minhaEscolaId, registrarLog]);

  const salvarEscola = useCallback(async (dados: Partial<Escola>) => {
    if (!ehNucleo && dados.id && dados.id !== minhaEscolaId) {
      return { success: false, error: 'Permissão negada: você só pode alterar os dados da sua escola vinculada.' };
    }

    if (dados.id) {
      let escolaAtualizada: Escola | null = null;
      setEscolasState(prev => prev.map(e => {
        if (e.id === dados.id) {
          const srmStatus = dados.srm_status || e.srm_status;
          escolaAtualizada = {
            ...e,
            ...dados,
            possui_srm: srmStatus ? (srmStatus === 'ativa' || srmStatus === 'inativa') : e.possui_srm,
            updated_at: new Date().toISOString()
          } as Escola;
          return escolaAtualizada;
        }
        return e;
      }));
      if (escolaAtualizada) {
      }
      registrarLog('ATUALIZACAO_ESCOLA', 'escolas', dados.id, { nome: dados.nome, municipio: dados.municipio });
      return { success: true, id: dados.id };
    } else {
      const novoId = generateUUID();
      const siglaMuni = (dados.municipio || 'ALT').substring(0, 3).toUpperCase();
      const srmStatus = dados.srm_status || (dados.possui_srm ? 'ativa' : 'nao_possui');
      const nova: Escola = {
        id: novoId,
        codigo: dados.codigo?.trim() || `ESC-${siglaMuni}-${Date.now().toString().slice(-3)}`,
        nome: dados.nome?.trim() || 'Nova Escola Estadual',
        municipio: dados.municipio || 'Altamira',
        diretor_nome: dados.diretor_nome || '',
        cargo_responsavel: dados.cargo_responsavel || 'Diretor(a) Escolar',
        endereco: dados.endereco || '',
        telefone: dados.telefone || '',
        email: dados.email || '',
        modalidade: dados.modalidade || 'REGULAR',
        srm_status: srmStatus,
        possui_srm: srmStatus === 'ativa' || srmStatus === 'inativa',
        atendimento_some: dados.modalidade?.includes('SOME') || false,
        pdi_status_geral: dados.pdi_status_geral || 'parcial',
        situacao_cuidadores: dados.situacao_cuidadores || 'nenhum',
        qtd_alunos_laudo: Number(dados.qtd_alunos_laudo) || 0,
        qtd_alunos_sem_laudo: Number(dados.qtd_alunos_sem_laudo) || 0,
        detalhe_diagnosticos: dados.detalhe_diagnosticos || '',
        dificuldades_docentes: dados.dificuldades_docentes || '',
        observacoes_regionais: dados.observacoes_regionais || '',
        ativa: true,
        created_at: new Date().toISOString(),
      };
      setEscolasState(prev => [nova, ...prev]);
      registrarLog('CRIACAO_ESCOLA', 'escolas', novoId, { nome: nova.nome, codigo: nova.codigo, municipio: nova.municipio });
      return { success: true, id: novoId };
    }
  }, [ehNucleo, minhaEscolaId, registrarLog]);

  const inativarEscola = useCallback(async (id: string) => {
    if (!ehNucleo) return { success: false, error: 'Apenas a equipe do Núcleo pode inativar escolas.' };
    setEscolasState(prev => prev.map(e => e.id === id ? { ...e, ativa: false } : e));
    registrarLog('INATIVACAO_ESCOLA', 'escolas', id);
    return { success: true };
  }, [ehNucleo, registrarLog]);

  const salvarTurma = useCallback(async (dados: Partial<Turma>) => {
    const escolaAlvo = dados.escola_id || minhaEscolaId;
    if (!ehNucleo && escolaAlvo !== minhaEscolaId) {
      return { success: false, error: 'Permissão negada para turmas de outra escola.' };
    }

    if (dados.id) {
      let turmaAtualizada: Turma | null = null;
      setTurmasState(prev => prev.map(t => {
        if (t.id === dados.id) {
          turmaAtualizada = { ...t, ...dados } as Turma;
          return turmaAtualizada;
        }
        return t;
      }));
      if (turmaAtualizada) {
      }
      registrarLog('ATUALIZACAO_TURMA', 'turmas', dados.id, { nome: dados.nome });
      return { success: true, id: dados.id };
    } else {
      const novoId = generateUUID();
      const nova: Turma = {
        id: novoId,
        escola_id: escolaAlvo!,
        codigo: dados.codigo || `TUR-${Date.now().toString().slice(-3)}`,
        nome: dados.nome || 'Turma',
        turno: dados.turno || 'Manhã',
        ano_letivo: dados.ano_letivo || new Date().getFullYear(),
        created_at: new Date().toISOString(),
      };
      setTurmasState(prev => [nova, ...prev]);
      registrarLog('CRIACAO_TURMA', 'turmas', novoId, { codigo: nova.codigo, escola_id: nova.escola_id });
      return { success: true, id: novoId };
    }
  }, [ehNucleo, minhaEscolaId, registrarLog]);

  const excluirTurma = useCallback(async (id: string) => {
    const turma = turmasState.find(t => t.id === id);
    if (!turma) return { success: false, error: 'Turma não encontrada' };
    if (!ehNucleo && turma.escola_id !== minhaEscolaId) return { success: false, error: 'Permissão negada' };

    setTurmasState(prev => prev.filter(t => t.id !== id));
    registrarLog('EXCLUSAO_TURMA', 'turmas', id);
    return { success: true };
  }, [turmasState, ehNucleo, minhaEscolaId, registrarLog]);

  const salvarProfissional = useCallback(async (dados: Partial<Profissional>) => {
    const escolaAlvo = dados.escola_id || minhaEscolaId;
    if (!ehNucleo && escolaAlvo !== minhaEscolaId) {
      return { success: false, error: 'Permissão negada.' };
    }

    if (dados.id) {
      let profAtualizado: Profissional | null = null;
      setProfissionaisState(prev => prev.map(p => {
        if (p.id === dados.id) {
          profAtualizado = { ...p, ...dados } as Profissional;
          return profAtualizado;
        }
        return p;
      }));
      if (profAtualizado) {
      }
      registrarLog('ATUALIZACAO_PROFISSIONAL', 'profissionais', dados.id, { nome: dados.nome });
      return { success: true, id: dados.id };
    } else {
      const novoId = generateUUID();
      const novo: Profissional = {
        id: novoId,
        escola_id: escolaAlvo!,
        nome: dados.nome || '',
        tipo: dados.tipo || 'professor_aee',
        documento_ou_matricula: dados.documento_ou_matricula,
        telefone: dados.telefone,
        ativo: true,
        created_at: new Date().toISOString(),
      };
      setProfissionaisState(prev => [novo, ...prev]);
      registrarLog('CRIACAO_PROFISSIONAL', 'profissionais', novoId, { nome: novo.nome, tipo: novo.tipo });
      return { success: true, id: novoId };
    }
  }, [ehNucleo, minhaEscolaId, registrarLog]);

  const inativarProfissional = useCallback(async (id: string) => {
    const prof = profissionaisState.find(p => p.id === id);
    if (!prof) return { success: false, error: 'Profissional não encontrado' };
    if (!ehNucleo && prof.escola_id !== minhaEscolaId) return { success: false, error: 'Permissão negada' };

    setProfissionaisState(prev => prev.map(p => p.id === id ? { ...p, ativo: false } : p));
    registrarLog('INATIVACAO_PROFISSIONAL', 'profissionais', id);
    return { success: true };
  }, [profissionaisState, ehNucleo, minhaEscolaId, registrarLog]);

  const salvarPDI = useCallback(async (dados: Partial<PDI>) => {
    const aluno = alunosState.find(a => a.id === dados.aluno_id);
    if (!aluno) return { success: false, error: 'Aluno não encontrado' };
    if (!ehNucleo && aluno.escola_id !== minhaEscolaId) return { success: false, error: 'Permissão negada' };

    const ano = dados.ano_letivo || new Date().getFullYear();
    const now = new Date().toISOString();

    // Regra do banco: se o status for 'vigente', apenas 1 PDI pode ser vigente por aluno no ano
    if (dados.status === 'vigente') {
      const jaExisteVigente = pdisState.some(
        p => p.aluno_id === aluno.id && p.ano_letivo === ano && p.status === 'vigente' && p.id !== dados.id
      );
      if (jaExisteVigente) {
        // Encerra ou altera o anterior para evitar conflito
        setPdisState(prev => prev.map(p => {
          if (p.aluno_id === aluno.id && p.ano_letivo === ano && p.status === 'vigente' && p.id !== dados.id) {
            return { ...p, status: 'encerrado', updated_at: now };
          }
          return p;
        }));
      }
    }

    if (dados.id) {
      let pdiAtualizado: PDI | null = null;
      setPdisState(prev => prev.map(p => {
        if (p.id === dados.id) {
          pdiAtualizado = { ...p, ...dados, updated_at: now } as PDI;
          return pdiAtualizado;
        }
        return p;
      }));
      if (pdiAtualizado) {
      }
      registrarLog('ATUALIZACAO_PDI', 'pdis', dados.id, { aluno_id: aluno.id, ano });
      return { success: true, id: dados.id };
    } else {
      const novoId = generateUUID();
      const novo: PDI = {
        id: novoId,
        aluno_id: aluno.id,
        escola_id: aluno.escola_id,
        ano_letivo: ano,
        status: dados.status || 'rascunho',
        conteudo: dados.conteudo || {},
        elaborado_por: dados.elaborado_por || currentUser.nome,
        data_elaboracao: dados.data_elaboracao || new Date().toISOString().split('T')[0],
        created_by: currentUser.id,
        created_at: now,
        updated_at: now,
      };
      setPdisState(prev => [novo, ...prev]);
      registrarLog('CRIACAO_PDI', 'pdis', novoId, { aluno_id: aluno.id, ano });
      return { success: true, id: novoId };
    }
  }, [alunosState, ehNucleo, minhaEscolaId, pdisState, currentUser, registrarLog]);

  const salvarEstudoDeCaso = useCallback(async (dados: Partial<EstudoDeCaso>) => {
    const now = new Date().toISOString();
    if (!dados.aluno_id) {
      return { success: false, error: 'Aluno não informado' };
    }

    if (dados.id) {
      setEstudosDeCasoState(prev => prev.map(e => e.id === dados.id ? { ...e, ...dados, updated_at: now } as EstudoDeCaso : e));
      registrarLog('ATUALIZACAO_ESTUDO_CASO', 'estudos_de_caso', dados.id, { aluno_id: dados.aluno_id });
      return { success: true, id: dados.id };
    } else {
      const novoId = generateUUID();
      const novo: EstudoDeCaso = {
        ...(dados as EstudoDeCaso),
        id: novoId,
        status: dados.status || 'rascunho',
        data_preenchimento: dados.data_preenchimento || new Date().toISOString().split('T')[0],
        created_by: currentUser.id,
        updated_at: now,
      };
      setEstudosDeCasoState(prev => [novo, ...prev]);
      registrarLog('CRIACAO_ESTUDO_CASO', 'estudos_de_caso', novoId, { aluno_id: dados.aluno_id });
      return { success: true, id: novoId };
    }
  }, [currentUser.id, registrarLog]);

  const excluirEstudoDeCaso = useCallback(async (id: string) => {
    setEstudosDeCasoState(prev => prev.filter(e => e.id !== id));
    registrarLog('EXCLUSAO_ESTUDO_CASO', 'estudos_de_caso', id);
    return { success: true };
  }, [registrarLog]);

  const salvarPEI = useCallback(async (dados: Partial<PEIOfficial>) => {
    const now = new Date().toISOString();
    if (!dados.aluno_id) {
      return { success: false, error: 'Aluno não informado' };
    }

    if (dados.id) {
      setPeisState(prev => prev.map(p => p.id === dados.id ? { ...p, ...dados, updated_at: now } as PEIOfficial : p));
      registrarLog('ATUALIZACAO_PEI', 'peis', dados.id, { aluno_id: dados.aluno_id });
      return { success: true, id: dados.id };
    } else {
      const novoId = generateUUID();
      const novo: PEIOfficial = {
        ...(dados as PEIOfficial),
        id: novoId,
        status: dados.status || 'rascunho',
        ano_letivo: dados.ano_letivo || new Date().getFullYear(),
        data_elaboracao: dados.data_elaboracao || new Date().toISOString().split('T')[0],
        created_by: currentUser.id,
        updated_at: now,
      };
      setPeisState(prev => [novo, ...prev]);
      registrarLog('CRIACAO_PEI', 'peis', novoId, { aluno_id: dados.aluno_id });
      return { success: true, id: novoId };
    }
  }, [currentUser.id, registrarLog]);

  const excluirPEI = useCallback(async (id: string) => {
    setPeisState(prev => prev.filter(p => p.id !== id));
    registrarLog('EXCLUSAO_PEI', 'peis', id);
    return { success: true };
  }, [registrarLog]);

  const obterEstudoDeCaso = useCallback((alunoId: string) => {
    return estudosDeCasoState.find(e => e.aluno_id === alunoId);
  }, [estudosDeCasoState]);

  const obterPEI = useCallback((alunoId: string) => {
    return peisState.find(p => p.aluno_id === alunoId);
  }, [peisState]);

  const salvarDocumento = useCallback(async (doc: Omit<DocumentoAluno, 'id' | 'created_at'>) => {
    if (!ehNucleo && doc.escola_id !== minhaEscolaId) {
      return { success: false, error: 'Permissão negada' };
    }
    const novoId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const novoDoc: DocumentoAluno = {
      ...doc,
      id: novoId,
      created_at: new Date().toISOString(),
    };
    setDocumentosState(prev => [novoDoc, ...prev]);
    registrarLog('UPLOAD_DOCUMENTO', 'documentos_aluno', novoId, { tipo: doc.tipo, titulo: doc.titulo });
    return { success: true, id: novoId };
  }, [ehNucleo, minhaEscolaId, registrarLog]);

  const excluirDocumento = useCallback(async (id: string) => {
    const doc = documentosState.find(d => d.id === id);
    if (!doc) return { success: false, error: 'Documento não encontrado' };
    if (!ehNucleo && doc.escola_id !== minhaEscolaId) return { success: false, error: 'Permissão negada' };

    setDocumentosState(prev => prev.filter(d => d.id !== id));
    registrarLog('EXCLUSAO_DOCUMENTO', 'documentos_aluno', id);
    return { success: true };
  }, [documentosState, ehNucleo, minhaEscolaId, registrarLog]);

  const proximoNumeroOficio = useCallback((ano: number) => {
    const oficiosAno = oficiosState.filter(o => o.ano === ano);
    if (oficiosAno.length === 0) return 1;
    const max = Math.max(...oficiosAno.map(o => o.numero));
    return max + 1;
  }, [oficiosState]);

  const salvarOficio = useCallback(async (dados: Partial<Oficio>) => {
    if (!ehNucleo) {
      return { success: false, error: 'Apenas a equipe do Núcleo pode criar ou emitir ofícios.' };
    }

    const ano = dados.ano || new Date().getFullYear();
    const now = new Date().toISOString();

    if (dados.id) {
      let oficioAtualizado: Oficio | null = null;
      setOficiosState(prev => prev.map(o => {
        if (o.id === dados.id) {
          oficioAtualizado = {
            ...o,
            ...dados,
            emitido_em: dados.status === 'emitido' && !o.emitido_em ? now : o.emitido_em,
          } as Oficio;
          return oficioAtualizado;
        }
        return o;
      }));
      if (oficioAtualizado) {
      }
      registrarLog('ATUALIZACAO_OFICIO', 'oficios', dados.id, { numero: dados.numero, status: dados.status });
      return { success: true, id: dados.id };
    } else {
      const numero = proximoNumeroOficio(ano);
      const novoId = generateUUID();
      const novo: Oficio = {
        id: novoId,
        ano,
        numero,
        assunto: dados.assunto || 'Solicitação de Atendimento Educacional Especializado',
        destinatario: dados.destinatario || 'SEDUC/PA - Diretoria de Educação Especial',
        corpo: dados.corpo || '',
        status: dados.status || 'rascunho',
        escola_id: dados.escola_id || null,
        criado_por: currentUser.id,
        criado_por_nome: `${currentUser.nome} (${currentUser.cargo})`,
        emitido_em: dados.status === 'emitido' ? now : undefined,
        created_at: now,
        alunos_ids: dados.alunos_ids || [],
      };
      setOficiosState(prev => [novo, ...prev]);
      registrarLog('EMISSAO_OFICIO', 'oficios', novoId, { numero, ano, destinatario: novo.destinatario });
      return { success: true, id: novoId };
    }
  }, [ehNucleo, proximoNumeroOficio, currentUser, registrarLog]);

  const registrarRespostaOficio = useCallback(async (
    id: string,
    dataResp: string,
    protocolo: string,
    resumo: string
  ) => {
    if (!ehNucleo) return { success: false, error: 'Apenas o Núcleo pode registrar respostas de ofícios' };
    let respOficio: Oficio | null = null;
    setOficiosState(prev => prev.map(o => {
      if (o.id === id) {
        respOficio = {
          ...o,
          status: 'respondido',
          resposta_recebida_em: dataResp,
          resposta_resumo: protocolo ? `[Protocolo ${protocolo}] ${resumo}` : resumo,
        };
        return respOficio;
      }
      return o;
    }));
    if (respOficio) {
    }
    registrarLog('RESPOSTA_OFICIO', 'oficios', id, { dataResp, protocolo, resumo });
    return { success: true };
  }, [ehNucleo, registrarLog]);

  const salvarUsuario = useCallback(async (dados: Partial<Profile>) => {
    try {
      const salvo = await dbSalvarUsuario({
        id: dados.id,
        nome: dados.nome,
        email: dados.email,
        cargo: dados.cargo,
        papel: dados.papel,
        escola_id: dados.papel?.startsWith('nucleo') ? null : dados.escola_id,
        ativo: dados.ativo,
        senha: dados.senha?.trim() || undefined,
      });
      setProfilesState(prev => prev.some(p => p.id === salvo.id) ? prev.map(p => p.id === salvo.id ? salvo : p) : [...prev, salvo]);
      registrarLog(dados.id ? 'ATUALIZACAO_USUARIO' : 'CRIACAO_USUARIO', 'profiles', salvo.id, { nome: salvo.nome, email: salvo.email, papel: salvo.papel });
      return { success: true, id: salvo.id };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Não foi possível salvar o usuário.' };
    }
  }, [registrarLog]);

  const alternarStatusUsuario = useCallback(async (id: string) => {
    if (id === currentUser.id) return { success: false, error: 'Você não pode desativar seu próprio usuário atualmente conectado.' };
    const target = profilesState.find(p => p.id === id);
    if (!target) return { success: false, error: 'Usuário não encontrado.' };
    const novoStatus = !target.ativo;
    try {
      await dbStatusUsuario(id, novoStatus);
    } catch (e: any) {
      return { success: false, error: e?.message || 'Não foi possível alterar o status.' };
    }
    setProfilesState(prev => prev.map(p => p.id === id ? { ...p, ativo: novoStatus } : p));
    registrarLog(novoStatus ? 'ATIVACAO_USUARIO' : 'DESATIVACAO_USUARIO', 'profiles', id, { nome: target.nome, email: target.email, novoStatus: novoStatus ? 'ativo' : 'inativo' });
    return { success: true, novoStatus };
  }, [currentUser.id, profilesState, registrarLog]);

  const excluirUsuario = useCallback(async (id: string) => {
    if (id === currentUser.id) return { success: false, error: 'Você não pode excluir seu próprio usuário atualmente conectado.' };
    const target = profilesState.find(p => p.id === id);
    if (!target) return { success: false, error: 'Usuário não encontrado.' };
    try {
      await dbExcluirUsuario(id);
    } catch (e: any) {
      return { success: false, error: e?.message || 'Não foi possível excluir o usuário.' };
    }
    setProfilesState(prev => prev.filter(p => p.id !== id));
    registrarLog('EXCLUSAO_USUARIO', 'profiles', id, { nome: target.nome, email: target.email, papel: target.papel });
    return { success: true };
  }, [currentUser.id, profilesState, registrarLog]);

  // Login validado no servidor (senha com hash scrypt, cookie HttpOnly, bloqueio após tentativas falhas)
  const login = useCallback(async (emailOuNome: string, senhaDigitada?: string) => {
    const email = emailOuNome.trim();
    if (!email) return { success: false, error: 'Por favor, informe seu e-mail institucional.' };
    try {
      await api('auth/login', { method: 'POST', body: { email, senha: senhaDigitada || '' } });
      const dados = await fetchBootstrap();
      aplicarBootstrap(dados);
      dbInsertAuditLog({ id: generateUUID(), user_id: dados.user.id, user_nome: dados.user.nome, acao: 'LOGIN_SISTEMA', tabela: 'auth', registro_id: dados.user.id, detalhes: { email: dados.user.email }, created_at: new Date().toISOString() } as AuditLogItem);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Não foi possível entrar. Tente novamente.' };
    }
  }, [aplicarBootstrap]);

  const logout = useCallback(() => {
    registrarLog('LOGOUT_SISTEMA', 'auth', currentUser.id, { email: currentUser.email });
    setTimeout(() => { api('auth/logout', { method: 'POST', body: {} }).catch(() => {}).finally(limparSessaoLocal); }, 150);
  }, [currentUser.id, currentUser.email, registrarLog, limparSessaoLocal]);

  const importarLote = useCallback(async (
    escolasNovas: Partial<Escola>[],
    turmasNovas: Partial<Turma>[],
    profissionaisNovos: Partial<Profissional>[],
    alunosNovos: Partial<Aluno>[]
  ) => {
    if (!ehNucleo) return { criados: 0, atualizados: 0, erros: ['Permissão negada: apenas o Núcleo pode importar planilhas'] };

    let criados = 0;
    let atualizados = 0;
    const erros: string[] = [];

    // 1. Upsert Escolas
    setEscolasState(prev => {
      const copy = [...prev];
      for (const e of escolasNovas) {
        if (!e.codigo || !e.nome) continue;
        const idx = copy.findIndex(x => x.codigo.toLowerCase() === e.codigo?.toLowerCase());
        if (idx >= 0) {
          copy[idx] = { ...copy[idx], ...e };
        } else {
          copy.push({
            id: e.id || generateUUID(),
            codigo: e.codigo,
            nome: e.nome,
            municipio: e.municipio || 'Altamira',
            diretor_nome: e.diretor_nome,
            endereco: e.endereco,
            telefone: e.telefone,
            email: e.email,
            ativa: true,
            created_at: new Date().toISOString(),
          });
        }
      }
      return copy;
    });

    // 2. Upsert Turmas
    setTurmasState(prev => {
      const copy = [...prev];
      for (const t of turmasNovas) {
        if (!t.codigo || !t.escola_id) continue;
        const idx = copy.findIndex(x => x.codigo.toLowerCase() === t.codigo?.toLowerCase() && x.escola_id === t.escola_id);
        if (idx >= 0) {
          copy[idx] = { ...copy[idx], ...t };
        } else {
          copy.push({
            id: t.id || generateUUID(),
            codigo: t.codigo,
            nome: t.nome || t.codigo,
            escola_id: t.escola_id,
            turno: t.turno || 'Manhã',
            ano_letivo: t.ano_letivo || new Date().getFullYear(),
            created_at: new Date().toISOString(),
          });
        }
      }
      return copy;
    });

    // 3. Upsert Profissionais
    setProfissionaisState(prev => {
      const copy = [...prev];
      for (const p of profissionaisNovos) {
        if (!p.nome || !p.escola_id || !p.tipo) continue;
        const idx = copy.findIndex(x => x.nome.toLowerCase() === p.nome?.toLowerCase() && x.escola_id === p.escola_id);
        if (idx >= 0) {
          copy[idx] = { ...copy[idx], ...p };
        } else {
          copy.push({
            id: p.id || generateUUID(),
            nome: p.nome,
            escola_id: p.escola_id,
            tipo: p.tipo,
            documento_ou_matricula: p.documento_ou_matricula,
            ativo: true,
            created_at: new Date().toISOString(),
          });
        }
      }
      return copy;
    });

    // 4. Upsert Alunos
    setAlunosState(prev => {
      const copy = [...prev];
      const now = new Date().toISOString();
      for (const a of alunosNovos) {
        if (!a.codigo || !a.nome || !a.escola_id) {
          erros.push(`Linha ignorada: dados obrigatórios ausentes (${a.nome || 'sem nome'})`);
          continue;
        }

        const idx = copy.findIndex(x => x.codigo.toLowerCase() === a.codigo?.toLowerCase());
        if (idx >= 0) {
          copy[idx] = {
            ...copy[idx],
            ...a,
            updated_by: currentUser.id,
            updated_at: now,
          };
          atualizados++;
        } else {
          copy.push({
            id: a.id || generateUUID(),
            codigo: a.codigo,
            nome: a.nome,
            data_nascimento: a.data_nascimento,
            idade_informada: a.idade_informada,
            sexo: a.sexo,
            endereco: a.endereco,
            escola_id: a.escola_id,
            turma_id: a.turma_id || null,
            ciclo: a.ciclo || 1,
            serie: a.serie || '',
            situacao_doc: a.situacao_doc || 'sem_laudo',
            cid: a.cid || '',
            numero_processo: a.numero_processo || '',
            contrato_acompanhante: Boolean(a.contrato_acompanhante),
            necessita_professor_aee: a.necessita_professor_aee !== undefined ? a.necessita_professor_aee : true,
            necessita_acompanhante: Boolean(a.necessita_acompanhante),
            professor_aee_id: a.professor_aee_id || null,
            acompanhante_id: a.acompanhante_id || null,
            observacoes: a.observacoes || '',
            ativo: true,
            created_by: currentUser.id,
            updated_by: currentUser.id,
            created_at: now,
            updated_at: now,
          });
          criados++;
        }
      }
      return copy;
    });

    registrarLog('IMPORTACAO_EXCEL', 'alunos', undefined, { criados, atualizados, total_erros: erros.length });
    return { criados, atualizados, erros };
  }, [ehNucleo, currentUser.id, registrarLog]);

  const importarAlunosEmLote = useCallback(async (linhasValidadas: any[]) => {
    if (!ehNucleo) return { success: false, totalImportados: 0, error: 'Apenas o Núcleo pode importar planilhas' };

    const alunosParaInserir: Partial<Aluno>[] = linhasValidadas
      .filter((r: any) => r.valida)
      .map((r: any) => ({
        ...r.normalized,
        ativo: true,
      }));

    const res = await importarLote([], [], [], alunosParaInserir);
    return {
      success: res.erros.length === 0 || (res.criados + res.atualizados) > 0,
      totalImportados: res.criados + res.atualizados,
      error: res.erros.join(', '),
    };
  }, [ehNucleo, importarLote]);

  const value = useMemo(() => ({
    isAuthenticated,
    login,
    logout,
    currentUser,
    setCurrentUser: (u: Profile) => setCurrentUserId(u.id),
    carregando,
    syncErro,
    limparSyncErro: () => setSyncErro(null),
    ehNucleo,
    minhaEscolaId,
    minhaEscola,
    escolas,
    profissionais,
    turmas,
    alunos,
    pdis,
    estudosDeCaso: estudosDeCasoState,
    peis: peisState,
    oficios,
    documentos,
    usuarios,
    auditLogs,
    auditoriaLogs: auditLogs,
    todasEscolas,
    salvarAluno,
    inativarAluno,
    salvarEscola,
    inativarEscola,
    salvarTurma,
    excluirTurma,
    salvarProfissional,
    inativarProfissional,
    salvarPDI,
    salvarEstudoDeCaso,
    excluirEstudoDeCaso,
    salvarPEI,
    excluirPEI,
    obterEstudoDeCaso,
    obterPEI,
    salvarDocumento,
    excluirDocumento,
    salvarOficio,
    registrarRespostaOficio,
    proximoNumeroOficio,
    salvarUsuario,
    alternarStatusUsuario,
    excluirUsuario,
    registrarLog,
    importarLote,
    importarAlunosEmLote,
  }), [
    isAuthenticated,
    login,
    logout,
    currentUser,
    ehNucleo,
    minhaEscolaId,
    minhaEscola,
    escolas,
    profissionais,
    turmas,
    alunos,
    pdis,
    estudosDeCasoState,
    peisState,
    oficios,
    documentos,
    usuarios,
    auditLogs,
    todasEscolas,
    salvarAluno,
    inativarAluno,
    salvarEscola,
    inativarEscola,
    salvarTurma,
    excluirTurma,
    salvarProfissional,
    inativarProfissional,
    salvarPDI,
    salvarEstudoDeCaso,
    excluirEstudoDeCaso,
    salvarPEI,
    excluirPEI,
    obterEstudoDeCaso,
    obterPEI,
    salvarDocumento,
    excluirDocumento,
    salvarOficio,
    registrarRespostaOficio,
    proximoNumeroOficio,
    salvarUsuario,
    alternarStatusUsuario,
    excluirUsuario,
    registrarLog,
    importarLote,
    importarAlunosEmLote,
    carregando,
    syncErro,
  ]);

  return (
    <AppStoreContext.Provider value={value}>
      {children}
    </AppStoreContext.Provider>
  );
};

export const useAppStore = () => {
  const context = useContext(AppStoreContext);
  if (!context) {
    throw new Error('useAppStore deve ser usado dentro de AppStoreProvider');
  }
  return context;
};
