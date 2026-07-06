# AmigoFit — Escopo e Guia de Execução

*Atualizado em 2026-07-05. Este é o único documento que você deveria abrir no dia a dia. `PLANEJAMENTO.md` e `PLANEJAMENTO_AMIGOFIT.md` são visão de produto (consultar raramente); `DEVLOG.md` é changelog (só escrever, não planejar a partir dele).*

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
- Frontend: React Native + Expo SDK 54 (TypeScript)
- Backend: Node.js + Express (JavaScript)
- Banco: PostgreSQL via Docker Compose
- IA: Claude API (chat + extração de dados estruturados), com suporte multi-provider (OpenAI, Gemini, Groq) — BYOK, chave nunca armazenada no servidor
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
| 1 | CORS aberto | `server/index.js` | ✅ Corrigido na Fase 0 (local) — **falta deploy em produção** |
| 2 | `JWT_SECRET` sem fallback seguro | `server/index.js` | ✅ Corrigido na Fase 0 — **falta deploy em produção** |
| 3 | Sem rate limit em `/api/chat` e `/api/extract` | `server/index.js` | ✅ Corrigido na Fase 0 (local) — **falta deploy** |
| 4 | DELETE + reinsert de mensagens | `server/index.js` | ✅ Corrigido na Fase 1 (upsert) |
| 5 | URL de backend hardcoded | `src/services/storage.ts` | ✅ Corrigido na Fase 0 (`.env`) |
| 6 | Documentos de planejamento conflitantes | raiz do repo | Em resolução — este arquivo centraliza |
| 7 | Dependências mortas | `package.json` | ✅ Corrigido na Fase 0 |
| 8 | `CATEGORY_CONFIG` duplicado | Diário / Insights | ✅ Corrigido na Fase 1 |
| 9 | Zero testes automatizados | todo o repo | Em andamento (Fase 2) |
| 10 | Insights são heurísticas, não IA real | `InsightsScreen.tsx` | Pendente (Fase 3) |
| 11 | Chat sem streaming | `ai.ts` / backend | Pendente, não bloqueante |
| 12 | Logs do backend não registram status HTTP | `server/index.js` | Pendente, achado na Fase 1 |
| 13 | `expo-file-system` com API removida — "compartilhar relatório semanal" quebrado | `InsightsScreen.tsx` | Pendente (Fase 3) |

---

## 3. Fases

### ✅ Fase 0 — Higiene rápida — concluída 2026-07-04
Dependências mortas removidas, `.env` configurado, CORS restrito, JWT_SECRET obrigatório, rate limit em auth. **Pendente:** deploy dessas mudanças no VPS de produção.

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

### ⬜ Fase 3 — Produto (Chat / Insights)
- [ ] Decidir e documentar: insights continuam heurísticos (deixar claro no copy do app) OU migrar `generateInsights()` para usar o LLM de fato
- [ ] Avaliar streaming no chat (custo x benefício, registrar decisão aqui)
- [ ] Corrigir `InsightsScreen.tsx`: substituir API removida do `expo-file-system` (`cacheDirectory`/`EncodingType`) para destravar "compartilhar relatório semanal"

### ⬜ Fase 4 — Pendências de infraestrutura e produto
- [ ] Deploy das correções da Fase 0 no VPS de produção
- [ ] Retomar Health Connect (estava pausado por decisão do usuário em 2026-07-04)
- [ ] Export de dados em PDF/CSV
- [ ] Push notifications via EAS Build
- [ ] Planos de treino gerados por IA
- [ ] Logar status HTTP nos logs do backend (achado #12)

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

---

## 5. Registro de decisões

*Adicione uma linha aqui sempre que tomar uma decisão importante de arquitetura ou escopo, para não perder o contexto depois.*

- 2026-07-04: Health Connect pausado por decisão do usuário.
- 2026-07-04: Fases validadas no emulador Pixel_8 antes do celular físico (S24).
- 2026-07-06: Fase 2 (testes automatizados) concluída — 19 testes (Jest + jest-expo + @testing-library/react-native + supertest), cobrindo `useChat`, extração em `ai.ts` e auth do backend. Ver notas técnicas na seção da Fase 2 acima antes de mexer em testes de novo.
