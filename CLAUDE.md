# CLAUDE.md

Orientações para o Claude Code neste repositório.

## Projeto

`agent-website` — landing page pública da Lab019 (lab019.ai), voltada ao
pequeno empreendedor (linguagem de negócio, pt-BR). Site estático — HTML +
CSS + um pouco de JS em `site/` — publicado no GitHub Pages via GitHub
Actions a cada push na `main` (sem build, sem framework).

Nota: não confundir com o `lab019-website` (site institucional Hugo +
Tailwind) — são repos e deploys distintos.

## Comandos

Não há build nem suíte de testes — o GitHub Pages publica o diretório `site/`
como está:

- Preview local: `python3 -m http.server -d site 8000`
- Deploy: automático no push para `main` (`.github/workflows/deploy.yml`);
  também acionável via workflow_dispatch.

Como não há lint nem suíte de testes, o equivalente aqui ao "lint e testes
verdes" e ao "toda mudança vem com teste" dos padrões da plataforma é:
HTML/CSS válidos, links e assets funcionando no preview local e o deploy do
Pages verde — mudanças se provam no preview, sem inventar harness de teste
para o site estático.

## Padrões da plataforma Lab019

Este repositório faz parte da plataforma de agentes da Lab019:

- `agent-runtime` — motor do agente (FastAPI SSE + LangGraph + MCP)
- `agent-gateway` — camada de canais (voz/LiveKit, Telegram, WhatsApp, widget)
- `agent-web` — front-end web (React + TypeScript)
- `agent-handoff` — vertical de atendimento humano
- `agent-base-tools` — MCP server de tools first-party (scheduler etc.)
- `agent-billing` — metering + wallet/billing por tenant
- `agent-secrets` — broker de segredos (BYOK)
- `agent-observability` — stack Prometheus + Grafana
- `agent-operation` — stack local unificada (docker compose) + IaC/deploy
- `lab019-website` — site institucional (Hugo + Tailwind)
- `agent-website` — landing page pública (site estático + GitHub Pages)

Todos os repos seguem os mesmos padrões abaixo.

### Qualidade de código

- **Lint e testes verdes antes de qualquer commit/push.** Use os comandos da
  seção "Comandos" deste repo. O CI é estrito: nada de `|| true`, checks
  pulados ou testes desabilitados para "resolver depois".
- **Conventional Commits** (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`,
  `ci:`, `chore:`), com escopo quando ajudar (ex.: `fix(widget): ...`). A
  mensagem explica o porquê, não só o quê.
- **SEMVER automatizado**: a cada push na `main`, o workflow `release` calcula
  a próxima versão a partir dos Conventional Commits (`fix:` → patch, `feat:`
  → minor, `BREAKING CHANGE`/`!` → major), cria a tag `vX.Y.Z` e publica um
  GitHub Release. Nos serviços com imagem Docker, a imagem no GHCR também
  recebe a tag da versão. O tipo do commit define a versão — escolha com
  cuidado.
- **Toda mudança de comportamento vem com teste.** Bug fix inclui teste de
  regressão que falharia sem o fix; feature nova cobre casos de borda, não só
  o happy path. O teste deve provar o que o nome/docstring afirma.
- **Siga o idioma do código existente** — nomes, estrutura, densidade de
  comentários. Não introduza dependência nova sem necessidade clara.
- **PRs pequenos e focados**, com descrição que explica o porquê.
- **Nunca commitar segredos** (`.env`, tokens, chaves, `secrets.json`) — use
  os arquivos `.example` correspondentes.

### Adversarial review quando o PR fica "ready for review"

Sempre que um PR acompanhado deste repositório fica **ready for review** — um
evento `<github-webhook-activity>` reporta que o PR saiu de draft (ou ele já
nasce non-draft) — dispare automaticamente:

1. **Subagent read-only** (sem Edit/Write/commit/push) faz um review
   **adversarial** do diff do PR contra a base: tenta **refutar** a correção
   do código, caçando defeitos reais introduzidos — lógica/correção, race
   conditions, lifecycle e vazamento de recursos, contratos quebrados entre
   serviços, buracos de tipo, casos de borda e testes que não provam o que
   afirmam. Retorna uma lista ranqueada e concreta com `arquivo:linha` e um
   cenário de falha por finding, separando **CONFIRMED** de **PLAUSIBLE**.
2. **Triagem no agente principal** — avalie os findings você mesmo; não
   aplique tudo cegamente:
   - Corrija e pushe os claramente reais, pequenos e dentro do escopo.
   - Pergunte ao usuário (AskUserQuestion) sobre os ambíguos ou arquiteturais.
   - Descarte falsos positivos, dizendo brevemente o que descartou e porquê.
3. Reporte um resumo curto do resultado (findings mantidos, corrigidos e
   descartados). Seja frugal em comentários no GitHub.
