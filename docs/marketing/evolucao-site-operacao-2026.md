# Posicionamento do site: operações com controle

## Diagnóstico

O site original apresentava a Lab019 como uma solução barata de atendimento para o
pequeno negócio. A plataforma agora também executa tarefas agendadas, inicia
contatos, usa sistemas conectados e registra resultados. A mensagem de entrada
precisa falar com equipes de operações, tecnologia e risco que avaliam uma
plataforma de IA para processos reais.

O público prioritário é **enterprise amplo**, sem nomear setores no hero. A
entrada direta de 14 dias e o plano de R$25 continuam visíveis para quem quer
testar tecnicamente a plataforma. O preço deixa de ser a primeira razão de compra.

## Direção de comunicação

- **Promessa:** “Agentes de IA para operações que exigem controle”. Atendimento e
  automação aparecem juntos, com escopo de ação e acompanhamento.
- **Caso concreto:** cobrança é o primeiro fluxo. WhatsApp oficial é o canal
  principal; ligação **telefônica** é uma opção selecionada pela equipe. A voz
  flui com baixa latência e permite interrupções. Não há troca automática de
  canal nem ligação pelo WhatsApp nesta versão.
- **Provas atuais:** ferramentas por especialista, credenciais fora da
  conversa, aprovação humana configurável, histórico, limite de custo, API,
  vários modelos e tarefas em sistemas. Cada alegação pública deve ser
  sustentada por documentação e teste do produto.
- **Tom:** objetivo, específico e verificável. Evitar promessas vagas de
  “enterprise grade”, métricas sem medição, clientes não autorizados como prova
  e conformidade regulatória não atestada.

## Referência competitiva

A [Coru](https://coru.com/pt/home-pt/) fala diretamente com compradores de
operações reguladas, com páginas para casos, plataforma e governança. Isso
confirma a necessidade de explicar controles, arquitetura e operação. A Lab019
não deve reproduzir alegações da Coru sobre clientes em produção, deploy privado,
guardrails ou métricas que ainda não possa comprovar. Sua mensagem própria é a
combinação de automação além do atendimento, escolha de modelos, acesso por web
ou API e teste aberto, com transparência sobre a maturidade atual.

## Segurança: fatos, limites e avaliação

- Explicar os controles **disponíveis hoje** sem afirmar que a plataforma
  atende todos os requisitos de uma empresa regulada.
- Informar claramente que a Lab019 **ainda não possui certificações
  independentes de segurança** para apresentar.
- A opção de processamento de **modelo** no Brasil não prova residência
  integral de dados. O fluxo de canais, provedores, integrações e armazenamento
  precisa de análise caso a caso.
- Requisitos técnicos, jurídicos e contratuais são discutidos antes de uma
  implantação com dados ou processos sujeitos a regras específicas.
- Não sugerir que instruções em prompt substituem controles técnicos ou
  aprovação humana. O [NIST AI RMF](https://airc.nist.gov/airmf-resources/airmf/)
  é referência externa de gestão de riscos, não certificação ou alegação de
  conformidade da Lab019.

## Jornada do site

1. Home: promessa para empresas, um fluxo concreto e seção de governança.
2. `/automacoes/`: lista, canal, prévia, custo, execução e status por contato.
3. `/seguranca/`: controles atuais, limites e estágio das certificações.
4. `/preco/`: plano de entrada para teste, com caminho para discutir implantação.

## Limites do caso de cobrança

- Primeiro contato no WhatsApp fora da janela de 24 horas exige template
  aprovado pela Meta. Jornada pode acompanhar quem não respondeu.
- Ligação ativa usa linha telefônica; pedidos de saída por voz exigem
  atualização manual da lista de não perturbe.
- Status de entrega ou resposta não prova pagamento. Confirmar quitação
  depende de dados conectados a uma fonte confiável.
- Disparos são reais e geram consumo. Há estimativa antes do envio e custo
  realizado depois.

Referências internas: `agent-docs/docs/conceitos/seguranca.md`,
`agent-docs/docs/guias/outbound.md`, `jornadas.md`, `tarefas-agendadas.md` e
`sistemas-web.md`. O plano de segurança em `agent-runtime/docs/security/`
é um registro de evolução e lacunas, não comprovação de conformidade.
