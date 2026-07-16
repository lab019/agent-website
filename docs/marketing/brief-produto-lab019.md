# LAB019 — Brief de Produto

> **Finalidade deste documento:** servir de contexto completo e autossuficiente sobre o
> produto para trabalhos de marketing, conteúdo, vendas e lançamento — inclusive para uso
> com assistentes de IA (ex.: Claude Cowork). Tudo aqui foi extraído dos repositórios do
> produto em julho/2026; onde algo ainda não está pronto, isso está dito explicitamente.

---

## 1. Identidade

- **Marca:** LAB019
- **Razão social:** INDRA CONSULTORIA EMPRESARIAL LTDA — CNPJ 04.022.591/0001-59
- **Sede:** Campinas, SP — Brasil 🇧🇷
- **Domínios:** `lab019.ai` e `lab019.com` (site institucional em GitHub Pages; app em
  `app.lab019.ai`; API em `api.lab019.ai`)
- **Contato público:** contato@lab019.ai
- **Tagline:** **"Inteligência artificial de verdade, a preço de gente."**
- **Posicionamento:** *a plataforma de agentes de IA para o pequeno empreendedor*
- **Tom de voz:** português do Brasil, linguagem de negócio (não técnica), calorosa e
  direta, com orgulho nacional ("Feito no Brasil", "Feito com 💚 em Campinas, SP") e
  exemplos do cotidiano do pequeno negócio (delivery de marmitas, comércio de bairro,
  profissionais liberais).

## 2. O que é o produto (em uma frase)

Uma plataforma onde o pequeno empreendedor coloca **uma equipe de agentes de IA para
trabalhar no negócio dele**: atende clientes por **chat e por voz**, usa os melhores
modelos de IA do mundo — **incluindo o brasileiro Sabiá** — e **cobra só pelo que usar**.

## 3. Para quem é

- **Público principal:** pequeno empreendedor brasileiro, do comércio de bairro ao
  escritório de serviços. **Não precisa saber programar** — tudo se faz pelo navegador,
  inclusive conversando com a própria IA (a assistente "Aura" configura agentes e
  ferramentas via chat).
- **Público secundário:** desenvolvedores — há API pública (streaming de texto via SSE e
  voz via WebRTC).
- **Verticais destacadas na comunicação:**
  1. **Comércio e delivery** — tira pedidos, responde cardápio/estoque, agenda entregas.
  2. **Serviços e profissionais liberais** — agenda, responde dúvidas frequentes, faz triagem.
  3. **Primeiro atendimento** — assistente de voz/chat no site que acolhe o cliente e
     encaminha para um humano quando necessário.
- **Modelo de venda:** 100% self-service (sem time de vendas). Signup sem cartão,
  provisionamento automático, "do zero ao atendimento em minutos".

## 4. Principais recursos (linguagem de cliente)

1. **Chat que pensa antes de responder** — respostas em tempo real (streaming), com o
   raciocínio do agente visível.
2. **Atendimento por voz** — fala e entende português do Brasil; o cliente pode
   interromper a IA no meio da fala (barge-in); a transcrição fica salva no histórico
   junto com as conversas de texto.
3. **Vários modelos de IA, escolha inteligente** — a plataforma roteia automaticamente
   entre modelos caros e baratos conforme a tarefa (perfis "econômico / padrão /
   inteligente"). Catálogo inclui Sabiá 4 (Maritaca, Brasil), GPT, Gemini, Amazon Nova,
   Mistral, DeepSeek e Anthropic.
4. **Equipe de agentes e ferramentas** — um agente principal coordena sub-agentes
   especialistas; ferramentas externas se conectam via padrão MCP; há ferramentas nativas
   (agendador de tarefas, calculadora científica/financeira, chamadas HTTP com controles
   de segurança).
5. **Traga sua própria chave (BYOK)** — quem já tem chave da OpenAI/Anthropic/Google pode
   usá-la e pagar os tokens direto ao provedor.
6. **Controle total do gasto** — teto de custo por conversa e custos exibidos em reais.
7. **Transbordo para humano** — o agente transfere a conversa para um atendente humano
   (caixa de entrada compartilhada: o atendente assume e depois devolve para a IA).

## 5. Canais de atendimento suportados

| Canal | Status |
|---|---|
| Chat no navegador (texto, streaming) | Pronto — canal principal |
| Voz no navegador (WebRTC/LiveKit) | Pronto — ativação opcional por cliente |
| Telefone (número/PSTN via SIP) | Pronto na infraestrutura — ativação gerenciada |
| Telegram (múltiplos bots por conta) | Pronto |
| WhatsApp (via Evolution API, pareamento por QR) | Disponível **opt-in** — ⚠️ não prometer como recurso universal na comunicação de lançamento |
| API para desenvolvedores | Pronta (texto SSE + voz WebRTC) |

## 6. Preço e modelo de cobrança

- **Um plano só, sem pegadinha:** **R$ 25/mês**, que devolve **R$ 25 em créditos de IA**
  — na prática, a plataforma "sai de graça"; paga-se apenas o consumo de IA.
- **Sem fidelidade** — cancela quando quiser; ao cancelar, vale até o fim do ciclo.
- **Trial sem cartão:** ao criar a conta, o cliente ganha **US$ 1 em créditos
  (~10 minutos de voz)**, válidos por 14 dias. Um trial por e-mail verificado.
- **Como o consumo é medido:** texto é cobrado por token (por mensagem); voz é cobrada
  por tempo (US$ 0,10/minuto, arredondado para minuto cheio).
- **Recarga avulsa (top-up):** via Stripe Checkout, apenas para assinantes ativos;
  créditos comprados **não expiram** (os da franquia mensal expiram).
- **Pagamento:** Stripe — **cartão e Pix**, cobrança em reais.
- **LGPD:** offboarding com apagamento de dados ao encerrar a conta.
- **Mensagem-síntese de preço:** *"Sua IA começa hoje, por R$25."*

## 7. Diferenciais competitivos (ângulos de comunicação)

- **Preço radicalmente simples e baixo** num mercado de ferramentas caras e planos
  confusos — "a preço de gente".
- **Voz em português de verdade** (STT/TTS pt-BR com interrupção natural) — a maioria dos
  concorrentes de chatbot para PME não tem voz em tempo real.
- **Modelo brasileiro Sabiá no catálogo** + dados e cobrança em reais + Pix — apelo "IA
  do Brasil para o Brasil".
- **Configuração conversacional** — o cliente monta o agente conversando com a Aura, sem
  formulários técnicos.
- **Transparência de custo** — custo por conversa em reais, teto de gasto, BYOK.
- **Sem time técnico e sem vendedor** — autosserviço de ponta a ponta.

## 8. Estado atual (julho/2026) — o que o marketing precisa saber

- **Pré-lançamento:** o site público hoje mostra uma página "Em breve"; a landing
  completa está pronta e guardada para ser restaurada no dia do lançamento.
- **Pendências conhecidas antes/durante o lançamento:**
  - Resolver a **inconsistência de domínio** (o site aponta para `app.lab019.com` /
    `api.lab019.com`; a infraestrutura de produção usa `app.lab019.ai` / `api.lab019.ai`).
  - **Transbordo humano** está no escopo mínimo (assumir/devolver); ainda sem filas
    múltiplas, SLA ou distribuição automática — não prometer "central de atendimento
    completa".
  - **Voz e WhatsApp** são módulos ativados sob demanda em produção — na comunicação,
    tratar voz como recurso destacado, e WhatsApp com cautela (beta/sob solicitação).
  - Não existem ainda planos adicionais (Pro/Enterprise) nem motion de vendas enterprise.
- **Sem métricas públicas de tração** — a narrativa de lançamento deve se apoiar em
  produto, preço e casos de uso, não em números de clientes.

## 9. Ativos existentes

- Landing page completa (pt-BR) com hero, features, preço, casos de uso, FAQ e CTA
  ("Começar por R$25") — pronta para publicar.
- Página "Em breve" atualmente no ar (pode capturar interesse pré-lançamento).
- API documentada na própria landing (exemplos de `curl`).
- Identidade: nome, tagline, tom de voz e âncora regional (Campinas, SP) definidos.

## 10. Glossário rápido

- **Agente / especialista:** a IA configurada para uma função (ex.: atendente da loja).
- **Aura:** especialista padrão que opera a plataforma para o cliente via conversa.
- **Créditos:** moeda interna de consumo de IA (franquia mensal + recargas).
- **BYOK:** *Bring Your Own Key* — usar a própria chave de provedor de IA.
- **MCP:** padrão aberto para conectar ferramentas externas ao agente.
- **Transbordo (handoff):** transferência da conversa da IA para um atendente humano.
