# agent-website

Landing page pública da **LAB019** — a plataforma de agentes de IA para o
pequeno empreendedor. Site estático, hospedado no **GitHub Pages**.

- **Domínios:** [lab019.com](https://lab019.com) e [lab019.ai](https://lab019.ai)
- **Público-alvo:** pequeno empreendedor (linguagem de negócio, pt-BR)
- **Proposta:** chat + voz com vários modelos de IA (Sabiá, Claude, Gemini, GPT),
  BYOK e acesso via web ou API. Plano de R$25/mês com R$25 em créditos inclusos.

## Estrutura

```
site/
├── index.html          # página "Em breve" (ativa enquanto o serviço não lança)
├── index-full.html     # landing page completa (backup, restaurar no lançamento)
├── 404.html            # página de erro
├── assets/
│   ├── styles.css      # design system + estilos
│   └── favicon.svg
├── CNAME               # domínio custom do GitHub Pages (lab019.ai)
├── robots.txt
└── sitemap.xml
.github/workflows/
└── deploy.yml          # publica site/ no GitHub Pages a cada push na main
```

## Página "Em breve" (pré-lançamento)

Enquanto o serviço não é lançado, o `site/index.html` mostra uma página
**"Estamos construindo algo novo"** (aguarde o lançamento). A landing page
completa fica guardada em `site/index-full.html` — nada foi perdido.

**No lançamento**, para voltar o site completo no ar, restaure a landing e
faça o deploy:

```bash
cp site/index-full.html site/index.html   # volta a landing completa
rm site/index-full.html                    # (opcional) remove o backup
```

Depois faça commit e merge na `main` — o deploy publica automaticamente.

O site é 100% estático (HTML + CSS + um pouco de JS), sem etapa de build.
Fonte carregada via Google Fonts (Inter).

## Desenvolvimento local

Não precisa de build. Basta servir a pasta `site/`:

```bash
cd site
python3 -m http.server 8080
# abra http://localhost:8080
```

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

O copy é voltado a negócio (não técnico) e descreve recursos reais da
plataforma: chat com streaming/raciocínio, voz por WebRTC em pt-BR,
roteamento entre modelos, composição de agentes/sub-agentes e ferramentas via
MCP, BYOK, teto de custo por conversa e acesso via web ou API.
