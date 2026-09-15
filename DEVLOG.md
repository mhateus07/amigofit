# AmigoFit — Devlog

Registro de tudo que foi desenvolvido no projeto até agora.

---

## Stack

- **Frontend:** React Native + Expo SDK 54 (TypeScript)
- **Backend:** Node.js + Express (JavaScript)
- **Banco de dados:** PostgreSQL via Docker Compose
- **IA:** Anthropic Claude API (`claude-sonnet-4-6`) — chat e extração de dados
- **Auth:** JWT + bcrypt
- **Storage local:** AsyncStorage (dados não sensíveis) + expo-secure-store/Keychain (token JWT, API keys)
- **Teste mobile:** Expo Go (iPhone via QR Code)

---

## Backend — `server/index.js`

URL de produção: `http://31.97.160.94:3001`

### Endpoints

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/health` | — | Health check |
| POST | `/auth/register` | — | Cadastro (rate limited) |
| POST | `/auth/login` | — | Login (rate limited) |
| GET | `/auth/me` | JWT | Dados do usuário logado |
| GET | `/api/profile` | JWT | Buscar perfil |
| POST | `/api/profile` | JWT | Salvar perfil |
| GET | `/api/messages` | JWT | Buscar histórico de chat |
| POST | `/api/messages` | JWT | Salvar histórico de chat |
| GET | `/api/extracted-data` | JWT | Buscar dados extraídos |
| POST | `/api/extracted-data` | JWT | Salvar dados extraídos |
| POST | `/api/chat` | JWT + API Key | Chat com Claude |
| POST | `/api/extract` | JWT + API Key | Extração de dados da mensagem |

### Segurança aplicada
- **Rate limiting** nas rotas `/auth/register` e `/auth/login`: máx. 10 req/15min via `express-rate-limit`
- **JWT_SECRET** lê da variável de ambiente `JWT_SECRET`; exibe aviso no boot se não estiver definida
- API Key Anthropic enviada pelo cliente via header `x-api-key` (não armazenada no servidor)

---

## Fluxo de telas (App.tsx)

```
Abertura
  └─► SplashScreen (2.6s — roda em paralelo com auth check)
        └─► [usuário já logado] ──► Main Tabs
        └─► [sem sessão] ──► WelcomeScreen
              ├─► "Começar agora" ──► AuthScreen (modo: register)
              └─► "Já tenho conta" ──► AuthScreen (modo: login)
                    └─► OnboardingScreen (se perfil incompleto)
                          └─► Main Tabs
```

---

## Telas implementadas

### `SplashScreen.tsx` *(nova)*
- Background: imagem `assets/splash-bg.png` (neon verde) com overlay escuro (45%)
- Logo "AF" animado: spring de entrada + dois rings de pulso alternados
- Texto "AmigoFit" e tagline com fade-in
- Transição: fade-out em 450ms após 2.6s
- Auth check roda em paralelo durante o splash

### `WelcomeScreen.tsx` *(nova)*
- Hero: mascote geométrico neon (`assets/mascot.png`) na parte superior
- Headline bold + 3 feature cards (Chat IA / Diário / Insights) com cores por categoria
- Botão primário: "Começar agora — é grátis 💪" → AuthScreen em modo register
- Botão secundário: "Já tenho conta →" → AuthScreen em modo login
- Entrada com animação: scale + fade (hero) e slide-up + fade (body)

### `OnboardingScreen.tsx` *(nova)*
- 3 passos com progress dots animados
- **Step 0:** Nome (pre-preenchido com o nome do cadastro)
- **Step 1:** Objetivo (Hipertrofia / Emagrecer / Condicionamento / Saúde geral) + Nível (Iniciante / Intermediário / Avançado)
- **Step 2:** API Key Anthropic com instruções passo a passo + opção "Configurar depois"
- Salva perfil no servidor e API Key localmente (AsyncStorage)

### `AuthScreen.tsx` *(modificada)*
- Adicionada prop `initialMode?: 'login' | 'register'` para abrir direto no tab correto

### `DiaryScreen.tsx` *(correção)*
- Corrigido erro TypeScript no `keyExtractor` do FlatList (retornava `number` em vez de `string`)

---

## Assets visuais (Lovart)

| Arquivo | Uso |
|---------|-----|
| `assets/splash-bg.png` | Background do SplashScreen + splash nativo (app.json) |
| `assets/mascot.png` | Hero da WelcomeScreen (figura correndo neon verde) |
| `assets/icon.png` | Ícone do app — **pendente substituição** pelo ícone "A com circuito" gerado |

### Ícone pendente
O ícone "A com circuito neural neon verde" ainda precisa ser salvo em:
- `assets/icon.png` (iOS + geral)
- `assets/adaptive-icon.png` (Android)

---

## app.json — mudanças

```json
"splash": {
  "image": "./assets/splash-bg.png",
  "resizeMode": "cover",
  "backgroundColor": "#0F0F0F"
}
```

---

## Dependências adicionadas ao servidor

```bash
npm install express-rate-limit   # rate limiting nas rotas de auth
```

---

## Como rodar localmente

### Backend
```bash
cd server
docker compose up -d   # sobe PostgreSQL
node index.js          # inicia servidor na porta 3001
```

### Frontend (iPhone via Expo Go)
```bash
npx expo start
# Escaneia QR Code no Expo Go
```

---

## Testes automatizados (2026-07-06)

Stack: `jest` + `jest-expo` (frontend/hooks) + `@testing-library/react-native` v14 + `supertest` (backend).

- `npm test` roda tudo (`jest.config.js` na raiz).
- `src/screens/__tests__/WelcomeScreen.test.tsx` — smoke test de um componente puro.
- `src/hooks/__tests__/useChat.test.ts` — estados de loading/erro e envio de mensagem, com `storage` e `AIService` mockados.
- `src/services/__tests__/ai.test.ts` — `AIService.extractData` (fetch mockado).
- `server/__tests__/auth.test.js` — registro, login e rota protegida (`pg` mockado, sem Postgres real).
- `server/index.js` agora exporta `{ app, pool, JWT_SECRET }` e só chama `initDB()`/`app.listen()` quando executado diretamente (`node server/index.js`), permitindo testar as rotas com `supertest`.

---

## Integração Apple Saúde (HealthKit) — 2026-08-26

- `src/services/appleHealth.ts`: sincroniza sono, passos, treinos, peso e frequência cardíaca do Apple Saúde (iOS) para o Diário/Insights — mesmo padrão de `healthConnect.ts` (Android).
- Lib `@kingstinct/react-native-healthkit` (+ `react-native-nitro-modules`), config plugin no `app.json`, card na aba Perfil visível só em `Platform.OS === 'ios'`.
- Motivo da prioridade sobre o Health Connect: uso diário real do app passou a ser no iPhone do usuário.

---

## Lembretes locais de treino — 2026-08-26

- `src/services/reminders.ts`: agenda notificação local diária (`expo-notifications`, trigger `DAILY`) sem depender de push remoto — funciona com conta Apple pessoal/gratuita.
- Seção "Lembrete de treino" do Perfil ganhou toggle + seletor de horário, substituindo o placeholder "Em breve"; `saveProfile` também parou de gravar `notificationEnabled`/`notificationTime` fixos (`false`/`'07:00'`) — bug encontrado de passagem.
- Plugin `expo-notifications` reativado no `app.json` só para as usage strings/ícone; a entitlement `aps-environment` que ele injeta precisa ser removida manualmente do `.entitlements` depois de cada `expo prebuild` (ver ESCOPO.md).

---

## Gamificação: conquistas — 2026-08-26

- `src/utils/achievements.ts`: 8 conquistas calculadas 100% no cliente a partir de dados já existentes (mensagens + Diário) — primeira mensagem, streaks de 3/7/30 dias, 10 treinos, semana de sono completa, 50/100 registros. Sem mudança de schema/backend.
- Nova seção "Conquistas" na aba Insights, logo abaixo dos cards de estatísticas: grid 2 colunas, cada badge com ícone, progresso (`X/Y`) e barra de progresso; ícone/barra ficam esmaecidos enquanto bloqueada.
- 5 testes novos em `src/utils/__tests__/achievements.test.ts` (49/49 no total).

---

## Export de dados (CSV/PDF) — 2026-08-27

- Aba Insights ganhou "Exportar CSV" e "Exportar PDF", ao lado do "Compartilhar relatório semanal" — exportam o histórico completo do Diário, não só os últimos 30 dias.
- CSV: monta a string na mão (com escape de vírgula/aspas/quebra de linha) e compartilha via `expo-sharing`, mesmo padrão já usado pro relatório semanal em texto.
- PDF: `expo-print` (`Print.printToFileAsync`) renderiza uma tabela HTML simples (data, categoria, rótulo, valor) e compartilha o arquivo gerado.
- Novo pod nativo (`ExpoPrint`) — precisou prebuild + remoção manual de `aps-environment` de novo (ver ESCOPO.md).

---

## Segurança: token e API keys movidos para o Keychain — 2026-09-07

- `src/services/storage.ts`: token JWT e as 4 chaves de API (Anthropic/OpenAI/Gemini/Groq) agora ficam no `expo-secure-store` (Keychain no iOS), não mais em `AsyncStorage` (texto puro no sandbox do app). Achado numa revisão de código pedida pelo usuário.
- Migração automática e transparente: `getSecure()` lê primeiro do SecureStore; se vazio, busca o valor antigo no AsyncStorage, grava no SecureStore e apaga do AsyncStorage — usuário não perde a chave já configurada nem precisa digitar de novo.
- Novo pod nativo (`ExpoSecureStore`) — precisou `expo prebuild` + remoção manual de `aps-environment` de novo (mesma pegadinha de sempre, ver ESCOPO.md). Validado no iPhone físico: chave de API preservada após a migração, chat funcionando.

---

## Fase 6: Fichas de treino com vídeo por exercício — 2026-09-08

- Nova aba "Treino" na barra inferior. Arquitetura clona a da aba Dieta (ficha = meal, exercício = item, check-in de treino = meal checkin), com uma peça nova: upload de vídeo próprio do usuário por exercício (não é biblioteca externa nem link de YouTube).
- Modelo de dados: tabelas `workout_plans`, `workout_checkins`, `exercise_videos`.
- Backend: CRUD de ficha + check-in (`/api/workout-plans`, `/api/workout-plans/checkins`) — check-in "concluí hoje" grava em `extracted_data` (category `workout`), alimentando a conquista `workouts-10` já existente sem mudar `achievements.ts`.
- Backend: extração de ficha via PDF (`/api/extract-workout`) e via foto (visão multi-provedor: Anthropic, OpenAI, Gemini; Groq/gpt-oss não tem visão e retorna erro claro pedindo pra trocar de provedor ou usar PDF).
- Infra: volume Docker novo pro `backend` (antes não tinha nenhum — arquivo escrito no container sumia a cada deploy), `multer`, endpoints `POST/GET/DELETE /api/exercise-videos`.
- Frontend: `TreinoScreen.tsx`, `useWorkoutPlan.ts` — form manual + lista + check-in + anexar/gravar vídeo por exercício (`expo-video`) + player inline + botão "📷 Foto" reaproveitando o `WorkoutReviewModal`.
- Novo pod nativo (`expo-video`) e `NSCameraUsageDescription` no `app.json` — mesma pegadinha do `aps-environment` reaparecendo após `expo prebuild` (removido manualmente de novo).
- 33 testes novos no backend (`workoutplan`, `extractworkout`, `exercisevideos`). Validado de ponta a ponta no iPhone físico do usuário: aba Treino, gravação/anexo de vídeo e extração via PDF/foto funcionando.

---

## Redesign visual — tema claro estilo Apple Health + fonte Inter — 2026-09-09

- `src/constants/theme.ts`: paleta trocada de preto+verde neon para tema claro/neutro (fundo off-white, texto quase preto, verde desaturado como accent) — mudança de valores, aplicada automaticamente em todas as telas que já usavam `theme` (Auth, Diário, Dieta, Insights, Perfil, Onboarding, Welcome, Treino).
- `ChatScreen.tsx` usada como piloto: além da paleta nova, recebeu ajustes de estilo próprios (espaçamento, bordas) para validar a direção visual antes de propagar refinamentos parecidos pras outras telas — as demais telas por enquanto só herdaram a cor, sem o polimento extra.
- Fonte customizada Inter via `@expo-google-fonts/inter`, carregada em `App.tsx` (`useFonts`).
- Bug corrigido de passagem: o early-return de "fonte ainda carregando" em `App()` estava antes de um `useEffect`, violando a ordem de hooks do React (`Rendered more hooks than during the previous render`) — movido pra depois de todos os hooks do componente.
- Pendente: propagar o polimento extra do Chat (não só a cor) pras demais telas, se fizer sentido depois de validar a direção.

---

## Próximos passos sugeridos

- [ ] Substituir `assets/icon.png` e `assets/adaptive-icon.png` pelo ícone gerado no Lovart
- [ ] Tela de Insights com gráficos reais (ex: Victory Native ou Recharts)
- [ ] Export de dados (PDF / CSV)
- [ ] Push notifications para lembretes de treino
- [ ] Migrar `saveMessages` para upsert (evitar DELETE + re-insert)
- [ ] Restringir CORS no servidor para domínios conhecidos
- [ ] Migrar backend para TypeScript
