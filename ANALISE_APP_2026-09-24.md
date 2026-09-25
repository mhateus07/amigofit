# Análise do AmigoFit

Data: 24/09/2026

## Escopo e avaliação

Análise do código local, incluindo backend, login, chat, dieta, treino, integrações de saúde e infraestrutura. O app já tem uma boa variedade de funcionalidades, mas a prioridade deve ser confiabilidade e proteção dos dados. Foram identificadas falhas que podem apagar histórico, mostrar sucesso sem salvar e permitir alterações em registros de outra conta.

Esta análise não incluiu teste visual em celular, inspeção do ambiente de produção ou auditoria de dependências. Nenhuma correção foi implementada durante a análise. Os achados abaixo resultam da leitura do código; os resultados dos comandos de validação estão ao final. As referências de linha correspondem ao código analisado nesta data.

## Correções prioritárias

### 1. Editar dieta ou treino apaga check-ins anteriores

Ao salvar um plano, o backend exclui todos os registros existentes e os recria. Como os check-ins usam `ON DELETE CASCADE`, são apagados junto, mesmo quando os mesmos IDs são reinseridos.

**Correção:** atualizar os itens existentes, inserir os novos e arquivar os removidos, preservando o histórico.

Referências: `server/index.js:924` (dieta), `server/index.js:1014` (treino).

### 2. Falhas de autorização entre contas

O salvamento de mensagens atualiza conflitos por `id` sem conferir o proprietário. Os check-ins também aceitam IDs de refeições/treinos sem validar a propriedade antes da gravação. Se alguém obtiver um ID de outra conta, pode alterar dados dela.

**Correção:** verificar o proprietário em toda operação e reforçar o isolamento com restrições no banco.

Referências: `server/index.js:857` (mensagens), `server/index.js:959` e `server/index.js:1049` (check-ins).

### 3. Falhas de gravação são escondidas

Muitas funções ignoram erros de rede e não verificam `res.ok`. Um check-in pode aparecer como concluído mesmo que o servidor tenha recusado a operação. Leituras com erro viram listas vazias, confundindo indisponibilidade com ausência de dados.

**Correção:** centralizar as requisições, tratar erros HTTP, exibir opção de tentar novamente e desfazer alterações otimistas quando necessário.

Referência: `src/services/storage.ts:121`.

### 4. Trocar de conta pode reaproveitar informações da conta anterior

O logout remove apenas token e usuário. Chaves de IA, provedor, cache de insights e marcadores de sincronização continuam no dispositivo. O cache dos insights é validado apenas por data e quantidade de registros: outra conta com a mesma quantidade pode receber os insights anteriores.

**Correção:** separar armazenamento por usuário, limpar o estado na troca de conta e invalidar resultados de requisições antigas.

Referências: `src/services/storage.ts:62`, `src/screens/InsightsScreen.tsx:586`.

### 5. Chaves de IA salvas diretamente no perfil do banco

O SecureStore protege a cópia no celular, mas a tela de perfil também envia as chaves para o backend, que grava o JSON recebido sem criptografia na aplicação. Elas passam a fazer parte dos backups do banco.

**Correção:** decidir se as chaves devem ficar somente no dispositivo ou implementar armazenamento específico de segredos, com criptografia e respostas que não devolvam as chaves completas.

Referências: `src/screens/ProfileScreen.tsx:130`, `server/index.js:840`.

### 6. Salvar o histórico inteiro do chat permite perda de mensagens

Cada gravação envia toda a conversa e remove no servidor o que não estiver na lista recebida. Dois dispositivos, ou gravações que chegam fora de ordem, podem apagar mensagens mais recentes.

**Correção:** gravar mensagens individualmente com IDs idempotentes; limpar histórico deve ser uma operação separada.

Referência: `server/index.js:857`.

## Outros bugs e inconsistências

| Problema | Impacto e correção | Referência |
| --- | --- | --- |
| Imagens do chat são substituídas por `[imagem]` nas conversões para OpenAI, Gemini e Groq | A IA não recebe a foto. Implementar envio multimodal quando suportado e bloquear explicitamente quando não for. | `server/index.js:226` |
| `imageUri` não é persistido no backend | A imagem da conversa desaparece após recarregar. Persistir o anexo com acesso autenticado. | `server/index.js:849` |
| Inicialização confunde perfil indisponível com perfil inexistente | Falha de rede ou sessão expirada pode levar ao onboarding novamente. Separar os estados de autenticação, carregamento, erro e primeiro acesso. | `App.tsx:151` |
| Sincronização de saúde avança mesmo quando o salvamento falha silenciosamente | Registros podem ficar sem importar nas próximas tentativas. Atualizar o marcador somente após confirmação do servidor e deduplicar por origem/ID. | `src/services/appleHealth.ts:195`; comportamento semelhante em `src/services/healthConnect.ts` |
| Contexto da IA seleciona os seis registros mais antigos de cada categoria dentro da janela | O servidor retorna ordem decrescente, mas o cliente usa `slice(-6)`. Ordenar explicitamente e selecionar os mais recentes. | `src/services/ai.ts:29` |
| Reprocessamento identifica mensagens por proximidade de horário | Pode pular mensagens distintas ou duplicar extrações demoradas. Vincular cada extração ao ID da mensagem. | `src/services/reprocess.ts:36` |
| Diário e insights não são atualizados automaticamente ao voltar à aba | O usuário pode precisar atualizar manualmente para ver novos registros. Recarregar ao ganhar foco ou invalidar o cache após gravações. | `src/screens/InsightsScreen.tsx:618`; `src/screens/DiaryScreen.tsx` |
| A API aceita campos e categorias sem validação suficiente | Dados inválidos podem chegar ao banco e quebrar telas que pressupõem categorias conhecidas. Validar tipos, enumerações, datas, tamanhos e respostas da IA. | `server/index.js:903` |

## Melhorias de experiência e produto

Estas são propostas baseadas nos fluxos implementados e precisam de validação visual e com usuários.

- **Tela “Hoje”:** reunir próximo treino, refeições pendentes e ações rápidas. As seis abas atuais distribuem bastante a rotina.
- **Treino com acompanhamento real:** registrar carga, repetições e séries realizadas, descanso e evolução por exercício.
- **Diário editável:** permitir corrigir ou excluir uma extração incorreta da IA, mostrando sua origem.
- **IA com confirmação:** apresentar “Identifiquei estes registros” antes de transformar interpretações duvidosas em histórico definitivo.
- **Uso offline:** manter planos disponíveis e indicar claramente registros pendentes de sincronização.
- **Onboarding mais simples:** para um público geral, configurar uma chave de API é uma barreira. Avaliar IA integrada ao produto, mantendo chave própria como configuração avançada.
- **Recuperação de conta:** implementar recuperação de senha, encerramento de sessões e exclusão de conta.
- **Acessibilidade:** revisar botões com ícones, rótulos para leitores de tela, fontes ampliadas, contraste e áreas de toque.
- **Insights mais úteis:** priorizar evolução e adesão; quantidade de registros, isoladamente, não representa melhora do usuário.

## Melhorias técnicas e operacionais

- Separar o backend de 1.277 linhas em autenticação, planos, mensagens, IA e persistência.
- Criar migrações versionadas e índices para consultas por usuário e data.
- Paginar mensagens e diário; hoje o histórico completo é carregado.
- Adicionar limites de tempo e cancelamento às chamadas de rede.
- Revisar sessões: o JWT dura 90 dias e não há mecanismo de revogação implementado.
- Limitar armazenamento de vídeos por usuário e limpar arquivos órfãos.
- Fazer backup dos vídeos também: o script atual cobre apenas o PostgreSQL. Manter cópia externa e testar restauração.
- Fazer o deploy verificar saúde real do serviço; atualmente ele reinicia e mostra logs.
- Monitorar falhas de gravação, latência e erros de IA, sem registrar conteúdo sensível.
- Criar testes com PostgreSQL real para isolamento entre usuários, exclusões em cascata, concorrência e recuperação de falhas.

Referências adicionais: `scripts/backup-db.sh`, `scripts/deploy.sh`, `docker-compose.yml`, `server/Dockerfile`.

## Resultado das verificações

- `npm test -- --runInBand`: **90 testes passaram**, distribuídos em **12 suítes**. A primeira tentativa foi bloqueada pelo sandbox ao abrir a porta temporária do Supertest; a execução com permissão ampliada concluiu com sucesso.
- `npx tsc --noEmit`: **falhou**, incluindo problemas nos tipos do Jest e uso de `StyleSheet.absoluteFillObject` em `src/screens/SplashScreen.tsx:103`.
- Os testes do backend usam banco simulado; passar nesses testes não garante integridade no PostgreSQL.
- Houve avisos de chamadas `act()` sobrepostas nos testes de `WelcomeScreen`.
- Não foi feita auditoria de dependências, inspeção da infraestrutura em produção ou validação em aparelhos.

## Ordem recomendada de execução

1. Corrigir autorização e perda de histórico.
2. Tornar gravações e troca de conta confiáveis, incluindo proteção das chaves de IA.
3. Corrigir IA, anexos e sincronização de saúde.
4. Melhorar experiência, acessibilidade e recuperação de erros.
5. Ampliar funcionalidades e acompanhamento de evolução.
