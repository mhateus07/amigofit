# Escopo do Projeto — AmigoFit (2026-07-04)

Documento de análise do estado atual + roadmap de melhorias, criado após auditoria completa do código (frontend, backend, docs existentes). Objetivo: sair de "funciona no meu emulador" para um app mais robusto, testável e seguro, validando cada fase no emulador Android antes de ir para o celular físico.

---

## 1. Estado atual (o que já funciona)

- Fluxo completo: Splash → Welcome → Auth → Onboarding → Tabs (Chat / Diário / Insights / Perfil)
- Chat com IA **multi-provider** (Claude, OpenAI, Gemini, Groq) — usuário traz a própria API key (BYOK), nunca armazenada no servidor
- Extração automática de dados estruturados a cada mensagem (2ª chamada LLM em paralelo)
- Diário com timeline, filtros por categoria, entrada manual
- Insights com gráficos SVG customizados (sono, semana, dia-a-semana, metas)
- Perfil completo: dados pessoais, medidas corporais, metas, múltiplas API keys, Health Connect (Android, pausado)
- Backend Node/Express + PostgreSQL, auth JWT + bcrypt

## 2. Problemas e riscos encontrados

| # | Problema | Onde | Risco |
|---|---|---|---|
| 1 | CORS aberto (`origin: '*'`) | `server/index.js` | Segurança |
| 2 | `JWT_SECRET` cai num fallback inseguro se não configurado | `server/index.js` | Segurança |
| 3 | Sem rate limit em `/api/chat` e `/api/extract` | `server/index.js` | Abuso de custo (APIs pagas) |
| 4 | `saveMessages` faz DELETE + reinsert completo a cada save | `server/index.js` | Ineficiência / risco de corrida |
| 5 | URL do backend hardcoded no cliente (`173.212.208.109`), sem `.env` por ambiente | `src/services/storage.ts` | Inflexibilidade, diverge dos próprios docs |
| 6 | 3 documentos com IPs/infos conflitantes entre si | `DEVLOG.md` / `PLANEJAMENTO.md` | Confusão, não é bug de código |
| 7 | Dependências instaladas mas não usadas (`react-native-markdown-display`, `axios`, `uuid`) | `package.json` | Peso morto |
| 8 | `CATEGORY_CONFIG` duplicado entre Diário e Insights | `DiaryScreen.tsx` / `InsightsScreen.tsx` | Duplicação, risco de inconsistência visual |
| 9 | **Zero testes automatizados** (frontend e backend) | todo o repo | Nenhuma rede de segurança para mudanças |
| 10 | "Insights" são heurísticas de regex/threshold, não IA de fato | `InsightsScreen.tsx` | Gap entre marketing ("insights personalizados por IA") e realidade |
| 11 | Chat sem streaming (resposta chega tudo de uma vez) | `ai.ts` / backend | UX — não bloqueante |
| 12 | `name` do `package.json` ainda é `"amigo_fit_temp"` | `package.json` | Cosmético |

## 3. Proposta de fases

Cada fase é implementada, testada no **emulador Pixel_8**, e só passa pra próxima quando estável. O celular físico (S24) só entra em cena no final, para validação real antes de qualquer release.

### Fase 0 — Higiene rápida (baixo risco, alto valor) — ✅ CONCLUÍDA em 2026-07-04
- [x] Remover dependências mortas (`react-native-markdown-display`, `axios`, `uuid`/`@types/uuid`) — 25 pacotes removidos
- [x] Corrigir `name` do `package.json` (`amigo_fit_temp` → `amigofit`)
- [x] Configurar `API_BASE` via `EXPO_PUBLIC_API_BASE_URL` (`.env`/`.env.example` criados), com fallback pro valor antigo
- [x] Restringir CORS via `ALLOWED_ORIGINS` (mobile não é afetado, só builds web)
- [x] `JWT_SECRET` obrigatório — servidor agora falha explicitamente no boot se ausente
- [x] Rate limit em `/api/chat` e `/api/extract` (30 req/5min por usuário, via `aiLimiter`)

**Validado no emulador Pixel_8 contra backend local** (`docker-compose up -d --build`, Postgres + backend em containers, app apontando pra `10.0.2.2:3001`): onboarding, chat, profile e extracted-data funcionando ponta a ponta, sem erros no log do backend.

**Bug encontrado durante o typecheck (fora do escopo da Fase 0, anotado pra depois):** `InsightsScreen.tsx` usa API antiga do `expo-file-system` (`cacheDirectory`/`EncodingType`, removidos na versão atual) — a função de "compartilhar relatório semanal" está quebrada. Ver Fase 3.

**Pendente:** as mudanças do backend (CORS/rate limit/JWT_SECRET) só existem localmente — ainda não foram deployadas no VPS de produção (`173.212.208.109`).

### Fase 1 — Robustez de dados — ✅ CONCLUÍDA em 2026-07-05
- [x] Trocar DELETE+reinsert de mensagens por upsert real (`INSERT ... ON CONFLICT (id) DO UPDATE`, delete só das mensagens removidas da lista)
- [x] Extrair `CATEGORY_CONFIG` para `src/constants/categories.ts`, usado agora por `DiaryScreen.tsx` e `InsightsScreen.tsx`

**Validado via `curl` direto no backend local:** editar mensagem existente, remover uma e adicionar outra num único save → resultado exato esperado no banco (sem duplicar, sem perder a editada). Também confirmado que token inválido/ausente retorna 401 corretamente.
**Validado visualmente no emulador:** Diário e Insights renderizam ícones/cores/labels idênticos após a unificação, sem regressão.

**Achado durante a validação (não é bug introduzido agora, é preexistente):** os logs do backend só registram `método + rota`, não o status HTTP — então uma chamada autenticada falhando (401) parece idêntica a uma bem-sucedida no log. Isso mascarou o fato de que uma sessão antiga do app no emulador estava usando um token inválido para o backend local, enquanto a UI parecia funcionar normalmente com dados em cache local. Vale considerar logar o status da resposta no backend numa fase futura.

### Fase 2 — Testes automatizados (base)
- Configurar Jest + `@testing-library/react-native`
- Cobrir no mínimo: `useChat`, parsing de `ai.ts`, extração de dados, auth do backend

### Fase 3 — Produto (Chat / Insights)
- Decidir: deixar claro no copy que insights são heurísticos, OU migrar `generateInsights()` para de fato usar o LLM
- Avaliar streaming no chat (custo x benefício)
- Corrigir `InsightsScreen.tsx`: import do `expo-file-system` usa API removida (`cacheDirectory`/`EncodingType`) — "compartilhar relatório semanal" está quebrado (encontrado no typecheck da Fase 0)

### Fase 4 — Pendências do `PLANEJAMENTO.md`
- Retomar Health Connect (pausado por decisão do usuário em 2026-07-04)
- Export PDF/CSV
- Push notifications (EAS Build)
- Planos de treino gerados por IA

---

## 4. Como vamos testar

1. Cada mudança de fase → rodar no **emulador Pixel_8** (`npx expo run:android --device Pixel_8`)
2. Validar a funcionalidade específica na tela certa
3. Só ao fechar um conjunto de fases (ou antes de um release) → instalar no S24 físico para validação final

---

*Ver também: `DEVLOG.md` (changelog histórico), `PLANEJAMENTO.md` (visão de produto), `PLANEJAMENTO_AMIGOFIT.md` (spec original).*
