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

## Conteúdo

O copy é voltado a negócio (não técnico) e descreve recursos reais do Agente:
atendimento por chat/voz/WhatsApp, roteamento automático entre modelos (com
opção de rodar 100% no Brasil via Sabiá-4/Maritaca), especialistas e
sub-agentes, skills, integrações e ferramentas via MCP, BYOK, handoff para
atendente humano (MVP), teto de custo por conversa e acesso via web ou API.

O levantamento completo das capacidades do Agente (base para a copy) está em
[`docs/levantamento-capacidades-do-agente.md`](docs/levantamento-capacidades-do-agente.md).
