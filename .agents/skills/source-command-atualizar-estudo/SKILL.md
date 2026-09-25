---
name: "source-command-atualizar-estudo"
description: "Atualiza o vault de estudo do AmigoFit no Obsidian a partir do código local (fonte da verdade)"
---

# source-command-atualizar-estudo

Use this skill when the user asks to run the migrated source command `atualizar-estudo`.

## Command Template

Você vai sincronizar o **vault de estudo** do AmigoFit com o **código local atual**.

## Regras de ouro

- **Fonte da verdade = os arquivos locais deste projeto** (o working tree atual, incluindo mudanças ainda não commitadas). NÃO use o GitHub.
- O `git` serve só de **gatilho** (saber o que mudou desde a última sincronização). O conteúdo das notas sempre reflete o código que está no disco AGORA — leia o arquivo real, nunca confie só no diff.
- **Vault de estudo:** `~/obsidian/Projetos_Dev/AmigoFit_App/` (18 notas `.md`).
- **Marcador da última sync:** `.Codex/.estudo-last-sync` (contém o commit da última atualização do vault).

## Passos

1. **Descubra o escopo do que mudou:**
   - `LAST=$(cat .Codex/.estudo-last-sync 2>/dev/null)`
   - `git log --oneline $LAST..HEAD` e `git diff --stat $LAST..HEAD` → o que mudou desde a última sync.
   - `git status -s` → mudanças ainda não commitadas (também contam, pois o local é a fonte).
   - Leia também as entradas recentes de `DEVLOG.md` — elas resumem o "porquê" das mudanças.
   - Se o marcador não existir, faça uma auditoria completa (compare todas as notas com o código).

2. **Mapeie cada mudança para a(s) nota(s) afetada(s)** e leia os arquivos de código reais envolvidos. Guia de mapeamento:
   - Rotas/schema/IA no backend → `Backend - Servidor Express.md`, `Backend - Banco de Dados.md`, `IA - Multi-provider BYOK.md`
   - Telas/navegação/tema → `Frontend - Navegação e Telas.md`
   - Hooks (`src/hooks/`) → `Frontend - Hooks.md`
   - Serviços (`src/services/`) → `Serviços - *.md`
   - Fluxos ponta a ponta (chat, dieta, treino, insights, voz, auth) → as notas `Fluxo *.md` / `Entrada por Voz.md`
   - Termos novos → `Glossário.md`; conceitos novos para testar → `Perguntas de Estudo.md`
   - **Feature nova sem nota** → crie uma nota nova e adicione o link na trilha do `00 - Início.md`.

3. **Atualize as notas** mantendo o estilo do vault:
   - Diagramas Mermaid onde ajudam; callouts (`> [!note]`, `> [!question]`, `> [!tip]`, `> [!warning]`, `> [!important]`); links `[[Nota]]`.
   - Explique sempre nos **dois níveis**: a parte prática (o que muda na operação/no mundo real) E a parte técnica (o que mudou no código/arquitetura).
   - Foque no *porquê* de cada coisa existir — é material de estudo, não referência de API.
   - Corrija o que ficou factualmente errado (nomes de modelo, contagem de tabelas/telas/testes, onde os dados moram, etc.).

4. **Feche a sincronização:**
   - Atualize a seção "Estado atual" e a linha "Última sincronização" no `00 - Início.md` com a data de hoje.
   - Grave o novo marcador: `git rev-parse HEAD > .Codex/.estudo-last-sync`.
   - Faça um resumo curto do que mudou nas notas (quais foram tocadas e por quê), nos dois níveis.

Não commite nada automaticamente, a não ser que eu peça.
