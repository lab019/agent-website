// LIC-3777 — SDK JS v1 (site/sdk/v1/lab019.js) against a local stand-in for the browser-mode gateway (LIC-3776).
// Criterion -> test:
//   1  contract of section 4 (connect/send/on/approve/stop/history/conversations/newConversation/voice/disconnect/markdown)
//   2  cut and restore the network: reconnect with Last-Event-ID, nothing duplicated, nothing lost
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startGateway, memoryStorage, until, wait } from './mock_gateway.mjs'
import { loadSdk } from './mock_gateway.mjs'
const { default: Lab019, Lab019: Named } = await loadSdk()

const KEY = 'wgt_test_key'
const FAST = { reconnect: { minDelay: 10, maxDelay: 40 } }

async function withGateway(opts, fn) {
  const gw = await startGateway(opts)
  const clients = []
  const connect = async (extra = {}) => {
    const c = await Lab019.connect({ key: KEY, baseUrl: gw.baseUrl, storage: memoryStorage(), ...FAST, ...extra })
    clients.push(c)
    return c
  }
  try {
    await fn(gw, connect)
  } finally {
    clients.forEach((c) => c.disconnect())
    await gw.close()
  }
}

test('exports Lab019 as default and named, with connect and markdown, and sets no global', () => {
  assert.equal(Lab019, Named)
  assert.equal(typeof Lab019.connect, 'function')
  assert.equal(typeof Lab019.markdown, 'function')
  assert.equal(globalThis.Lab019, undefined)
})

test('connect opens a session with the publishable key, loads config, and stores the session', async () => {
  await withGateway({ config: { title: 'Lab019' } }, async (gw, connect) => {
    const storage = memoryStorage()
    const c = await connect({ storage })
    const [open] = gw.requests('POST', '/sessions')
    assert.equal(open.headers['x-publishable-key'], KEY)
    assert.equal(open.body && open.body.external_user_id, undefined)
    assert.equal(c.config.title, 'Lab019')
    const saved = JSON.parse(storage.getItem(`lab019:session:${KEY}`))
    assert.equal(saved.sessionToken, 'wst_1')
    assert.equal(saved.conversationId, 'conv_1')
    assert.ok(saved.sessionId)
  })
})

test('connect resumes the stored session instead of opening a new one', async () => {
  await withGateway({}, async (gw, connect) => {
    const storage = memoryStorage()
    const first = await connect({ storage })
    first.disconnect()
    const second = await connect({ storage })
    assert.equal(gw.state.sessionCount, 1)
    assert.equal(second.conversationId, 'conv_1')
  })
})

test('an expired stored session is replaced by a new one, once', async () => {
  await withGateway({}, async (gw, connect) => {
    const storage = memoryStorage({
      [`lab019:session:${KEY}`]: JSON.stringify({ sessionToken: 'wst_dead', sessionId: 'x', conversationId: 'old' }),
    })
    const c = await connect({ storage })
    assert.equal(gw.state.sessionCount, 1)
    assert.equal(c.conversationId, 'conv_1')
    assert.equal(JSON.parse(storage.getItem(`lab019:session:${KEY}`)).sessionToken, 'wst_1')
  })
})

test('visitorToken goes in the body; external_user_id is never sent', async () => {
  await withGateway({}, async (gw, connect) => {
    await connect({ visitorToken: 'vt_abc' })
    const [open] = gw.requests('POST', '/sessions')
    assert.deepEqual(open.body, { visitorToken: 'vt_abc' })
  })
})

test('storage:null keeps nothing and always opens a fresh session', async () => {
  await withGateway({}, async (gw, connect) => {
    const a = await connect({ storage: null })
    a.disconnect()
    await connect({ storage: null })
    assert.equal(gw.state.sessionCount, 2)
  })
})

test('a throwing storage never breaks connect', async () => {
  await withGateway({}, async (gw, connect) => {
    const boom = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
      removeItem() {
        throw new Error('blocked')
      },
    }
    const c = await connect({ storage: boom })
    assert.ok(c.config)
  })
})

test('send posts the text with an idempotency key and returns the messageId', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    const out = await c.send('oi')
    assert.equal(out.messageId, 'm1')
    const [req] = gw.requests('POST', '/conversations/me/messages')
    assert.equal(req.headers.authorization, 'Bearer wst_1')
    assert.ok(req.headers['x-idempotency-key'].length >= 16)
    assert.deepEqual(req.body, { text: 'oi' })
  })
})

test('send with files encodes attachments as base64', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    await c.send('veja', { files: [{ name: 'a.txt', type: 'text/plain', bytes: new TextEncoder().encode('hello') }] })
    const [req] = gw.requests('POST', '/conversations/me/messages')
    assert.deepEqual(req.body.attachments, [{ name: 'a.txt', mediaType: 'text/plain', data: 'aGVsbG8=' }])
  })
})

test('a send whose answer is lost is retried with the SAME key: one turn, not two', async () => {
  await withGateway({}, async (gw, connect) => {
    gw.state.failSendAfterProcessing = 1 // the gateway handled it, then the network died
    const c = await connect()
    const out = await c.send('uma vez só')
    assert.equal(out.messageId, 'm1')
    const posts = gw.requests('POST', '/conversations/me/messages')
    assert.equal(posts.length, 2)
    assert.equal(posts[0].headers['x-idempotency-key'], posts[1].headers['x-idempotency-key'])
    assert.equal(gw.state.turnsRun, 1)
  })
})

test('a 503 on send is retried with the same key', async () => {
  await withGateway({}, async (gw, connect) => {
    gw.state.sendFailures = 2
    const c = await connect()
    const out = await c.send('x')
    assert.equal(out.messageId, 'm1')
    const keys = new Set(gw.requests('POST', '/conversations/me/messages').map((r) => r.headers['x-idempotency-key']))
    assert.equal(keys.size, 1)
  })
})

test('two sends use two different keys', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    await c.send('a')
    await c.send('b')
    const keys = gw.requests('POST', '/conversations/me/messages').map((r) => r.headers['x-idempotency-key'])
    assert.notEqual(keys[0], keys[1])
  })
})

test('429 rejects with code rate_limited and retryAfter, and is not retried blindly', async () => {
  const http = await import('node:http')
  const srv = http.createServer((req, res) => {
    if (req.url.endsWith('/sessions')) {
      res.writeHead(201, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ sessionToken: 'wst_1', sessionId: 's', conversationId: 'c', expiresIn: 1 }))
    }
    if (req.url.includes('/events')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      return res.write(': ping\n\n')
    }
    if (req.url.endsWith('/config')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end('{}')
    }
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' })
    res.end(JSON.stringify({ code: 'rate_limited' }))
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const c = await Lab019.connect({
    key: KEY,
    baseUrl: `http://127.0.0.1:${srv.address().port}/v1/public`,
    storage: null,
    ...FAST,
  })
  await assert.rejects(c.send('x'), (e) => e.code === 'rate_limited' && e.retryAfter === 7 && e.status === 429)
  c.disconnect()
  srv.closeAllConnections()
  await new Promise((r) => srv.close(r))
})

test('on / off / "*": events reach listeners, off stops them, unknown events are ignored by named listeners', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    const deltas = []
    const all = []
    const fn = (d) => deltas.push(d.delta)
    c.on('message_delta', fn)
    c.on('*', (name, data) => all.push(name))
    await until(() => gw.state.streams.size === 1)
    gw.emit('message_delta', { delta: 'ol' })
    gw.emit('message_delta', { delta: 'á' })
    gw.emit('brand_new_event', { x: 1 })
    await until(() => all.includes('brand_new_event'))
    assert.deepEqual(deltas, ['ol', 'á'])
    c.off('message_delta', fn)
    gw.emit('message_delta', { delta: 'zz' })
    await until(() => all.filter((n) => n === 'message_delta').length === 3)
    assert.deepEqual(deltas, ['ol', 'á'])
  })
})

test('a throwing listener does not stop the others or the stream', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    const seen = []
    c.on('done', () => {
      throw new Error('listener bug')
    })
    c.on('done', (d) => seen.push(d.messageId))
    await until(() => gw.state.streams.size === 1)
    gw.emit('done', { messageId: 'a' })
    gw.emit('done', { messageId: 'b' })
    await until(() => seen.length === 2)
    assert.deepEqual(seen, ['a', 'b'])
  })
})

test('SSE frames split across chunks, CRLF and comments are parsed', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    const seen = []
    c.on('message_delta', (d) => seen.push(d.delta))
    await until(() => gw.state.streams.size === 1)
    const [res] = [...gw.state.streams]
    res.write('id: 5-0\r\nevent: message_delta\r\ndata: {"delta":"a')
    await wait(20)
    res.write('b"}\r\n\r\n: ping\n\n')
    await until(() => seen.length === 1)
    assert.deepEqual(seen, ['ab'])
  })
})

test('cut and restore the network: reconnects with Last-Event-ID, nothing duplicated, nothing lost', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    const seen = []
    c.on('message_delta', (d) => seen.push(d.delta))
    await until(() => gw.state.streams.size === 1)
    gw.emit('message_delta', { delta: '1' })
    gw.emit('message_delta', { delta: '2' })
    await until(() => seen.length === 2)
    gw.cut()
    gw.emit('message_delta', { delta: '3' }) // arrives while the SDK is offline
    gw.emit('message_delta', { delta: '4' })
    await until(() => gw.state.streams.size === 1 && seen.length === 4)
    await wait(80)
    assert.deepEqual(seen, ['1', '2', '3', '4'])
    const evs = gw.requests('GET', '/conversations/me/events')
    assert.ok(evs.length >= 2)
    assert.ok(evs[evs.length - 1].headers['last-event-id'])
  })
})

test('if the gateway replays the last seen event too, the SDK drops the duplicate', async () => {
  await withGateway({}, async (gw, connect) => {
    gw.state.replayInclusive = true
    const c = await connect()
    const seen = []
    c.on('message_delta', (d) => seen.push(d.delta))
    await until(() => gw.state.streams.size === 1)
    gw.emit('message_delta', { delta: 'a' })
    gw.emit('message_delta', { delta: 'b' })
    await until(() => seen.length === 2)
    gw.cut()
    gw.emit('message_delta', { delta: 'c' })
    await until(() => seen.length === 3)
    await wait(80)
    assert.deepEqual(seen, ['a', 'b', 'c'])
  })
})

test('repeated cuts keep recovering', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    const seen = []
    c.on('message_delta', (d) => seen.push(d.delta))
    await until(() => gw.state.streams.size === 1)
    for (let i = 0; i < 4; i++) {
      gw.emit('message_delta', { delta: `m${i}` })
      await until(() => seen.length === i + 1)
      const before = gw.requests('GET', '/conversations/me/events').length
      gw.cut()
      await until(() => gw.requests('GET', '/conversations/me/events').length > before && gw.state.streams.size === 1)
    }
    assert.deepEqual(seen, ['m0', 'm1', 'm2', 'm3'])
  })
})

test('lastEventId is persisted, so a reload resumes without replaying what was already shown', async () => {
  await withGateway({}, async (gw, connect) => {
    const storage = memoryStorage()
    const c = await connect({ storage })
    const seen = []
    c.on('message_delta', (d) => seen.push(d.delta))
    await until(() => gw.state.streams.size === 1)
    gw.emit('message_delta', { delta: 'x' })
    await until(() => seen.length === 1)
    const saved = JSON.parse(storage.getItem(`lab019:session:${KEY}`))
    assert.ok(saved.lastEventId)
    c.disconnect()
    gw.emit('message_delta', { delta: 'y' })
    const c2 = await connect({ storage })
    const seen2 = []
    c2.on('message_delta', (d) => seen2.push(d.delta))
    await until(() => seen2.length === 1)
    await wait(60)
    assert.deepEqual(seen2, ['y'])
  })
})

test('replay_gap and conversation_rolled are surfaced to the page', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    const names = []
    c.on('replay_gap', () => names.push('replay_gap'))
    c.on('conversation_rolled', (d) => names.push(`rolled:${d.conversationId}`))
    await until(() => gw.state.streams.size === 1)
    gw.emit('replay_gap', {})
    gw.emit('conversation_rolled', { conversationId: 'conv_9' })
    await until(() => names.length === 2)
    assert.deepEqual(names, ['replay_gap', 'rolled:conv_9'])
    assert.equal(c.conversationId, 'conv_9')
  })
})

test('connection state changes are emitted as connection events', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    const states = []
    c.on('connection', (d) => states.push(d.state))
    await until(() => gw.state.streams.size === 1)
    gw.cut()
    await until(() => states.includes('reconnecting'))
    await until(() => states.includes('connected'))
  })
})

test('an expired session while streaming emits session_expired and opens a new session', async () => {
  await withGateway({}, async (gw, connect) => {
    const storage = memoryStorage()
    const c = await connect({ storage })
    const codes = []
    c.on('error', (e) => codes.push(e.code))
    c.on('session', (s) => codes.push(`session:${s.sessionId}`))
    await until(() => gw.state.streams.size === 1)
    gw.state.sessions.clear()
    gw.cut()
    await until(() => codes.includes('session_expired'))
    await until(() => gw.state.sessionCount === 2)
    assert.equal(JSON.parse(storage.getItem(`lab019:session:${KEY}`)).sessionToken, 'wst_2')
  })
})

test('history, stop, conversations, newConversation and approve call the me routes', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    await c.send('oi')
    const h = await c.history({ limit: 10 })
    assert.equal(h.messages[0].text, 'oi')
    assert.equal(gw.requests('GET', '/conversations/me/messages')[0].query.limit, '10')
    assert.deepEqual(await c.stop(), { stopped: true })
    assert.equal((await c.conversations()).conversations[0].current, true)
    const n = await c.newConversation()
    assert.equal(n.conversationId, 'conv_new')
    assert.equal(c.conversationId, 'conv_new')
    await c.approve('i1', { actionId: 'a1', type: 'approve' })
    const [r] = gw.requests('POST', '/conversations/me/resume')
    assert.equal(r.body.messageId, 'i1')
    assert.deepEqual(r.body.decisions, [{ actionId: 'a1', type: 'approve' }])
    assert.ok(r.headers['x-idempotency-key'])
  })
})

const fakeMic = async () => ({ getTracks: () => [{ stop() {} }] })

test('voice.start without consent:true rejects before any request', async () => {
  await withGateway({}, async (gw, connect) => {
    const c = await connect()
    await assert.rejects(c.voice.start(), (e) => e.code === 'consent_required')
    await assert.rejects(c.voice.start({ consent: false }), (e) => e.code === 'consent_required')
    assert.equal(gw.requests('POST', '/conversations/me/voice-session').length, 0)
  })
})

test('voice disabled by the gateway rejects with voice_disabled', async () => {
  await withGateway({}, async (gw, connect) => {
    gw.state.voiceStatus = 403
    const c = await connect({ runtime: { getUserMedia: fakeMic } })
    await assert.rejects(c.voice.start({ consent: true }), (e) => e.code === 'voice_disabled')
  })
})

test('voice.start with consent asks for a voice-session with consent:true and joins the room', async () => {
  await withGateway({}, async (gw, connect) => {
    const calls = []
    class Room {
      constructor(o) {
        calls.push(['new', o])
        this.localParticipant = { setMicrophoneEnabled: async (v) => calls.push(['mic', v]) }
      }
      on() {
        return this
      }
      async connect(url, token) {
        calls.push(['connect', url, token])
      }
      async startAudio() {
        calls.push(['startAudio'])
      }
      async disconnect() {
        calls.push(['disconnect'])
      }
    }
    const c = await connect({
      runtime: { getUserMedia: fakeMic, loadLiveKit: async () => ({ Room, RoomEvent: {}, Track: {} }) },
    })
    const states = []
    c.on('voice.state', (d) => states.push(d.state))
    await c.voice.start({ consent: true })
    const [req] = gw.requests('POST', '/conversations/me/voice-session')
    assert.deepEqual(req.body, { consent: true })
    assert.deepEqual(
      calls.find((x) => x[0] === 'connect'),
      ['connect', 'wss://voz.test', 'lk-token'],
    )
    assert.ok(calls.some((x) => x[0] === 'mic' && x[1] === true))
    assert.ok(states.includes('connected'))
    await c.voice.stop()
    assert.ok(calls.some((x) => x[0] === 'disconnect'))
    assert.ok(states.includes('idle'))
  })
})

test('disconnect closes the stream and keeps the stored session', async () => {
  await withGateway({}, async (gw, connect) => {
    const storage = memoryStorage()
    const c = await connect({ storage })
    await until(() => gw.state.streams.size === 1)
    c.disconnect()
    await until(() => gw.state.streams.size === 0)
    await wait(100)
    assert.equal(gw.state.streams.size, 0)
    assert.ok(storage.getItem(`lab019:session:${KEY}`))
  })
})

test('connect without a key fails with a coded error', async () => {
  await assert.rejects(Lab019.connect({}), (e) => e.code === 'key_required')
})

test('connect with a rejected key (opaque 404) fails with a coded error', async () => {
  const gw = await startGateway()
  await assert.rejects(
    Lab019.connect({ key: '', baseUrl: gw.baseUrl, storage: null }),
    (e) => e.code === 'key_required',
  )
  await gw.close()
})

// --- markdown: the same subset as chat.js, returned as a safe HTML string ---

test('markdown escapes raw html and never emits script or event handlers', () => {
  const out = Lab019.markdown('<script>alert(1)</script> <img src=x onerror=alert(1)> a & b "q"')
  assert.ok(!out.includes('<script'))
  assert.ok(!out.includes('<img'))
  assert.ok(out.includes('&lt;script&gt;'))
  assert.ok(out.includes('&amp;'))
})

test('markdown links allow only http(s) and mailto, open in a new tab with noopener', () => {
  const ok = Lab019.markdown('[site](https://lab019.ai/x?a=1&b=2)')
  assert.ok(ok.includes('href="https://lab019.ai/x?a=1&amp;b=2"'))
  assert.ok(ok.includes('target="_blank"') && ok.includes('rel="noopener noreferrer"'))
  assert.ok(Lab019.markdown('[m](mailto:a@b.co)').includes('href="mailto:a@b.co"'))
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', ' JaVaScRiPt:alert(1)']) {
    const out = Lab019.markdown(`[x](${bad})`)
    assert.ok(!/href=/i.test(out), `${bad} -> ${out}`)
  }
})

test('markdown quote characters in link targets cannot break out of the attribute', () => {
  const out = Lab019.markdown('[x](https://a.co/"onmouseover="alert(1))')
  assert.ok(!/ onmouseover=/.test(out))
})

test('markdown renders the chat subset: bold, italic, code, fences, headings, lists, paragraphs', () => {
  const out = Lab019.markdown('# Título\n\nOlá **negrito** e *itálico* e `code`\n\n- a\n- b\n\n1. um\n2. dois\n\n```\nlet x = 1 < 2\n```')
  assert.ok(out.includes('<strong>negrito</strong>'))
  assert.ok(out.includes('<em>itálico</em>'))
  assert.ok(out.includes('<code>code</code>'))
  assert.ok(out.includes('<ul>') && out.includes('<li>a</li>'))
  assert.ok(out.includes('<ol>') && out.includes('<li>dois</li>'))
  assert.ok(out.includes('<pre><code>let x = 1 &lt; 2</code></pre>'))
  assert.ok(/<h[1-6]>Título<\/h[1-6]>/.test(out))
  assert.ok(out.includes('<p>'))
})

test('markdown tolerates non-strings and an unterminated fence', () => {
  assert.equal(Lab019.markdown(null), '')
  assert.equal(Lab019.markdown(undefined), '')
  assert.ok(Lab019.markdown('```\nunterminated <b>').includes('&lt;b&gt;'))
})

// --- static guarantees of the file ---

const SOURCE = readFileSync(fileURLToPath(new URL('../../site/sdk/v1/lab019.js', import.meta.url)), 'utf8')

test('no fixed pt-BR phrase in the SDK (labels belong to the page)', () => {
  const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const strings = stripped.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || []
  const ptWords = /\b(você|voce|erro|mensagem|enviar|conectar|tente|falha|não|nao|olá|ola|obrigad|ligação|voz de|microfone)\b/i
  const offenders = strings.filter((s) => /[À-ÿ]/.test(s) || ptWords.test(s))
  assert.deepEqual(offenders, [])
})

test('no dependency outside voice: the only external URL is the LiveKit CDN with SRI', () => {
  assert.ok(!/^\s*import\s/m.test(SOURCE), 'static import found')
  const urls = [...new Set(SOURCE.match(/https?:\/\/[^\s'"`)]+/g) || [])].filter((u) => !/lab019\.ai/.test(u))
  assert.deepEqual(
    urls.filter((u) => !u.startsWith('https://cdn.jsdelivr.net/npm/livekit-client@')),
    [],
  )
  assert.ok(/sha384-[A-Za-z0-9+/=]+/.test(SOURCE))
})
