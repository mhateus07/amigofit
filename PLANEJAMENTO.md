# AmigoFit — Planejamento Futuro

## Visão do produto

Um diário de saúde conversacional onde a IA extrai dados automaticamente do que o usuário fala.
O diferencial real: **você não preenche formulários, você conversa.**

---

## Melhorias planejadas

### 🧠 IA mais inteligente
- **Memória de longo prazo**: hoje a IA só vê os últimos 14 dias. Gerar um "resumo mensal" automaticamente e injetar no contexto
- **Proatividade**: IA alerta quando detectar padrões ruins ("você dormiu mal 4 dias seguidos, quer conversar sobre isso?")
- **Análise de progresso**: comparar mês atual vs anterior nos insights, com linguagem natural explicando o que mudou

### 📊 Insights mais ricos
- **Correlações visuais**: gráfico de sono × performance, alimentação × humor
- **Streak e metas semanais** com barra de progresso real
- **Relatório semanal automático**: tela resumindo a semana toda (exportável em PDF)
- **Previsão de padrões**: "baseado no seu histórico, você tende a treinar mal nas sextas-feiras"

### 🏋️ Funcionalidades de treino
- **Planos de treino gerados pela IA** com base no perfil e objetivo do usuário
- **Biblioteca de exercícios** com vídeos/GIFs
- **Timer de treino** integrado ao chat ("iniciar treino" abre cronômetro)
- **Integração com Samsung Health / Google Fit** para importar dados automaticamente sem precisar digitar

### 💰 Monetização
- **Plano gratuito** com limite de mensagens/dia ou sem histórico completo
- **Plano Pro** (~R$29/mês): histórico ilimitado, relatórios, planos de treino
- **Opção "traga sua chave"** (já implementado) para usuários técnicos
- **Marca branca**: vender o app para academias e personal trainers com branding próprio

### 🤝 Social e retenção
- **Desafios semanais**: "7 dias treinando", compartilhável
- **Personal trainer real** pode acessar o histórico do aluno e comentar
- **Compartilhar progresso**: card semanal bonito para Instagram/WhatsApp

### ⚙️ Técnico / infraestrutura
- **Build de produção** (EAS Build) com notificações push reais
- **Modo offline**: mensagens ficam em fila local e sincronizam ao voltar à internet
- **Backup e exportação** dos dados em CSV/PDF
- **Web app** para visualizar dados no computador

---

## Prioridades recomendadas

| Prioridade | Feature | Impacto | Esforço |
|---|---|---|---|
| 1 | Integração Samsung Health / Google Fit | Alto | Médio |
| 2 | Relatório semanal automático | Alto | Baixo |
| 3 | Planos de treino por IA | Alto | Médio |
| 4 | Notificações push (build próprio via EAS) | Médio | Médio |
| 5 | Monetização / plano Pro | Alto | Alto |

---

## Estado atual (junho 2026)

- App React Native + Expo SDK 54 (TypeScript)
- Backend Node.js + Express + PostgreSQL no Docker (VPS Contabo 173.212.208.109)
- Suporte a múltiplos provedores de IA: Anthropic, OpenAI, Groq, Gemini
- Testado e funcionando no Samsung S24
- Repositório: github.com/mhateus07/amigofit
