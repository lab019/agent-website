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
 *   GET  {GATEWAY}/v1/widget/config?key=wgt_…       (aparência + canais públicos)
 *   POST {GATEWAY}/v1/voice/sessions                (voz-by-key: X-Widget-Session
 *        + Bearer wst_, { consent: true } → { livekit_url, livekit_token })
 *
 * Voz (porta do widget do agent-web, LIC-371): quando a widget key habilita o
 * canal "voice" (GET /config), o composer ganha um botão de microfone. A
 * chamada usa a MESMA sessão/conversa do texto — o browser nunca conhece o
 * agent_id — e as transcrições (STT do visitante + fala do agente) entram no
 * mesmo feed, com o badge "voz". O SDK do LiveKit NÃO entra no peso da página:
 * é carregado via CDN só no primeiro clique no microfone.
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
  // Intervalo do "drain" progressivo: os deltas recebidos são revelados aos
  // poucos (efeito de digitação) em vez de aparecerem em bloco. Isso mantém a
  // sensação de streaming mesmo quando o SSE chega com deltas coalescidos (ou
  // bufferizado por um proxy/CDN na frente da API).
  var DRAIN_TICK_MS = 22

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
              // Se este signal já foi abortado (ex.: um retry já re-mintou a
              // sessão e trocou o subCtl), esta é a assinatura ANTIGA — não
              // dispara onExpired, senão derrubaria a assinatura nova e boa.
              if (signal.aborted) return
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
    if (msg.pending) {
      // Três pontinhos ANIMADOS (markup estático, sem dado do usuário). Só
      // (re)monta quando entra em "typing" — reaplicar a cada render reiniciaria
      // a animação CSS.
      if (el.getAttribute('data-typing') !== '1') {
        el.setAttribute('data-typing', '1')
        el.innerHTML = '<span class="lab019-typing" aria-label="digitando"><span></span><span></span><span></span></span>'
      }
    } else if (msg.meta) {
      // Texto + linha de métricas. Montado via DOM (o texto do agente SEMPRE em
      // text node — nunca innerHTML — para não abrir XSS).
      if (el.getAttribute('data-typing') === '1') el.removeAttribute('data-typing')
      el.textContent = ''
      el.appendChild(document.createTextNode(msg.text))
      var meta = document.createElement('span')
      meta.className = 'msg-meta'
      meta.textContent = msg.meta
      el.appendChild(meta)
    } else if (msg.voice) {
      // Fala transcrita (STT/TTS) — mesmo feed, com o badge "voz". Texto sempre
      // em text node (transcrição é conteúdo do usuário/modelo — nunca innerHTML).
      if (el.getAttribute('data-typing') === '1') el.removeAttribute('data-typing')
      el.textContent = ''
      el.appendChild(document.createTextNode(msg.text))
      var badge = document.createElement('span')
      badge.className = 'msg-voice'
      badge.textContent = 'voz'
      el.appendChild(badge)
    } else {
      if (el.getAttribute('data-typing') === '1') el.removeAttribute('data-typing')
      el.textContent = msg.text
    }
  }

  // Formata as métricas da resposta numa linha curta: TTFT · total · tokens · modelo.
  function fmtSec(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return null
    var s = ms / 1000
    return (s < 10 ? s.toFixed(1) : String(Math.round(s))).replace('.', ',') + 's'
  }

  function formatMetrics(m) {
    if (!m || typeof m !== 'object') return ''
    var parts = []
    var ttft = fmtSec(m.ttftMs)
    if (ttft) parts.push('⚡ ' + ttft)
    var total = fmtSec(m.totalDurationMs)
    if (total) parts.push('total ' + total)
    var tin = typeof m.tokensIn === 'number' ? m.tokensIn : 0
    var tout = typeof m.tokensOut === 'number' ? m.tokensOut : 0
    if (tin + tout > 0) parts.push(tin + tout + ' tok')
    if (m.model) parts.push(String(m.model))
    return parts.join(' · ')
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
    var t = currentTurn
    if (t.buffer) {
      // esvazia o que ainda não foi revelado pelo drain
      t.msg.pending = false
      t.msg.text += t.buffer
      t.buffer = ''
    }
    if (t.msg.pending) {
      t.msg.pending = false
      t.msg.text = 'A resposta demorou demais. Tente de novo.'
    }
    render()
    finishTurn()
  }

  // Revela o texto recebido aos poucos (efeito de digitação). Cada tick move um
  // naco proporcional do buffer para a bolha; quando o buffer esvazia E o turno
  // recebeu `done`, finaliza. Um único timer por turno.
  function scheduleDrain() {
    if (!currentTurn || currentTurn.drainTimer) return
    currentTurn.drainTimer = setTimeout(drainTick, DRAIN_TICK_MS)
  }

  function drainTick() {
    var t = currentTurn
    if (!t) return
    t.drainTimer = null
    if (t.buffer.length > 0) {
      // Naco proporcional (ceil(len/25), mín. 2): digita rápido e com ease-out,
      // sem estourar em bloco nem arrastar demais em respostas longas.
      var n = Math.max(2, Math.ceil(t.buffer.length / 25))
      t.msg.pending = false
      t.msg.text += t.buffer.slice(0, n)
      t.buffer = t.buffer.slice(n)
      render()
    }
    if (t.buffer.length > 0) {
      t.drainTimer = setTimeout(drainTick, DRAIN_TICK_MS)
      return
    }
    if (t.done) {
      if (t.msg.pending) {
        t.msg.pending = false
        t.msg.text = 'Não recebi uma resposta. Tente de novo.'
      } else if (t.metrics) {
        // Linha discreta com as métricas da resposta (encanta o técnico).
        t.msg.meta = formatMetrics(t.metrics)
      }
      render()
      finishTurn()
    }
    // senão: buffer vazio mas sem `done` ainda — espera o próximo delta, que
    // reinicia o drain via scheduleDrain().
  }

  function finishTurn() {
    sending = false
    if (currentTurn && currentTurn.drainTimer) clearTimeout(currentTurn.drainTimer)
    currentTurn = null
    // Aborta o POST em voo deste turno, se ainda houver. Sem isso, um turno
    // encerrado cedo (por um frame de erro/expiração antes do próprio 202) deixa
    // o POST vivo — e seu 202 tardio fixaria o messageId no turno SEGUINTE,
    // derrubando os deltas dele até o watchdog. (Espelha o gwPostController.abort()
    // do widget de referência.)
    if (postCtl) {
      postCtl.abort()
      postCtl = null
    }
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
      // Acumula no buffer; o drain revela aos poucos (efeito de digitação).
      t.buffer += payload.delta
      scheduleDrain()
    } else if (event === 'done') {
      var d = currentTurn
      if (!d || !d.messageId) return
      if (payload.messageId && d.messageId !== payload.messageId) return
      // Marca o fim e deixa o drain terminar de revelar o buffer; ele finaliza o
      // turno quando esvaziar (drainTick).
      d.done = true
      scheduleDrain()
    } else if (event === 'metadata') {
      // Métricas da resposta (subset público repassado pelo gateway): tempo até
      // a 1ª resposta, tempo total, tokens e modelo. Guardadas no turno e
      // mostradas numa linha discreta ao finalizar (drainTick).
      var mt = currentTurn
      if (!mt || !mt.messageId) return
      if (payload.messageId && mt.messageId !== payload.messageId) return
      mt.metrics = payload
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

    var turn = { msg: agent, messageId: null, buffer: '', done: false, drainTimer: null, metrics: null }
    currentTurn = turn
    armWatchdog()
    postCtl = new AbortController()
    doSend(text, turn, true)
  }

  function doSend(text, turn, allowRetry) {
    // Captura o controller deste envio: finishTurn zera postCtl, então ler
    // postCtl tarde (dentro das continuations) poderia pegar null/outro turno.
    var ctl = postCtl
    ensureSession(ctl ? ctl.signal : undefined)
      .then(function (s) {
        return postMessage(s, text, ctl ? ctl.signal : undefined)
      })
      .then(
        function (messageId) {
          // Só fixa se este turno ainda é o atual. Um turno já encerrado (por um
          // frame de erro/expiração) não pode fixar/roubar o messageId do turno
          // seguinte — senão os deltas do novo turno seriam todos descartados.
          if (currentTurn === turn) turn.messageId = messageId
        },
        function (err) {
          if (err && err.name === 'AbortError') return
          // Turno já substituído/encerrado: não renderiza erro nem repõe a mensagem.
          if (currentTurn !== turn) return
          if (err && err.name === 'SessionExpiredError' && allowRetry) {
            // Sessão persistida ficou velha: descarta e tenta uma vez com uma nova.
            resetSession()
            doSend(text, turn, false)
            return
          }
          renderError(turn.msg, err instanceof Error ? err : new Error(String(err)))
          finishTurn()
        }
      )
  }

  // ------------------------------------------------------------------------ voz

  // Porta do fluxo voice-by-key do widget do agent-web (src/widget/voice.ts +
  // src/lib/voiceClient.ts): sessão de voz mintada com a MESMA sessão de widget
  // do texto, LiveKit no browser, transcrições no mesmo feed. O SDK só é
  // carregado (CDN, versão pinada) no primeiro clique no microfone.
  var LIVEKIT_CDN = 'https://cdn.jsdelivr.net/npm/livekit-client@2.20.0/dist/livekit-client.umd.min.js'

  var voiceEnabled = false // GET /v1/widget/config → channels inclui "voice"
  var micButtons = [] // botões 🎙️ (um por superfície), exibidos pelo config
  var voiceBars = [] // barras de status da chamada (uma por superfície)
  var voiceStatus = 'idle' // 'idle' | 'connecting' | 'live'
  // Guarda anti-corrida (espelha o voiceEpoch do widget de referência): um
  // stop/erro/novo start incrementa a época, e qualquer continuation de uma
  // conexão em voo superada se descarta em vez de deixar um mic vivo.
  var voiceEpoch = 0
  var voiceRoom = null
  var voiceSelf = '' // identity local no LiveKit (definida pós-connect)
  var voiceMuted = false
  var voiceAudioEls = {} // trackSid → <audio> oculto do áudio do agente
  var voiceBlocked = {} // trackSid → true quando o autoplay foi bloqueado
  var livekitPromise = null

  // Busca a config pública da key (aparência + canais). Só liga a UI de voz —
  // qualquer falha degrada para "só texto", sem erro visível.
  function fetchPublicConfig() {
    fetch(GATEWAY_BASE + '/v1/widget/config?key=' + encodeURIComponent(WIDGET_KEY), {
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        return res.ok ? res.json() : null
      })
      .then(function (cfg) {
        var channels = cfg && cfg.channels
        if (channels && channels.length && channels.indexOf('voice') !== -1) {
          voiceEnabled = true
          for (var i = 0; i < micButtons.length; i++) micButtons[i].hidden = false
        }
      })
      .catch(function () {
        /* sem config → segue só texto */
      })
  }

  function loadLiveKit() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient)
    if (livekitPromise) return livekitPromise
    livekitPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script')
      s.src = LIVEKIT_CDN
      s.async = true
      s.onload = function () {
        if (window.LivekitClient) resolve(window.LivekitClient)
        else reject(new Error('O componente de voz carregou incompleto. Recarregue a página.'))
      }
      s.onerror = function () {
        livekitPromise = null // permite tentar de novo no próximo clique
        reject(new Error('Não consegui carregar o componente de voz. Verifique sua conexão.'))
      }
      document.head.appendChild(s)
    })
    return livekitPromise
  }

  // Pede o microfone AINDA no gesto do clique (o prompt do browser sai na hora,
  // não só depois do POST + connect). A permissão persiste; o LiveKit reabre o
  // mic ao publicar. Porta do ensureMicrophoneAccess do agent-web.
  function ensureMic() {
    var md = navigator.mediaDevices
    if (!md || typeof md.getUserMedia !== 'function') {
      return Promise.reject(new Error('Microfone indisponível neste navegador.'))
    }
    return md.getUserMedia({ audio: true }).then(
      function (stream) {
        stream.getTracks().forEach(function (t) {
          t.stop()
        })
      },
      function (err) {
        var name = err && err.name
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          throw new Error('Permissão de microfone negada — autorize o microfone e tente de novo.')
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          throw new Error('Nenhum microfone encontrado.')
        }
        throw err instanceof Error ? err : new Error(String(err))
      }
    )
  }

  // POST {gateway}/v1/voice/sessions (voz-by-key): sem agent_id no corpo — o
  // gateway resolve org/agente e REUSA a conversa da própria sessão do widget.
  function createVoiceSession(sess) {
    return fetch(GATEWAY_BASE + '/v1/voice/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Widget-Session': sess.sessionId,
        Authorization: 'Bearer ' + sess.sessionToken,
      },
      body: JSON.stringify({ consent: true }),
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(fail, fail)
        function fail() {
          if (res.status === 401) throw new SessionExpiredError()
          if (res.status === 403) throw new Error('O atendimento por voz não está disponível no momento.')
          if (res.status === 429) throw new Error('Muitas chamadas agora. Tente novamente em instantes.')
          throw new Error('Não consegui iniciar a chamada de voz. Tente novamente.')
        }
      }
      return res.json()
    })
  }

  function startVoice() {
    if (voiceStatus !== 'idle') return
    var epoch = ++voiceEpoch
    voiceStatus = 'connecting'
    renderVoiceBars()
    var lk
    loadLiveKit()
      .then(function (mod) {
        lk = mod
        return ensureMic()
      })
      .then(function () {
        return attemptVoice(lk, epoch, true)
      })
      .catch(function (err) {
        if (epoch !== voiceEpoch) return
        teardownVoice(
          err && err.message ? err.message : 'Não consegui iniciar a chamada de voz. Tente novamente.'
        )
      })
  }

  function attemptVoice(lk, epoch, allowRetry) {
    return ensureSession()
      .then(function (s) {
        return createVoiceSession(s)
      })
      .then(function (vs) {
        if (epoch !== voiceEpoch) return null
        return connectRoom(lk, vs, epoch)
      })
      .then(function (room) {
        if (!room) return
        if (epoch !== voiceEpoch) {
          try {
            room.disconnect()
          } catch (e) {
            /* já caiu */
          }
          return
        }
        voiceStatus = 'live'
        renderVoiceBars()
      })
      .catch(function (err) {
        // Sessão persistida velha: descarta e tenta UMA vez com uma nova
        // (espelha o retry do doSend).
        if (err && err.name === 'SessionExpiredError' && allowRetry && epoch === voiceEpoch) {
          resetSession()
          // A sessão morta era compartilhada com o texto: um turno de texto em
          // andamento nunca mais receberia eventos pela assinatura abortada —
          // encerra-o com o mesmo erro amigável do caminho onExpired, em vez
          // de deixá-lo pendurado até o watchdog.
          if (currentTurn) {
            renderError(currentTurn.msg, new SessionExpiredError())
            finishTurn()
          }
          return attemptVoice(lk, epoch, false)
        }
        throw err
      })
  }

  function connectRoom(lk, vs, epoch) {
    var room = new lk.Room({ adaptiveStream: true, dynacast: true })
    voiceRoom = room

    // Áudio do agente: cada track de áudio remota ganha o seu próprio <audio>
    // oculto no DOM (elemento por track evita a corrida pause()/play() quando o
    // agente republica — mesmo racional do VoiceConnection de referência).
    room.on(lk.RoomEvent.TrackSubscribed, function (track, pub) {
      // Guarda de época: uma track que chega DEPOIS do teardown (hangup no
      // meio de um republish do agente) não pode anexar um <audio> órfão que
      // ninguém mais consegue parar — nem vazar para uma chamada seguinte.
      if (epoch !== voiceEpoch) return
      if (track.kind !== lk.Track.Kind.Audio) return
      if (voiceAudioEls[pub.trackSid]) return
      var el = track.attach()
      el.autoplay = true
      el.style.display = 'none'
      document.body.appendChild(el)
      voiceAudioEls[pub.trackSid] = el
      // play() explícito expõe a rejeição de autoplay bloqueado (o autoplay
      // sozinho falha em silêncio) → botão "Ativar som" na barra.
      el.play().then(
        function () {
          delete voiceBlocked[pub.trackSid]
          renderVoiceBars()
        },
        function () {
          voiceBlocked[pub.trackSid] = true
          renderVoiceBars()
        }
      )
    })

    room.on(lk.RoomEvent.TrackUnsubscribed, function (track, pub) {
      // Mesma guarda do TrackSubscribed: pós-teardown o mapa já foi limpo pelo
      // próprio teardownVoice; um unsubscribe atrasado não deve mexer no
      // estado (possivelmente de uma chamada nova).
      if (epoch !== voiceEpoch) return
      if (track.kind !== lk.Track.Kind.Audio) return
      var el = voiceAudioEls[pub.trackSid]
      if (!el) return
      track.detach(el)
      el.remove()
      delete voiceAudioEls[pub.trackSid]
      delete voiceBlocked[pub.trackSid]
      renderVoiceBars()
    })

    // Legendas ao vivo: STT do visitante + texto falado do agente entram no
    // feed. Quem fala é decidido pela identity local (definida pós-connect).
    room.on(lk.RoomEvent.TranscriptionReceived, function (segments, participant) {
      if (epoch !== voiceEpoch) return
      var isLocal = participant && participant.identity === voiceSelf
      var list = segments || []
      for (var i = 0; i < list.length; i++) {
        var seg = list[i]
        if (!seg || !seg.text || !String(seg.text).trim()) continue
        onVoiceSegment(seg.id || '', isLocal ? 'user' : 'agent', String(seg.text), Boolean(seg.final))
      }
    })

    room.on(lk.RoomEvent.Disconnected, function () {
      // Só reporta queda se ESTA chamada ainda é a atual (o hangup do usuário
      // incrementa a época antes de desconectar, então não cai aqui).
      if (epoch !== voiceEpoch) return
      teardownVoice('A chamada de voz caiu. Clique no microfone para ligar de novo.')
    })

    return room
      .connect(vs.livekit_url, vs.livekit_token)
      .then(function () {
        // Superada durante o connect (hangup/erro no meio do caminho): NÃO
        // reabilita o microfone de uma chamada que o usuário já encerrou —
        // só derruba a sala e sai.
        if (epoch !== voiceEpoch) {
          try {
            room.disconnect()
          } catch (e) {
            /* já caiu */
          }
          return null
        }
        voiceSelf = room.localParticipant.identity
        return room.localParticipant
          .setMicrophoneEnabled(true)
          .then(function () {
            // Destrava o autoplay ainda com o gesto do clique; se falhar, o
            // botão "Ativar som" cobre.
            return room.startAudio().then(null, function () {})
          })
          .then(function () {
            return room
          })
      })
  }

  // Porta do planTranscription do agent-web: segmento com id → upsert na própria
  // linha (a legenda interina cresce no lugar, sem empilhar bolha por delta);
  // final sem id → append; interina sem id → descarta.
  function onVoiceSegment(id, role, text, isFinal) {
    var msgRole = role === 'user' ? 'user' : 'agent'
    if (id) {
      var key = 'voice-' + role + '-' + id
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i].voiceKey === key) {
          messages[i].text = text
          render()
          return
        }
      }
      messages.push({ role: msgRole, text: text, voice: true, voiceKey: key })
      render()
      return
    }
    if (isFinal) {
      messages.push({ role: msgRole, text: text, voice: true })
      render()
    }
  }

  function toggleMute() {
    if (!voiceRoom || voiceStatus !== 'live') return
    var next = !voiceMuted
    voiceRoom.localParticipant.setMicrophoneEnabled(!next).then(
      function () {
        voiceMuted = next
        renderVoiceBars()
      },
      function () {
        /* falhou: mantém o estado atual */
      }
    )
  }

  // Retry do autoplay — precisa vir de um gesto (o clique no botão da barra).
  function enableAudioRetry() {
    if (!voiceRoom) return
    var room = voiceRoom
    var unlock = room.startAudio ? room.startAudio().then(null, function () {}) : Promise.resolve()
    unlock.then(function () {
      for (var sid in voiceAudioEls) {
        ;(function (sid_) {
          voiceAudioEls[sid_].play().then(
            function () {
              delete voiceBlocked[sid_]
              renderVoiceBars()
            },
            function () {
              voiceBlocked[sid_] = true
              renderVoiceBars()
            }
          )
        })(sid)
      }
    })
  }

  // Encerra a chamada (hangup, erro ou queda). `errorText` opcional vira uma
  // mensagem de erro no feed. Incrementa a época ANTES de desconectar para o
  // handler de Disconnected não reportar a própria desconexão como queda.
  function teardownVoice(errorText) {
    voiceEpoch++
    var room = voiceRoom
    voiceRoom = null
    voiceSelf = ''
    voiceMuted = false
    for (var sid in voiceAudioEls) {
      var el = voiceAudioEls[sid]
      el.pause()
      el.srcObject = null
      el.remove()
    }
    voiceAudioEls = {}
    voiceBlocked = {}
    if (room) {
      try {
        room.disconnect()
      } catch (e) {
        /* já desconectado */
      }
    }
    voiceStatus = 'idle'
    renderVoiceBars()
    if (errorText) {
      messages.push({ role: 'error', text: errorText })
      render()
    }
  }

  // Barra de status da chamada — uma por superfície, reconstruída a cada estado
  // (mesmo modelo do syncSurface: a lista é curta, reconstruir é o simples).
  function makeVoiceBar() {
    var bar = document.createElement('div')
    bar.className = 'lab019-voicebar'
    bar.hidden = true
    voiceBars.push(bar)
    return bar
  }

  function makeBarBtn(text, onClick) {
    var b = document.createElement('button')
    b.type = 'button'
    b.className = 'lab019-voicebar-btn'
    b.textContent = text
    b.addEventListener('click', onClick)
    return b
  }

  function renderVoiceBars() {
    var blocked = false
    for (var sid in voiceBlocked) {
      if (voiceBlocked[sid]) {
        blocked = true
        break
      }
    }
    for (var i = 0; i < voiceBars.length; i++) {
      var bar = voiceBars[i]
      bar.textContent = ''
      if (voiceStatus === 'idle') {
        bar.hidden = true
        continue
      }
      bar.hidden = false
      var label = document.createElement('span')
      label.className = 'lab019-voicebar-label'
      if (voiceStatus === 'connecting') {
        label.textContent = 'Conectando a chamada…'
      } else {
        // Markup estático (sem dado do usuário) — o pulse é o mesmo do header.
        label.innerHTML = '<span class="pulse"></span> Em chamada — pode falar'
      }
      bar.appendChild(label)
      if (voiceStatus === 'live') {
        if (blocked) bar.appendChild(makeBarBtn('🔊 Ativar som', enableAudioRetry))
        bar.appendChild(makeBarBtn(voiceMuted ? 'Reativar mic' : 'Silenciar', toggleMute))
      }
      bar.appendChild(
        makeBarBtn('Encerrar', function () {
          teardownVoice(null)
        })
      )
    }
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

    // Botão de voz — nasce oculto; a config pública (canal "voice") o exibe.
    var micBtn = document.createElement('button')
    micBtn.className = 'chat-live-mic'
    micBtn.type = 'button'
    micBtn.hidden = !voiceEnabled
    micBtn.setAttribute('aria-label', 'Falar por voz')
    micBtn.title = 'Falar por voz'
    micBtn.innerHTML = '<span aria-hidden="true">🎙️</span>'
    micBtn.addEventListener('click', startVoice)
    micButtons.push(micBtn)

    form.appendChild(input)
    form.appendChild(micBtn)
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
    card.insertBefore(makeVoiceBar(), form)
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
    panel.appendChild(makeVoiceBar())
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
    fetchPublicConfig()
    // Fechamento educado da chamada ao sair da página (o LiveKit derrubaria
    // sozinho pelo timeout, mas assim o gateway encerra na hora).
    window.addEventListener('pagehide', function () {
      if (voiceRoom) {
        try {
          voiceRoom.disconnect()
        } catch (e) {
          /* noop */
        }
      }
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
})()
