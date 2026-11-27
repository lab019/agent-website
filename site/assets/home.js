/*
 * Home do lab019.ai — o palco de conversa (LIC-3777).
 *
 * A home é um cliente do SDK público (/sdk/v1/lab019.js): o composer abre o chat no centro da página, a mesma
 * conversa aparece na bolha quando o palco sai da tela, e ela continua depois de recarregar ou de ir para outra
 * página (o SDK guarda a sessão no localStorage; o histórico volta por `history()`).
 *
 * Configuração: <meta name="lab019-widget-key"> e <meta name="lab019-api-base"> (o deploy injeta os valores das
 * Variables PUBLIC_WIDGET_KEY / PUBLIC_API_BASE). Sem a chave a home continua de pé: ao perguntar, o visitante
 * recebe o caminho alternativo (teste grátis ou e-mail) — nada de erro seco.
 *
 * Os textos desta página ficam aqui, não no SDK: o SDK só devolve códigos de erro.
 */
import { createTurnIds } from './turn-ids.js'
import { askStop, bubble, busyCycles, minimizedStore, sendButtons } from './home-controls.js'

const SDK_URL = '/sdk/v1/lab019.js'
const KEY_RE = /^wgt_[A-Za-z0-9._-]+$/
const BASE_RE = /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/
const SIGNUP_URL = 'https://app.lab019.ai/signup'
const TURN_TIMEOUT_MS = 120000
const STOP_RETRY_MS = 700

const T = {
  rateLimited: 'Muitas mensagens em pouco tempo. Espere um instante e tente de novo.',
  unavailable: 'Não consegui falar com o agente agora.',
  alt: 'Enquanto isso, você pode',
  altTrial: 'testar grátis por 14 dias',
  altTeam: 'falar com a equipe',
  or: 'ou',
  expired: 'Sua sessão expirou. A próxima mensagem abre uma nova conversa.',
  dropped: 'Não consegui receber essa mensagem. Tente enviar de novo.',
  voiceConnecting: 'Conectando a chamada…',
  voiceLive: 'Em chamada com o Agente',
  mute: 'Silenciar',
  unmute: 'Ativar microfone',
  micDenied: 'O microfone está bloqueado. Libere o acesso no navegador e tente de novo.',
  micMissing: 'Não encontrei um microfone neste aparelho. Você pode continuar por texto.',
  voiceOff: 'A voz não está disponível agora. Você pode continuar por texto.',
  voiceBusy: 'Já existe uma chamada em andamento.',
  voiceFailed: 'Não consegui iniciar a chamada. Você pode continuar por texto.',
  voiceTag: 'voz',
  send: 'Enviar',
  stop: 'Parar resposta',
  actTrial: ['Testar grátis', '14 dias · sem cartão e sem CNPJ'],
  actVoice: ['Testar a voz agora', 'Pelo navegador, nesta página'],
}

const PLACEHOLDERS = [
  'Pergunte qualquer coisa…',
  'Ex.: o agente consegue cobrar boletos vencidos pelo WhatsApp?',
  'Ex.: dá para atender por telefone em português?',
  'Ex.: como ele passa a conversa para alguém da equipe?',
  'Ex.: quanto eu gastaria atendendo pelo WhatsApp?',
]

const $ = (selector, root = document) => root.querySelector(selector)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

function meta(name) {
  const el = document.querySelector(`meta[name="${name}"]`)
  return el ? (el.getAttribute('content') || '').trim() : ''
}

const config = (() => {
  const key = meta('lab019-widget-key')
  const base = meta('lab019-api-base').replace(/\/+$/, '')
  return {
    key: KEY_RE.test(key) ? key : '',
    // The deploy injects the API origin (the same Variable chat.js uses); the SDK wants the gateway path under it.
    baseUrl: BASE_RE.test(base) ? `${base}/gateway/v1/public` : undefined,
  }
})()

/** The sign-up link keeps the campaign parameters of this page, like signup-link.js does for the static links. */
function signupUrl() {
  const kept = new URLSearchParams()
  new URLSearchParams(location.search).forEach((value, key) => {
    if (/^utm_/i.test(key) || key === 'gclid' || key === 'fbclid') kept.append(key, value)
  })
  const query = kept.toString()
  return query ? `${SIGNUP_URL}?${query}` : SIGNUP_URL
}

// ---------------------------------------------------------------------------------------------------------------
// elements and state

const stage = $('#stage')
const feed = $('#feed')
const feedIn = $('#feed-in')
const pbody = $('#pbody')
const q = $('#q')
const send = $('#send')
const panelSend = $('#pform .send-btn')
const fab = $('#fab')
const fabBadge = $('#fab-badge')
const panel = $('#panel')
const mic = $('#mic')
const consent = $('#consent')
const voicebar = $('#voicebar')
const voiceLabel = $('#voice-label')
const voiceTime = $('#voice-time')
const muteButton = $('#mute')

let SDK = null // the Lab019 class, once the module is loaded
let chat = null
let connecting = null
let busy = false
let stopping = false // the visitor asked to stop the answer; waiting for the stream's `done`
let sending = null // the send() of the current question, so a stop never races ahead of it
const ids = createTurnIds() // drops the late events of a question that already left the screen
const cycles = busyCycles() // the handoff request releases the busy state only while it is still its own
let booting = false
let turn = null // the answer being streamed: { rows, text, id, timer, frame }
let stageVisible = true
let minimized = false // the visitor put the conversation in the corner bubble to see the site again
const minimizedPref = minimizedStore(() => window.sessionStorage)
let muted = false
let voiceTimer = null
let voiceSince = 0
const transcripts = new Map()

// ---------------------------------------------------------------------------------------------------------------
// SDK

async function loadSdk() {
  if (!SDK) SDK = (await import(SDK_URL)).default
  return SDK
}

function getChat() {
  if (chat) return Promise.resolve(chat)
  if (!config.key) return Promise.reject(Object.assign(new Error('no_key'), { code: 'key_required' }))
  if (!connecting) {
    connecting = loadSdk()
      .then((Lab019) => Lab019.connect({ key: config.key, baseUrl: config.baseUrl }))
      .then((client) => {
        bind(client)
        chat = client
        return client
      })
      .catch((error) => {
        connecting = null
        throw error
      })
  }
  return connecting
}

function bind(client) {
  client.on('message_delta', onDelta)
  client.on('done', onDone)
  client.on('turn.silent_end', onSilentEnd)
  client.on('error', onError)
  client.on('handoff.attendant_message', onAttendant)
  client.on('voice.state', onVoiceState)
  client.on('voice.transcript', onTranscript)
  client.on('voice.error', onVoiceError)
}

// ---------------------------------------------------------------------------------------------------------------
// rendering — the same conversation goes to the stage and to the bubble

const LOGO = '<svg class="ava" aria-hidden="true"><use href="#logo019"/></svg>'
const roots = () => [feedIn, pbody]

function scrollDown() {
  for (const el of [feed, pbody]) el.scrollTop = el.scrollHeight
}

function hasConversation() {
  return feedIn.children.length > 0
}

function addRow(kind, fill) {
  const rows = roots().map((root) => {
    const row = document.createElement('div')
    row.className = `row ${kind}`
    if (kind === 'bot') row.innerHTML = `${LOGO}<div class="col"><div class="msg bot"></div></div>`
    else row.innerHTML = '<div class="msg user"></div>'
    fill(row.querySelector('.msg'), row)
    root.appendChild(row)
    return row
  })
  syncFab()
  scrollDown()
  return rows
}

function voiceBadge(msg) {
  const badge = document.createElement('span')
  badge.className = 'msg-voice'
  badge.textContent = T.voiceTag
  msg.appendChild(badge)
}

function addUser(text, voice) {
  return addRow('user', (msg) => {
    msg.textContent = text
    if (voice) voiceBadge(msg)
  })
}

function addBot(markdown) {
  return addRow('bot', (msg) => {
    msg.innerHTML = SDK.markdown(markdown)
  })
}

function addTyping() {
  return addRow('bot', (msg) => {
    msg.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>'
  })
}

function addNotice(text, withAlt) {
  return addRow('bot', (msg) => {
    msg.classList.add('err')
    msg.append(document.createTextNode(text))
    if (!withAlt) return
    msg.append(document.createTextNode(` ${T.alt} `))
    const trial = document.createElement('a')
    trial.href = signupUrl()
    trial.textContent = T.altTrial
    // LIC-3792: the team is reached through the conversation (handoff to a person), never through an e-mail
    const team = document.createElement('button')
    team.type = 'button'
    team.className = 'link'
    team.dataset.team = ''
    team.textContent = T.altTeam
    msg.append(trial, document.createTextNode(` ${T.or} `), team, document.createTextNode('.'))
  })
}

function actsHtml() {
  const trial = `<a class="act primary" href="${signupUrl()}"><span class="ico">🎁</span><span><b>${T.actTrial[0]}</b><small>${T.actTrial[1]}</small></span></a>`
  const voice = `<a class="act" href="#" data-voice><span class="ico">🎙️</span><span><b>${T.actVoice[0]}</b><small>${T.actVoice[1]}</small></span></a>`
  return `<div class="acts">${trial}${voice}</div>`
}

function clearActs() {
  for (const el of document.querySelectorAll('.acts')) el.remove()
}

// ---------------------------------------------------------------------------------------------------------------
// the answer being streamed

function startTurn() {
  endTurn()
  turn = { rows: addTyping(), text: '', timer: null, frame: 0 }
  turn.timer = setTimeout(() => {
    // The gateway never closed the turn: give the composer back instead of leaving the visitor stuck.
    finishTurn(true)
  }, TURN_TIMEOUT_MS)
}

function endTurn() {
  if (!turn) return
  clearTimeout(turn.timer)
  cancelAnimationFrame(turn.frame)
  turn = null
}

function paint() {
  if (!turn) return
  turn.frame = 0
  for (const row of turn.rows) {
    const msg = row.querySelector('.msg')
    msg.innerHTML = SDK.markdown(turn.text)
    if (msg.lastElementChild) msg.lastElementChild.classList.add('caret')
  }
  scrollDown()
}

function onDelta(event) {
  if (!event || typeof event.delta !== 'string') return
  if (stopping || ids.stale(event)) return
  if (!turn) startTurn()
  turn.text += event.delta
  if (!turn.frame) turn.frame = requestAnimationFrame(paint)
}

function finishTurn(silent) {
  if (!turn) {
    release()
    return
  }
  const { rows, text } = turn
  endTurn()
  if (!text.trim()) {
    for (const row of rows) row.remove()
  } else {
    for (const row of rows) {
      const msg = row.querySelector('.msg')
      msg.innerHTML = SDK.markdown(text)
      if (!silent) row.querySelector('.col').insertAdjacentHTML('beforeend', actsHtml())
    }
    // The cards only follow the last answer.
    const all = [...feedIn.querySelectorAll('.acts')]
    all.slice(0, -1).forEach((el) => el.remove())
    const inPanel = [...pbody.querySelectorAll('.acts')]
    inPanel.slice(0, -1).forEach((el) => el.remove())
  }
  release()
  syncFab()
  scrollDown()
}

function release() {
  busy = false
  stopping = false
  sending = null
  ids.drop()
  cycles.end()
  syncSend()
}

function onDone(event) {
  if (ids.stale(event)) return
  // a stopped answer keeps what was written but gets no follow-up cards
  finishTurn(stopping || !!(event && event.stopped))
}

async function stopTurn() {
  if (!busy || stopping) return
  stopping = true
  syncSend()
  if (turn) {
    cancelAnimationFrame(turn.frame)
    turn.frame = 0
  }
  const asked = sending
  const mine = () => stopping && sending === asked // `done` may already have closed it and a new question begun
  if (asked) await asked.catch(() => {})
  // right after send() the gateway may not have started the run yet: askStop asks once more before giving up
  const stopped = chat ? await askStop(() => chat.stop(), { stillMine: mine, retryMs: STOP_RETRY_MS }) : false
  if (!mine()) return
  // `done` (with `stopped`) closes the turn; if it never comes, close it here. Either way release() drops the
  // question's id, so whatever its run still streams stays off the screen.
  if (!stopped) finishTurn(true)
  else setTimeout(() => mine() && finishTurn(true), 5000)
}

function onSilentEnd(event) {
  if (ids.stale(event)) return
  if (!turn) return release()
  if (turn.text.trim()) return finishTurn(stopping)
  const rows = turn.rows
  endTurn()
  for (const row of rows) row.remove()
  if (event && event.reason === 'dropped') addNotice(T.dropped, false)
  release()
}

function onAttendant(event) {
  if (event && typeof event.text === 'string' && event.text) addBot(event.text)
}

function onError(event) {
  const code = event && event.code
  if (code === 'session_expired') {
    // the SDK renews the session on its own and keeps this client: dropping it would leave two streams open
    endTurn()
    addNotice(T.expired, false)
    release()
    return
  }
  if (code === 'rate_limited') {
    endTurn()
    addNotice(T.rateLimited, false)
    release()
  }
}

function fail(error) {
  endTurn()
  const code = error && error.code
  // Remove the typing dots that were waiting for an answer.
  for (const el of document.querySelectorAll('.typing')) {
    const row = el.closest('.row')
    if (row) row.remove()
  }
  if (code === 'rate_limited') addNotice(T.rateLimited, false)
  else addNotice(T.unavailable, true)
  release()
}

// ---------------------------------------------------------------------------------------------------------------
// stage: start → chat

function navHeight() {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'), 10) || 66
}

function toStage() {
  window.scrollTo({ top: Math.max(0, stage.offsetTop - navHeight()) })
}

function rememberMinimized(value) {
  minimized = value
  minimizedPref.write(value)
}

// The stage goes back to the start screen; the conversation stays in the corner bubble, closed.
function minimize() {
  if (!stage.classList.contains('is-chat') || stage.classList.contains('is-voice')) return
  rememberMinimized(true)
  const go = () => stage.classList.remove('is-chat')
  const shown = document.startViewTransition && !reduceMotion ? document.startViewTransition(go).finished : go()
  panel.classList.remove('open')
  window.scrollTo({ top: 0 })
  syncFab()
  // the button that was clicked is gone: the bubble takes the focus once it is on screen
  Promise.resolve(shown).catch(() => {}).then(() => fab.focus({ preventScroll: true }))
}

function enterChat(callback) {
  if (minimized) {
    rememberMinimized(false)
    syncFab()
  }
  const go = () => {
    stage.classList.add('is-chat')
    if (callback) callback()
  }
  window.scrollTo({ top: 0 })
  if (!stage.classList.contains('is-chat') && document.startViewTransition && !reduceMotion) {
    document.startViewTransition(go)
  } else {
    go()
  }
  setTimeout(toStage, 0)
}

function resetUi() {
  endTurn()
  feedIn.innerHTML = ''
  pbody.innerHTML = ''
  stage.classList.remove('is-chat', 'is-voice')
  rememberMinimized(false)
  mic.classList.remove('is-on')
  consent.hidden = true
  panel.classList.remove('open')
  fab.classList.remove('is-visible')
  q.value = ''
  autoGrow()
  release()
}

async function ask(text, fromPanel) {
  text = text.trim()
  if (!text || busy || booting) return
  busy = true
  syncSend()
  const go = () => {
    addUser(text)
    startTurn()
  }
  if (fromPanel) go()
  else enterChat(go)
  q.value = ''
  autoGrow()
  syncSend()
  const asked = getChat().then((client) => client.send(text))
  sending = asked
  try {
    const { messageId } = (await asked) || {}
    // closed before the gateway answered (timeout, reset): its run must not reach the screen either
    if (sending === asked) ids.start(messageId)
    else if (messageId) ids.drop(messageId)
  } catch (error) {
    if (!stopping) fail(error)
  }
}

// "Conversar com a equipe": opens the conversation and asks the product for a person. Nothing is typed or sent for
// the visitor; the gateway answers on the stream (queue notice, or the default no-attendant notice).
async function talkToTeam() {
  if (busy || booting) return
  busy = true
  const cycle = cycles.begin()
  syncSend()
  enterChat()
  try {
    const client = await getChat()
    await client.requestHuman()
    // a stop during the request already released it; a question asked since then must keep its answer
    if (cycles.owns(cycle)) release()
  } catch (error) {
    if (!cycles.owns(cycle)) return
    addNotice(error && error.code === 'rate_limited' ? T.rateLimited : T.unavailable, true)
    release()
  }
}

// ---------------------------------------------------------------------------------------------------------------
// composer

function autoGrow() {
  q.style.height = 'auto'
  q.style.height = q.value ? `${Math.min(q.scrollHeight, 160)}px` : ''
}

function syncSend() {
  // while the agent answers, the send button becomes the stop button (in the stage and in the bubble)
  const state = sendButtons({ busy, stopping, booting, hasText: !!q.value.trim() })
  for (const [button, { disabled }] of [[send, state.stage], [panelSend, state.panel]]) {
    button.classList.toggle('is-stop', state.face.stop)
    button.setAttribute('aria-label', T[state.face.label])
    if (state.face.stop) button.title = T.stop
    else button.removeAttribute('title')
    button.querySelector('use').setAttribute('href', state.face.icon)
    button.disabled = disabled
  }
}

function prewarm() {
  if (config.key && !chat) getChat().catch(() => {})
}

q.addEventListener('focus', prewarm, { once: true })
q.addEventListener('input', () => {
  autoGrow()
  syncSend()
})
q.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    ask(q.value, false)
  }
})
$('#composer').addEventListener('submit', (event) => {
  event.preventDefault()
  if (busy) stopTurn()
  else ask(q.value, false)
})
$('#pform').addEventListener('submit', (event) => {
  event.preventDefault()
  if (busy) return void stopTurn()
  const field = $('#pq')
  const text = field.value
  field.value = ''
  ask(text, true)
})
$('#pq').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    // Enter never stops an answer: only the button does
    if (!busy) $('#pform').requestSubmit()
  }
})
$('#mini').addEventListener('submit', (event) => {
  event.preventDefault()
  const field = $('#mini-q')
  ask(field.value || field.placeholder.replace(/^Ex\.:\s*/, ''), false)
  field.value = ''
})

document.addEventListener('click', (event) => {
  const asking = event.target.closest('[data-ask]')
  if (asking) {
    event.preventDefault()
    ask(asking.dataset.ask, !!asking.closest('.panel'))
    return
  }
  const voice = event.target.closest('[data-voice]')
  if (voice) {
    event.preventDefault()
    askConsent()
    return
  }
  if (event.target.closest('[data-team]')) {
    event.preventDefault()
    talkToTeam()
  }
})

$('#new-chat').addEventListener('click', async () => {
  if (chat) {
    try {
      await chat.voice.stop()
      await chat.newConversation()
    } catch {
      // the server is still on the old conversation: do not pretend it started from scratch
      addNotice(T.unavailable, true)
      return
    }
  }
  resetUi()
  q.focus()
})

// Placeholder that rotates through examples (only on the start screen, with the field empty and unfocused).
let placeholderIndex = 0
setInterval(() => {
  if (document.activeElement === q || q.value || stage.classList.contains('is-chat')) return
  placeholderIndex = (placeholderIndex + 1) % PLACEHOLDERS.length
  q.placeholder = PLACEHOLDERS[placeholderIndex]
}, 3200)

// ---------------------------------------------------------------------------------------------------------------
// bubble: shows up when there is a conversation and the stage left the screen or was minimized

function syncFab() {
  const state = bubble({ hasConversation: hasConversation(), minimized, stageVisible })
  fab.classList.toggle('is-visible', state.visible)
  fab.classList.toggle('is-low', state.low)
  if (state.closePanel) panel.classList.remove('open')
}

new IntersectionObserver(
  ([entry]) => {
    stageVisible = entry.intersectionRatio > 0.15
    syncFab()
  },
  { threshold: [0, 0.15, 0.5] },
).observe(stage)

fab.addEventListener('click', () => {
  panel.classList.toggle('open')
  fabBadge.hidden = true
  scrollDown()
})
$('#p-close').addEventListener('click', () => panel.classList.remove('open'))
$('#p-expand').addEventListener('click', () => {
  panel.classList.remove('open')
  if (minimized) return enterChat(scrollDown)
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
})
$('#minimize').addEventListener('click', minimize)
$('#p-mic').addEventListener('click', () => {
  panel.classList.remove('open')
  askConsent()
})

// ---------------------------------------------------------------------------------------------------------------
// voice — nothing starts without an explicit yes

function askConsent() {
  if (chat && chat.voice.state !== 'idle') return
  enterChat(() => {
    consent.hidden = false
    $('#consent-yes').focus({ preventScroll: true })
  })
  prewarm()
}

$('#mic').addEventListener('click', askConsent)
$('#consent-no').addEventListener('click', () => {
  consent.hidden = true
})
$('#consent-yes').addEventListener('click', async () => {
  consent.hidden = true
  voiceLabel.textContent = T.voiceConnecting
  stage.classList.add('is-voice')
  mic.classList.add('is-on')
  try {
    const client = await getChat()
    await client.voice.start({ consent: true })
  } catch (error) {
    // `voice.error` carries the message; a connection failure before the call gets the generic one.
    if (!error || !String(error.code || '').startsWith('voice') && !String(error.code || '').startsWith('mic')) {
      addNotice(T.voiceFailed, false)
    }
    // a second click while a call is live must not tear that call's UI down
    if (!error || error.code !== 'voice_busy') stopVoiceUi()
  }
})
muteButton.addEventListener('click', async () => {
  if (!chat) return
  muted = !muted
  await chat.voice.setMuted(muted).catch(() => {})
  muteButton.textContent = muted ? T.unmute : T.mute
})
$('#end-call').addEventListener('click', () => {
  if (chat) chat.voice.stop().catch(() => {})
  stopVoiceUi()
})

function tickVoice() {
  const seconds = Math.max(0, Math.floor((Date.now() - voiceSince) / 1000))
  voiceTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function stopVoiceUi() {
  clearInterval(voiceTimer)
  voiceTimer = null
  muted = false
  muteButton.textContent = T.mute
  stage.classList.remove('is-voice')
  mic.classList.remove('is-on')
  transcripts.clear()
}

function onVoiceState(event) {
  if (event.state === 'connected') {
    voiceLabel.textContent = T.voiceLive
    voiceSince = Date.now()
    tickVoice()
    clearInterval(voiceTimer)
    voiceTimer = setInterval(tickVoice, 1000)
  } else if (event.state === 'idle') {
    stopVoiceUi()
  }
}

function onVoiceError(event) {
  const messages = {
    mic_denied: T.micDenied,
    mic_unavailable: T.micMissing,
    voice_disabled: T.voiceOff,
    voice_unavailable: T.voiceOff,
    voice_busy: T.voiceBusy,
  }
  addNotice(messages[event.code] || T.voiceFailed, false)
  if (event.code !== 'voice_busy') stopVoiceUi()
}

function onTranscript(event) {
  if (!event || typeof event.text !== 'string' || !event.text.trim()) return
  const known = transcripts.get(event.id)
  if (known) {
    for (const row of known) {
      const msg = row.querySelector('.msg')
      msg.textContent = event.text
      voiceBadge(msg)
    }
    scrollDown()
    return
  }
  const fill = (msg) => {
    msg.textContent = event.text
    voiceBadge(msg)
  }
  const rows = event.speaker === 'user' ? addRow('user', fill) : addRow('bot', fill)
  transcripts.set(event.id, rows)
}

// ---------------------------------------------------------------------------------------------------------------
// mobile menu

const nav = $('header.nav')
$('.nav-burger').addEventListener('click', () => {
  const open = nav.classList.toggle('open')
  $('.nav-burger').setAttribute('aria-expanded', String(open))
})
nav.addEventListener('click', (event) => {
  if (event.target.closest('.nav-links a')) nav.classList.remove('open')
})

// ---------------------------------------------------------------------------------------------------------------
// boot: a visitor who already talked comes back to the same conversation

function rowsFromHistory(messages) {
  const list = [...messages]
  if (list.length > 1 && list.every((m) => m && m.createdAt)) list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  for (const message of list) {
    const text = message && typeof (message.text ?? message.content) === 'string' ? message.text ?? message.content : ''
    if (!text.trim()) continue
    const fromVisitor = message.origin === 'customer' || message.origin === 'visitor' || message.role === 'user'
    if (fromVisitor) addUser(text, false)
    else addBot(text)
  }
}

async function boot() {
  if (!config.key) return
  let stored = false
  try {
    stored = !!localStorage.getItem(`lab019:session:${config.key}`)
  } catch {
    /* storage blocked: the visitor starts fresh */
  }
  if (!stored) return
  booting = true
  syncSend()
  try {
    const client = await getChat()
    const page = await client.history({ limit: 50 })
    await loadSdk()
    if (page && Array.isArray(page.messages) && page.messages.length) {
      if (minimizedPref.read()) minimized = true
      else stage.classList.add('is-chat')
      rowsFromHistory(page.messages)
      clearActs()
      scrollDown()
      syncFab()
    }
  } catch {
    /* no history: the start screen stays as it is */
  } finally {
    booting = false
    syncSend()
  }
}

boot()
