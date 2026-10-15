# Evolução do site: atendimento e operação

## Diagnóstico

O site nasceu com o atendimento como principal demonstração de valor. A plataforma
passou a executar tarefas únicas e recorrentes, iniciar contatos por WhatsApp e
telefone, acompanhar jornadas e usar sistemas conectados. A home precisava mostrar
esse trabalho além da conversa, sem perder a entrada simples para o pequeno negócio.

## Direção escolhida

- **Home (direção A):** promessa equilibrada, “Atende seus clientes. Cuida das rotinas
  do negócio.” Os três verbos **Atende, Executa, Acompanha** explicam o ciclo.
- **Automações:** página própria, com cobrança como primeiro exemplo concreto e
  relatórios, retornos e tarefas em sistemas como extensões naturais.
- **Cobrança:** WhatsApp oficial como canal principal; ligação **telefônica** como
  opção selecionada pela empresa. A voz de baixa latência permite uma conversa que
  flui e aceita interrupções. Não há troca automática de canal nem ligação pelo
  WhatsApp nesta versão.
- **Linguagem:** contato cordial e acompanhamento. “Cobrança” significa lembrar
  clientes de pagamentos do negócio, não a cobrança da assinatura Lab019.

## Jornada mostrada no site

1. Revisar contatos, dados da cobrança e lista de não perturbe.
2. Escolher template de WhatsApp ou roteiro de ligação, conferir a prévia e o custo,
   e agendar o disparo.
3. Deixar o Agente conversar com quem responder ou atender; encaminhar casos que
   pedem uma pessoa.
4. Consultar status e consumo por contato. A confirmação de pagamento depende de
   uma fonte de dados conectada.

## Limites que a comunicação deve preservar

- Fora da janela de 24 horas, o primeiro contato por WhatsApp oficial requer
  template aprovado pela Meta; jornadas usam templates e podem acompanhar quem
  não respondeu.
- Ligação ativa usa linha telefônica. A janela de contato vale quando configurada;
  pedidos de saída feitos por voz exigem atualização manual da lista de não perturbe.
- Status de entrega ou resposta não prova pagamento. Só comunicar quitação quando
  houver consulta a uma fonte confiável do negócio.
- Disparos são reais e têm consumo. A tela mostra estimativa antes do envio e custo
  realizado depois.

## Implementação desta etapa

Home e página `/automacoes/`, navegação cruzada, preço, metadados e sitemap. O
site continua estático em GitHub Pages. Antes de publicar, revisar o texto final,
especialmente o exemplo de cobrança, e verificar o fluxo de cadastro no app.

Referências de produto: `agent-docs/docs/guias/outbound.md`, `jornadas.md`,
`tarefas-agendadas.md` e `sistemas-web.md` no repositório de documentação.
