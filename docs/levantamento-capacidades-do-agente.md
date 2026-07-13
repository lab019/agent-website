# Levantamento de capacidades — o Agente do LAB019

> Documento de trabalho para reposicionar o `agent-website`: sair da narrativa de
> **"plataforma de agentes"** e passar a apresentar **um Agente** — o Agente do
> LAB019, feito para o **pequeno negócio**. Aqui está o levantamento **exaustivo**
> do que esse Agente realmente faz, extraído da leitura do código dos 8 repositórios
> do produto. Depois decidimos o que vai para a home e o que vira página de detalhe.
>
> **Método:** leitura direta do código + análise de cada repo por subagentes
> dedicados. Cada capacidade abaixo traz **onde vive** (repo/módulo) e um selo de
> **maturidade**. Onde há dúvida ou divergência, está marcado como ⚠️.
>
> **Legenda de maturidade:**
> `PRONTO` implementado e coeso · `PARCIAL` funciona mas com dependências/limites ·
> `ROADMAP` previsto no código, ainda não ligado · `⚠️ VALIDAR` divergência a confirmar antes de publicar.

---

## 1. Reposicionamento em uma frase

**Antes (site atual):** "A plataforma de agentes de IA para o pequeno empreendedor."

**Proposta:** "O Agente de IA que atende, resolve e trabalha pelo seu negócio — por
chat, voz e WhatsApp, com uma equipe de especialistas por trás e um preço que cabe
no caixa."

A mudança não é só de copy: hoje o produto **é** um agente configurável (o `aura`
de onboarding, mais especialistas por vertical) que o cliente molda conversando —
não uma "plataforma" abstrata que ele precisa montar. O site deve vender **o que o
Agente faz**, não a infraestrutura.

---

## 2. Como o Agente é construído (contexto de arquitetura)

O Agente é um sistema de serviços especializados. O cliente nunca vê isso — mas
ajuda a entender por que cada capacidade existe e onde ela "mora".

| Serviço | Papel | O que é o "cérebro"/"corpo" |
|---|---|---|
| **agent-runtime** | Núcleo/cérebro | Orquestra LLM, ferramentas (MCP), sub-agentes, skills, memória, reasoning, billing. Conversa via **SSE streaming**. |
| **agent-gateway** | Canais e mídia | Voz (WebRTC/LiveKit/SIP/Twilio), WhatsApp (Evolution API), Telegram, turn-detection, STT/TTS, handoff de mídia. |
| **agent-handoff** | Mesa de atendimento | Fila, "assumir agora", monitoramento ao vivo, auditoria da transferência humano↔agente. |
| **agent-base-tools** | Ferramentas nativas | MCP server first-party: agenda, data/hora, calculadora financeira, `http_request`, self-service da plataforma, `transfer_to_human`. |
| **agent-secrets** | Cofre de chaves | Broker de segredos por tenant — a fundação do BYOK e das credenciais de integração. |
| **agent-billing** | Créditos e cobrança | Carteira append-only, plano, franquia vs. créditos comprados, metering de LLM/voz/PSTN/WhatsApp, Stripe. |
| **agent-web** | Interface | Front-end React: chat, voz, telas de admin/canais/billing, mesa de atendimento. |
| **agent-website** | Site público | Este repo — a landing. |

**Multi-tenant e portátil** de ponta a ponta: cada capacidade é isolada por
organização (`org_id`), com modos `standalone` (single-tenant) e `oidc`
(multi-tenant via JWT Supabase).

---

## 3. Capacidades do Agente

### 3.1 Conversa que pensa antes de responder — `PRONTO`

- **O que é:** chat em tempo real com raciocínio à vista. Cada resposta é uma
  **timeline**: raciocínio → ferramentas usadas → texto final, com cursor ao vivo.
- **Como funciona:** streaming por **SSE** (`agent-runtime` → `agent-web`). O front
  renderiza nós de reasoning colapsáveis, tool calls com status/duração/resultado, e
  um rodapé com modelo servido, tokens in/out, tokens de raciocínio, duração e
  **TTFT (tempo até o 1º token)** (`agent-web` `AgentTurn.tsx`, `TimelineReasoning.tsx`).
- **Reasoning (extended thinking):** opt-in por especialista (`reasoning: {effort}`
  ou `{budget_tokens}`), cross-provider via LiteLLM, com **tetos por especialista**
  e hierarquia tenant ⊇ especialista ⊇ request. Exposto ao usuário como seletor
  **Desligado/minimal/low/medium/high** (`agent-runtime` `reasoning_resolver.py`;
  `agent-web` `InputBar.tsx`).
- **Benefício:** o dono confia na resposta porque vê o "porquê"; em tarefas difíceis
  o Agente raciocina mais, no resto fica barato e rápido.

### 3.2 Voz natural — `PRONTO`

- **O que é:** o cliente **liga ou fala** e conversa naturalmente, em português do
  Brasil, no mesmo histórico do chat de texto.
- **Como funciona (agent-gateway):** pipeline
  **Silero VAD → Deepgram STT (`nova-3`, pt-BR) → agent-runtime → Cartesia TTS
  (`sonic-3`, pt)** sobre **LiveKit** (WebRTC). Barge-in agressivo (interrompe o
  Agente após ~200ms de fala, cancela o TTS e aborta o request em andamento),
  endpointing configurável, e **filler de silêncio + leito ambiente** para a linha
  nunca parecer muda em esperas longas (`worker.py`, `filler.py`).
- **Transcrição unificada:** falas do usuário (STT) e do Agente (TTS) viram bolhas no
  mesmo feed, com selo **"voz"**; a timeline de reasoning/ferramentas aparece igual à
  de um turno de texto (`agent-web` `VoiceMessage.tsx`, `AgentTurn.tsx`).
- **Consentimento LGPD:** modal antes de acessar o microfone (web) e disclosure
  falado em ligações ("Esta chamada é atendida por um agente de IA.").
- **Benefício:** atendimento por voz que soa humano — pode ser interrompido, aguenta
  pausas, e deixa tudo transcrito no histórico.

### 3.3 Telefonia de verdade (número real) — `PRONTO` (dial-in) / `PARCIAL` (BYO-SIP)

- **O que é:** o cliente final liga para um **número de telefone comum** e é atendido
  pelo Agente 24/7. O empreendedor **compra o número dentro do produto**, sem tocar
  em Twilio.
- **Como funciona (agent-gateway):** PSTN → Twilio Elastic SIP Trunk → LiveKit SIP →
  worker de voz. O número discado (DNIS) resolve o agente/tenant. Self-serve de
  números pela tela de Canais: buscar por DDD, comprar, vincular a um agente
  (`sip_managed.md`, `phone_numbers.py`). Empresas com PABX próprio podem apontar um
  **tronco SIP** para a plataforma (`sip_trunk_router.py`).
- **Maturidade:** dial-in gerenciado e SIP self-serve estão prontos; o caminho
  **BYO-SIP com JWT assinado no INVITE** aparece na spec mas não confirmei código
  pronto — provável backlog.
- **Benefício:** um número de telefone que atende sozinho, sem call center nem conta
  de operadora.

### 3.4 WhatsApp (QR Code **e** Cloud API) — `PRONTO`

- **O que é:** presença no canal nº 1 do pequeno negócio brasileiro, com **dois
  jeitos de conectar**.
- **Como funciona (agent-gateway, via Evolution API):**
  - **QR Code (Baileys):** parear escaneando o QR — sem burocracia (`create_number`
    devolve QR/pairing code, `fetch_qr` renova).
  - **Cloud API (oficial da Meta):** token-based (access_token / phone_number_id /
    business_id), sem QR, com **templates aprovados** para mensagens fora da janela
    de 24h.
  - Cada número é ligado a um agente; gestão multi-tenant (`POST/GET/PATCH/DELETE
    /v1/whatsapp/...`), allowlist de remetentes, dedup. O tenant **nunca** manuseia
    credenciais da Evolution — a plataforma é dona da instância.
- **Na UI:** tela de Canais com modal "escanear para conectar" (QR) ou campos de
  tokens Meta (Cloud) (`agent-web` `VoiceChannelSection.tsx`/`ChannelsScreen.tsx`).
- **Benefício:** o Agente atende no WhatsApp — do jeito simples (QR) ou oficial
  (Cloud API) — com o mesmo cérebro do chat e da voz.

### 3.5 Telegram — `PRONTO`

- **O que é:** segundo canal de texto, multi-tenant.
- **Como funciona:** cadastrar o bot com o token do BotFather (validado via `getMe`),
  webhook autenticado, mesmo core de conversa/handoff (`agent-gateway`
  `channels/telegram/`). Toggle de handoff `/humano` e modo público/allowlist na UI.

### 3.6 Widget público / anônimo no site — `PRONTO`

- **O que é:** um chat/voz aberto a visitantes anônimos no site do cliente, **sem
  vazar dados** de outros clientes nem o raciocínio interno.
- **Como funciona (agent-gateway):** `role=anonymous`, conversa isolada por visitante,
  agente público dedicado, ferramentas restritas (`allow_anonymous`), gating de origem
  e rate-limit; supressão do relay de reasoning/ferramentas ao visitante
  (`core/widget.py`).

### 3.7 Handoff humano (transferir para uma pessoa) — `PRONTO` (núcleo) / `PARCIAL` (mesa)

- **O que é:** o Agente atende o volume e escala para um humano quando precisa — **na
  mesma conversa**, em voz e texto — e devolve depois com contexto.
- **Como funciona:**
  - **Gatilho:** o Agente chama a tool nativa **`transfer_to_human`** (`agent-base-tools`)
    ou o cliente digita `/humano`. Aprovação humana de ações também existe via HITL
    (§3.8).
  - **Mesa de atendimento (agent-handoff):** fila compartilhada por tenant com
    **"claim" atômico** (primeiro a clicar leva), **monitoramento ao vivo** de todas
    as conversas desde a 1ª mensagem, **"assumir agora" (barge-in)** sem esperar a
    fila, **devolver ao Agente** com nota, e **auditoria imutável** de cada transição.
  - **Voz:** o atendente entra na sala LiveKit ao vivo (WebRTC) e a presença dele
    muta o Agente. **Texto:** relay bidirecional de mensagens (WhatsApp/Telegram/web).
  - **Injeção de contexto:** o runtime aceita `POST .../context` para o humano deixar
    notas que o Agente lê ao retomar.
- **O que ainda NÃO existe (não prometer):** notificação ativa ao atendente (o modelo
  é **pull**/polling, sem e-mail/SMS/push), **SLA**, e **roteamento por assunto/skill**
  ou presença de atendentes — tudo previsto na spec como crescimento, sem código.
- **Benefício:** rede de segurança — casos sensíveis vão para uma pessoa sem perder o
  histórico, e voltam para o Agente.

### 3.8 Aprovação humana de ações (HITL) — `PRONTO`

- **O que é:** o Agente **pausa e pede um "OK"** antes de executar ações sensíveis
  (enviar e-mail, apagar registro, gastar dinheiro).
- **Como funciona:** opt-in por ferramenta no especialista
  (`interrupt_on: {tool: {allowed_decisions: [approve|edit|reject|respond]}}`). A tool
  pausa o turno e emite um evento `interrupt`; o usuário decide via painel **"Aprovação
  necessária"** (Aprovar / Rejeitar / Editar JSON / Responder) e o turno retoma por
  `POST .../resume` (`agent-runtime` `deep_engine.py`, `hitl.md`; `agent-web`
  `ApprovalRequest.tsx`).
- **Benefício:** o dono decide o que o Agente faz sozinho e o que precisa de
  confirmação — confiança e segurança.

### 3.9 Escolha inteligente de modelo (custo × inteligência) — `PRONTO`

- **O que é:** o Agente **escolhe sozinho o modelo certo para cada mensagem** —
  o mais barato que dá conta, o mais forte quando precisa. O cliente pode priorizar
  **custo** ou **inteligência**.
- **Como funciona:** o runtime manda ao **LiteLLM Proxy** apenas o nome de um
  **perfil** — `cheap`, `default` ou `smart`. Cada perfil é um *complexity router*
  que classifica a complexidade da mensagem (regra, sub-ms) e despacha para um tier
  **SIMPLE → MEDIUM → COMPLEX → REASONING** (`litellm-proxy/config.yaml`):
  - **`cheap` / `default`** — escadas **custo-first**, cheapest-first, de providers
    baratos (GPT-nano, Gemini Flash-Lite, Mistral Small, DeepSeek V4). **Nunca**
    Anthropic. Cache automático embutido.
  - **`smart`** — **qualidade-first** (Anthropic/Bedrock): Haiku → Sonnet → Opus →
    Fable 5, só escala ao topo nas mensagens mais difíceis.
  - Dentro de um tier, `cost-based-routing` pega o deployment mais barato disponível;
    há retries e **fallbacks cross-provider**.
- **Exposto na UI:** dropdown de modelo (grupos "Plataforma" e "BYOK"), perfis
  roteados marcados **"· roteado"**, e na tela de billing o **modelo real que rodou**
  aparece junto do alias do perfil (`agent-web` `InputBar.tsx`, `BillingScreen.tsx`).
- **Prompt caching** precificado com desconto reduz drasticamente o custo do prefixo
  repetido (system prompt + histórico) — estimativa de ~85% de economia de input em
  turnos com cache.
- **Benefício:** os créditos rendem muito mais — mensagem simples ("qual seu
  horário?") não paga preço de modelo de ponta.

### 3.10 BYOK — traga sua própria chave — `PRONTO`

- **O que é:** o cliente usa a **própria conta** de LLM (OpenAI, Anthropic, Google) e
  o custo cai na conta dele, não da LAB019.
- **Como funciona:** `agent-runtime` `byok_resolver.py` resolve a chave por `org_id`
  em tempo de request via o cofre **agent-secrets** (broker HTTP). Multi-provider
  (`anthropic/*`, `gemini/*`, `openai/*`). A chave é passada ao proxy como credencial
  do cliente; turnos BYOK são marcados `cost_basis=customer` no billing. Na UI, os
  modelos BYOK só aparecem quando há chave, agrupados no optgroup **BYOK**.
- **Cofre (agent-secrets):** segredos por `(namespace, provider, org_id)`, tokens de
  leitura e admin separados, write-only (nunca devolve o valor), nunca loga o segredo.
  ⚠️ É explicitamente **PoC** (JSON local, sem cripto at-rest; Vault/AWS previstos via
  seam de Protocol, não implementados).
- **Benefício:** clientes maiores / sensíveis a dados usam a própria conta — bom para
  vendas e compliance.

### 3.11 Skills (conhecimento do negócio sob demanda) — `PRONTO`

- **O que é:** blocos de conhecimento reutilizáveis (cardápio, política de trocas,
  FAQ, glossário) que o Agente carrega **só quando precisa**.
- **Como funciona:** **Skill Store** em Postgres com precedência **global ⊇ org**;
  `installed_skills` no especialista é um seletor real. Um backend read-only projeta a
  store na rota `/skills/` do deepagents, preservando **progressive disclosure** (só a
  descrição entra no prompt; o corpo é lido on-demand) — não incha o prompt nem o custo
  (`agent-runtime` `skills/store.py`, `skill_store_backend.py`, `skills.md`).
- **Benefício:** injeta o conhecimento do negócio sem deploy e sem encarecer cada
  conversa.

### 3.12 Especialistas (agentes prontos e configuráveis) — `PRONTO`

- **O que é:** "personalidades" especializadas — agente de agendamento, de cobrança,
  de suporte — cada uma com prompt, modelo, ferramentas, skills e **teto de custo**
  próprios.
- **Como funciona:** definidos em YAML (`AgentSpec`), guardados em **store DB-backed
  tenant-ready**, com **CRUD sem redeploy** (`/v1/admin/specialists/{id}`), precedência
  tenant > global > `aura`. Na UI há um **editor em formulário** que monta o YAML, com
  campo **"Custo máx. por conversa (USD)"** (default 0,5) (`agent-runtime`
  `specialists/store.py`; `agent-web` `SpecialistEditor.tsx`).
- **Benefício:** dá para vender/instalar agentes prontos por vertical e cada cliente
  customizar o seu sem depender de dev.

### 3.13 Multi-agentes / equipe de especialistas — `PRONTO` (sub-agentes) / `ROADMAP` (A2A)

- **O que é:** um agente principal **delega** subtarefas a sub-agentes especialistas
  isolados (ex.: pesquisar → resumir → verificar).
- **Como funciona:** sub-agentes inline no YAML (`sub_agents:`), compilados via
  deepagents/langgraph; cada um com modelo/reasoning próprio, ferramentas restritas a
  um subconjunto das do pai, e custo somando no teto da conversa. **Profundidade 1**
  (sem sub-sub-agentes). O SSE emite início/fim de sub-agente; a UI mostra o nó
  "delegou para X · sub-agente" com cor própria (`agent-runtime` `specialist_mapper.py`;
  `agent-web` `AgentTurn.tsx`).
- **Maturidade:** o "A2A" real entre **instâncias** distintas (`agent_delegation.py`)
  está **órfão/roadmap**, não ligado ao dispatch atual. Vender como "equipe de
  sub-agentes especialistas", não como "agentes independentes conversando".
- **Benefício:** tarefas compostas ficam mais confiáveis, cada etapa feita por um
  especialista.

### 3.14 Integrações via MCP (o Agente **age**, não só conversa) — `PRONTO`

- **O que é:** conectar o Agente a ferramentas e sistemas externos (busca web, CRM,
  ERP, Notion, ferramentas internas) pelo padrão **MCP**.
- **Como funciona:** **MCP Store DB-backed tenant-ready**, CRUD sem redeploy
  (`/v1/admin/mcp-servers/{name}`), com **4 modos de auth**: `static` (só global),
  `forward_user_token`, `byok:<provider>` (segredo por tenant), e **`oauth`**.
  - **MCP OAuth 2.1 user-delegated** (mesmo modelo do "add custom connector" do
    Claude): authorization code + **PKCE** + **Dynamic Client Registration**, tokens
    escopados por `(server, org, user)`, **criptografados em repouso (AES-256-GCM)`**,
    refresh transparente e proteção SSRF (`agent-runtime` `oauth/`, `mcp-store.md`).
  - Na UI, CRUD de MCP servers com **catálogo de tools ao vivo** e grant por-tool ou
    servidor inteiro (`agent-web` `McpServersScreen.tsx`).
- **Benefício:** o Agente consulta estoque, cria pedido no ERP, busca na web, lê o
  Notion do dono — com segurança multi-tenant e login OAuth por usuário.

### 3.15 Ferramentas nativas do Agente (`agent-base-tools`) — `PRONTO`

O Agente já vem com um kit de ferramentas de fábrica (MCP first-party):

- **Agenda / automação (`schedule_run`, `list_scheduled`, `cancel_scheduled`):**
  agenda a execução futura de um prompt — **uma vez** (`at`) ou **recorrente** (`cron`),
  timezone-aware — com loop de disparo durável (Postgres, `FOR UPDATE SKIP LOCKED`).
  Base do **outbound proativo** (§3.16).
- **Data/hora (`now`, `shift`, `diff`):** relógio e matemática de calendário
  (ex.: "+2,5 meses", "dias até o vencimento").
- **Calculadora financeira segura (`calculate`):** sem `eval` (avalia AST contra
  allowlist). Científica + **financeira: PMT, FV, PV, VPL (NPV) e TIR (IRR)** — o
  Agente responde prestação de financiamento, retorno de investimento, margem.
- **`http_request` ("um curl para o Agente"):** conecta a **qualquer API pública** com
  guardas fortes (SSRF sempre ligado, denylist dos serviços internos, redirects
  re-validados por hop, credencial gerenciada por tenant injetada server-side).
  ⚠️ A injeção de credencial gerenciada usa o namespace `http` do agent-secrets, que a
  PoC atual do cofre ainda **não** modela (só `mcp`/`llm`) — gap a confirmar.
- **`transfer_to_human`:** o gatilho de handoff (§3.7).
- **Self-service da plataforma:** `list/create/get/delete_specialist`,
  `list/create/get/delete_mcp_server`, `list_mcp_server_tools`, `list_models`,
  `start_conversation` — ver §3.17.

### 3.16 Automação proativa / outbound — `PRONTO`

O Agente **inicia** conversas, não só responde:

- **Agendamentos (chat ou tela):** "me manda o resumo de vendas toda segunda 9h",
  "cobrar o cliente X amanhã" (`schedule_run` + tela `#/admin/schedules`).
- **Disparos de WhatsApp (broadcast/mail-merge):** campanha personalizada com texto
  `{{coluna}}` ou template aprovado, destinatários por **CSV**, envio com status por
  contato; **respostas voltam para o Agente** (`agent-web`
  `WhatsAppBroadcastScreen.tsx`; `agent-gateway` `send_outbound`). Cobrado por mensagem.
- **Campanha de voz / cobrança (PSTN outbound):** o Agente **liga** para uma lista
  (nome/valor/vencimento por CSV), com abertura personalizada e **disclosure legal**,
  respeitando **janela de horário** e timezone (`agent-gateway`
  `channels/voice/outbound.py`, `compliance.py`; `agent-web` `VoiceOutboundScreen.tsx`).
- **Benefício:** régua de cobrança, remarketing e lembretes automáticos — sem call
  center e sem desenvolvedor.

### 3.17 Onboarding no-code: o Agente `aura` monta o seu Agente — `PRONTO`

- **O que é:** o pequeno empreendedor **cria o próprio agente conversando** — sem tela
  técnica. Ele diz "quero um agente que responda dúvidas e agende horários" e o `aura`
  cria o especialista, conecta integrações e já dispara a primeira conversa.
- **Como funciona:** as tools de self-service do `agent-base-tools` deixam um
  especialista **operar a própria plataforma** com segurança (sempre escopado à org do
  chamador): `create_specialist`, `create_mcp_server`, `start_conversation`, etc.
- **Benefício:** de zero a atendimento em minutos, pelo chat, sem consultoria.

### 3.18 Entrada por arquivos + visão — `PRONTO`

- **O que é:** mandar imagens, PDFs, planilhas e documentos direto ao Agente.
- **Como funciona:** o runtime aceita anexos base64, extrai texto (markitdown) e, para
  imagens, **fixa automaticamente um modelo com visão** (`agent-runtime`
  `attachments/`, `vision_routing.py`); a UI tem clipe de anexo com thumbnails e
  validação (`agent-web` `InputBar.tsx`).
- **Benefício:** o cliente manda o comprovante, a planilha, o PDF do pedido — e o
  Agente entende.

### 3.19 Saída estruturada (JSON) — `PRONTO`

- **O que é:** o Agente pode devolver **JSON validado** por um schema definido no
  especialista (`response_format`), útil para integrar com sistemas.

### 3.20 Memória e continuidade — `PRONTO`

- **O que é:** o Agente lembra da conversa entre turnos e ao longo do tempo.
- **Como funciona:** checkpoints por thread `{org_id}:{conversation_id}` (LangGraph
  `AsyncPostgresSaver`), memória de longo prazo (rota `/memories/`), histórico
  recarregável, **sumarização automática** quando o contexto chega a ~85% da janela.
  Voz e texto **compartilham a mesma conversa** — ligar depois de conversar por chat
  continua o mesmo fio.
- **Na UI:** barra de status com **ocupação da janela de contexto** (`[████░░] % ctx`)
  e contagem de turnos (`agent-web` `StatusBar.tsx`).

### 3.21 "Plan mode" — ⚠️ VALIDAR / não existe como recurso nomeado

- **Situação real:** **não há** um "plan mode" (nenhuma ocorrência de `plan_mode`/
  "modo plano" no runtime nem no front). O que existe são os **built-ins do
  deepagents** disponíveis a todo agente: **`write_todos`** (lista de tarefas/
  planejamento) + um **filesystem virtual por conversa** (`ls`/`read_file`/`write_file`
  /`edit_file`/`glob`/`grep`) que persiste entre turnos.
- **Recomendação:** ou **não anunciar** "plan mode", ou reposicionar como
  **"planejamento de tarefas em vários passos"** (o Agente organiza um checklist e
  mantém um rascunho de trabalho). Vender como "plan mode tipo Claude Code" seria
  impreciso.

---

## 4. Controle de custo, plano e transparência (`agent-billing`) — `PRONTO`

- **Créditos:** unidade em micro-dólares (`US$1 = 1.000.000 créditos`). Carteira
  **append-only** (razão imutável, saldo derivado por soma) — trilha auditável.
- **Plano base:** **R$25/mês** → concede **5.000.000 créditos (US$5)** de franquia
  mensal (a franquia expira no fim do ciclo; créditos **comprados** não expiram).
  ⚠️ **Divergência a corrigir antes de publicar:** o backend está em **R$25/mês** (repricing
  `0005`), mas a UI de billing ainda mostra o rótulo hardcoded **"R$ 50/mês"**
  (`agent-web` `BillingScreen.tsx`) e o top-up default é R$50. A home atual fala em
  R$25 com R$25 de créditos — **conferir os números reais** (R$25 → US$5 ≈ R$25 em
  crédito ao câmbio seed de R$5/USD).
- **Trial freemium:** **14 dias, US$1 (~10 min de voz), sem cartão**, 1 por e-mail
  verificado.
- **Metering por dimensão:** LLM (por token), **Voz STT+TTS US$0,05/min**, **PSTN
  in/out US$0,02/min**, **WhatsApp US$0,10/msg**, **aluguel de número US$1,15/mês**.
  ⚠️ O preço de **LLM não vem seedado** — é responsabilidade do operador configurar a
  margem; sem preço, eventos de LLM são rejeitados (nunca cobrados a zero).
- **Teto de custo por conversa (cost cap):** enforçado pelo runtime, inclui
  sub-agentes, sobrevive a pausas de HITL; exposto na UI como "Custo máx. por conversa".
- **Hard-stop por saldo:** o runtime consulta o saldo e bloqueia org com saldo ≤ 0
  (fail-open se sem carteira); a voz encerra graciosamente antes de estourar o saldo.
- **Stripe:** assinatura, top-up (só para assinante ativo), Customer Portal,
  reconciliação, Pix habilitável.
- **Transparência na UI:** tela de billing self-service mostra saldo em BRL, split
  franquia vs. comprado com data de expiração, avisos de saldo baixo, e **tabela de
  consumo por débito** (tipo, modelo real, tokens in/out + cache, créditos).
- **Benefício:** preço previsível em reais, sem surpresa na fatura, com o custo de
  cada conversa à vista.

---

## 5. Confiança: segurança, privacidade e operação — `PRONTO`

- **Multi-tenant isolado:** guards cross-tenant, testes de negação como gate de
  release (`agent-runtime` NFR-S2). Um cliente nunca acessa dado de outro.
- **LGPD:** consentimento de voz (falado + modal), **remoção de conta self-service**
  (offboard no fim do ciclo + erasure de checkpoints/memória/skills), redação de PII em
  logs (amostragem 1%).
- **Segredos:** cofre dedicado, write-only, nunca logado; tokens OAuth de MCP
  criptografados (AES-256-GCM).
- **Observabilidade:** OpenTelemetry, métricas Prometheus, audit log imutável de
  handoff e de uso.
- **Confiabilidade:** contratos idempotentes com retry/backoff entre serviços,
  cancelamento cooperativo, disconnect que preserva o checkpoint.

---

## 6. Mapa rápido: capacidade → onde vive

| Capacidade | runtime | gateway | handoff | base-tools | secrets | billing | web |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Chat + reasoning | ● | | | | | | ● |
| Voz / telefonia / SIP | ○(flag) | ● | ○ | | | ○ | ● |
| WhatsApp (QR/Cloud) | | ● | ○ | | | ○ | ● |
| Telegram | | ● | | | | | ● |
| Handoff humano | ○ | ● | ● | ●(tool) | | | ● |
| HITL (aprovação) | ● | | | | | | ● |
| Roteamento de modelos | ● | | | | | | ● |
| BYOK | ● | | | | ● | ○ | ● |
| Skills | ● | | | | | | ● |
| Especialistas | ● | | | ○(tools) | | | ● |
| Sub-agentes | ● | | | | | | ● |
| Custom MCPs (+OAuth) | ● | | | ○(tools) | ○ | | ● |
| Ferramentas nativas | | | | ● | | | ● |
| Outbound (agenda/WA/voz) | | ● | | ● | | ● | ● |
| Anexos / visão | ● | | | | | | ● |
| Créditos / plano / cost cap | ○ | ○ | | | | ● | ● |

`●` implementa o núcleo · `○` participa/depende.

---

## 7. Pendências a validar antes de virar copy do site

1. **Preço do plano (⚠️):** backend **R$25/mês**; UI ainda mostra **"R$ 50/mês"**.
   Alinhar backend + UI + site num número só.
2. **Sabiá / Maritaca (⚠️):** o site atual destaca o modelo brasileiro **Sabiá**, mas
   **não encontrei Sabiá/Maritaca no catálogo de modelos** dos perfis (que usam
   OpenAI/Gemini/Mistral/DeepSeek/Bedrock). O catálogo LiteLLM é aberto (dá para
   adicionar), mas **hoje não está configurado** — confirmar antes de manter esse
   destaque.
3. **"Plan mode" (⚠️):** não existe como recurso nomeado — reposicionar ou remover
   (§3.21).
4. **Handoff — não prometer:** notificação ativa ao atendente, SLA, roteamento por
   skill e presença de atendentes **não existem** (modelo é polling).
5. **Multi-agente:** vender como **sub-agentes** (profundidade 1); A2A entre instâncias
   é roadmap.
6. **BYOK / agent-secrets:** cofre é **PoC** (JSON local, sem cripto at-rest). Namespace
   `http` do `http_request` ainda não modelado no cofre.
7. **Preço de LLM não seedado:** garantir que a margem esteja configurada antes de
   qualquer promessa de "custo por conversa".

---

## 8. Recomendação de estrutura para o site

**Reframe da home (o Agente, não a plataforma):**

- **Hero:** "O Agente de IA que trabalha pelo seu negócio — chat, voz e WhatsApp."
  CTA: testar grátis 14 dias (sem cartão) / assinar por R$25.
- **Prova rápida (strip):** atende por **chat, voz e WhatsApp**, escolhe o modelo mais
  barato que resolve, e passa para uma pessoa quando precisa.

**Blocos de capacidade na home (os 6 mais fortes e verdadeiros):**

1. **Atende em todo canal** — chat, voz (número de telefone real) e WhatsApp (QR ou
   Cloud API), sempre a mesma conversa.
2. **Escolhe o modelo certo, gasta pouco** — roteamento automático custo × inteligência
   + BYOK.
3. **Uma equipe de especialistas** — agente principal + sub-agentes + skills do seu
   negócio.
4. **Age, não só conversa** — integrações MCP (com OAuth), `http_request`, agenda e
   calculadora financeira.
5. **Passa para um humano quando precisa** — handoff em voz e texto, com "assumir
   agora" e monitoramento ao vivo.
6. **Você no controle do gasto** — teto por conversa, créditos transparentes, sem
   surpresa na fatura.

**Páginas de detalhe (uma por tema, para SEO e profundidade):**

- `/voz` — voz + telefonia + outbound de cobrança.
- `/whatsapp` — QR vs Cloud API + disparos/broadcast.
- `/handoff` — mesa de atendimento, "assumir agora", monitoramento.
- `/modelos` — roteamento custo × inteligência, BYOK, reasoning.
- `/integracoes` — MCP, OAuth, ferramentas nativas, `http_request`.
- `/especialistas` — especialistas, sub-agentes, skills, no-code com o `aura`.
- `/preco` — plano, créditos, trial, cost cap.

**Diferenciais para enfatizar (verdadeiros e raros no segmento):** roteamento
automático de custo, BYOK multi-provider, MCP com OAuth 2.1 real, handoff de **voz**
ao vivo, e o onboarding no-code conversando com o `aura`.
