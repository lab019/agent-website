/*
 * Chat ao vivo do hero + widget flutuante — lab019.ai
 * -----------------------------------------------------------------------------
 * O card de chat que ilustra o hero passa a ser um chat DE VERDADE contra a API
 * pública da LAB019 (o mesmo canal de texto que o agent-gateway expõe: token
 * anônimo no /gateway + streaming SSE direto do /runtime). Uma única conversa é
 * renderizada em duas superfícies:
 *
 *   1. o card no hero (topo da página);
 *   2. um painel flutuante no canto superior direito, aberto por uma bolinha que
 *      só aparece quando o hero sai da tela (logo abaixo do botão "Testar grátis").
 *
 * Ao rolar de volta ao topo, o hero reaparece, a bolinha some e a conversa segue
 * no mesmo lugar — é sempre a MESMA conversa (mesmo conversationId, mesmo
 * histórico), só o local de exibição muda.
 *
 * Contrato (idêntico ao widget embutível do agent-web, src/widget/client.ts):
 *   POST {API_BASE}/gateway/v1/widget/text-token {agent_id}
 *        → { token, expires_in }                    (credencial anônima curta)
 *   POST {API_BASE}/runtime/v1/conversations/{id}/messages
 *        Authorization: Bearer <token>
 *        { messageId, content, agentId }             → SSE de message_delta
 *
 * Configuração: o agent_id e a base da API NÃO são hardcodados. Os tokens
 * __PUBLIC_AGENT_ID__ / __PUBLIC_API_BASE__ são substituídos no deploy (o
 * workflow do GitHub Pages troca-os pelos valores das Variables PUBLIC_AGENT_ID
 * / PUBLIC_API_BASE; ver .github/workflows/deploy.yml). Sem um agent_id válido
 * (preview local, ou Variable ausente), o recurso fica INERTE: o hero mantém a
 * ilustração estática e a bolinha não aparece — deploy seguro, igual ao GTM.
 */
;(function () {
  'use strict'

  // === Configuração (substituída no deploy; literal em preview local) ===
  var AGENT_ID = '__PUBLIC_AGENT_ID__'
  var API_BASE = '__PUBLIC_API_BASE__'

  // Aparência/cópia do agente-demo da LAB019 (o agente que a landing conversa).
  var TITLE = 'Agente LAB019'
  var GREETING =
    'Oi! 👋 Sou o agente virtual da LAB019. Pergunte o que quiser — preços, ' +
    'canais (chat, voz, WhatsApp), como configurar. Estou aqui pra mostrar na ' +
    'prática como funciona.'

  // Sem agente público configurado → recurso inerte (mantém a ilustração do
  // hero). O token não substituído começa com "__", então não passa daqui.
  if (!AGENT_ID || AGENT_ID.slice(0, 2) === '__') return
  // A base da API tem default de produção mesmo sem a Variable — só o agent_id é
  // realmente obrigatório (não dá para adivinhar qual agente público usar).
  if (!API_BASE || API_BASE.slice(0, 2) === '__') API_BASE = 'https://api.lab019.ai'
  API_BASE = API_BASE.replace(/\/+$/, '')
  var GATEWAY_BASE = API_BASE + '/gateway'
  var RUNTIME_BASE = API_BASE + '/runtime'

  // Renova o token um pouco antes de expirar, para não tomar 401 no meio do turno.
  var TOKEN_REFRESH_SKEW_MS = 30000

  function randomId() {
    var c = window.crypto
    if (c && typeof c.randomUUID === 'function') return c.randomUUID()
    // Fallback para engines antigas: não é criptográfico, mas é só um id opaco.
    return 'w-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  }

  // ------------------------------------------------------------------ backend

  // 403 estável "agente não é público" (LIC-239/240). Tolera as duas formas de
  // envelope: gateway → { detail: { errorCode } }, runtime → { errorCode }.
  function isAgentNotPublic(body) {
    try {
      var parsed = JSON.parse(body)
      if (parsed && parsed.errorCode === 'agent_not_public') return true
      var d = parsed && parsed.detail
      if (d && typeof d === 'object' && d.errorCode === 'agent_not_public') return true
    } catch (e) {
      /* corpo não-JSON não é a recusa estruturada */
    }
    return false
  }

  function AgentNotPublicError() {
    this.name = 'AgentNotPublicError'
    this.message = 'agent is not available to anonymous callers'
  }
  AgentNotPublicError.prototype = Object.create(Error.prototype)

  // Cache do token anônimo (uma conversa por página → um cache).
  var tokenCache = null // { token, expiresAt }

  function tokenFresh(now) {
    return tokenCache !== null && now < tokenCache.expiresAt - TOKEN_REFRESH_SKEW_MS
  }

  // POST {gateway}/v1/widget/text-token → credencial anônima curta.
  function fetchToken(signal) {
    return fetch(GATEWAY_BASE + '/v1/widget/text-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ agent_id: AGENT_ID }),
      signal: signal,
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(
          function (t) {
            if (res.status === 403 && isAgentNotPublic(t)) throw new AgentNotPublicError()
            throw new Error('HTTP ' + res.status)
          },
          function () {
            throw new Error('HTTP ' + res.status)
          }
        )
      }
      return res.json().then(function (body) {
        var token = body && typeof body.token === 'string' ? body.token : ''
        if (!token) throw new Error('token ausente na resposta')
        var ttlMs = (body && typeof body.expires_in === 'number' ? body.expires_in : 600) * 1000
        tokenCache = { token: token, expiresAt: Date.now() + ttlMs }
        return token
      })
    })
  }

  function ensureToken(signal) {
    if (tokenFresh(Date.now())) return Promise.resolve(tokenCache.token)
    return fetchToken(signal)
  }

  /*
   * Faz o streaming de um turno direto do endpoint SSE do runtime. Parseia os
   * frames `data:` e encaminha cada message_delta do assistente. Devolve um
   * AbortController para o chamador cancelar. `handleFrame` devolve true num
   * frame TERMINAL (um `error` in-band): aí paramos de ler e NÃO chamamos onDone
   * também (senão o fechamento do stream sobrescreveria o erro já mostrado) —
   * mesma lógica do runtimeClient/agent-web.
   */
  function streamMessage(params, cb) {
    var controller = new AbortController()
    fetch(
      RUNTIME_BASE + '/v1/conversations/' + encodeURIComponent(params.conversationId) + '/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: 'Bearer ' + params.token,
        },
        body: JSON.stringify({
          messageId: params.messageId,
          content: params.content,
          agentId: AGENT_ID,
        }),
        signal: controller.signal,
      }
    ).then(
      function (response) {
        if (!response.ok) {
          return response.text().then(
            function (t) {
              if (response.status === 403 && isAgentNotPublic(t)) cb.onError(new AgentNotPublicError())
              else cb.onError(new Error('HTTP ' + response.status))
            },
            function () {
              cb.onError(new Error('HTTP ' + response.status))
            }
          )
        }
        var reader = response.body && response.body.getReader ? response.body.getReader() : null
        if (!reader) {
          cb.onError(new Error('corpo da resposta não é legível'))
          return
        }
        var decoder = new TextDecoder()
        var buffer = ''

        function handleFrame(frame) {
          var jsonStr = frame
            .split('\n')
            .filter(function (line) {
              return line.indexOf('data:') === 0
            })
            .map(function (line) {
              return line.slice('data:'.length).replace(/^ /, '')
            })
            .join('\n')
          if (!jsonStr) return false
          var event
          try {
            event = JSON.parse(jsonStr)
          } catch (e) {
            return false // frame malformado → ignora
          }
          if (event.type === 'message_delta' && typeof event.delta === 'string') {
            cb.onDelta(event.delta)
          } else if (event.type === 'error') {
            var msg = typeof event.message === 'string' ? event.message : 'erro no servidor'
            cb.onError(new Error(msg))
            return true // terminal: para de ler, não dispara onDone
          }
          // Demais eventos (reasoning, tool_*, metadata, done) são ignorados — o
          // turno resolve quando o stream fecha.
          return false
        }

        var terminated = false
        function pump() {
          return reader.read().then(function (result) {
            if (result.done || terminated) return
            buffer += decoder.decode(result.value, { stream: true })
            buffer = buffer.replace(/\r\n/g, '\n')
            var frames = buffer.split('\n\n')
            buffer = frames.pop() || ''
            for (var i = 0; i < frames.length; i++) {
              if (frames[i].trim() && handleFrame(frames[i])) {
                terminated = true
                break
              }
            }
            if (terminated) return
            return pump()
          })
        }

        return pump().then(
          function () {
            if (!terminated && buffer.trim() && handleFrame(buffer)) terminated = true
            try {
              reader.releaseLock()
            } catch (e) {
              /* já liberado */
            }
            // Um frame `error` terminal já reportou via onError — não sinaliza de novo.
            if (!terminated) cb.onDone()
          },
          function (err) {
            try {
              reader.releaseLock()
            } catch (e) {
              /* noop */
            }
            if (err && err.name === 'AbortError') return
            cb.onError(err instanceof Error ? err : new Error(String(err)))
          }
        )
      },
      function (err) {
        if (err && err.name === 'AbortError') return
        cb.onError(err instanceof Error ? err : new Error(String(err)))
      }
    )
    return controller
  }

  // ------------------------------------------------------- estado da conversa

  // Fonte da verdade: uma lista de mensagens compartilhada pelas duas superfícies.
  var conversationId = randomId()
  var messages = [] // { role: 'user'|'agent'|'error', text, pending? }
  var surfaces = [] // { body: HTMLElement } — hero e/ou painel flutuante
  var formControls = [] // { input, send } — para habilitar/desabilitar em bloco
  var sending = false
  var streamCtl = null

  messages.push({ role: 'agent', text: GREETING })

  function makeBubble() {
    var el = document.createElement('div')
    el.className = 'msg'
    return el
  }

  function applyBubble(el, msg) {
    var cls = 'msg'
    if (msg.pending) cls += ' bot typing'
    else if (msg.role === 'user') cls += ' user'
    else if (msg.role === 'error') cls += ' error'
    else cls += ' bot'
    el.className = cls
    el.textContent = msg.pending ? '…' : msg.text
  }

  // Reconciliação incremental: as mensagens só CRESCEM (append) e apenas a última
  // muda durante o streaming, então basta criar as que faltam e reaplicar todas
  // (a lista é curta). Cada superfície rola para o fim.
  function syncSurface(s) {
    var body = s.body
    while (body.children.length < messages.length) {
      body.appendChild(makeBubble())
    }
    for (var i = 0; i < messages.length; i++) {
      applyBubble(body.children[i], messages[i])
    }
    body.scrollTop = body.scrollHeight
  }

  function render() {
    for (var i = 0; i < surfaces.length; i++) syncSurface(surfaces[i])
  }

  function setFormsEnabled(enabled) {
    for (var i = 0; i < formControls.length; i++) {
      formControls[i].input.disabled = !enabled
      formControls[i].send.disabled = !enabled
    }
  }

  function finishTurn() {
    sending = false
    streamCtl = null
    setFormsEnabled(true)
  }

  function renderError(agent, err) {
    var friendly =
      err && err.name === 'AgentNotPublicError'
        ? 'Este atendimento não está disponível no momento.'
        : 'Não consegui me conectar. Tente novamente em instantes.'
    if (agent.pending) {
      // Ainda sem texto: transforma a própria bolha em erro.
      agent.pending = false
      agent.role = 'error'
      agent.text = friendly
    } else {
      // Já havia texto parcial: acrescenta uma bolha de erro separada.
      messages.push({ role: 'error', text: friendly })
    }
    render()
  }

  function send(text) {
    text = (text || '').trim()
    if (!text || sending) return
    sending = true
    setFormsEnabled(false)

    messages.push({ role: 'user', text: text })
    var agent = { role: 'agent', text: '', pending: true }
    messages.push(agent)
    render()

    var tokenCtl = new AbortController()
    ensureToken(tokenCtl.signal).then(
      function (token) {
        streamCtl = streamMessage(
          {
            conversationId: conversationId,
            messageId: randomId(),
            content: text,
            token: token,
          },
          {
            onDelta: function (delta) {
              agent.pending = false
              agent.text += delta
              render()
            },
            onError: function (err) {
              renderError(agent, err)
              finishTurn()
            },
            onDone: function () {
              if (agent.pending) {
                // Stream fechou sem texto — fallback suave em vez de bolha vazia.
                agent.pending = false
                agent.text = 'Não recebi uma resposta. Tente de novo.'
              }
              render()
              finishTurn()
            },
          }
        )
      },
      function (err) {
        renderError(agent, err instanceof Error ? err : new Error(String(err)))
        finishTurn()
      }
    )
  }

  // -------------------------------------------------------------- superfícies

  // Constrói o formulário (textarea + enviar) e o liga ao controlador. Enter
  // envia; Shift+Enter quebra linha. Devolve o <form> pronto para inserir.
  function buildForm(placeholder) {
    var form = document.createElement('form')
    form.className = 'chat-live-foot'
    form.setAttribute('novalidate', '')

    var input = document.createElement('textarea')
    input.className = 'chat-live-input'
    input.setAttribute('rows', '1')
    input.setAttribute('placeholder', placeholder)
    input.setAttribute('aria-label', 'Escreva uma mensagem')

    var sendBtn = document.createElement('button')
    sendBtn.className = 'chat-live-send'
    sendBtn.type = 'submit'
    sendBtn.setAttribute('aria-label', 'Enviar mensagem')
    sendBtn.innerHTML = '<span aria-hidden="true">➤</span>'

    form.appendChild(input)
    form.appendChild(sendBtn)

    function submit() {
      var v = input.value
      input.value = ''
      input.style.height = ''
      send(v)
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      submit()
    })
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        submit()
      }
    })
    // Auto-crescimento simples do textarea (limitado por CSS max-height).
    input.addEventListener('input', function () {
      input.style.height = 'auto'
      input.style.height = input.scrollHeight + 'px'
    })

    formControls.push({ input: input, send: sendBtn })
    return form
  }

  // Transforma o card estático do hero em chat ao vivo: corpo rolável + form.
  function mountHero() {
    var card = document.getElementById('hero-chat')
    if (!card) return null
    card.removeAttribute('role')
    card.removeAttribute('aria-label')
    card.classList.add('is-live')

    var body = card.querySelector('.chat-body')
    var foot = card.querySelector('.chat-foot')
    if (!body || !foot) return null
    body.textContent = '' // remove as bolhas roteirizadas de ilustração
    surfaces.push({ body: body })

    var form = buildForm('Escreva uma mensagem…')
    foot.parentNode.replaceChild(form, foot)
    return card
  }

  // Bolinha flutuante (canto superior direito, abaixo do "Testar grátis") + painel.
  function mountFloating() {
    var fab = document.createElement('button')
    fab.type = 'button'
    fab.className = 'lab019-chat-fab'
    fab.setAttribute('aria-label', 'Abrir conversa com o Agente')
    fab.setAttribute('aria-expanded', 'false')
    fab.innerHTML = '<span aria-hidden="true">💬</span>'

    var panel = document.createElement('div')
    panel.className = 'lab019-chat-panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', TITLE)
    panel.hidden = true

    var head = document.createElement('div')
    head.className = 'lab019-chat-phead'
    head.innerHTML =
      '<span class="lab019-chat-pdot" aria-hidden="true">L</span>' +
      '<strong>' +
      TITLE +
      '</strong>' +
      '<span class="lab019-chat-pstatus"><span class="pulse"></span> online</span>' +
      '<button type="button" class="lab019-chat-pclose" aria-label="Fechar conversa">×</button>'

    var body = document.createElement('div')
    body.className = 'chat-body lab019-chat-pbody'

    panel.appendChild(head)
    panel.appendChild(body)
    panel.appendChild(buildForm('Escreva uma mensagem…'))

    document.body.appendChild(panel)
    document.body.appendChild(fab)

    surfaces.push({ body: body })

    function openPanel(open) {
      if (open) {
        panel.hidden = false
        // força reflow para a transição de entrada pegar
        void panel.offsetWidth
        panel.classList.add('open')
        fab.setAttribute('aria-expanded', 'true')
        var input = panel.querySelector('.chat-live-input')
        if (input && !input.disabled) input.focus()
        render() // garante rolagem até o fim ao abrir
      } else {
        panel.classList.remove('open')
        fab.setAttribute('aria-expanded', 'false')
        // esconde depois da transição para não ficar clicável invisível
        window.setTimeout(function () {
          if (!panel.classList.contains('open')) panel.hidden = true
        }, 200)
      }
    }

    fab.addEventListener('click', function () {
      openPanel(panel.hidden || !panel.classList.contains('open'))
    })
    head.querySelector('.lab019-chat-pclose').addEventListener('click', function () {
      openPanel(false)
    })

    return {
      fab: fab,
      panel: panel,
      close: function () {
        openPanel(false)
      },
    }
  }

  // --------------------------------------------------------------- visibilidade

  // A bolinha aparece quando o card do hero sai da tela e some quando ele volta.
  // É sempre a mesma conversa — só troca a superfície visível.
  function wireVisibility(heroCard, floating) {
    if (!heroCard || !floating) return
    if (!('IntersectionObserver' in window)) {
      // Sem observer: mantém a bolinha sempre disponível (degradação segura).
      floating.fab.classList.add('is-visible')
      return
    }
    var io = new IntersectionObserver(
      function (entries) {
        var e = entries[0]
        if (!e) return
        // "Visível" = uma fração relevante do card ainda na tela.
        var heroVisible = e.isIntersecting && e.intersectionRatio >= 0.35
        if (heroVisible) {
          floating.fab.classList.remove('is-visible')
          floating.close()
        } else {
          floating.fab.classList.add('is-visible')
        }
      },
      { threshold: [0, 0.35, 0.7] }
    )
    io.observe(heroCard)
  }

  // ---------------------------------------------------------------------- boot

  function boot() {
    var heroCard = mountHero()
    // Se o hero não existe nesta página (chat.js só entra na index), não monta nada.
    if (!heroCard) return
    var floating = mountFloating()
    render()
    wireVisibility(heroCard, floating)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
})()
