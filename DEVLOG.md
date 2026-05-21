# AmigoFit — Devlog

Registro de tudo que foi desenvolvido no projeto até agora.

---

## Stack

- **Frontend:** React Native + Expo SDK 54 (TypeScript)
- **Backend:** Node.js + Express (JavaScript)
- **Banco de dados:** PostgreSQL via Docker Compose
- **IA:** Anthropic Claude API (`claude-sonnet-4-6`) — chat e extração de dados
- **Auth:** JWT + bcrypt
- **Storage local:** AsyncStorage (token, API key)
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

## Próximos passos sugeridos

- [ ] Substituir `assets/icon.png` e `assets/adaptive-icon.png` pelo ícone gerado no Lovart
- [ ] Tela de Insights com gráficos reais (ex: Victory Native ou Recharts)
- [ ] Export de dados (PDF / CSV)
- [ ] Push notifications para lembretes de treino
- [ ] Migrar `saveMessages` para upsert (evitar DELETE + re-insert)
- [ ] Restringir CORS no servidor para domínios conhecidos
- [ ] Migrar backend para TypeScript
