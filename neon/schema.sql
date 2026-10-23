-- DRE Altamira | Sistema de Gestão do AEE | Neon PostgreSQL
-- Schema de produção. Não cria usuários, senhas nem dados de demonstração.
-- Ordem: 1) este arquivo (banco nasce vazio)  2) npm run create-admin (primeiro usuário do Núcleo)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Usuários (login no servidor; a senha nunca é guardada em texto, apenas hash scrypt)
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  email text NOT NULL,
  cargo text,
  papel text NOT NULL CHECK (papel IN ('nucleo_diretor','nucleo_tecnico','diretor_escola','secretaria_escola')),
  escola_id text NULL,
  ativo boolean NOT NULL DEFAULT true,
  senha_hash text NOT NULL,
  ultimo_acesso timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT escola_ou_nucleo CHECK (
    (papel IN ('diretor_escola','secretaria_escola') AND escola_id IS NOT NULL) OR
    (papel IN ('nucleo_diretor','nucleo_tecnico') AND escola_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_uq ON app_users (lower(email));

-- Registros do sistema: um módulo por tipo de dado, conteúdo completo em JSONB
-- módulos: escolas, profissionais, turmas, alunos, pdis, estudos_de_caso, peis, documentos, oficios
CREATE TABLE IF NOT EXISTS app_records (
  module text NOT NULL CHECK (module IN ('escolas','profissionais','turmas','alunos','pdis','estudos_de_caso','peis','documentos','oficios')),
  id text NOT NULL,
  escola_id text NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, id)
);
CREATE INDEX IF NOT EXISTS app_records_escola_idx ON app_records (module, escola_id);
CREATE INDEX IF NOT EXISTS app_records_updated_idx ON app_records (module, updated_at DESC);
-- regras do original: código único de escola e de aluno; numeração única de ofício por ano
CREATE UNIQUE INDEX IF NOT EXISTS app_records_escola_codigo_uq ON app_records ((data->>'codigo')) WHERE module = 'escolas';
CREATE UNIQUE INDEX IF NOT EXISTS app_records_aluno_codigo_uq ON app_records ((data->>'codigo')) WHERE module = 'alunos';
CREATE UNIQUE INDEX IF NOT EXISTS app_records_oficio_numero_uq ON app_records ((data->>'ano'), (data->>'numero')) WHERE module = 'oficios';

-- Trilha de auditoria (LGPD)
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  user_nome text,
  acao text NOT NULL,
  tabela text NOT NULL,
  registro_id text,
  detalhes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
