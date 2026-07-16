# LAB019 — Plano de Marketing de Lançamento do MVP

> Plano passo a passo para tirar o LAB019 do modo "Em breve" e colocá-lo no mercado.
> Premissas: orçamento enxuto, equipe mínima (fundador + IA), venda 100% self-service,
> público = pequeno empreendedor brasileiro. Companion deste plano:
> [`brief-produto-lab019.md`](./brief-produto-lab019.md).

---

## Estratégia em uma linha

**Lançar pequeno e perto de casa:** validar com 10–20 clientes reais (Campinas e rede de
contatos), transformar esses clientes em prova social, e só então abrir o funil público —
com a mensagem "IA de verdade, a preço de gente" e o CTA "Sua IA começa hoje, por R$25".

## Metas do lançamento (sugestão — ajustar)

| Métrica | Meta 90 dias |
|---|---|
| Contas trial criadas | 300 |
| Ativação (agente publicado + 1ª conversa real) | 40% dos trials |
| Conversão trial → assinante R$25 | 15% dos ativados |
| Assinantes pagantes | ~20–30 |
| Depoimentos/casos de uso publicáveis | 5 |

O funil a instrumentar desde o dia 1: **visita → trial (sem cartão) → ativação → assinatura → recarga/retenção**.

---

## Fase 0 — Preparação (semanas 1–2) · "arrumar a casa"

Pré-requisitos técnicos e de mensagem antes de qualquer divulgação.

1. **Resolver o domínio canônico** — o site aponta para `app.lab019.com`, a produção usa
   `app.lab019.ai`. Escolher um, redirecionar o outro. (Bloqueador de lançamento.)
2. **Revisar a landing completa** (`index-full.html`) contra o estado real do produto:
   - WhatsApp: rebaixar para "em breve / sob solicitação" na copy.
   - Transbordo humano: descrever como está (assumir/devolver), sem prometer call center.
3. **Instrumentar o funil:** analytics no site e no app (ex.: Plausible/GA4 + eventos de
   signup, ativação e assinatura), UTMs padronizadas em todos os links de campanha.
4. **Página "Em breve" com captura:** adicionar campo de e-mail ("Avise-me no lançamento")
   — começa a construir a lista antes do dia L.
5. **Preparar o "kit de lançamento":** 1 vídeo-demo de 60–90s (chat + voz com sotaque
   brasileiro é o momento "uau"), 5–10 capturas de tela, 1 one-pager PDF, textos de
   anúncio nos 3 tamanhos (título, parágrafo, post longo).
6. **Perfis e presença mínima:** Instagram e LinkedIn da LAB019, Google Business Profile
   (Campinas), página de contato/WhatsApp comercial para dúvidas de venda.
7. **Definir política de suporte do lançamento:** quem responde, em que prazo, por qual
   canal (e-mail + WhatsApp comercial).

**Critério para avançar:** funil instrumentado, landing corrigida, kit pronto.

## Fase 1 — Beta fechado / soft launch (semanas 3–6) · "10 a 20 clientes de verdade"

Objetivo: prova social e aprendizado, não volume.

1. **Recrutar 10–20 negócios** da rede de contatos e de Campinas (delivery, salão,
   clínica, escritório de serviços). Oferta clara: *setup acompanhado de graça + 3 meses
   por R$25 congelado* em troca de feedback e depoimento.
2. **Onboarding assistido:** acompanhar cada um colocando o agente no ar (a Aura faz o
   trabalho; você observa onde travam — isso vira backlog de produto e de conteúdo).
3. **Medir e documentar resultados por cliente:** nº de atendimentos automatizados,
   tempo economizado, pedidos captados fora do horário. Esses números são a matéria-prima
   do marketing público.
4. **Produzir 3–5 mini-casos** (1 parágrafo + print/foto + número concreto) e 2–3
   depoimentos em vídeo curto (celular, autêntico).
5. **Iterar preço/copy** com o que aprender (ex.: objeções recorrentes viram FAQ).

**Critério para avançar:** ≥5 clientes usando de verdade + ≥3 casos documentados.

## Fase 2 — Lançamento público (semanas 7–8) · "dia L"

1. **Publicar a landing completa** (restaurar `index-full.html` → `index.html` conforme o
   runbook do repositório) e disparar o e-mail para a lista de espera.
2. **Sequência de anúncio (1 semana):**
   - **Dia L:** post de lançamento no LinkedIn (pessoal do fundador + página) e Instagram,
     com o vídeo-demo; e-mail à lista; mensagem à rede pessoal (WhatsApp) com pedido
     explícito de compartilhamento.
   - **Dia L+1..L+5:** 1 conteúdo/dia — um mini-caso por dia, cada um apontando para o
     trial sem cartão.
   - **Imprensa/ecosistema regional:** pauta para veículos de Campinas e ecossistema de
     startups (a âncora local "IA feita em Campinas para o pequeno negócio" é pauta boa).
   - **Comunidades:** grupos e fóruns de empreendedorismo/PME onde autopromoção é aceita
     (apresentar como fundador, com transparência).
3. **Aproveitar o gancho nacional:** conteúdo específico "IA brasileira" (Sabiá no
   catálogo, cobrança em reais, Pix, LGPD) — diferencial claro contra ferramentas gringas.
4. **Ativar o Google Business Profile** e páginas locais ("agente de IA para comércio em
   Campinas") para busca local.

## Fase 3 — Motor de crescimento contínuo (semana 9 em diante)

1. **Conteúdo/SEO em pt-BR (canal principal de longo prazo).** 2 artigos/semana mirando
   buscas do público-alvo, ex.: "atendente virtual para delivery", "como automatizar
   atendimento do WhatsApp/Instagram", "quanto custa um chatbot com IA", "IA que atende
   por telefone". Cada artigo termina no CTA do trial.
2. **Prova social permanente:** página de casos no site; pedir depoimento a todo cliente
   que renovar o 2º mês.
3. **Indicação:** programa simples "indique um empreendedor, ambos ganham créditos"
   (top-up de créditos como recompensa — barato e alinhado ao produto).
4. **Parcerias-alavanca:** contadores, agências que atendem PMEs e consultores de
   marketing local — eles têm carteira de clientes exatamente no ICP; oferecer comissão
   recorrente ou créditos.
5. **Mídia paga só depois do funil provar conversão orgânica.** Começar pequeno
   (R$20–50/dia) em Meta Ads segmentando donos de pequenos negócios, com o vídeo-demo;
   Google Ads em termos de fundo de funil ("chatbot para delivery preço").
6. **Ritmo de revisão:** ritual quinzenal olhando o funil (visita→trial→ativação→
   assinatura→retenção), decidindo 1 aposta de aquisição e 1 correção de ativação por
   ciclo.

## Mensagens-chave (usar em tudo)

- **Promessa:** "Coloque uma equipe de agentes de IA para trabalhar no seu negócio."
- **Preço:** "Sua IA começa hoje, por R$25" / "Inteligência artificial de verdade, a
  preço de gente."
- **Simplicidade:** "Não é técnico? Use tudo pelo navegador." / "Do zero ao atendimento
  em minutos."
- **Brasil:** voz que entende português de verdade, modelo brasileiro Sabiá, reais e Pix,
  feito em Campinas.
- **Controle:** sem fidelidade, teto de gasto, custo em reais, trial sem cartão.

## Riscos e salvaguardas

| Risco | Salvaguarda |
|---|---|
| Prometer canal/recurso ainda opt-in (WhatsApp, voz por telefone) | Copy revisada na Fase 0; "em breve/sob solicitação" |
| Lançar sem prova social | Fase 1 obrigatória antes do dia L |
| Tráfego sem ativação (gente entra e não põe agente no ar) | Onboarding assistido no beta vira roteiro/vídeo de onboarding self-service |
| Suporte engolir o fundador no dia L | Janela de anúncio escalonada (1 semana), FAQ robusto, a própria Aura como 1º nível de suporte |
| Custo de IA do trial abusado | Já mitigado no produto (1 trial por e-mail verificado, expira em 14 dias) |

## Checklist executivo (resumo)

- [ ] Fase 0: domínio canônico, landing corrigida, analytics/UTM, captura de e-mail, kit de lançamento, perfis sociais
- [ ] Fase 1: 10–20 betas, onboarding assistido, 3–5 casos documentados, 2–3 vídeos
- [ ] Fase 2: publicar landing, e-mail à lista, semana de anúncios, imprensa regional, comunidades
- [ ] Fase 3: 2 artigos SEO/semana, programa de indicação, parcerias (contadores/agências), mídia paga controlada
- [ ] Ritual quinzenal de funil
