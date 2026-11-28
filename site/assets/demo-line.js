/*
 * Demo line of lab019.ai — the block above the chat: "Conversar no WhatsApp" split in two halves, "Texto ou áudio"
 * (wa.me) and "Ligação de voz" (wa.me/call), plus a smaller "Ligar pelo telefone" (tel:), so a visitor without an
 * account can test the site's specialist by WhatsApp message, voice message, WhatsApp call and phone call.
 *
 * The number is NOT in this repo and NOT in any deploy config: it is read live from the platform's public route
 * GET /gateway/v1/public/demo-line (the same demo line the app shows to members). Any failure — network, timeout,
 * non-200, malformed body, a number that is not a Brazilian E.164 — leaves the block hidden: no number, no fallback.
 * The WhatsApp call half shows only when the route says the line takes WhatsApp calls (`whatsapp_calls: true`);
 * without it the text half takes the whole button. wa.me/call only opens in WhatsApp on a phone, so on a computer
 * that half opens a QR code of the same link to scan with the phone (qr.js, loaded on the first click).
 * Markup carries only data-demo-line="whatsapp|whatsapp-call|call|number"; mountDemoLine() fills href and text.
 */

const API_BASE = 'https://api.lab019.ai'
const DEMO_LINE_PATH = '/gateway/v1/public/demo-line'
const TIMEOUT_MS = 5000

// E.164 "+55" + area code + 8 or 9 digits -> { e164, display: "+55 AA NNNNN-NNNN" }; anything else -> null.
export function demoLineFromE164(e164) {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(String(e164 || '').trim())
  if (!match) return null
  const [, area, first, last] = match
  return { e164: match[0], display: `+55 ${area} ${first}-${last}` }
}

// The public route's answer -> a line, or null on any failure (never throws).
export async function fetchDemoLine(fetchImpl = globalThis.fetch, base = API_BASE) {
  if (typeof fetchImpl !== 'function') return null
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null
  try {
    const response = await fetchImpl(base.replace(/\/+$/, '') + DEMO_LINE_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: controller ? controller.signal : undefined,
    })
    if (!response || !response.ok) return null
    const body = await response.json()
    const line = demoLineFromE164(body && body.e164)
    return line && { ...line, whatsappCalls: body.whatsapp_calls === true }
  } catch (error) {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// wa.me takes the digits only; tel: takes the E.164 number. The WhatsApp call link exists only when the line takes calls.
export function demoLineLinks(line) {
  if (!line) return null
  const digits = line.e164.replace(/\D/g, '')
  const links = { whatsapp: 'https://wa.me/' + digits, call: 'tel:' + line.e164, display: line.display }
  if (line.whatsappCalls) links['whatsapp-call'] = 'https://wa.me/call/' + digits
  return links
}

// A phone opens wa.me/call in the WhatsApp app; WhatsApp on a computer does not take it. iPadOS reports a Mac.
export function isPhone(nav = globalThis.navigator) {
  if (!nav) return false
  const ua = String(nav.userAgent || '')
  return (
    (nav.userAgentData && nav.userAgentData.mobile === true) ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)
  )
}

// Draws the QR code of the call link once, then opens the popover.
export async function showCallQr(pop, url, loadQr = () => import('./qr.js')) {
  const slot = pop.querySelector('[data-qr]')
  if (slot && !slot.firstChild) {
    const { qrSvg } = await loadQr()
    slot.innerHTML = qrSvg(url, { label: 'Código QR da ligação para o agente pelo WhatsApp' })
  }
  pop.showPopover()
}

// With no line (fetch failed) the block stays hidden (the markup ships with [hidden]); so does the WhatsApp call half
// when the line takes no calls. On a computer, a click on that half opens the QR code instead of the link; where the
// browser has no popover, or the QR code fails to load, the link opens as is.
export async function mountDemoLine(root = document, fetchImpl = globalThis.fetch, { phone = isPhone(), loadQr } = {}) {
  const links = demoLineLinks(await fetchDemoLine(fetchImpl))
  if (!links) return false
  root.querySelectorAll('[data-demo-line]').forEach((el) => {
    const kind = el.dataset.demoLine
    if (kind === 'number') el.textContent = links.display
    else if (kind in links) {
      el.setAttribute('href', links[kind])
      el.hidden = false
    }
  })
  const callLink = links['whatsapp-call'] && root.querySelector('[data-demo-line="whatsapp-call"]')
  const pop = root.querySelector('#wa-call-qr')
  if (callLink && pop && !phone && typeof pop.showPopover === 'function') {
    callLink.addEventListener('click', (event) => {
      event.preventDefault()
      showCallQr(pop, links['whatsapp-call'], loadQr).catch(() => globalThis.open(links['whatsapp-call'], '_blank', 'noopener'))
    })
  }
  const block = root.querySelector('.try-ways')
  if (block) block.hidden = false
  return true
}
