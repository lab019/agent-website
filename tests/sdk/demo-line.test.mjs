// Demo line block above the home's composer: the WhatsApp call half only when the line takes calls (c2), and on a
// computer that half opens a QR code instead of the wa.me/call link (c3). site/assets/demo-line.js and qr.js are
// served as browser modules; they are copied to .mjs files so node loads them as ESM. A fictitious number only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

async function load(name) {
  const target = join(mkdtempSync(join(tmpdir(), 'lab019-demo-line-')), name.replace(/\.js$/, '.mjs'))
  copyFileSync(fileURLToPath(new URL(`../../site/assets/${name}`, import.meta.url)), target)
  return import(pathToFileURL(target).href)
}

const { fetchDemoLine, demoLineLinks, isPhone, mountDemoLine } = await load('demo-line.js')
const qr = await load('qr.js')

const answer = (body) => async () => ({ ok: true, status: 200, json: async () => body })
const NUMBER = '+5511900000000'
const settle = () => new Promise((resolve) => setImmediate(resolve))

function fakePage({ popover = true } = {}) {
  const node = (dataset = {}, hidden = false) => ({
    dataset,
    hidden,
    textContent: '',
    attrs: {},
    listeners: [],
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    addEventListener(type, fn) {
      this.listeners.push([type, fn])
    },
  })
  const text = node({ demoLine: 'whatsapp' })
  const voice = node({ demoLine: 'whatsapp-call' }, true)
  const tel = node({ demoLine: 'call' })
  const number = node({ demoLine: 'number' })
  const block = node({}, true)
  const slot = {
    html: '',
    get firstChild() {
      return this.html ? {} : null
    },
    set innerHTML(value) {
      this.html = value
    },
  }
  const pop = { shown: 0, querySelector: (selector) => (selector === '[data-qr]' ? slot : null) }
  if (popover) pop.showPopover = () => (pop.shown += 1)
  const bySelector = { '[data-demo-line="whatsapp-call"]': voice, '#wa-call-qr': pop, '.try-ways': block }
  const root = {
    querySelectorAll: (selector) => (selector === '[data-demo-line]' ? [text, voice, tel, number] : []),
    querySelector: (selector) => bySelector[selector] || null,
  }
  return { root, text, voice, tel, number, block, slot, pop }
}

function click(el) {
  const event = { prevented: false, preventDefault() { this.prevented = true } }
  el.listeners.filter(([type]) => type === 'click').forEach(([, fn]) => fn(event))
  return event
}

test('c2: the WhatsApp call half shows only when the route says the line takes WhatsApp calls', async () => {
  const cases = [
    { name: 'whatsapp_calls: true', body: { e164: NUMBER, whatsapp_calls: true }, voice: true },
    { name: 'no field (the route today)', body: { e164: NUMBER }, voice: false },
    { name: 'whatsapp_calls: false', body: { e164: NUMBER, whatsapp_calls: false }, voice: false },
    { name: 'a string is not a yes', body: { e164: NUMBER, whatsapp_calls: 'true' }, voice: false },
  ]
  for (const { name, body, voice } of cases) {
    const links = demoLineLinks(await fetchDemoLine(answer(body)))
    assert.equal(links.whatsapp, 'https://wa.me/5511900000000', `${name}: text half`)
    assert.equal(links['whatsapp-call'], voice ? 'https://wa.me/call/5511900000000' : undefined, `${name}: call link`)

    const page = fakePage()
    assert.equal(await mountDemoLine(page.root, answer(body), { phone: true }), true, name)
    assert.equal(page.block.hidden, false, `${name}: block shown`)
    assert.equal(page.text.attrs.href, 'https://wa.me/5511900000000', `${name}: text href`)
    assert.equal(page.tel.attrs.href, 'tel:+5511900000000', `${name}: phone href`)
    assert.equal(page.number.textContent, '+55 11 90000-0000', `${name}: number`)
    assert.equal(page.voice.hidden, !voice, `${name}: call half visibility`)
    assert.equal(page.voice.attrs.href, voice ? 'https://wa.me/call/5511900000000' : undefined, `${name}: call href`)
  }
  const failed = fakePage()
  assert.equal(await mountDemoLine(failed.root, async () => ({ ok: false, status: 503 }), { phone: false }), false)
  assert.equal(failed.block.hidden, true, 'route down: nothing shows')
  assert.equal(failed.voice.hidden, true)
})

test('c3: a phone opens the WhatsApp call link; a computer shows its QR code', async () => {
  const devices = [
    { name: 'iPhone', nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148', maxTouchPoints: 5 }, phone: true },
    { name: 'Android Chrome', nav: { userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/131 Mobile Safari/537.36', userAgentData: { mobile: true } }, phone: true },
    { name: 'Android tablet', nav: { userAgent: 'Mozilla/5.0 (Linux; Android 15; Tab) Chrome/131 Safari/537.36', userAgentData: { mobile: false } }, phone: true },
    { name: 'iPad on iPadOS (reports a Mac)', nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 }, phone: true },
    { name: 'Mac', nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131 Safari/537.36', maxTouchPoints: 0, userAgentData: { mobile: false } }, phone: false },
    { name: 'Windows', nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131 Safari/537.36', userAgentData: { mobile: false } }, phone: false },
    { name: 'no navigator', nav: undefined, phone: false },
  ]
  for (const { name, nav, phone } of devices) assert.equal(isPhone(nav), phone, name)

  const withCalls = answer({ e164: NUMBER, whatsapp_calls: true })

  // phone: the link is left alone
  const onPhone = fakePage()
  await mountDemoLine(onPhone.root, withCalls, { phone: true })
  assert.deepEqual(onPhone.voice.listeners, [], 'phone: no click handler')

  // computer: the click opens the QR code of the same link, drawn once
  let loads = 0
  const loadQr = async () => ((loads += 1), qr)
  const onDesktop = fakePage()
  await mountDemoLine(onDesktop.root, withCalls, { phone: false, loadQr })
  assert.equal(click(onDesktop.voice).prevented, true, 'computer: the link does not open')
  await settle()
  assert.equal(onDesktop.pop.shown, 1)
  assert.equal(onDesktop.slot.html, qr.qrSvg('https://wa.me/call/5511900000000', { label: 'Código QR da ligação para o agente pelo WhatsApp' }))
  click(onDesktop.voice)
  await settle()
  assert.equal(onDesktop.pop.shown, 2)
  assert.equal(loads, 1, 'the QR code is drawn once')

  // computer whose browser has no popover, or a line without calls: the link stays as is
  const noPopover = fakePage({ popover: false })
  await mountDemoLine(noPopover.root, withCalls, { phone: false, loadQr })
  assert.deepEqual(noPopover.voice.listeners, [])
  const noCalls = fakePage()
  await mountDemoLine(noCalls.root, answer({ e164: NUMBER }), { phone: false, loadQr })
  assert.deepEqual(noCalls.voice.listeners, [])

  // the QR code fails to load: the link opens in a new tab after all
  const opened = []
  const realOpen = globalThis.open
  globalThis.open = (...args) => opened.push(args)
  try {
    const broken = fakePage()
    await mountDemoLine(broken.root, withCalls, { phone: false, loadQr: async () => { throw new Error('offline') } })
    click(broken.voice)
    await settle()
    assert.deepEqual(opened, [['https://wa.me/call/5511900000000', '_blank', 'noopener']])
    assert.equal(broken.pop.shown, 0)
  } finally {
    globalThis.open = realOpen
  }
})
