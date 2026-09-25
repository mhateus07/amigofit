# AmigoFit — Escopo e Guia de Execução

*Atualizado em 2026-07-17. Este é o único documento que você deveria abrir no dia a dia. `PLANEJAMENTO.md` e `PLANEJAMENTO_AMIGOFIT.md` são visão de produto (consultar raramente); `DEVLOG.md` é changelog (só escrever, não planejar a partir dele).*

---

## 1. Como usar este documento

### Regra de ouro: uma fase por vez
Trabalhe só na fase "Em andamento". As fases seguintes não existem para você até chegar nelas. Isso evita a sensação de "tem coisa demais pra fazer" — o documento guarda o resto, você não precisa.

### Loop de trabalho (repita a cada sessão)
1. Abra este arquivo, veja a fase "Em andamento".
2. Escolha **um** checkbox.
3. Implemente só ele.
4. Valide (ver "Definição de pronto" abaixo).
5. Marque o checkbox como feito, adicione 2-3 linhas no `DEVLOG.md` se for relevante.
6. Commit (ver convenção abaixo).
7. Pare. Não emende no próximo item na mesma sessão a menos que sobre tempo e energia.

### Protocolo de correção de bugs
1. **Reproduza** o bug antes de mexer em qualquer código — não conserte "no escuro".
2. **Isole**: identifique o arquivo/linha exata da causa.
3. **Corrija o mínimo necessário** para resolver a causa, não sintomas.
4. **Valide de novo** do mesmo jeito que reproduziu (curl, emulador, teste automatizado).
5. **Documente em 3 linhas**: o que quebrou, por quê, o que foi mudado.
6. Se o bug encontrado for **fora do escopo da fase atual**, anote na seção "Achados pendentes" da fase e não pare o que estava fazendo para consertá-lo agora.

### Definição de pronto (Definition of Done)
Uma tarefa só está concluída quando:
- Funciona no **emulador Pixel_8** (`npx expo run:android --device Pixel_8`), não só "parece funcionar".
- Não quebrou nada que já funcionava (checar as telas relacionadas).
- Checkbox marcado + registro no DEVLOG/ESCOPO.
- Commit feito.

O celular físico (S24) só entra para validação final, ao fechar um conjunto de fases ou antes de release — não a cada tarefa.

### Convenção de commits/branches
- Branch por fase ou por feature grande: `fase-2-testes`, `fix-insights-filesystem`.
- Commits pequenos e descritivos: `fix: upsert de mensagens evita delete+reinsert` em vez de `ajustes`.
- Bugs que aparecem fora do escopo viram Issue no GitHub (não ficam soltos na sua cabeça).

---

## 2. Estado atual do projeto

### Stack
- Frontend: React Native + Expo SDK 57 (TypeScript)
- Backend: Node.js + Express (JavaScript)
- Banco: PostgreSQL via Docker Compose
- IA: Claude API (chat + extração de dados estruturados), com suporte multi-provider (OpenAI, Gemini, Groq) — BYOK; desde a Fase 7 a chave fica criptografada no servidor (AES-256-GCM), nunca em texto puro nem no aparelho
- Auth: JWT + bcrypt

### O que já funciona
- Fluxo completo: Splash → Welcome → Auth → Onboarding → Tabs (Chat / Diário / Insights / Perfil)
- Extração automática de dados a cada mensagem (2ª chamada LLM em paralelo)
- Diário com timeline, filtros por categoria, entrada manual
- Insights com gráficos SVG customizados
- Perfil completo com múltiplas API keys, Health Connect (Android, pausado)

### Riscos conhecidos (revisar antes de cada fase)
| # | Problema | Onde | Status |
|---|---|---|---|
| 1 | CORS aberto | `server/index.js` | ✅ Corrigido na Fase 0, deployado em produção em 2026-07-17 |
| 2 | `JWT_SECRET` sem fallback seguro | `server/index.js` | ✅ Corrigido na Fase 0, deployado em produção em 2026-07-17 |
| 3 | Sem rate limit em `/api/chat` e `/api/extract` | `server/index.js` | ✅ Corrigido na Fase 0, deployado em produção em 2026-07-17 |
| 4 | DELETE + reinsert de mensagens | `server/index.js` | ✅ Corrigido na Fase 1 (upsert); o `DELETE ... NOT IN` que sobrou foi removido na Fase 7 |
| 5 | URL de backend hardcoded | `src/services/storage.ts` | ✅ Corrigido na Fase 0 (`.env`) |
| 6 | Documentos de planejamento conflitantes | raiz do repo | Em resolução — este arquivo centraliza |
| 7 | Dependências mortas | `package.json` | ✅ Corrigido na Fase 0 |
| 8 | `CATEGORY_CONFIG` duplicado | Diário / Insights | ✅ Corrigido na Fase 1 |
| 9 | Zero testes automatizados | todo o repo | Em andamento (Fase 2) |
| 10 | Insights são heurísticas, não IA real | `InsightsScreen.tsx` | Pendente (Fase 3) |
| 11 | Chat sem streaming | `ai.ts` / backend | Pendente, não bloqueante |
| 12 | Logs do backend não registram status HTTP | `server/index.js` | ✅ Corrigido na Fase 7 (log de acesso com status e latência), deployado 2026-09-25 |
| 13 | `expo-file-system` com API removida — "compartilhar relatório semanal" quebrado | `InsightsScreen.tsx` | Pendente (Fase 3) |
| 14 | Backend em HTTP puro, sem TLS (chaves de API de IA trafegando sem criptografia) | VPS de produção | ✅ Corrigido em 2026-07-17 — HTTPS via Traefik/EasyPanel + Let's Encrypt (`amigofit-api.impulsiodigital.com`), porta 3001 HTTP fechada |
| 15 | Deploy manual multi-passo via SSH, sem script | VPS de produção | ✅ Corrigido em 2026-07-17 — `scripts/deploy.sh` |
| 16 | Sem backup do banco de produção | VPS de produção | ✅ Corrigido em 2026-07-17 — `scripts/backup-db.sh` via cron diário, retenção de 14 dias |
| 17 | Token JWT e chaves de API de IA em `AsyncStorage` (texto puro, sem criptografia) | `src/services/storage.ts` | ✅ Corrigido em 2026-09-07 — migrado para `expo-secure-store` (Keychain), migração automática dos valores já salvos |
| 18 | Modelo `llama-3.3-70b-versatile` da Groq foi descontinuado ("does not exist or you do not have access to it") — chat quebrado para qualquer usuário com Groq ativo | `server/index.js` (`PROVIDER_MODELS`) | ✅ Corrigido em 2026-09-08 — trocado para `openai/gpt-oss-120b`, depois trocado de novo (ver risco #19) |
| 19 | `openai/gpt-oss-120b` (modelo de raciocínio) quebra o modo `response_format: json_object` da Groq — `/api/extract` e `/api/insights` falhavam com "Failed to validate JSON", dados do chat não caíam no Diário sem erro visível pro usuário | `server/index.js` (`PROVIDER_MODELS`) | ✅ Corrigido em 2026-09-08 — ver risco #20, a troca inicial pra `llama-3.1-8b-instant` também falhou |
| 20 | Os modelos Llama da Groq (`llama-3.1-8b-instant`, `llama-3.3-70b-versatile`) não são acessíveis em todas as contas Groq ("does not exist or you do not have access to it"), mesmo listados como "Production" na doc oficial | `server/index.js` (`PROVIDER_MODELS`) | ✅ Corrigido em 2026-09-08 — modelo final: `openai/gpt-oss-20b` (confirmado acessível) + `reasoning_effort: 'low'` e `max_tokens` maior nas chamadas com `response_format: json_object` (`groqReasoningOptions()`), pra evitar truncar o JSON com tokens de raciocínio |
| 21 | Redesign visual (tema claro estilo Apple Health) trocou a paleta em todas as telas, mas o polimento extra de estilo (espaçamento, bordas) só foi aplicado na tela de Chat, usada como piloto | `src/screens/*.tsx` | Pendente — propagar pras demais telas se a direção for validada |
| 22 | Splash nativa aparece pequena/centralizada em vez de tela cheia, desde a migração pro plugin `expo-splash-screen` (SDK 57) | `app.json` (config do plugin `expo-splash-screen`) | Pendente — cosmético, não bloqueia uso; app abre e funciona normal |
| 23 | `Simulator.app` ausente/quebrado na instalação do Xcode do usuário — bloqueia teste via simulador (só o teste em iPhone físico funciona hoje) | Xcode.app local (fora do repo) | Pendente — precisa reinstalar/reparar o Xcode; ver decisão 2026-09-15 |

| 24 | Salvar plano de dieta/treino apagava todo o histórico de check-ins (DELETE + ON DELETE CASCADE) | `server/routes/plans.js` | ✅ Corrigido na Fase 7, deployado 2026-09-25 |
| 25 | Mensagens/check-ins aceitavam IDs de outra conta | `server/routes/*` | ✅ Corrigido na Fase 7, deployado 2026-09-25 |
| 26 | Falhas de gravação escondidas no app (sem `res.ok`, `catch {}`) | `src/services/storage.ts` | ✅ Corrigido na Fase 7 — falta build no iPhone |
| 27 | Chaves de IA em texto puro dentro de `profiles.data` (e nos backups) — contradizia "chave nunca armazenada no servidor" | `server/index.js` | ✅ Corrigido na Fase 7 (criptografadas em `ai_keys`), deployado 2026-09-25 |
| 28 | Backup só existe na própria VPS | `scripts/backup-db.sh` | ✅ Corrigido em 2026-09-25 — cópia diária no Google Drive (`gdrive:amigofit-backups`) |
---

## 3. Fases

### ✅ Fase 0 — Higiene rápida — concluída 2026-07-04
Dependências mortas removidas, `.env` configurado, CORS restrito, JWT_SECRET obrigatório, rate limit em auth. Deploy dessas mudanças no VPS de produção concluído em 2026-07-17.

### ✅ Fase 1 — Robustez de dados — concluída 2026-07-05
Upsert real de mensagens, `CATEGORY_CONFIG` unificado. Validado via curl e emulador.

### ✅ Fase 2 — Testes automatizados — concluída 2026-07-06
Objetivo: ter uma rede de segurança mínima antes de mexer em mais nada de produto.

Como fazer, passo a passo:
- [x] Instalar: `jest`, `jest-expo`, `@testing-library/react-native` (`@testing-library/jest-native` ficou de fora — deprecado, os matchers já vêm embutidos no `@testing-library/react-native` 12.4+)
- [x] Configurar `jest.config.js` com preset `jest-expo`
- [x] Escrever o primeiro teste, o mais simples possível, para ganhar confiança no setup (`WelcomeScreen.test.tsx`)
- [x] Cobrir `useChat` (hook do chat): estados de loading/erro, envio de mensagem (`src/hooks/__tests__/useChat.test.ts`, 5 testes)
- [x] Cobrir parsing de `ai.ts`: a extração de dados estruturados retorna o JSON esperado a partir de mensagens de exemplo (`src/services/__tests__/ai.test.ts`, 3 testes)
- [x] Cobrir auth do backend: registro, login, rota protegida sem token retorna 401 (`server/__tests__/auth.test.js`, 10 testes, `pg` mockado — sem depender de Postgres real)
- [x] Rodar `npm test` e garantir que passa localmente antes de cada commit desta fase — 19/19 testes passando

**Fase 2 concluída em 2026-07-06.** Detalhes técnicos relevantes para a próxima sessão:
- `@testing-library/react-native` está na v14, que mudou `render`/`renderHook` para **assíncronos** (`await render(...)`) — diferente da maioria dos tutoriais/exemplos online, que assumem API síncrona.
- `@testing-library/jest-native` ficou de fora (não instalado): está deprecado, os matchers (`toBeOnTheScreen` etc.) já vêm embutidos no `@testing-library/react-native` 12.4+.
- Precisou criar `babel.config.js` (não existia no repo) com `babel-preset-expo`, exigido pelo `babel-jest` do preset `jest-expo`.
- `jest.setup.js` mocka `react-native-safe-area-context` e `@react-native-async-storage/async-storage` globalmente (via `setupFilesAfterEnv`) — sem isso, qualquer teste que importe uma tela ou o `storage.ts` quebra com erro de módulo nativo ausente.
- Para mockar uma classe (ex.: `AIService`) com `jest.mock()`, o valor da instância criada via `new` fica em `mock.instances[0]`, **não** em `mock.results[0].value` (que registra o retorno explícito do construtor — `undefined` nesse caso). Isso quebrou os testes de `useChat` até ser corrigido.
- `server/index.js` precisou de um ajuste mínimo (não muda comportamento em produção): agora exporta `{ app, pool, JWT_SECRET }` e só chama `initDB()`/`app.listen()` quando rodado diretamente (`require.main === module`), permitindo testar as rotas com `supertest` sem subir o servidor real. O Postgres é mockado via `jest.mock('pg')`.
- Teste de `WelcomeScreen` ainda imprime um aviso benigno `overlapping act() calls` no console (por causa das animações do `useEffect`) — não falha o teste, mas ficou como possível limpeza futura, não bloqueante.

Não avance para a Fase 3 sem reler essas notas — evita redescobrir os mesmos gotchas do zero.

### 🟨 Fase 7 — Confiabilidade e proteção dos dados — deployada 2026-09-25, falta validação no iPhone
Origem: análise do código colada pelo usuário em 2026-09-24 (achados de perda de histórico, isolamento entre contas e falhas silenciosas). Prioridade acima das Fases 3/4/5, que ficam pausadas até fechar esta. Branch `fase-7-confiabilidade`. Código pronto, **128 testes passando (31 contra PostgreSQL 16 real)**, TypeScript sem erros. **Deployado em produção em 2026-09-25** (4 migrações aplicadas, chave em texto puro migrada para `ai_keys`) e build Release instalada no iPhone — falta o usuário validar os fluxos.

Correções prioritárias (na ordem de gravidade):
- [x] Editar dieta/treino não apaga mais os check-ins: planos são atualizados e arquivados (`active=false`) em vez de apagados; FK sem cascade. *(Produção tinha 5 refeições e 0 check-ins em 2026-09-25 — coerente com o bug ter apagado o histórico.)*
- [x] Isolamento entre contas: check-in confere o dono (404) + FK composta `(id, user_id)` no banco; upsert de mensagem/plano só altera linha da própria conta (409)
- [x] Falhas de gravação visíveis: `src/services/api.ts` (timeout, `res.ok`, erro legível), telas com "Tentar de novo", otimismo desfeito em erro, mensagem de chat não salva marcada com retry
- [x] Troca de conta: logout limpa token/usuário/caches/marcadores; dados locais separados por usuário; respostas de sessão anterior descartadas; cache de insights por assinatura dos dados
- [x] Chaves de IA: fora do aparelho e do JSON do perfil → tabela `ai_keys` com AES-256-GCM (`AI_KEYS_SECRET`), servidor usa a chave direto, API só devolve os 4 últimos dígitos (ver decisão 2026-09-25)
- [x] Chat grava mensagem por mensagem (PUT idempotente); limpar histórico = `DELETE /api/messages`

Outros bugs da análise:
- [x] Imagens chegam ao OpenAI/Gemini (antes viravam "[imagem]"); Groq recusa explicitamente
- [x] Imagem do chat persistida no servidor (`chat_images`), aparece após recarregar
- [x] Inicialização separa "sem perfil" (onboarding) de "não carregou" (erro + retry)
- [x] Sincronização Apple Saúde/Health Connect: marcador só avança após o servidor confirmar; `sourceRef` evita duplicar; totais do dia recalculados inteiros
- [x] Contexto da IA usa os 6 registros mais recentes por categoria (antes: os mais antigos)
- [x] Reprocessamento por ID da mensagem (`messages.extracted_at`), não por horário
- [x] Diário e Insights recarregam ao ganhar foco
- [x] Validação de tipos/enums/datas/tamanhos na API e das respostas da IA
- [x] TypeScript compilando de novo (tipos do Jest no TS 6, `absoluteFill`)

Melhorias técnicas:
- [x] Backend dividido em módulos (`server/lib`, `server/routes`, `server/ai`)
- [x] Migrações versionadas (`server/migrations.js`, tabela `schema_migrations`) + índices por usuário/data
- [x] Paginação do chat (100 por vez, "carregar anteriores")
- [x] Timeout em todas as chamadas (app e provedores de IA)
- [x] Sessões: JWT de 30 dias com renovação automática + revogação (`token_version`)
- [x] Cotas de vídeo (1 GB) e imagem (300 MB) por usuário + limpeza diária de órfãos
- [x] Backup inclui vídeos/imagens; cópia externa via rclone (`BACKUP_REMOTE`); `scripts/test-restore.sh`
- [x] Deploy confere `/health` (com banco) e faz backup antes; resolve risco #12 (log com status e latência, sem conteúdo)
- [x] Testes com PostgreSQL real (`server/testing/realDb.js`, `server/__tests__/integridade.pg.test.js`)

Melhorias de produto:
- [x] Tela "Hoje" (primeira aba; Perfil abre pelo ⚙️)
- [x] Treino com registro de séries (carga/reps), cronômetro de descanso e evolução por exercício
- [x] Diário editável (corrigir/excluir) mostrando a origem de cada registro
- [x] IA com revisão: "Identifiquei N registros · revisar" com opção de descartar
- [x] Offline: dieta/treino em cache por conta; check-ins offline em fila
- [x] Conta: alterar senha, sair de todos os aparelhos, excluir conta
- [x] Acessibilidade: rótulos em botões de ícone e áreas de toque de 44pt nas telas mexidas (revisão completa de contraste/fonte ampliada ainda não feita)
- [x] Insights priorizam adesão/evolução (prompt + "Treinos 7d / meta" no lugar do total de registros)
- [ ] Recuperação de senha por e-mail — **bloqueado**: precisa escolher um provedor de e-mail (SMTP/Resend/SES)
- [ ] Onboarding sem chave própria (IA integrada ao produto) — **decisão de negócio**: quem paga o uso da IA
- [x] Deploy em produção — 2026-09-25: merge em `main`, `AI_KEYS_SECRET` gerado no `.env` da VPS (cópia fora dela em `~/.amigofit/AI_KEYS_SECRET` no Mac do usuário), `./scripts/deploy.sh` com backup antes e `/health` ok
- [x] Backup externo no **Google Drive** — 2026-09-25: rclone na VPS (remote `gdrive`, escopo `drive.file`), `BACKUP_REMOTE=gdrive:amigofit-backups`, cron diário 03:00 já envia; `scripts/test-restore.sh` restaurou com sucesso. Sem retenção no Drive (arquivos pequenos; limpar manualmente se crescer)
- [x] Nova build Release instalada no iPhone — 2026-09-25
- [ ] Validação dos fluxos no iPhone pelo usuário (roteiro no DEVLOG, entrada de 2026-09-25)

### ⬜ Fase 3 — Produto (Chat / Insights)
- [x] Corrigir `InsightsScreen.tsx`: substituir API removida do `expo-file-system` (`cacheDirectory`/`EncodingType`) para destravar "compartilhar relatório semanal" — **corrigido e confirmado em 2026-08-22** (troca de `import * as FileSystem from 'expo-file-system'` para `'expo-file-system/legacy'`, mesmo padrão já usado em `DietaScreen.tsx`). Testado via Expo Go/túnel no iPhone: compartilhamento do relatório semanal funcionando.
- [x] Migrar insights de heurística para IA real — **implementado em 2026-08-22**: novo endpoint `POST /api/insights` (backend, multi-provedor, mesmo padrão de `/api/extract`) gera de 3-5 insights via LLM a partir dos dados dos últimos 30 dias + perfil. `InsightsScreen.tsx` usa a IA quando há chave configurada e ≥3 registros (com cache diário em AsyncStorage, ignorado no pull-to-refresh); cai de volta na heurística antiga (`generateHeuristicInsights`) se não houver chave, poucos dados, ou a chamada falhar. 8 testes novos (4 backend, 2 frontend + os 2 do fix anterior), 44/44 passando. Deployado no VPS em 2026-08-23 (push + `./scripts/deploy.sh`) e **confirmado pelo usuário funcionando end-to-end** via Expo Go: insights de IA aparecendo na aba Insights.
- [ ] Avaliar streaming no chat (custo x benefício, registrar decisão aqui)

### ⬜ Fase 5 — Aproveitando o "conversar" ao máximo
Ideias levantadas em 2026-09-07 (ver seção 4 para as demais). Objetivo: reforçar o diferencial central do app (você não preenche formulário, você conversa) com formas mais ricas de conversar.
- [ ] Consulta em linguagem natural sobre os próprios dados: perguntar "quantas vezes treinei perna esse mês?" ou "qual foi meu pior dia de sono?" e a IA responder consultando `extracted_data`/`workouts` direto (texto→SQL ou busca estruturada), em vez de só extrair dados novos
- [x] Entrada por voz/áudio no chat: gravar e transcrever (Whisper ou equivalente) para registrar logo após o treino sem digitar — **implementado e confirmado em 2026-09-08**. `src/hooks/useVoiceRecorder.ts` (`expo-audio`, preset HIGH_QUALITY, auto-stop em 2min), botão 🎤 no `ChatScreen.tsx` grava e transcreve, preenchendo o campo de texto pra revisão antes de enviar (não envia direto). Backend: `POST /api/transcribe` — Groq/OpenAI via Whisper (multipart), Gemini via áudio inline no `generateContent`; Anthropic não suporta, então `storage.ts` escolhe automaticamente outro provedor com chave salva (ordem: ativo se compatível > Groq > OpenAI > Gemini) sem depender do provedor ativo do chat. Testado no iPhone físico do usuário via Xcode (precisou `pod install` manual — `expo prebuild` não rodou sozinho — e remover `aps-environment` do entitlements de novo, mesma pegadinha de sempre). Achado no caminho: modelo Groq `llama-3.3-70b-versatile` estava descontinuado, quebrando o chat com Groq ativo — ver risco #18.
- [ ] Foto da refeição no chat: enviar imagem e a IA (vision) descrever/estimar a refeição, mesmo padrão de "não preencher formulário"

### ✅ Fase 6 — Fichas de treino com vídeo por exercício — concluída 2026-09-08
Planejado em 2026-09-08 (plano completo em `.claude/plans/fancy-gathering-eich.md`). Nova aba "Treino" na barra inferior. Arquitetura clona a da aba Dieta (ficha = meal, exercício = item, check-in de treino = meal checkin), com uma peça nova: upload de vídeo próprio do usuário por exercício (não é biblioteca externa nem link de YouTube).
- [x] Modelo de dados + tabelas (`workout_plans`, `workout_checkins`, `exercise_videos`) + tipos TS (`Exercise`, `WorkoutPlan`, `WorkoutCheckin`) — **implementado em 2026-09-08**. Tabelas adicionadas em `initDB()` (`server/index.js`), mesmo padrão de `meals`/`meal_checkins`. Validado rodando o backend contra um Postgres local descartável (`docker run postgres:16-alpine`) antes de mexer em produção — `\dt` confirmou as 3 tabelas criadas sem erro de SQL. Só schema (nenhum endpoint novo ainda).
- [x] Backend: CRUD de ficha + check-in (`/api/workout-plans`, `/api/workout-plans/checkins`), sem IA/vídeo ainda — inclui insert em `extracted_data` (category `workout`) no check-in "concluí hoje", que já alimenta a conquista `workouts-10` existente sem mudar `achievements.ts` — **implementado em 2026-09-08**, 12 testes novos (`server/__tests__/workoutplan.test.js`), validado também de ponta a ponta via curl contra Postgres real (não só mocks)
- [x] Frontend: aba Treino básica (form manual + lista + check-in) — **implementado e confirmado em 2026-09-08** (`TreinoScreen.tsx`, `useWorkoutPlan.ts`, aba nova em `App.tsx`). Testado no iPhone físico do usuário.
- [x] Backend: extração de ficha via PDF (`/api/extract-workout`, mesmo padrão do `/api/extract-meals`) — **implementado em 2026-09-08**, 7 testes novos (`server/__tests__/extractworkout.test.js`). Tela de revisão fica pro checkbox de frontend seguinte.
- [x] Infra + backend: upload de vídeo — volume Docker novo pro `backend` (hoje não tinha nenhum, arquivo escrito no container sumia a cada deploy — corrigido em `docker-compose.yml`), `multer`, endpoints `POST/GET/DELETE /api/exercise-videos` — **implementado em 2026-09-08**, 9 testes novos (`server/__tests__/exercisevideos.test.js`), validado de ponta a ponta via curl (upload → download com conteúdo idêntico → delete → 404 depois)
- [x] Frontend: anexar/gravar vídeo por exercício + player inline — **implementado e confirmado em 2026-09-08** (`expo-video` novo, `NSCameraUsageDescription` adicionada no `app.json`, `prebuild` + `pod install` + remoção do `aps-environment` de novo — mesma pegadinha de sempre). Testado no iPhone físico do usuário.
- [x] Extração de ficha via foto — visão multi-provedor — **implementado em 2026-09-08**. `/api/extract-workout` aceita `imageBase64`+`mimeType` além de `pdfBase64`; `extractWorkoutFromImageWithProvider` cobre Anthropic (bloco `image`), OpenAI (`image_url`) e Gemini (`inline_data`, mesmo mecanismo já usado na transcrição de voz); Groq/gpt-oss retorna erro claro pedindo pra trocar de provedor ou usar PDF (não tem visão). Botão "📷 Foto" novo no header da aba Treino, reaproveita o `WorkoutReviewModal` já existente. 5 testes novos (imagem via Anthropic, erro do Groq, 400 sem pdfBase64/imageBase64). Validado via curl contra servidor real (400 sem campos, erro claro do Groq).

### ⬜ Fase 4 — Pendências de infraestrutura e produto
- [x] Deploy das correções da Fase 0 no VPS de produção — concluído 2026-07-17
- [x] HTTPS no backend de produção — concluído 2026-07-17 (achado #14)
- [x] Script de deploy automatizado — concluído 2026-07-17 (achado #15)
- [x] Backup automático do banco de produção — concluído 2026-07-17 (achado #16)
- [ ] Retomar Health Connect (estava pausado por decisão do usuário em 2026-07-04) — Android, baixa prioridade agora (ver decisão 2026-08-26)
- [x] Integração Apple Saúde (HealthKit, iOS) — **implementado e confirmado em 2026-08-26**. `src/services/appleHealth.ts` (espelha `healthConnect.ts`: sono, passos, treinos, peso, frequência cardíaca), plugin `@kingstinct/react-native-healthkit` + `react-native-nitro-modules` no `app.json`, card na aba Perfil (`Platform.OS === 'ios'`). Testado no iPhone físico do usuário via Xcode: sincronização e importação de dados funcionando.
- [x] Export de dados em PDF/CSV — **implementado e confirmado em 2026-08-27**. Botões "Exportar CSV" e "Exportar PDF" na aba Insights (junto do "Compartilhar relatório semanal"), exportam todo o histórico do Diário (não só 30 dias). CSV via `expo-file-system` + `expo-sharing` (mesmo padrão do relatório semanal); PDF via `expo-print` (`Print.printToFileAsync` gerando HTML tabular) + `expo-sharing`. Novo pod `ExpoPrint` — mesma pegadinha do `aps-environment` reaparecendo no `expo prebuild` (removido manualmente de novo). Testado no iPhone físico do usuário.
- [ ] Push notifications via EAS Build
- [ ] Planos de treino gerados por IA
- [x] Lembretes locais (notificações sem push remoto) — **implementado e confirmado em 2026-08-26**. `src/services/reminders.ts` (`expo-notifications`, trigger `DAILY` local, sem push remoto), toggle + seletor de horário (07:00/12:00/19:00/21:00) na seção "Lembrete de treino" do Perfil, substituindo o placeholder "Em breve". Plugin `expo-notifications` reativado no `app.json` — necessário remover a chave `aps-environment` do `ios/AmigoFit/AmigoFit.entitlements` depois de cada `expo prebuild` (ver achado 2026-08-26 no registro de decisões). Testado no iPhone físico: ativação, escolha de horário e disparo da notificação funcionando.
- [x] Gamificação: badges/conquistas além do streak atual — **implementado e confirmado em 2026-08-26**. `src/utils/achievements.ts` (8 conquistas client-side: primeira mensagem, streaks de 3/7/30 dias, 10 treinos, semana de sono completa, 50/100 registros no Diário — sem mudança de backend/DB), seção "Conquistas" nova na aba Insights (grid 2 colunas com barra de progresso), 5 testes novos (49/49 no total). Testado no iPhone físico do usuário.
- [x] Logar status HTTP nos logs do backend (achado #12) — feito na Fase 7

---

## 4. Backlog de visão (não fazer agora — só referência)

Vem de `PLANEJAMENTO.md` e `PLANEJAMENTO_AMIGOFIT.md`. Só volte aqui quando fechar a Fase 4:

- Memória de longo prazo da IA (resumo mensal automático)
- Proatividade da IA (alertas de padrões ruins)
- Correlações visuais (sono × performance, alimentação × humor)
- Integração Samsung Health / Google Fit
- Monetização (plano gratuito + Pro ~R$29/mês)
- Marca branca para academias/personal trainers
- Desafios sociais, compartilhamento de progresso
- Modo offline com fila de sincronização
- Web app para visualização de dados

Prioridade recomendada quando chegar a hora: Integração Health/Fit > Relatório semanal automático > Planos de treino por IA > Push notifications > Monetização.

**Novas ideias (2026-09-07)** — "conversar ao máximo" virou Fase 5 (ver seção 3); o resto fica aqui como referência futura:
- Retenção com baixo esforço de digitação: check-in por notificação com quick-reply direto da tela de bloqueio; atalhos/templates rápidos ("dormi bem", "treino de perna feito"); widget de tela inicial (iOS) com streak/resumo do dia
- Saúde/segurança: alerta de dor recorrente detectada nas extrações (sugerir cautela/procurar profissional); PIN/Face ID para abrir o app (dados de saúde sensíveis)
- Visual/progresso: fotos de progresso corporal com timeline comparável lado a lado
- Apple Watch: registrar treino ativo ou responder humor/dor direto do pulso

---

## 5. Registro de decisões

*Adicione uma linha aqui sempre que tomar uma decisão importante de arquitetura ou escopo, para não perder o contexto depois.*

- 2026-07-04: Health Connect pausado por decisão do usuário.
- 2026-07-04: Fases validadas no emulador Pixel_8 antes do celular físico (S24).
- 2026-07-06: Fase 2 (testes automatizados) concluída — 19 testes (Jest + jest-expo + @testing-library/react-native + supertest), cobrindo `useChat`, extração em `ai.ts` e auth do backend. Ver notas técnicas na seção da Fase 2 acima antes de mexer em testes de novo.
- 2026-07-17: Backend de produção migrado de HTTP puro no IP para HTTPS em `https://amigofit-api.impulsiodigital.com` (Traefik/EasyPanel já existente no VPS + Let's Encrypt automático). Novo build EAS gerado com a URL HTTPS, instalado e testado com sucesso no aparelho do usuário; porta 3001 HTTP direta removida do `docker-compose.yml` e confirmada fechada. `scripts/deploy.sh` (deploy manual em 1 comando) e `scripts/backup-db.sh` (backup diário via cron, retém 14 dias em `/opt/amigofit/backups/`) adicionados e testados na VPS. Ver riscos #14, #15, #16.
- 2026-08-26: Removido o plugin `expo-notifications` do `app.json` (não estava em uso em nenhum lugar do código) — ele adicionava a capability Push Notifications, que conta pessoal/gratuita da Apple não suporta, travando builds locais no Xcode via `expo run:ios`. Push notifications real continua no backlog, mas será feito via EAS Build com conta paga quando chegar a hora.
- 2026-08-26: Priorizada integração com **Apple Saúde (HealthKit)** em vez de retomar o Health Connect (Android) — o uso diário real do app agora é no iPhone do usuário, não em Android, então HealthKit é o que traz valor imediato. Health Connect continua pausado/backlog.
- 2026-09-09: Redesign visual iniciado — tema trocado de preto+verde neon pra claro/neutro estilo Apple Health (`src/constants/theme.ts`) + fonte Inter. Tela de Chat usada como piloto pro polimento extra antes de propagar pras demais telas (ver risco #21).
- 2026-08-26 (achado, não bloqueante): `npx expo prebuild` sem `--clean` não remove entitlements de plugins removidos do `app.json` — mesmo depois de tirar `expo-notifications` dos plugins, a chave `aps-environment` reapareceu em `ios/AmigoFit/AmigoFit.entitlements` numa prebuild seguinte (rodada para adicionar o plugin do HealthKit). Precisou remoção manual da chave no arquivo depois de cada `prebuild`. Se voltar a acontecer, checar esse arquivo antes de abrir o Xcode.
- 2026-09-15: Habilitado teste no iPhone físico do usuário (iPhone 17 Pro Max, iOS 27) além do simulador. Bug raiz: o Xcode 27/iOS 27 instalados no Mac do usuário **exigem** adoção do UIScene lifecycle do UIKit — sem isso o app nem inicializa (`Application failed to launch: UIScene life cycle is required for apps built with this SDK`), e nem o upgrade pra SDK 57 (mais atual disponível) resolveu sozinho, porque o template nativo do Expo ainda não adota Scene lifecycle. Corrigido via config plugin novo `plugins/withIosSceneLifecycle.js` (gera `SceneDelegate.swift`, registra no `project.pbxproj`, adiciona `UIApplicationSceneManifest` no `Info.plist`, move a criação da janela do `AppDelegate.swift` pro Scene delegate — tudo reaplicado em todo `expo prebuild`, já que `ios/` é gerado/gitignored). Detalhes completos e todos os ajustes auxiliares (upgrade SDK 54→57, `plugins/withIosMinDeploymentTargetFix.js`, `ios.appleTeamId`, permissão de rede local, migração do splash) no DEVLOG (entrada de 2026-09-15). Ver riscos #22 e #23 (pendências que sobraram: splash pequena e `Simulator.app` quebrado nesta instalação do Xcode).
- 2026-09-15: Gerada e validada uma build **Release** do app (via `xcodebuild -configuration Release`) pra uso no iPhone sem depender do Mac ligado nem do Metro — o JS já compilado (`main.jsbundle`) fica empacotado dentro do `.app`. Confirmado pelo usuário funcionando com o Metro derrubado de propósito e o cabo USB desconectado. Trade-off: sem hot reload — pra atualizar o app com mudanças de código novas, precisa reconectar o iPhone e gerar uma Release nova. Detalhes no DEVLOG (seção "Build Release: app independente do Mac/Metro").
- 2026-09-25: Fase 7 criada a partir da análise de código de 2026-09-24 e colocada acima das Fases 3/4/5. Chaves de IA: escolhido guardá-las **criptografadas no servidor** (AES-256-GCM, chave mestra `AI_KEYS_SECRET` no `.env`, fora do banco) em vez de só no aparelho — mantém a restauração automática em aparelho novo e tira as chaves legíveis dos backups. O app não guarda nem envia mais a chave; o servidor a usa direto. **Perder `AI_KEYS_SECRET` = usuários precisam recadastrar as chaves** — guardar cópia fora da VPS.
- 2026-09-25: Perfil saiu da barra de abas (abre pelo ⚙️ da nova tela "Hoje") para manter 6 abas.
- 2026-09-25: Testes de integridade rodam contra PostgreSQL 16 real e descartável (binários do pacote `embedded-postgres`, sem Docker) — o banco mockado não prova constraints, cascade nem isolamento.
