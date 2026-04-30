# AmigoFit — Plano de Produto

## Conceito

Um companheiro de treino com IA integrada (Claude). Você conversa naturalmente — antes, durante e depois do treino — e o app automaticamente extrai, organiza e aprende com o que você compartilha. Com o tempo, ele identifica padrões e te dá insights reais: o que te faz render mais, o que te prejudica, quanto sono você precisa.

---

## Fluxo Central

```
Usuário conversa → IA extrai dados relevantes → Salva no perfil → 
Analisa padrões → Gera insights personalizados
```

---

## Funcionalidades

### 1. Chat com o AmigoFit (core)
- Conversa livre e natural em PT-BR
- Contexto persistente: a IA lembra das conversas anteriores
- Modos de conversa:
  - **Pré-treino**: o que comi, como dormi, disposição do dia
  - **Durante o treino**: sugestões em tempo real, motivação, adaptações
  - **Pós-treino**: como foi, o que senti, dificuldades
  - **Livre**: nutrição, perguntas gerais, planejamento

### 2. Extração Inteligente de Dados
A IA detecta automaticamente na conversa e registra:

| Categoria | Exemplos de captura |
|-----------|---------------------|
| **Saúde/Bem-estar** | "passei mal", "dor de cabeça", "enjoo" |
| **Desempenho** | "não consegui fazer a série", "aumentei o peso", "bati recorde" |
| **Alimentação** | "comi pizza ontem", "tomei whey", "fui jantar pesado" |
| **Sono** | "dormi 5 horas", "acordei cansado", "dormi bem" |
| **Emoções** | "estressado", "animado", "sem energia" |
| **Treino realizado** | exercícios, séries, cargas, duração |

### 3. Diário Automático (Planilha Inteligente)
- Linha do tempo com todas as entradas
- Visualização por categoria (alimentação, sono, performance)
- Calendário de treinos e correlações
- Exportável (PDF, CSV)

### 4. Insights e Padrões (o diferencial)
Com dados acumulados de semanas/meses, o app responde:
- "Quando você come X na véspera, seu rendimento cai Y%"
- "Você rende melhor com 7-8h de sono vs 5-6h"
- "Sexta-feira historicamente é seu pior dia — considere descanso"
- "Os últimos 3 episódios de mal-estar foram após refeições pesadas à noite"

### 5. Perfil do Usuário
- Objetivo: hipertrofia, emagrecimento, condicionamento, saúde geral
- Nível: iniciante, intermediário, avançado
- Restrições: alimentares, físicas, lesões
- Preferências de treino

---

## Arquitetura Técnica

### Frontend Mobile
- **React Native** (iOS + Android com um codebase)
- Ou **Flutter** (melhor performance, mais verboso)
- **Recomendação: React Native** — ecossistema maior, integração mais fácil com APIs JS

### Backend
- **Node.js + Express** ou **Python + FastAPI**
- **Recomendação: Python + FastAPI** — melhor para ML/análise de dados futura

### Banco de Dados
```
PostgreSQL
├── users (perfil, configurações)
├── conversations (histórico de chats)
├── extracted_data (dados extraídos automaticamente)
│   ├── category (sleep, nutrition, performance, mood, health)
│   ├── value
│   ├── raw_text (trecho original da conversa)
│   └── timestamp
├── workouts (treinos registrados)
└── insights (insights gerados)
```

### IA
- **Claude API** (Anthropic) — para o chat
- **System prompt** com contexto do usuário carregado dinamicamente
- **Função de extração**: após cada mensagem, segundo chamada à API extrai dados estruturados
- Futuramente: embeddings para busca semântica no histórico

### Infraestrutura
- **Supabase** (PostgreSQL + Auth + Storage, tudo junto, ótimo para MVP)
- **Vercel** ou **Railway** para o backend
- **Expo** para build/distribuição do app em React Native

---

## Fluxo de Dados — Como a Extração Funciona

```
1. Usuário envia mensagem: "Ontem dormi só 5 horas e comi uma pizza às 22h"

2. Claude responde naturalmente ao usuário

3. Em paralelo (ou sequencialmente), segunda chamada à API:
   Prompt: "Extraia dados estruturados desta mensagem: [mensagem]"
   Resposta JSON:
   {
     "sleep": { "hours": 5, "quality": "poor" },
     "nutrition": [
       { "food": "pizza", "time": "22:00", "flag": "late_heavy_meal" }
     ]
   }

4. Dados salvos no banco com timestamp

5. A cada N dias, análise de padrões é rodada
```

---

## MVP — O Que Construir Primeiro

### Fase 1 — Chat Funcional (4-6 semanas)
- [ ] App React Native básico com tela de chat
- [ ] Integração com Claude API
- [ ] Autenticação (Supabase Auth)
- [ ] Histórico de conversas persistido
- [ ] System prompt com perfil do usuário

### Fase 2 — Extração de Dados (3-4 semanas)
- [ ] Pipeline de extração após cada mensagem
- [ ] Banco de dados estruturado
- [ ] Tela de "Diário" com dados extraídos
- [ ] Usuário pode editar/confirmar dados extraídos

### Fase 3 — Insights (4-6 semanas)
- [ ] Algoritmo de correlação básico
- [ ] Tela de insights/padrões
- [ ] Notificações inteligentes ("Você treina melhor após 8h de sono")
- [ ] Relatório semanal

### Fase 4 — Polimento (2-3 semanas)
- [ ] UI/UX refinado
- [ ] Onboarding
- [ ] Tela de perfil e configurações
- [ ] Exportação de dados

---

## Stack Final Recomendada

| Camada | Tecnologia | Por quê |
|--------|-----------|---------|
| Mobile | React Native + Expo | Cross-platform, deploy rápido |
| UI | NativeWind (Tailwind p/ RN) | Estilização rápida |
| Backend | Python + FastAPI | Futuro ML, análise de dados |
| Banco | Supabase (PostgreSQL) | Auth + DB + Realtime incluídos |
| IA | Claude API (claude-sonnet-4-6) | Melhor em PT-BR, conversacional |
| Deploy | Railway (backend) + Supabase (DB) | Simples e barato no início |

---

## Diferenciais Competitivos

1. **Totalmente conversacional** — não tem formulários, só chat natural
2. **Aprende sobre você** — não é genérico, se personaliza com o tempo
3. **Passivo** — você só conversa, os dados são coletados automaticamente
4. **Correlações reais** — liga sono, alimentação, humor e performance
5. **PT-BR nativo** — feito para o público brasileiro

---

## Próximos Passos

1. Validar o conceito (protótipo no Figma ou tela mockada)
2. Configurar o projeto React Native + Expo
3. Criar conta na Anthropic e testar o system prompt do AmigoFit
4. Configurar Supabase (auth + tabelas)
5. Construir a tela de chat e integrar Claude API

---

## Estimativa de Custo (MVP)

| Item | Custo/mês |
|------|-----------|
| Supabase (free tier) | R$ 0 |
| Railway backend | ~R$ 15-30 |
| Claude API (uso moderado) | ~R$ 50-150 |
| Apple Developer (anual) | R$ 550/ano |
| Google Play (único) | R$ 130 |
| **Total inicial** | **~R$ 65-180/mês** |
