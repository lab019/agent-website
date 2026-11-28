/*
 * Demo line of lab019.ai — the buttons "Conversar no WhatsApp" and "Ligar agora" next to the chat, so a visitor
 * without an account can test the site's specialist by WhatsApp, voice message and phone call.
 *
 * The number is NOT in the repo. The deploy (.github/workflows/deploy.yml) replaces DEMO_LINE_TOKEN below with the
 * E.164 number held in the repository Variable DEMO_LINE_E164 (public config, not a secret). Without the Variable
 * the token stays, demoLineFromE164() returns null and the block stays hidden: no number, no fallback.
 * Markup carries only data-demo-line="whatsapp|call|number"; mountDemoLine() fills href and text from here.
 */

const DEMO_LINE_TOKEN = '__DEMO_LINE_E164__'

// E.164 "+55" + area code + 8 or 9 digits -> { e164, display: "+55 AA NNNNN-NNNN" }; anything else -> null.
export function demoLineFromE164(e164) {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(String(e164 || '').trim())
  if (!match) return null
  const [, area, first, last] = match
  return { e164: match[0], display: `+55 ${area} ${first}-${last}` }
}

export const DEMO_LINE = demoLineFromE164(DEMO_LINE_TOKEN)

// wa.me takes the digits only; tel: takes the E.164 number.
export function demoLineLinks(line = DEMO_LINE) {
  if (!line) return null
  return { whatsapp: 'https://wa.me/' + line.e164.replace(/\D/g, ''), call: 'tel:' + line.e164, display: line.display }
}

// With no line configured the block stays hidden (the markup ships with [hidden]).
export function mountDemoLine(root = document, line = DEMO_LINE) {
  const links = demoLineLinks(line)
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
