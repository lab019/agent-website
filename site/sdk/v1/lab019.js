/*!
 * Lab019 SDK v1 — your own chat UI on top of a Lab019 agent, from the browser.
 *
 * ES module, no dependencies (LiveKit is loaded lazily, only when the visitor starts a voice call), no UI and no
 * fixed phrase: the page owns every label. Errors carry a stable `code`; the page decides what to say.
 *
 *   import Lab019 from 'https://lab019.ai/sdk/v1/lab019.js'
 *   const chat = await Lab019.connect({ key: 'wgt_…' })
 *   chat.on('message_delta', ({ delta }) => append(delta))
 *   await chat.send('Hello')
 *
 * Contract: https://docs.lab019.ai/guias/sdk-chat-no-site
 */

const DEFAULT_BASE_URL = 'https://api.lab019.ai/gateway/v1/public'
const STORAGE_PREFIX = 'lab019:session:'
const LIVEKIT_URL = 'https://cdn.jsdelivr.net/npm/livekit-client@2.20.0/dist/livekit-client.umd.min.js'
const LIVEKIT_SRI = 'sha384-s/eoT8qpr81c6c9MG5V7GA5xi5IzfEUQLyk3liFfzu9seBzZ3beFVjsD3pXTRmUc'
const SEEN_LIMIT = 500
const SEND_ATTEMPTS = 4
const RETRYABLE_STATUS = new Set([502, 503, 504])
const REQUEST_TIMEOUT_MS = 30000

/** Short non-reversible tag of the visitor token, to tell sessions apart without keeping the token in storage. */
function fingerprint(token) {
  if (!token) return null
  let h = 5381
  for (let i = 0; i < token.length; i++) h = ((h * 33) ^ token.charCodeAt(i)) >>> 0
  return h.toString(16)
}

// ---------------------------------------------------------------------------------------------------------------
// errors

class Lab019Error extends Error {
  constructor(code, details = {}) {
    super(code)
    this.name = 'Lab019Error'
    this.code = code
    if (details.status !== undefined) this.status = details.status
    if (details.retryAfter !== undefined) this.retryAfter = details.retryAfter
    if (details.cause !== undefined) this.cause = details.cause
  }
}

async function errorFromResponse(res) {
  let code = `http_${res.status}`
  try {
    const body = await res.json()
    const found = body && (body.code || body.errorCode || (body.error && (body.error.code || body.error)))
    if (typeof found === 'string' && found) code = found
  } catch {
    /* no JSON body */
  }
  if (res.status === 401 && code === 'http_401') code = 'session_expired'
  const details = { status: res.status }
  if (res.status === 429) {
    code = code === 'http_429' ? 'rate_limited' : code
    const secs = Number(res.headers.get('retry-after'))
    if (Number.isFinite(secs)) details.retryAfter = secs
  }
  return new Lab019Error(code, details)
}

// ---------------------------------------------------------------------------------------------------------------
// small helpers

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function uuid() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && c.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function encodeFile(file) {
  if (file && typeof file.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { name: file.name || 'file', mediaType: file.type || 'application/octet-stream', data: toBase64(bytes) }
  }
  const name = (file && file.name) || 'file'
  const mediaType = (file && (file.mediaType || file.type)) || 'application/octet-stream'
  if (file && typeof file.data === 'string') return { name, mediaType, data: file.data }
  const raw = file && file.bytes
  if (raw instanceof ArrayBuffer) return { name, mediaType, data: toBase64(new Uint8Array(raw)) }
  if (raw && raw.buffer instanceof ArrayBuffer) {
    return { name, mediaType, data: toBase64(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)) }
  }
  throw new Lab019Error('invalid_file')
}

function defaultStorage() {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------------------------
// server-sent events over fetch (EventSource cannot send the Authorization header)

async function readEvents(body, onFrame, onActivity) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    onActivity()
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
    let cut
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const frame = parseFrame(raw)
      if (frame) onFrame(frame)
    }
  }
}

function parseFrame(raw) {
  let event = 'message'
  let id
  const data = []
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const at = line.indexOf(':')
    const field = at === -1 ? line : line.slice(0, at)
    const value = at === -1 ? '' : line.slice(at + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'id') id = value
    else if (field === 'data') data.push(value)
  }
  if (!data.length && id === undefined) return null
  const text = data.join('\n')
  let payload = text
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    /* keep the raw text */
  }
  return { event, id, data: payload }
}

// ---------------------------------------------------------------------------------------------------------------
// client

class Client {
  constructor(opts) {
    this.key = opts.key
    this.baseUrl = opts.baseUrl
    this.visitorToken = opts.visitorToken
    this.storage = opts.storage
    this.reconnect = opts.reconnect
    this.idleTimeout = opts.idleTimeout
    this.runtime = opts.runtime || {}
    this.config = {}
    this.visitor = { identified: false }
    this.sessionToken = null
    this.sessionId = null
    this.conversationId = null
    this.lastEventId = null
    this.connection = 'closed'
    this._listeners = new Map()
    this._seen = new Set()
    this._closed = false
    this._gen = 0
    this._abort = null
    this._wake = null
    this._renewing = null
    this.voice = new Voice(this)
  }

  // -- events -----------------------------------------------------------------------------------------------------

  on(name, fn) {
    if (typeof fn !== 'function') return () => {}
    if (!this._listeners.has(name)) this._listeners.set(name, new Set())
    this._listeners.get(name).add(fn)
    return () => this.off(name, fn)
  }

  off(name, fn) {
    const set = this._listeners.get(name)
    if (set) set.delete(fn)
  }

  _emit(name, data) {
    const run = (fn, ...args) => {
      try {
        fn(...args)
      } catch (err) {
        if (globalThis.console && console.error) console.error(err)
      }
    }
    const named = this._listeners.get(name)
    if (named) for (const fn of [...named]) run(fn, data)
    const all = this._listeners.get('*')
    if (all) for (const fn of [...all]) run(fn, name, data)
  }

  _setConnection(state) {
    if (this.connection === state) return
    this.connection = state
    this._emit('connection', { state })
  }

  // -- storage ----------------------------------------------------------------------------------------------------

  get _storageKey() {
    return STORAGE_PREFIX + this.key
  }

  _load() {
    if (!this.storage) return null
    try {
      const saved = JSON.parse(this.storage.getItem(this._storageKey))
      return saved && typeof saved.sessionToken === 'string' ? saved : null
    } catch {
      return null
    }
  }

  _persist() {
    if (!this.storage) return
    try {
      this.storage.setItem(
        this._storageKey,
        JSON.stringify({
          sessionToken: this.sessionToken,
          sessionId: this.sessionId,
          conversationId: this.conversationId,
          lastEventId: this.lastEventId,
          visitor: fingerprint(this.visitorToken),
        }),
      )
    } catch {
      /* storage blocked or full: the chat still works for this page view */
    }
  }

  _forget() {
    if (!this.storage) return
    try {
      this.storage.removeItem(this._storageKey)
    } catch {
      /* ignore */
    }
  }

  // -- http -------------------------------------------------------------------------------------------------------

  async _fetch(url, init) {
    try {
      return await fetch(url, init)
    } catch (err) {
      if (err && err.name === 'AbortError') throw err
      throw new Lab019Error('network_error', { cause: err })
    }
  }

  async _call(method, path, { body, headers, query } = {}, renewed = false) {
    const qs = query ? '?' + new URLSearchParams(query).toString() : ''
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
    let res
    try {
      res = await this._fetch(this.baseUrl + path + qs, {
        method,
        headers: {
          authorization: `Bearer ${this.sessionToken}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: abort.signal,
      })
    } catch (err) {
      // a stalled request is a lost one: surface it as a network error so a write can be retried with its key
      if (err && err.name === 'AbortError') throw new Lab019Error('network_error', { cause: err })
      throw err
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 401 && !renewed && !this._closed) {
      // the token died between stream reconnects: renew once and replay the call
      await this._renew()
      return this._call(method, path, { body, headers, query }, true)
    }
    if (!res.ok) throw await errorFromResponse(res)
    return res
  }

  async _json(method, path, opts) {
    const res = await this._call(method, path, opts)
    return res.status === 204 ? {} : res.json()
  }

  /** A write that may be retried: same idempotency key, so the gateway runs it once. */
  async _idempotent(path, body) {
    const key = uuid()
    let last
    for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt++) {
      try {
        return await this._json('POST', path, { body, headers: { 'x-idempotency-key': key } })
      } catch (err) {
        last = err
        const retry = err.code === 'network_error' || RETRYABLE_STATUS.has(err.status)
        if (!retry || this._closed) throw err
        await sleep(Math.min(this.reconnect.minDelay * 2 ** attempt, this.reconnect.maxDelay))
      }
    }
    throw last
  }

  // -- session ----------------------------------------------------------------------------------------------------

  async _init() {
    let saved = this._load()
    // a session belongs to whoever opened it: another visitor (or a login/logout) must never inherit it
    if (saved && (saved.visitor || null) !== fingerprint(this.visitorToken)) {
      this._forget()
      saved = null
    }
    if (saved) {
      this.sessionToken = saved.sessionToken
      this.sessionId = saved.sessionId || null
      this.conversationId = saved.conversationId || null
      this.lastEventId = saved.lastEventId || null
      if (this.lastEventId) this._remember(this.lastEventId)
      const [ok] = await Promise.all([this._validate(), this._loadConfig()])
      if (!ok) await this._openSession()
    } else {
      await Promise.all([this._openSession(), this._loadConfig()])
    }
    this._persist()
    this._start()
  }

  async _validate() {
    try {
      const page = await this._json('GET', '/conversations/me/messages', { query: { limit: 1 } })
      if (page && page.conversationId) this.conversationId = page.conversationId
      return true
    } catch (err) {
      if (err.status === 401 || err.status === 404) return false
      return true // offline or a hiccup: keep the session, the stream will find out
    }
  }

  async _loadConfig() {
    try {
      const res = await this._fetch(`${this.baseUrl}/config`, { headers: { 'x-publishable-key': this.key } })
      if (res.ok) this.config = await res.json()
    } catch {
      /* the chat works without it */
    }
  }

  async _openSession() {
    const body = this.visitorToken ? { visitorToken: this.visitorToken } : {}
    const res = await this._fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-publishable-key': this.key },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await errorFromResponse(res)
    const s = await res.json()
    this.sessionToken = s.sessionToken
    this.sessionId = s.sessionId
    this.conversationId = s.conversationId
    this.visitor = s.visitor || { identified: false }
    this.lastEventId = null
    this._seen.clear()
    this._persist()
    this._emit('session', { sessionId: this.sessionId, conversationId: this.conversationId, visitor: this.visitor })
  }

  /** One renewal at a time, even when the stream and a request notice the expiry together. */
  _renew() {
    if (!this._renewing) {
      this._forget()
      this._emit('error', { code: 'session_expired' })
      this._renewing = this._openSession().finally(() => {
        this._renewing = null
      })
    }
    return this._renewing
  }

  // -- stream -----------------------------------------------------------------------------------------------------

  _start() {
    if (this._closed) return
    this._gen++
    if (this._abort) this._abort.abort()
    this._run(this._gen)
  }

  _remember(id) {
    this._seen.add(id)
    if (this._seen.size > SEEN_LIMIT) this._seen.delete(this._seen.values().next().value)
  }

  _dispatch(frame) {
    if (frame.id !== undefined) {
      if (this._seen.has(frame.id)) return // replayed after a reconnect
      this._remember(frame.id)
      this.lastEventId = frame.id
      this._persist()
    }
    if (frame.event === 'conversation_rolled' && frame.data && frame.data.conversationId) {
      this.conversationId = frame.data.conversationId
      this._persist()
    }
    this._emit(frame.event, frame.data)
  }

  async _run(gen) {
    let attempt = 0
    while (!this._closed && gen === this._gen) {
      const abort = new AbortController()
      this._abort = abort
      let idle
      const arm = () => {
        clearTimeout(idle)
        idle = setTimeout(() => abort.abort(), this.idleTimeout)
      }
      try {
        arm()
        const res = await this._fetch(`${this.baseUrl}/conversations/me/events`, {
          headers: {
            authorization: `Bearer ${this.sessionToken}`,
            accept: 'text/event-stream',
            ...(this.lastEventId ? { 'last-event-id': this.lastEventId } : {}),
          },
          signal: abort.signal,
        })
        if (res.status === 401 || res.status === 404) {
          clearTimeout(idle)
          await this._renew().catch(() => {})
          if (gen !== this._gen || this._closed) return
          // a renewal that keeps failing backs off like any other reconnect instead of hammering the gateway
          this._setConnection('reconnecting')
          const wait = Math.min(this.reconnect.minDelay * 2 ** attempt++, this.reconnect.maxDelay)
          await this._pause(wait * (0.75 + Math.random() * 0.5))
          continue
        }
        if (!res.ok || !res.body) throw await errorFromResponse(res)
        attempt = 0
        this._setConnection('connected')
        await readEvents(res.body, (frame) => gen === this._gen && this._dispatch(frame), arm)
      } catch (err) {
        if (this._closed || gen !== this._gen) return
        void err
      } finally {
        clearTimeout(idle)
      }
      if (this._closed || gen !== this._gen) return
      this._setConnection('reconnecting')
      const delay = Math.min(this.reconnect.minDelay * 2 ** attempt++, this.reconnect.maxDelay)
      await this._pause(delay * (0.75 + Math.random() * 0.5))
    }
  }

  /** Sleep that the browser coming back online (or disconnect) cuts short. */
  _pause(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms)
      const onOnline = () => done()
      function done() {
        clearTimeout(timer)
        if (globalThis.removeEventListener) globalThis.removeEventListener('online', onOnline)
        resolve()
      }
      this._wake = done
      if (globalThis.addEventListener) globalThis.addEventListener('online', onOnline)
    })
  }

  // -- public api -------------------------------------------------------------------------------------------------

  async send(text, { files } = {}) {
    const body = {}
    body.text = typeof text === 'string' ? text : ''
    if (files && files.length) body.attachments = await Promise.all(files.map(encodeFile))
    if (!body.text && !body.attachments) throw new Lab019Error('empty_message')
    const out = await this._idempotent('/conversations/me/messages', body)
    return { messageId: out.messageId }
  }

  /**
   * Answer a tool approval. `interrupt` is the id the `interrupt` event carried (or the event itself);
   * `decision` is one decision object or an array of them.
   */
  async approve(interrupt, decision) {
    const messageId = interrupt && typeof interrupt === 'object' ? interrupt.messageId || interrupt.interruptId : interrupt
    const decisions = Array.isArray(decision) ? decision : [decision]
    return this._idempotent('/conversations/me/resume', { messageId, decisions })
  }

  stop() {
    return this._json('POST', '/conversations/me/stop')
  }

  /**
   * Ask for a person without typing anything: the product flow hands the conversation to the human queue.
   * No text goes out on the visitor's behalf; the gateway answers 202 with `{ outcome }` — `requested`,
   * `already` or `unavailable` (the default no-attendant notice then arrives on the event stream).
   */
  requestHuman() {
    return this._json('POST', '/conversations/me/handoff')
  }

  async history({ limit, before } = {}) {
    const query = {}
    if (limit !== undefined) query.limit = String(limit)
    if (before !== undefined) query.before = String(before)
    const page = await this._json('GET', '/conversations/me/messages', { query })
    if (page && page.conversationId) this.conversationId = page.conversationId
    return page
  }

  conversations() {
    return this._json('GET', '/conversations/me/conversations')
  }

  async newConversation() {
    const out = await this._json('POST', '/conversations/me/new')
    this.conversationId = out.conversationId
    this.lastEventId = null
    this._seen.clear()
    this._persist()
    this._start() // re-bind the stream to the new conversation
    return out
  }

  /** A file the agent produced: the bytes, as a Blob (the route needs the session token). */
  async artifact(artifactId) {
    const res = await this._call('GET', `/conversations/me/artifacts/${encodeURIComponent(artifactId)}`)
    return res.blob()
  }

  /** Close the stream. The stored session stays, so the next `connect` picks the conversation back up. */
  disconnect() {
    this._closed = true
    this._gen++
    if (this._abort) this._abort.abort()
    if (this._wake) this._wake()
    this.voice.stop().catch(() => {})
    this._setConnection('closed')
  }
}

// ---------------------------------------------------------------------------------------------------------------
// voice (LiveKit, loaded on the first call)

let livekitPromise = null

function loadLiveKit() {
  if (globalThis.LivekitClient) return Promise.resolve(globalThis.LivekitClient)
  if (!livekitPromise) {
    livekitPromise = new Promise((resolve, reject) => {
      if (typeof document === 'undefined') return reject(new Lab019Error('voice_unavailable'))
      const script = document.createElement('script')
      script.src = LIVEKIT_URL
      script.integrity = LIVEKIT_SRI
      script.crossOrigin = 'anonymous'
      script.async = true
      script.onload = () => (globalThis.LivekitClient ? resolve(globalThis.LivekitClient) : reject(new Lab019Error('voice_unavailable')))
      script.onerror = () => reject(new Lab019Error('voice_unavailable'))
      document.head.appendChild(script)
    }).catch((err) => {
      livekitPromise = null
      throw err
    })
  }
  return livekitPromise
}

class Voice {
  constructor(client) {
    this._client = client
    this._room = null
    this._epoch = 0
    this._audio = new Map()
    this.state = 'idle'
  }

  _set(state) {
    if (this.state === state) return
    this.state = state
    this._client._emit('voice.state', { state })
  }

  /** Must be called from a user gesture (a click): that is when the browser asks for the microphone. */
  async start({ consent } = {}) {
    if (consent !== true) throw new Lab019Error('consent_required')
    if (this.state !== 'idle') throw new Lab019Error('voice_busy')
    const client = this._client
    const epoch = ++this._epoch
    this._set('connecting')
    try {
      await this._ensureMic()
      const grant = await client._json('POST', '/conversations/me/voice-session', { body: { consent: true } })
      if (epoch !== this._epoch) return
      const lk = await (client.runtime.loadLiveKit || loadLiveKit)()
      if (epoch !== this._epoch) return
      const room = new lk.Room({ adaptiveStream: true, dynacast: true })
      this._room = room
      this._wire(room, lk, epoch)
      await room.connect(grant.livekit_url, grant.livekit_token)
      if (epoch !== this._epoch) return await room.disconnect()
      if (typeof room.startAudio === 'function') await room.startAudio().catch(() => {})
      await room.localParticipant.setMicrophoneEnabled(true)
      if (epoch !== this._epoch) return
      this._set('connected')
    } catch (err) {
      if (epoch === this._epoch) await this._teardown()
      const error = err instanceof Lab019Error ? err : new Lab019Error('voice_failed', { cause: err })
      if (error.status === 403 && error.code === 'http_403') error.code = 'voice_disabled'
      client._emit('voice.error', { code: error.code })
      throw error
    }
  }

  async _ensureMic() {
    const getUserMedia =
      this._client.runtime.getUserMedia ||
      (globalThis.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices))
    if (!getUserMedia) throw new Lab019Error('mic_unavailable')
    let stream
    try {
      stream = await getUserMedia({ audio: true })
    } catch (err) {
      throw new Lab019Error('mic_denied', { cause: err })
    }
    if (stream && stream.getTracks) stream.getTracks().forEach((t) => t.stop())
  }

  _wire(room, lk, epoch) {
    const E = lk.RoomEvent || {}
    const on = (name, fn) => room.on(name, (...args) => epoch === this._epoch && fn(...args))
    on(E.TrackSubscribed, (track) => {
      if (!track || track.kind !== 'audio' || typeof document === 'undefined') return
      const el = track.attach()
      el.style.display = 'none'
      document.body.appendChild(el)
      this._audio.set(track.sid, el)
    })
    on(E.TrackUnsubscribed, (track) => {
      const el = track && this._audio.get(track.sid)
      if (!el) return
      track.detach(el)
      el.remove()
      this._audio.delete(track.sid)
    })
    on(E.TranscriptionReceived, (segments, participant) => {
      const speaker = participant && participant.isLocal ? 'user' : 'agent'
      for (const seg of segments || []) {
        this._client._emit('voice.transcript', { id: seg.id, speaker, text: seg.text, final: seg.final !== false })
      }
    })
    on(E.Disconnected, () => this._teardown())
  }

  setMuted(muted) {
    if (this._room && this._room.localParticipant) return this._room.localParticipant.setMicrophoneEnabled(!muted)
    return Promise.resolve()
  }

  /** Call from a gesture when the browser blocked autoplay of the agent's voice. */
  async unlockAudio() {
    if (this._room && typeof this._room.startAudio === 'function') await this._room.startAudio()
  }

  async stop() {
    this._epoch++
    await this._teardown()
  }

  async _teardown() {
    const room = this._room
    this._room = null
    for (const el of this._audio.values()) el.remove()
    this._audio.clear()
    if (room) {
      try {
        await room.disconnect()
      } catch {
        /* already gone */
      }
    }
    this._set('idle')
  }
}

// ---------------------------------------------------------------------------------------------------------------
// markdown → safe HTML string (the subset chat.js renders; model output never reaches innerHTML unescaped)

const MD_SAFE_LINK = /^(?:https?:|mailto:)/i
const MD_FENCE = /^\s*```/
const MD_FENCE_CLOSE = /^\s*```\s*$/
const MD_HEADING = /^(#{1,6})\s+(.*)$/
const MD_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const MD_QUOTE = /^\s*>\s?(.*)$/
const MD_BULLET = /^(\s*)[-*+]\s+(.*)$/
const MD_ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const MD_BLANK = /^\s*$/
const MD_ESCAPE = /\\([\\`*_[\]()#+\-.!~>])/
const MD_CODE = /`([^`\n]+)`/
const MD_BOLD = /\*\*((?:[^*]|\*(?!\*))+)\*\*/
const MD_STRIKE = /~~([^~\n]+)~~/
const MD_ITALIC = /\*([^*\n]+)\*/
const MD_LINK = /\[([^\]\n]*)\]\(([^()\s]+)\)/
const MD_AUTOLINK = /https?:\/\/[^\s<>]+/
const MD_TRAILING_PUNCT = /[.,;:!?'"]+$/

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])

const anchor = (href, inner) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`

function countChar(str, ch) {
  let n = 0
  for (let i = 0; i < str.length; i++) if (str.charAt(i) === ch) n++
  return n
}

function inline(text) {
  let out = ''
  let rest = text
  while (rest.length > 0) {
    let best = null
    const consider = (m, length, render) => {
      if (!m || length <= 0) return
      if (best && m.index >= best.index) return
      best = { index: m.index, length, render }
    }
    const esc = MD_ESCAPE.exec(rest)
    consider(esc, esc ? esc[0].length : 0, () => escapeHtml(esc[1]))
    const code = MD_CODE.exec(rest)
    consider(code, code ? code[0].length : 0, () => `<code>${escapeHtml(code[1])}</code>`)
    const bold = MD_BOLD.exec(rest)
    consider(bold, bold ? bold[0].length : 0, () => `<strong>${inline(bold[1])}</strong>`)
    const strike = MD_STRIKE.exec(rest)
    consider(strike, strike ? strike[0].length : 0, () => `<del>${inline(strike[1])}</del>`)
    const italic = MD_ITALIC.exec(rest)
    consider(italic, italic ? italic[0].length : 0, () => `<em>${inline(italic[1])}</em>`)
    const link = MD_LINK.exec(rest)
    consider(link, link ? link[0].length : 0, () =>
      MD_SAFE_LINK.test(link[2]) ? anchor(link[2], inline(link[1])) : escapeHtml(link[0]),
    )
    const auto = MD_AUTOLINK.exec(rest)
    let autoUrl = auto ? auto[0] : ''
    if (auto) {
      autoUrl = autoUrl.replace(MD_TRAILING_PUNCT, '')
      while (autoUrl.charAt(autoUrl.length - 1) === ')' && countChar(autoUrl, '(') < countChar(autoUrl, ')')) {
        autoUrl = autoUrl.slice(0, -1).replace(MD_TRAILING_PUNCT, '')
      }
    }
    consider(auto, autoUrl.length, () => anchor(autoUrl, escapeHtml(autoUrl)))

    if (!best) return out + escapeHtml(rest)
    if (best.index > 0) out += escapeHtml(rest.slice(0, best.index))
    out += best.render()
    rest = rest.slice(best.index + best.length)
  }
  return out
}

function list(lines, start) {
  const first = MD_BULLET.exec(lines[start]) || MD_ORDERED.exec(lines[start])
  const ordered = MD_ORDERED.test(lines[start])
  const baseIndent = first[1].length
  let startAttr = ''
  if (ordered) {
    const startNum = parseInt(MD_ORDERED.exec(lines[start])[2], 10)
    if (startNum !== 1) startAttr = ` start="${startNum}"`
  }
  const items = [] // { html, nested: [] }
  let nested = []
  const flushNested = () => {
    if (nested.length && items.length) items[items.length - 1].html += blocks(nested.join('\n'))
    nested = []
  }
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (MD_BLANK.test(line)) break
    const item = MD_BULLET.exec(line) || MD_ORDERED.exec(line)
    if (item) {
      if (item[1].length > baseIndent) {
        nested.push(line)
        i++
        continue
      }
      if (MD_ORDERED.test(line) !== ordered) break
      flushNested()
      items.push({ html: inline(item[item.length - 1]) })
      i++
      continue
    }
    if (items.length) {
      if (nested.length) nested.push(line)
      else items[items.length - 1].html += '<br>' + inline(line.replace(/^\s+/, ''))
      i++
      continue
    }
    break
  }
  flushNested()
  const tag = ordered ? 'ol' : 'ul'
  return { html: `<${tag}${startAttr}>${items.map((it) => `<li>${it.html}</li>`).join('')}</${tag}>`, next: i }
}

function blocks(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let out = ''
  let para = []
  const flushPara = () => {
    if (para.length) out += `<p>${para.map(inline).join('<br>')}</p>`
    para = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (MD_FENCE.test(line)) {
      flushPara()
      i++
      const code = []
      while (i < lines.length && !MD_FENCE_CLOSE.test(lines[i])) code.push(lines[i++])
      i++
      out += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`
      continue
    }
    const heading = MD_HEADING.exec(line)
    if (heading) {
      flushPara()
      out += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`
      i++
      continue
    }
    if (MD_HR.test(line)) {
      flushPara()
      out += '<hr>'
      i++
      continue
    }
    if (MD_QUOTE.test(line)) {
      flushPara()
      const inner = []
      for (let q; i < lines.length && (q = MD_QUOTE.exec(lines[i])); i++) inner.push(q[1])
      out += `<blockquote>${blocks(inner.join('\n'))}</blockquote>`
      continue
    }
    if (MD_BULLET.test(line) || MD_ORDERED.test(line)) {
      flushPara()
      const l = list(lines, i)
      out += l.html
      i = l.next
      continue
    }
    if (MD_BLANK.test(line)) {
      flushPara()
      i++
      continue
    }
    para.push(line)
    i++
  }
  flushPara()
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// entry point

const Lab019 = {
  /**
   * Open (or resume) the visitor's session and start the live stream.
   * @param {{key: string, visitorToken?: string, baseUrl?: string, storage?: Storage|null}} options
   */
  async connect(options = {}) {
    const { key, visitorToken, baseUrl = DEFAULT_BASE_URL, reconnect, idleTimeout, runtime } = options
    if (!key || typeof key !== 'string') throw new Lab019Error('key_required')
    const client = new Client({
      key,
      visitorToken,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      storage: options.storage === undefined ? defaultStorage() : options.storage,
      reconnect: { minDelay: 500, maxDelay: 15000, ...reconnect },
      idleTimeout: idleTimeout || 45000,
      runtime,
    })
    await client._init()
    return client
  },

  /** Markdown → HTML string, safe to assign to innerHTML: raw HTML is escaped, links are http(s)/mailto only. */
  markdown(text) {
    return typeof text === 'string' && text ? blocks(text) : ''
  },
}

export { Lab019, Lab019Error }
export default Lab019
