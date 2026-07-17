/*
 * Chat ao vivo do hero + widget flutuante — lab019.ai
 * -----------------------------------------------------------------------------
 * O card de chat que ilustra o hero é um chat DE VERDADE contra o canal público
 * de widget do agent-gateway. Uma única conversa é renderizada em duas
 * superfícies:
 *
 *   1. o card no hero (topo da página);
 *   2. um painel flutuante no canto superior direito, aberto por uma bolinha que
 *      só aparece quando o hero sai da tela (logo abaixo do botão "Testar grátis").
 *
 * Ao rolar de volta ao topo, o hero reaparece, a bolinha some e a conversa segue
 * no mesmo lugar — é sempre a MESMA conversa (mesma sessão/conversation), só o
 * local de exibição muda.
 *
 * Protocolo de sessão do gateway (idêntico ao widget embutível do agent-web,
 * src/widget/client.ts — o caminho antigo de text-token + SSE direto do runtime
 * foi removido). O tenant (org) e o agente são resolvidos server-side pela
 * WIDGET KEY (`wgt_…`), origin-gated no gateway — o browser nunca carrega
 * credencial de admin:
 *
 *   POST {GATEWAY}/v1/widget/sessions            { key }
 *        → { session_id, session_token(wst_), conversation_id, expires_in }
 *   POST {GATEWAY}/v1/widget/conversations/{sid}/messages   (Bearer wst_ + x-idempotency-key)
 *        { text }  → 202 { messageId }            (a resposta vem pelo SSE, não aqui)
 *   GET  {GATEWAY}/v1/widget/conversations/{sid}/events?st=wst_   (SSE persistente)
 *        eventos: state, message_delta, done, error, handoff.*, replay_gap
 *
 * Configuração: a widget key e a base da API NÃO são hardcodadas. Os tokens
 * __PUBLIC_WIDGET_KEY__ / __PUBLIC_API_BASE__ são substituídos no deploy (o
 * workflow do GitHub Pages troca-os pelas Variables PUBLIC_WIDGET_KEY /
 * PUBLIC_API_BASE; ver .github/workflows/deploy.yml). Sem uma widget key válida
 * (preview local, ou Variable ausente) o recurso fica INERTE: o hero mantém a
 * ilustração estática e a bolinha não aparece — deploy seguro, igual ao GTM.
 */
;(function () {
  'use strict'

  // === Configuração (substituída no deploy; literal em preview local) ===
  var WIDGET_KEY = '__PUBLIC_WIDGET_KEY__'
  var API_BASE = '__PUBLIC_API_BASE__'

  // Aparência/cópia do agente-demo da LAB019 (a saudação é client-side; o resto
  // da conversa vem do agente de verdade).
  var TITLE = 'Agente LAB019'
  var GREETING =
    'Oi! 👋 Sou o agente virtual da LAB019. Pergunte o que quiser — preços, ' +
    'canais (chat, voz, WhatsApp), como configurar. Estou aqui pra mostrar na ' +
    'prática como funciona.'

  // Sem widget key configurada → recurso inerte (mantém a ilustração do hero).
  // O token não substituído começa com "__", então não passa daqui.
  if (!WIDGET_KEY || WIDGET_KEY.slice(0, 2) === '__') return
  // A base da API tem default de produção mesmo sem a Variable — só a key é
  // realmente obrigatória (ela resolve o tenant + agente no gateway).
  if (!API_BASE || API_BASE.slice(0, 2) === '__') API_BASE = 'https://api.lab019.ai'
  API_BASE = API_BASE.replace(/\/+$/, '')
  var GATEWAY_BASE = API_BASE + '/gateway'

  // Sessão reaproveitada entre reloads (localStorage), namespaced pela key.
  var STORAGE_KEY = 'lab019-chat-session:' + WIDGET_KEY
  // Reconexão do SSE com backoff simples.
  var RECONNECT_DELAY_MS = 1500
  // Watchdog absoluto por turno: se um `done` se perde, reabilita o composer.
  var TURN_WATCHDOG_MS = 180 * 1000

  function randomId(prefix) {
    var c = window.crypto
    if (c && typeof c.randomUUID === 'function') return c.randomUUID()
    // Fallback para engines antigas: não é criptográfico, mas é só um id opaco.
    return (prefix || 'w') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  }

  // ------------------------------------------------------------------ backend

  // A sessão do gateway foi rejeitada como desconhecida/expirada (401/404) — o
  // chamador deve descartá-la e abrir uma nova.
  function SessionExpiredError() {
    this.name = 'SessionExpiredError'
    this.message = 'widget session expired'
  }
  SessionExpiredError.prototype = Object.create(Error.prototype)

  // POST {gateway}/v1/widget/sessions → { sessionId, sessionToken, conversationId, expiresIn }
  function createSession(signal) {
    return fetch(GATEWAY_BASE + '/v1/widget/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key: WIDGET_KEY }),
      signal: signal,
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(
          function () {
            throw new Error('HTTP ' + res.status)
          },
          function () {
            throw new Error('HTTP ' + res.status)
          }
        )
      }
      return res.json().then(function (body) {
        if (!body || !body.session_id || !body.session_token || !body.conversation_id) {
          throw new Error('resposta de sessão malformada')
        }
        return {
          sessionId: body.session_id,
          sessionToken: body.session_token,
          conversationId: body.conversation_id,
          expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 0,
          lastEventId: null,
        }
      })
    })
  }

  // POST {gateway}/v1/widget/conversations/{sid}/messages → 202 { messageId }.
  // A resposta do agente NÃO vem aqui: chega pelo SSE de events (correlacionada
  // por messageId). 401/404 → SessionExpiredError.
  function postMessage(sess, text, signal) {
    return fetch(
      GATEWAY_BASE + '/v1/widget/conversations/' + encodeURIComponent(sess.sessionId) + '/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer ' + sess.sessionToken,
          'x-idempotency-key': randomId('idem'),
        },
        body: JSON.stringify({ text: text }),
        signal: signal,
      }
    ).then(function (res) {
      if (!res.ok) {
        return res.text().then(reject, reject)
        function reject() {
          if (res.status === 401 || res.status === 404) throw new SessionExpiredError()
          throw new Error('HTTP ' + res.status)
        }
      }
      return res.json().then(function (body) {
        if (!body || !body.messageId) throw new Error('messageId ausente na resposta')
        return body.messageId
      })
    })
  }

  // ---- parser de SSE (porta de src/widget/client.ts) ----

  function parseSSEFrame(frame) {
    var event = 'message'
    var id
    var dataLines = []
    var sawField = false
    var lines = frame.split('\n')
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      if (!line || line.charAt(0) === ':') continue
      if (line.indexOf('event:') === 0) {
        event = line.slice('event:'.length).replace(/^ /, '')
        sawField = true
      } else if (line.indexOf('data:') === 0) {
        dataLines.push(line.slice('data:'.length).replace(/^ /, ''))
        sawField = true
      } else if (line.indexOf('id:') === 0) {
        id = line.slice('id:'.length).replace(/^ /, '')
        sawField = true
      }
    }
    if (!sawField) return null
    return { event: event, data: dataLines.join('\n'), id: id }
  }

  function parsePayload(data) {
    if (!data) return {}
    try {
      var p = JSON.parse(data)
      return p && typeof p === 'object' ? p : {}
    } catch (e) {
      return {}
    }
  }

  // Resolve após `ms`, ou na hora (true) se o signal abortar antes.
  function waitOrAborted(ms, signal) {
    if (signal.aborted) return Promise.resolve(true)
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        signal.removeEventListener('abort', onAbort)
        resolve(false)
      }, ms)
      function onAbort() {
        clearTimeout(timer)
        resolve(true)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  // Assina (e mantém aberta) a SSE por-sessão do gateway, reconectando com
  // backoff em queda/close até o signal abortar ou a sessão sumir (401/404).
  // `handlers`: onEvent(frameEvent, payload), onEventId(id), onExpired(), onGap().
  function subscribeEvents(sess, handlers, signal) {
    var lastEventId = sess.lastEventId
    ;(function loop() {
      if (signal.aborted) return
      var qs = 'st=' + encodeURIComponent(sess.sessionToken)
      var headers = { Accept: 'text/event-stream' }
      if (lastEventId) headers['Last-Event-ID'] = lastEventId
      fetch(
        GATEWAY_BASE +
          '/v1/widget/conversations/' +
          encodeURIComponent(sess.sessionId) +
          '/events?' +
          qs,
        { method: 'GET', headers: headers, signal: signal }
      ).then(
        function (response) {
          if (!response.ok) {
            if (response.status === 401 || response.status === 404) {
              handlers.onExpired()
              return
            }
            return waitOrAborted(RECONNECT_DELAY_MS, signal).then(function (stop) {
              if (!stop) loop()
            })
          }
          var reader = response.body && response.body.getReader ? response.body.getReader() : null
          if (!reader) {
            return waitOrAborted(RECONNECT_DELAY_MS, signal).then(function (stop) {
              if (!stop) loop()
            })
          }
          var decoder = new TextDecoder()
          var buffer = ''
          function pump() {
            return reader.read().then(function (result) {
              if (result.done || signal.aborted) return
              buffer += decoder.decode(result.value, { stream: true })
              buffer = buffer.replace(/\r\n/g, '\n')
              var frames = buffer.split('\n\n')
              buffer = frames.pop() || ''
              for (var i = 0; i < frames.length; i++) {
                if (!frames[i].trim()) continue
                var frame = parseSSEFrame(frames[i])
                if (!frame) continue
                if (frame.id) {
                  lastEventId = frame.id
                  handlers.onEventId(frame.id)
                }
                handlers.onEvent(frame.event, parsePayload(frame.data))
              }
              return pump()
            })
          }
          return pump().then(
            function () {
              try {
                reader.releaseLock()
              } catch (e) {
                /* já liberado */
              }
              if (signal.aborted) return
              // Stream fechou (hangup/blip) sem abortarmos → reconecta com o
              // lastEventId para o gateway reenviar o que perdemos.
              return waitOrAborted(RECONNECT_DELAY_MS, signal).then(function (stop) {
                if (!stop) loop()
              })
            },
            function (err) {
              try {
                reader.releaseLock()
              } catch (e) {
                /* noop */
              }
              if (err && err.name === 'AbortError') return
              return waitOrAborted(RECONNECT_DELAY_MS, signal).then(function (stop) {
                if (!stop) loop()
              })
            }
          )
        },
        function (err) {
          if (err && err.name === 'AbortError') return
          return waitOrAborted(RECONNECT_DELAY_MS, signal).then(function (stop) {
            if (!stop) loop()
          })
        }
      )
    })()
  }

  // ---- persistência da sessão (localStorage, com TTL) ----

  function persistSession(sess) {
    try {
      var ttlMs = (sess.expiresIn > 0 ? sess.expiresIn : 1800) * 1000
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessionId: sess.sessionId,
          sessionToken: sess.sessionToken,
          conversationId: sess.conversationId,
          lastEventId: sess.lastEventId,
          expiresAt: Date.now() + ttlMs,
        })
      )
    } catch (e) {
      /* localStorage indisponível (modo privado) — segue sem persistir */
    }
  }

  function restoreSession() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      var s = JSON.parse(raw)
      if (!s || !s.sessionId || !s.sessionToken || !s.conversationId) return null
      if (typeof s.expiresAt === 'number' && Date.now() >= s.expiresAt) return null
      return {
        sessionId: s.sessionId,
        sessionToken: s.sessionToken,
        conversationId: s.conversationId,
        expiresIn: 0,
        lastEventId: typeof s.lastEventId === 'string' ? s.lastEventId : null,
      }
    } catch (e) {
      return null
    }
  }

  function clearStoredSession() {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      /* noop */
    }
  }

  // ------------------------------------------------------- estado da conversa

  // Fonte da verdade: uma lista de mensagens compartilhada pelas duas superfícies.
  var messages = [] // { role: 'user'|'agent'|'error', text, pending? }
  var surfaces = [] // { body: HTMLElement } — hero e/ou painel flutuante
  var formControls = [] // { input, send } — para habilitar/desabilitar em bloco

  var session = null // { sessionId, sessionToken, conversationId, lastEventId }
  var sessionPromise = null // single-flight do createSession
  var subCtl = null // AbortController da assinatura SSE
  var sending = false
  var currentTurn = null // { msg, messageId } — o turno do agente em andamento
  var postCtl = null // AbortController do POST da mensagem
  var watchdog = null

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

  function armWatchdog() {
    clearWatchdog()
    watchdog = setTimeout(onWatchdog, TURN_WATCHDOG_MS)
  }

  function clearWatchdog() {
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = null
    }
  }

  function onWatchdog() {
    // Um `done` se perdeu (turno pendurado): reabilita o composer para o
    // visitante tentar de novo, em vez de travar.
    if (!currentTurn) return
    if (currentTurn.msg.pending) {
      currentTurn.msg.pending = false
      currentTurn.msg.text = 'A resposta demorou demais. Tente de novo.'
    }
    render()
    finishTurn()
  }

  function finishTurn() {
    sending = false
    currentTurn = null
    postCtl = null
    clearWatchdog()
    setFormsEnabled(true)
  }

  function renderError(agentMsg, err) {
    var friendly =
      err && err.name === 'SessionExpiredError'
        ? 'A conversa reiniciou. Tente enviar de novo.'
        : 'Não consegui me conectar. Tente novamente em instantes.'
    if (agentMsg && agentMsg.pending) {
      agentMsg.pending = false
      agentMsg.role = 'error'
      agentMsg.text = friendly
    } else {
      messages.push({ role: 'error', text: friendly })
    }
    render()
  }

  // ---- ciclo de vida da sessão + assinatura ----

  function resetSession() {
    session = null
    sessionPromise = null
    if (subCtl) {
      subCtl.abort()
      subCtl = null
    }
    clearStoredSession()
  }

  function startSubscription() {
    if (subCtl || !session) return
    subCtl = new AbortController()
    subscribeEvents(
      session,
      {
        onEvent: onGatewayEvent,
        onEventId: function (id) {
          if (session) {
            session.lastEventId = id
            persistSession(session)
          }
        },
        onExpired: function () {
          resetSession()
          if (currentTurn) {
            renderError(currentTurn.msg, new SessionExpiredError())
            finishTurn()
          }
        },
        onGap: function () {
          /* buffer de replay estourou — raro; ignoramos (o turno segue). */
        },
      },
      subCtl.signal
    )
  }

  function ensureSession(signal) {
    if (session) return Promise.resolve(session)
    if (sessionPromise) return sessionPromise
    var restored = restoreSession()
    if (restored) {
      session = restored
      startSubscription()
      return Promise.resolve(session)
    }
    sessionPromise = createSession(signal).then(
      function (s) {
        session = s
        persistSession(session)
        sessionPromise = null
        startSubscription()
        return session
      },
      function (err) {
        sessionPromise = null
        throw err
      }
    )
    return sessionPromise
  }

  // Despacha um frame do SSE para o turno em andamento. O guard de messageId
  // evita que um frame de OUTRO turno (replay/atraso no stream persistente)
  // preencha ou encerre o turno atual.
  function onGatewayEvent(event, payload) {
    if (event === 'message_delta') {
      var t = currentTurn
      if (!t || !t.messageId) return
      if (payload.messageId && t.messageId !== payload.messageId) return
      if (typeof payload.delta !== 'string') return
      t.msg.pending = false
      t.msg.text += payload.delta
      render()
    } else if (event === 'done') {
      var d = currentTurn
      if (!d || !d.messageId) return
      if (payload.messageId && d.messageId !== payload.messageId) return
      if (d.msg.pending) {
        d.msg.pending = false
        d.msg.text = 'Não recebi uma resposta. Tente de novo.'
      }
      render()
      finishTurn()
    } else if (event === 'error') {
      var e = currentTurn
      if (e) {
        renderError(e.msg, new Error(typeof payload.message === 'string' ? payload.message : 'erro'))
        finishTurn()
      }
    } else if (event === 'handoff.attendant_message') {
      // Mensagem de um atendente humano (se o handoff estiver ativo): entra no
      // feed como uma bolha do agente.
      if (typeof payload.text === 'string' && payload.text) {
        messages.push({ role: 'agent', text: payload.text })
        render()
      }
    }
    // Demais eventos (state, reasoning, tool_*, metadata, outros handoff.*) são
    // ignorados por esta landing — degrada de boa contra um gateway mais novo.
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

    currentTurn = { msg: agent, messageId: null }
    armWatchdog()
    postCtl = new AbortController()
    doSend(text, agent, true)
  }

  function doSend(text, agent, allowRetry) {
    ensureSession(postCtl ? postCtl.signal : undefined)
      .then(function (s) {
        return postMessage(s, text, postCtl ? postCtl.signal : undefined)
      })
      .then(
        function (messageId) {
          // Fixa o messageId agora (fonte autoritativa do 202) — o guard nos
          // frames só aceita deltas/done deste messageId.
          if (currentTurn) currentTurn.messageId = messageId
        },
        function (err) {
          if (err && err.name === 'AbortError') return
          if (err && err.name === 'SessionExpiredError' && allowRetry) {
            // Sessão persistida ficou velha: descarta e tenta uma vez com uma nova.
            resetSession()
            doSend(text, agent, false)
            return
          }
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
        // A bolinha só aparece quando o card já ROLOU PARA CIMA e saiu da tela —
        // não quando ele ainda está abaixo da dobra (no mobile o card fica embaixo
        // do texto do hero) nem quando um card mais alto que a viewport está sendo
        // lido. Por isso o gatilho é a posição (borda inferior acima do topo da
        // viewport), e não uma fração de área — que, num card alto, nunca chegaria
        // ao limiar mesmo com o card quase todo visível.
        var rootTop = e.rootBounds ? e.rootBounds.top : 0
        var scrolledAbove = !e.isIntersecting && e.boundingClientRect.bottom <= rootTop
        if (scrolledAbove) {
          floating.fab.classList.add('is-visible')
        } else {
          floating.fab.classList.remove('is-visible')
          floating.close()
        }
      },
      // Só o cruzamento em 0 (entrar/sair da tela) importa para essa decisão.
      { threshold: [0] }
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
