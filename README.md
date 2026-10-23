# Sistema de Gestão de Educação Especial — SEDUC-PA (DRE Altamira)

Sistema integrado desenvolvido para o **Núcleo de Educação Especial da Diretoria Regional de Ensino de Altamira (DRE Altamira)** em articulação com a **Secretaria de Estado de Educação do Pará (SEDUC-PA)** e a **Coordenação de Educação Especial (COEES)**.

O sistema centraliza o controle regional do **Atendimento Educacional Especializado (AEE)**, o semáforo de conformidade de atendimento, elaboração e vigência do **PDI (Plano de Desenvolvimento Individual)**, acompanhamento de laudos e estudos de caso, gestão de recursos humanos (professores de AEE e cuidadores/acompanhantes), emissão de ofícios à SEDUC e análise estatística abrangente dos 8 municípios da região da Transamazônica e Xingu.

---


## 📑 Sumário
1. Visão geral e funcionalidades
2. Arquitetura (Vercel + Neon)
3. Publicar: passo a passo
4. Rodar localmente
5. Guia de utilização
6. Regras de negócio e semáforo
7. Segurança, LGPD e limitações
8. Autoria

---

## 🏛️ Visão Geral e Arquitetura

O sistema atende a duas esferas de atuação educacional:
- **Núcleo Regional (DRE Altamira):** Gestão macro de todos os 8 polos municipais (*Altamira, Brasil Novo, Vitória do Xingu, Porto de Moz, Senador José Porfírio, Medicilândia, Anapu e Uruará*), com autoridade para emissão de ofícios institucionais à sede da SEDUC-PA, gestão de lotação de docentes/cuidadores, auditoria completa e análise de relatórios executivos.
- **Unidade Escolar (Direção e Secretaria):** Visão restrita à própria escola, com cadastro e acompanhamento individual de cada estudante, vinculação às turmas e acompanhamento da elaboração dos planos pedagógicos (PDI/PEI).

---

## 🚀 Funcionalidades Principais

1. **Dashboard Estatístico Completo (Métricas Panorâmicas):**
   - **Semáforo de Atendimento em Tempo Real:** Distribuição visual em 6 status regulamentares (Regular/OK, Sem Nenhum Profissional, Falta Professor AEE, Falta Cuidador, Contrato Pendente, Sem Demanda Direta).
   - **Painel Clínico de Diagnósticos & CIDs:** Gráficos empilhados por patologia (*TEA, Deficiência Intelectual, Deficiência Física/Paralisia, Deficiência Visual, Deficiência Auditiva, Síndrome de Down, TDAH e Múltiplas*).
   - **Comparativo dos 8 Municípios da DRE:** Métricas de matrículas, cobertura regular e salas de recursos multifuncionais (SRM) ativas.
   - **Recursos Humanos:** Balanço de demanda vs. profissionais alocados e controle de vigência dos contratos de apoio.
   - **Controle Documental & PDI 2026:** Percentual de laudos médicos homologados, estudos de caso em andamento e cobertura de PDIs vigentes.
   - **Ciclos, Turnos e Pirâmide Etária:** Estratificação por Ensino Fundamental, Ensino Médio, EJA e faixas de idade.

2. **Gestão de Estudantes (Cadastro e Prontuário AEE):**
   - Cadastro detalhado com CID, número de processo administrativo na SEDUC, ciclo e série.
   - Vinculação a Professor Especialista de AEE e Acompanhante/Cuidador.
   - Sinalização automática de conformidade pelo Semáforo de Atendimento.
   - Exportação completa da listagem de alunos para planilhas Excel (`.xlsx`).

3. **PDI (Plano de Desenvolvimento Individual) & PEI:**
   - Formulário estruturado com áreas de desenvolvimento: Comunicação e Linguagem, Cognitivo, Motor/Sensorial, Socialização e Habilidades Acadêmicas.
   - Definição de objetivos pedagógicos, recursos de tecnologia assistiva, adaptações curriculares e critérios de avaliação.
   - Controle de versões e status: Rascunho, Vigente e Encerrado.

4. **Estudos de Caso e Documentos do Estudante:**
   - Registro de histórico familiar, anamnese, barreiras de aprendizagem e justificativas pedagógicas.
   - Upload e arquivamento de laudos periciais, relatórios multidisciplinares e declarações.

5. **Módulo de Escolas e Salas de Recursos Multifuncionais (SRM):**
   - Cadastro de todas as unidades estaduais da DRE Altamira com endereços, contatos e dados da gestão.
   - Monitoramento do status da SRM: Ativa, Inativa, Sem SRM ou regime SOME/CEMEP.

6. **Ofícios e Encaminhamentos Institucionais:**
   - Numeração sequencial automática de ofícios por ano (`Ofício nº 001/2026 - DRE/ALTAMIRA`).
   - Pré-seleção automática de estudantes com déficits de profissionais para anexar ao documento.
   - Registro de protocolos de envio, respostas da SEDUC-PA e exportação em documento oficial para impressão/assinatura.

7. **Documentos Oficiais COEES / SEDUC-PA:**
   - Visualização e geração dos modelos padronizados de instrumentais da Secretaria de Educação.

8. **Carga em Lote (Importador de Planilhas):**
   - Importação em massa de alunos, turmas, escolas e profissionais a partir de arquivos `.xlsx` e `.csv`.

9. **Segurança e Auditoria (LGPD):**
   - Trilha de auditoria permanente (`audit_log`) registrando data/hora, operador e alterações em registros de alunos.

---


## 🧱 Arquitetura (Vercel + Neon)

- **Front-end:** React 19 + TypeScript + Tailwind v4 + Recharts (todas as telas do sistema original).
- **API:** função serverless em `api/[...path].ts` (Vercel). É a **única** parte que fala com o banco.
- **Banco:** PostgreSQL no **Neon**. Tabelas: `app_users` (usuários, senha com hash scrypt), `app_records` (escolas, alunos, turmas, profissionais, PDI, PEI, estudos de caso, documentos e ofícios) e `audit_log` (trilha LGPD).
- **Sem chaves no navegador:** a `DATABASE_URL` existe só no servidor. Não há Supabase, `localStorage` de dados nem senha embutida.
- **Perfis (equivalente ao RLS do original, agora aplicado no servidor):** Núcleo vê e grava tudo; Direção/Secretaria só enxergam e gravam a **própria escola**; ofícios, usuários e auditoria são exclusivos do Núcleo.
- **Gravação automática:** qualquer alteração nas telas é enviada ao Neon em segundos; se falhar, aparece um aviso vermelho no topo.

---

## 🚀 Publicar: passo a passo

1. **Neon:** crie um projeto e copie a connection string.
2. **Neon → SQL Editor:** execute `neon/schema.sql`. O banco nasce **vazio**: sem escolas, alunos, usuários ou dados de exemplo.
3. **Gere a chave de sessão:** `openssl rand -hex 32`.
   **Crie o armazenamento de arquivos:** na Vercel, *Storage → Create → Blob* e escolha acesso **Private** (ou `vercel blob create-store dre-arquivos --access private`), conectando ao projeto. Isso cria sozinho a variável `BLOB_READ_WRITE_TOKEN`. **Não use store público.**
4. **Vercel:** importe o repositório (framework: Vite) e cadastre as variáveis `DATABASE_URL` e `SESSION_SECRET` (Production, Preview e Development).
5. Faça o **deploy**.
6. **Crie o primeiro administrador** (no seu computador, com a mesma `DATABASE_URL`):
   ```bash
   npm install
   DATABASE_URL='sua-connection-string' npm run create-admin
   ```
   O script pede nome, e-mail, cargo e senha (mínimo 12 caracteres). Não existe usuário nem senha padrão.
7. Abra `/api/health` (deve responder `{"ok":true}`), entre no sistema cadastre as escolas (tela **Escolas** ou **Importar Planilha**) e depois os demais usuários em **Usuários & Auditoria**. Os modelos de documentos (PDI, PEI, Estudo de Caso e Ofícios) já vêm prontos e puxam automaticamente os dados do aluno cadastrado.

## 💻 Rodar localmente
```bash
npm install
# .env.local com DATABASE_URL e SESSION_SECRET (veja .env.example)
npx vercel dev      # front-end + API juntos
```
`npm run dev` sozinho sobe só a interface (sem API). `npm run build` gera a versão de produção.

---

## 📖 Guia de Utilização do Sistema (Passo a Passo)

### 1. Acesso ao Sistema (Login)
- Na tela de login, informe o e-mail institucional e a senha definidas pelo Núcleo.
- Primeiro acesso e redefinição de senha: procure o Núcleo de Educação Especial da DRE.

### 2. Navegação no Dashboard
- Ao autenticar, você verá o painel com as métricas do semáforo.
- Utilize a barra superior de abas para alternar entre:
  - **Semáforo de Atendimento:** Gráfico de rosca e quantitativos absolutos.
  - **Diagnósticos & CIDs:** Visualização das condições de saúde dos alunos.
  - **Polos Regionais:** Comparativo dos 8 municípios da região.
  - **Recursos Humanos:** Relação de carências de professores e acompanhantes.
  - **Laudos & PDI 2026:** Indicadores de documentação e cumprimento de planos.
  - **Ciclos, Turnos & Idades:** Distribuição por turnos e faixas etárias.
- É possível clicar diretamente em qualquer card numérico do semáforo para ir à listagem de estudantes filtrada automaticamente por aquele status.

### 3. Gerenciando Estudantes (Módulo Alunos)
1. Clique em **Alunos** no menu lateral.
2. Utilize o botão **Novo Aluno** no topo direito para registrar um novo estudante.
3. Preencha os dados de identificação, turma, laudo médico/CID e assinale se ele necessita de Professor de AEE e/ou Acompanhante.
4. Ao salvar, o sistema calcula em tempo real o status de atendimento e insere o registro na trilha de auditoria.
5. Para exportar os dados para auditoria externa, clique em **Exportar Excel**.

### 4. Criando e Acompanhando o PDI / PEI
1. Na lista de alunos, localize o estudante desejado.
2. Clique no ícone de **PDI** ou abra as opções do aluno.
3. Preencha as metas pedagógicas, adaptações e cronograma de atendimentos na SRM.
4. Altere o status para **Vigente** para regularizar a conformidade pedagógica do estudante perante a DRE.

### 5. Emitindo Ofícios de Solicitação à SEDUC-PA (Apenas Núcleo)
1. Acesse o menu **Ofícios à SEDUC**.
2. Clique em **Novo Ofício**.
3. O sistema carrega automaticamente a lista de estudantes que estão nas situações *Sem Nenhum Profissional*, *Falta Professor AEE* ou *Falta Cuidador*.
4. Selecione os alunos cujas vagas devem ser pleiteadas na folha de pagamento da SEDUC.
5. O sistema redige o documento oficial com preâmbulo padrão, quadro demonstrativo dos estudantes, justificativa fundamentada e campo para assinatura da diretoria.
6. Clique em **Exportar DOCX** ou **Imprimir** para formalizar o documento.

---

## 🔐 Segurança, LGPD e limitações

- Login validado no servidor; senhas com **scrypt**; cookie de sessão `HttpOnly` + `Secure` + `SameSite=Lax` (8 h); bloqueio por 15 min após 8 tentativas falhas; cabeçalho anti-CSRF nas gravações.
- Permissões por perfil/escola aplicadas **no servidor** (o navegador não consegue burlar).
- Trilha de auditoria em `audit_log` (login, falhas de login, criação/edição/exclusão), visível ao Núcleo.
- **Documentos e fotos dos alunos (laudo, identidade, comprovante, foto):** ficam num **Vercel Blob privado**. Nada tem link público: o arquivo só abre pela API, depois de conferir o login e se o aluno é da escola do usuário (o Núcleo abre todos). Aceita PDF, JPG, PNG, WEBP e DOCX; fotos são reduzidas no envio; limite de **4 MB** por arquivo (limite das funções da Vercel). Cada abertura fica registrada na auditoria e excluir o documento apaga o arquivo.
- **Recuperação de senha por e-mail** não existe: o Núcleo redefine a senha pela tela de usuários.
- Antes de uso institucional com dados reais de estudantes, faça validação com a administração responsável, defina política de backup/retenção (Neon) e avaliação LGPD. Este pacote não é uma certificação de conformidade.

---

## 🚦 Regras de Negócio e Semáforo de Atendimento

O semáforo do AEE avalia a conformidade de atendimento com base no cruzamento das necessidades diagnosticadas versus os recursos humanos alocados:

| Cor / Status | Significado | Condição no Sistema |
| :--- | :--- | :--- |
| 🟢 **OK (Atendimento Regular)** | Conformidade total | Todos os profissionais necessários (professor AEE e/ou acompanhante) estão alocados e contratos ativos. |
| 🔴 **Sem Nenhum** | Déficit grave e prioridade máxima | Aluno necessita de professor e cuidador, porém não possui nenhum profissional designado. |
| 🟣 **Falta Professor de AEE** | Carência docente especializada | Possui cuidador (ou não necessita), mas está desprovido de docente para atendimento na SRM. |
| 🟠 **Falta Acompanhante** | Carência de apoio individual | Possui professor de AEE (ou não necessita), mas não possui cuidador/acompanhante para auxílio nas atividades diárias. |
| 🟡 **Contrato Pendente** | Risco de descontinuidade | Possui acompanhante alocado, porém o contrato temporário está pendente de renovação ou comprovação documental. |
| ⚪ **Sem Demanda Direta** | Registro regular em acompanhamento | Estudante com diagnóstico que não demanda atendimento contínuo na SRM nem acompanhante diário. |

---

## ⚖️ Declaração de Autoria e Direitos de Uso

> **AVISO LEGAL E DIREITOS AUTORAIS:**  
> **Este sistema tem autoria e não pode ser usado sem autorização.**  
> Todos os direitos sobre a concepção, código-fonte, arquitetura de dados, design de interface e regras de negócio pertencem exclusivamente ao seu autor. É expressamente vedada qualquer reprodução, distribuição, modificação, engenharia reversa, comercialização ou utilização não autorizada, total ou parcial, sem a prévia e expressa autorização por escrito do detentor dos direitos autorais.
