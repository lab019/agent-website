// Local stand-in for the browser mode of the public API (LIC-3776), built from section 3 of the spec.
// It records every request so the tests can assert the SDK's contract (headers, bodies, idempotency).
import http from 'node:http'

export async function startGateway(opts = {}) {
  const state = {
    requests: [], // { method, path, query, headers, body }
    sessions: new Map(), // wst_ -> { sessionId, conversationId }
    seq: 0,
    sessionCount: 0,
    events: [], // { id, event, data }
    streams: new Set(), // open SSE responses
    sockets: new Set(),
    messagesByKey: new Map(), // idempotency key -> messageId
    turnsRun: 0,
    history: [],
    config: { title: 'Agent', channels: ['text', 'voice'], media_input: { enabled: true }, ...opts.config },
    failSendAfterProcessing: 0, // number of POST /messages to kill AFTER the turn was recorded
    expireTokens: false,
    sessionStatus: 201, // set to 503 to make every new session fail
    replayInclusive: false,
    voiceStatus: 200,
    sendStatus: 202,
    sendFailures: 0, // times to answer 503 before succeeding
  }

  const nextId = () => `${1754487641000 + state.seq}-${state.seq++ % 1}`

  function emit(event, data, { withId = true } = {}) {
    const id = withId ? `${1754487641000 + state.seq++}-0` : undefined
    const rec = { id, event, data }
    if (withId) state.events.push(rec)
    for (const res of state.streams) writeEvent(res, rec)
    return rec
  }

  function writeEvent(res, rec) {
    if (res.destroyed || res.writableEnded) return
    res.write(`${rec.id ? `id: ${rec.id}\n` : ''}event: ${rec.event}\ndata: ${JSON.stringify(rec.data)}\n\n`)
  }

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...headers })
    res.end(JSON.stringify(body))
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      let body = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = raw
      }
      const path = url.pathname.replace(/^\/v1\/public/, '')
      state.requests.push({
        method: req.method,
        path,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
      })

      if (req.method === 'OPTIONS') return json(res, 204, {})

      if (path === '/config' && req.method === 'GET') {
        if (!req.headers['x-publishable-key']) return json(res, 404, { error: 'not_found' })
        return json(res, 200, state.config)
      }
      if (path === '/sessions' && req.method === 'POST') {
        if (!req.headers['x-publishable-key']) return json(res, 404, { error: 'not_found' })
        if (body && body.external_user_id) return json(res, 400, { code: 'browser_mode_no_external_user_id' })
        if (state.sessionStatus !== 201) return json(res, state.sessionStatus, { code: 'unavailable' })
        state.sessionCount++
        const token = `wst_${state.sessionCount}`
        const sess = { sessionId: `s${state.sessionCount}`, conversationId: `conv_${state.sessionCount}` }
        state.sessions.set(token, sess)
        return json(
          res,
          201,
          {
            sessionToken: token,
            ...sess,
            expiresIn: 86400,
            visitor: { identified: Boolean(body && body.visitorToken) },
          },
          { 'cache-control': 'no-store' },
        )
      }

      // every other route needs the session token and the `me` path
      const auth = (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('st') || ''
      const sess = state.sessions.get(auth)
      if (!sess || state.expireTokens) return json(res, 401, { code: 'session_expired' })
      const m = path.match(/^\/conversations\/me(\/.*)?$/)
      if (!m) return json(res, 403, { code: 'browser_mode_path' })
      const sub = m[1] || ''

      if (sub === '/messages' && req.method === 'POST') {
        const key = req.headers['x-idempotency-key']
        if (!key) return json(res, 400, { code: 'idempotency_key_required' })
        if (state.sendFailures > 0) {
          state.sendFailures--
          return json(res, 503, { code: 'unavailable' })
        }
        let messageId = state.messagesByKey.get(key)
        if (!messageId) {
          messageId = `m${state.messagesByKey.size + 1}`
          state.messagesByKey.set(key, messageId)
          state.turnsRun++
          state.history.push({ messageId, origin: 'customer', text: body.text })
          if (opts.onTurn) opts.onTurn({ emit, messageId, text: body.text, state })
        }
        if (state.failSendAfterProcessing > 0) {
          state.failSendAfterProcessing--
          return req.socket.destroy()
        }
        return json(res, state.sendStatus, { messageId })
      }
      if (sub === '/messages' && req.method === 'GET') {
        return json(res, 200, { conversationId: sess.conversationId, messages: state.history, nextBefore: null })
      }
      if (sub === '/events' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        })
        const last = req.headers['last-event-id']
        if (!last) writeEvent(res, { event: 'state', data: { driver: 'agent_driving', openTurn: false } })
        else {
          const idx = state.events.findIndex((e) => e.id === last)
          const from = idx < 0 ? 0 : state.replayInclusive ? idx : idx + 1
          for (const rec of state.events.slice(from)) writeEvent(res, rec)
        }
        res.write(': ping\n\n')
        state.streams.add(res)
        res.on('close', () => state.streams.delete(res))
        return
      }
      if (sub === '/stop' && req.method === 'POST') return json(res, 200, { stopped: true })
      if (sub === '/handoff' && req.method === 'POST') return json(res, 202, { outcome: 'requested' })
      if (sub === '/new' && req.method === 'POST') return json(res, 201, { conversationId: 'conv_new' })
      if (sub === '/conversations' && req.method === 'GET') {
        return json(res, 200, { conversations: [{ conversationId: sess.conversationId, current: true }] })
      }
      if (sub === '/resume' && req.method === 'POST') return json(res, 202, { messageId: body && body.messageId })
      if (sub.startsWith('/artifacts/') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
        return res.end('file-bytes')
      }
      if (sub === '/voice-session' && req.method === 'POST') {
        if (state.voiceStatus !== 200) return json(res, state.voiceStatus, { code: 'voice_disabled' })
        if (!body || body.consent !== true) return json(res, 400, { code: 'consent_required' })
        return json(res, 200, {
          livekit_url: 'wss://voz.test',
          livekit_token: 'lk-token',
          room_name: 'room-1',
          conversation_id: sess.conversationId,
        })
      }
      return json(res, 404, { error: 'not_found' })
    })
  })
  server.on('connection', (s) => {
    state.sockets.add(s)
    s.on('close', () => state.sockets.delete(s))
  })

  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1/public`

  return {
    state,
    baseUrl,
    emit,
    // the network goes away: every open socket dies, the SDK must come back by itself
    cut() {
      for (const s of [...state.sockets]) s.destroy()
    },
    requests: (method, path) => state.requests.filter((r) => r.method === method && r.path === path),
    async close() {
      for (const s of [...state.sockets]) s.destroy()
      await new Promise((r) => server.close(r))
    },
  }
}

export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export async function until(fn, { timeout = 4000, step = 15 } = {}) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for condition')
    await wait(step)
  }
}

// The SDK ships as an ES module at site/sdk/v1/lab019.js, but the repo has no "type": "module" (the site's other
// scripts are classic). Import a verbatim .mjs copy so node treats it as a module without touching the shipped file.
export async function loadSdk() {
  const { mkdtempSync, copyFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileURLToPath, pathToFileURL } = await import('node:url')
  const dir = mkdtempSync(join(tmpdir(), 'lab019-sdk-'))
  const target = join(dir, 'lab019.mjs')
  copyFileSync(fileURLToPath(new URL('../../site/sdk/v1/lab019.js', import.meta.url)), target)
  return import(pathToFileURL(target).href)
}
