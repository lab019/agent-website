# agent-website

Landing page pública da **LAB019** — o Agente de IA para o pequeno negócio.
Site estático, hospedado no **GitHub Pages**.

- **Domínios:** [lab019.com](https://lab019.com) e [lab019.ai](https://lab019.ai)
- **Público-alvo:** pequeno empreendedor (linguagem de negócio, pt-BR)
- **Proposta:** um Agente que atende por **chat, voz e WhatsApp**, com vários
  modelos de IA (o brasileiro **Sabiá-4** da Maritaca — com opção de
  infraestrutura 100% no Brasil —, Claude, Gemini, GPT e DeepSeek), escolha
  automática do modelo, BYOK e acesso via web ou API. Plano de **R$25/mês que
  viram créditos**, com 14 dias grátis sem cartão.

## Estrutura

```
site/
├── index.html          # home (landing completa)
├── 404.html            # página de erro
├── assets/
│   ├── styles.css      # design system + estilos
│   ├── legal.css       # estilos das páginas legais
│   └── favicon.svg
├── modelos/            # detalhe: modelos e escolha inteligente
├── whatsapp/           # detalhe: canal WhatsApp (QR ou Cloud API)
├── voz/                # detalhe: voz e telefone
├── especialistas/      # detalhe: especialistas, sub-agentes e skills
├── integracoes/        # detalhe: MCP e ferramentas
├── handoff/            # detalhe: atendimento humano
├── preco/              # detalhe: preço e créditos
├── privacidade/  · termos/          # legais (PT)
├── en/privacy/   · en/terms/        # legais (EN)
├── CNAME               # domínio custom do GitHub Pages (lab019.ai)
├── robots.txt
└── sitemap.xml
.github/workflows/
└── deploy.yml          # publica site/ no GitHub Pages a cada push na main
```

Cada página de detalhe é um `index.html` numa subpasta (URLs limpas: `/modelos/`,
`/whatsapp/`, …). Todas reaproveitam o `assets/styles.css`.

O site é 100% estático (HTML + CSS + um pouco de JS), sem etapa de build. Fonte
carregada via Google Fonts (Inter).

## Desenvolvimento local

Não precisa de build. Basta servir a pasta `site/`:

```bash
cd site
python3 -m http.server 8080
# abra http://localhost:8080
```

Como não há lint nem suíte de testes, o gate de qualidade é: HTML/CSS válidos,
links e assets funcionando no preview, e o deploy do Pages verde.

## Publicação

O deploy é automático: ao dar merge na branch `main`, o workflow
`.github/workflows/deploy.yml` publica o conteúdo de `site/` no GitHub Pages.

### Configuração de domínio (uma vez)

1. Em **Settings → Pages**, defina a origem como **GitHub Actions**.
2. O arquivo `site/CNAME` já aponta para `lab019.ai`. Configure o DNS do
   domínio com um `CNAME`/`ALIAS` para `<org>.github.io` (ou os `A` records
   do GitHub Pages) e ative **Enforce HTTPS**.
3. Para o domínio `lab019.com`, configure um redirecionamento (a nível de DNS
   ou registrador) apontando para `lab019.ai` — o GitHub Pages aceita um
   único domínio custom por repositório via `CNAME`.

### Chat ao vivo no hero (Variables)

O card de chat do hero é um **chat de verdade** contra o **canal público de
widget** do agent-gateway — o mesmo protocolo de sessão do widget embutível
(`src/widget/client.ts` do agent-web):

```
POST {gateway}/v1/widget/sessions            { key }          → session_token (wst_) + conversation_id
POST {gateway}/v1/widget/conversations/{sid}/messages         → 202 { messageId }  (resposta vem pelo SSE)
GET  {gateway}/v1/widget/conversations/{sid}/events?st=wst_   → SSE (message_delta, done, error, …)
```

O **tenant (org) e o agente são resolvidos server-side pela WIDGET KEY** (`wgt_…`),
origin-gated no gateway — o browser nunca carrega credencial de admin. Quando o
hero sai da tela, uma bolinha aparece no canto superior direito (abaixo do
"Testar grátis") e abre um painel que **continua a mesma conversa**; ao voltar ao
topo, a conversa retoma no card do hero. A sessão é reaproveitada entre reloads
(localStorage). Toda a lógica vive em [`site/assets/chat.js`](site/assets/chat.js).

A widget key e a base da API **não são hardcodadas** — são injetadas no deploy a
partir de **repository/environment Variables** (padrão idêntico ao `GTM_CONTAINER_ID`):

| Variable            | Obrigatória | Default (se ausente)     | O que é                                                       |
| ------------------- | ----------- | ------------------------ | ------------------------------------------------------------ |
| `PUBLIC_WIDGET_KEY` | sim¹        | —                        | a widget key pública `wgt_…` (criada no gerenciador de keys) |
| `PUBLIC_API_BASE`   | não         | `https://api.lab019.ai`  | origem da API (o gateway fica em `{base}/gateway`)           |

¹ Sem `PUBLIC_WIDGET_KEY`, o token não é substituído e o hero permanece como
**ilustração estática** (sem chat ao vivo, sem bolinha) — deploy seguro, e é
exatamente o comportamento no preview local.

Dependências de backend (fora deste repo):

- A **widget key** precisa ter `https://lab019.ai` na sua lista de origins
  permitidas (o gateway faz origin-gating no mint da sessão).
- Como a landing é servida de `https://lab019.ai` e chama `https://api.lab019.ai`,
  esse **origin precisa estar liberado no CORS** do gateway
  (`GATEWAY_CORS_ORIGINS`) — ver `agent-operation`. (O runtime não é mais chamado
  direto pelo browser neste fluxo — o gateway virou data-plane.)

## Conteúdo

O copy é voltado a negócio (não técnico) e descreve recursos reais do Agente:
atendimento por chat/voz/WhatsApp, roteamento automático entre modelos (com
opção de rodar 100% no Brasil via Sabiá-4/Maritaca), especialistas e
sub-agentes, skills, integrações e ferramentas via MCP, BYOK, handoff para
atendente humano (MVP), teto de custo por conversa e acesso via web ou API.

O levantamento completo das capacidades do Agente (base para a copy) está em
[`docs/levantamento-capacidades-do-agente.md`](docs/levantamento-capacidades-do-agente.md).
