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
| 1 | CORS aberto | `server/index.js` | ✅ Corrigido na Fase 0, deployado em produção em 2026-07-17 |
| 2 | `JWT_SECRET` sem fallback seguro | `server/index.js` | ✅ Corrigido na Fase 0, deployado em produção em 2026-07-17 |
| 3 | Sem rate limit em `/api/chat` e `/api/extract` | `server/index.js` | ✅ Corrigido na Fase 0, deployado em produção em 2026-07-17 |
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
| 14 | Backend em HTTP puro, sem TLS (chaves de API de IA trafegando sem criptografia) | VPS de produção | ✅ Corrigido em 2026-07-17 — HTTPS via Traefik/EasyPanel + Let's Encrypt (`amigofit-api.impulsiodigital.com`), porta 3001 HTTP fechada |
| 15 | Deploy manual multi-passo via SSH, sem script | VPS de produção | ✅ Corrigido em 2026-07-17 — `scripts/deploy.sh` |
| 16 | Sem backup do banco de produção | VPS de produção | ✅ Corrigido em 2026-07-17 — `scripts/backup-db.sh` via cron diário, retenção de 14 dias |

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

### ⬜ Fase 3 — Produto (Chat / Insights)
- [x] Corrigir `InsightsScreen.tsx`: substituir API removida do `expo-file-system` (`cacheDirectory`/`EncodingType`) para destravar "compartilhar relatório semanal" — **corrigido e confirmado em 2026-08-22** (troca de `import * as FileSystem from 'expo-file-system'` para `'expo-file-system/legacy'`, mesmo padrão já usado em `DietaScreen.tsx`). Testado via Expo Go/túnel no iPhone: compartilhamento do relatório semanal funcionando.
- [x] Migrar insights de heurística para IA real — **implementado em 2026-08-22**: novo endpoint `POST /api/insights` (backend, multi-provedor, mesmo padrão de `/api/extract`) gera de 3-5 insights via LLM a partir dos dados dos últimos 30 dias + perfil. `InsightsScreen.tsx` usa a IA quando há chave configurada e ≥3 registros (com cache diário em AsyncStorage, ignorado no pull-to-refresh); cai de volta na heurística antiga (`generateHeuristicInsights`) se não houver chave, poucos dados, ou a chamada falhar. 8 testes novos (4 backend, 2 frontend + os 2 do fix anterior), 44/44 passando. Deployado no VPS em 2026-08-23 (push + `./scripts/deploy.sh`) e **confirmado pelo usuário funcionando end-to-end** via Expo Go: insights de IA aparecendo na aba Insights.
- [ ] Avaliar streaming no chat (custo x benefício, registrar decisão aqui)

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
- 2026-07-17: Backend de produção migrado de HTTP puro no IP para HTTPS em `https://amigofit-api.impulsiodigital.com` (Traefik/EasyPanel já existente no VPS + Let's Encrypt automático). Novo build EAS gerado com a URL HTTPS, instalado e testado com sucesso no aparelho do usuário; porta 3001 HTTP direta removida do `docker-compose.yml` e confirmada fechada. `scripts/deploy.sh` (deploy manual em 1 comando) e `scripts/backup-db.sh` (backup diário via cron, retém 14 dias em `/opt/amigofit/backups/`) adicionados e testados na VPS. Ver riscos #14, #15, #16.
- 2026-08-26: Removido o plugin `expo-notifications` do `app.json` (não estava em uso em nenhum lugar do código) — ele adicionava a capability Push Notifications, que conta pessoal/gratuita da Apple não suporta, travando builds locais no Xcode via `expo run:ios`. Push notifications real continua no backlog, mas será feito via EAS Build com conta paga quando chegar a hora.
- 2026-08-26: Priorizada integração com **Apple Saúde (HealthKit)** em vez de retomar o Health Connect (Android) — o uso diário real do app agora é no iPhone do usuário, não em Android, então HealthKit é o que traz valor imediato. Health Connect continua pausado/backlog.
- 2026-08-26 (achado, não bloqueante): `npx expo prebuild` sem `--clean` não remove entitlements de plugins removidos do `app.json` — mesmo depois de tirar `expo-notifications` dos plugins, a chave `aps-environment` reapareceu em `ios/AmigoFit/AmigoFit.entitlements` numa prebuild seguinte (rodada para adicionar o plugin do HealthKit). Precisou remoção manual da chave no arquivo depois de cada `prebuild`. Se voltar a acontecer, checar esse arquivo antes de abrir o Xcode.
