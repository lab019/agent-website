/*
 * Demo line of lab019.ai — the buttons "Conversar no WhatsApp" and "Ligar agora" next to the chat, so a visitor
 * without an account can test the site's specialist by WhatsApp, voice message and phone call.
 *
 * The number is NOT in this repo and NOT in any deploy config: it is read live from the platform's public route
 * GET /gateway/v1/public/demo-line (the same demo line the app shows to members). Any failure — network, timeout,
 * non-200, malformed body, a number that is not a Brazilian E.164 — leaves the block hidden: no number, no fallback.
 * Markup carries only data-demo-line="whatsapp|call|number"; mountDemoLine() fills href and text from the answer.
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
    return demoLineFromE164(body && body.e164)
  } catch (error) {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// wa.me takes the digits only; tel: takes the E.164 number.
export function demoLineLinks(line) {
  if (!line) return null
  return { whatsapp: 'https://wa.me/' + line.e164.replace(/\D/g, ''), call: 'tel:' + line.e164, display: line.display }
}

// With no line (fetch failed) the block stays hidden (the markup ships with [hidden]).
export async function mountDemoLine(root = document, fetchImpl = globalThis.fetch) {
  const links = demoLineLinks(await fetchDemoLine(fetchImpl))
  if (!links) return false
  root.querySelectorAll('[data-demo-line]').forEach((el) => {
    const kind = el.dataset.demoLine
    if (kind === 'number') el.textContent = links.display
    else if (kind in links) el.setAttribute('href', links[kind])
  })
  const block = root.querySelector('.demo-line')
  if (block) block.hidden = false
  return true
}
