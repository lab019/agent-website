/*
 * Google Tag Manager + consentimento (LGPD) para lab019.ai
 * -----------------------------------------------------------------------------
 * Carrega o GTM (que por sua vez dispara o GA4) SOMENTE depois de consentimento
 * explícito do visitante. Enquanto não há escolha, nada da Google é carregado —
 * cookies de análise/marketing são não essenciais e dependem de opt-in.
 *
 * Um único arquivo compartilhado por todas as páginas do site, para o ID do
 * contêiner e a lógica de consentimento viverem em um só lugar.
 *
 * Configuração: o ID do contêiner NÃO é hardcodado. O token __GTM_CONTAINER_ID__
 * abaixo é substituído no deploy (o workflow do GitHub Pages troca-o pelo valor
 * da Variable GTM_CONTAINER_ID; ver .github/workflows/deploy.yml). Se a landing
 * um dia for servida por container, o mesmo token pode ser preenchido via
 * envsubst no entrypoint a partir do .env — o token é o ponto único de injeção.
 * O GA4 entra como tag DENTRO do GTM (interface web), não aqui no código.
 * Enquanto o token não for substituído (preview local, ou Variable ausente), o
 * script fica inerte: não carrega nada e não mostra o banner — deploy seguro.
 */
;(function () {
  'use strict'

  // === Configuração ===
  // Substituído no deploy. Fica com o token literal em preview local.
  var GTM_ID = '__GTM_CONTAINER_ID__'
  var STORAGE_KEY = 'lab019-consent' // valor: 'granted' | 'denied'

  // Sem ID válido (token não substituído ou formato inesperado) → recurso inerte:
  // nada carrega e o banner não aparece. O token começa com "__", então não casa
  // com o formato de contêiner e é barrado naturalmente.
  if (!/^GTM-[A-Z0-9]+$/.test(GTM_ID)) return

  var isEn = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0
  var dnt =
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1' ||
    navigator.msDoNotTrack === '1'

  window.dataLayer = window.dataLayer || []
  function gtag() {
    window.dataLayer.push(arguments)
  }

  // Consent Mode v2 — tudo negado por padrão até o visitante decidir.
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500,
  })

  // Rastreamento de conversão: quando o lead clica num CTA, empurra um evento
  // semântico no dataLayer para o GTM repassar ao GA4 e ao Meta (Lead). Fica
  // ativo independentemente da escolha de consentimento — o push é só um array
  // em memória; nada sai do navegador enquanto o GTM não carregar, e o GTM só
  // carrega após o "Aceitar". Delegação num único listener (captura) para pegar
  // cliques em qualquer CTA, inclusive os injetados depois.
  document.addEventListener(
    'click',
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null
      if (!a) return
      var href = a.getAttribute('href') || ''
      var evt = null
      if (href.indexOf('app.lab019.ai') !== -1) {
        // CTA principal: começar no app (teste grátis) — a conversão da landing.
        evt = {
          event: 'cta_click',
          cta_destination: 'app',
          link_url: href,
          link_text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        }
      } else if (/^mailto:contato@/i.test(href)) {
        // Contato por e-mail → lead leve (o e-mail jurídico privacidade@ não conta).
        evt = { event: 'email_click', link_url: href }
      }
      if (evt) window.dataLayer.push(evt)
    },
    true
  )

  function loadGtm() {
    if (window.__lab019GtmLoaded) return
    window.__lab019GtmLoaded = true
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
    var s = document.createElement('script')
    s.async = true
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(GTM_ID)
    document.head.appendChild(s)
  }

  function grant() {
    try {
      localStorage.setItem(STORAGE_KEY, 'granted')
    } catch (e) {}
    gtag('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
    })
    loadGtm()
  }

  function deny() {
    try {
      localStorage.setItem(STORAGE_KEY, 'denied')
    } catch (e) {}
    // Permanece tudo negado; nada da Google é carregado.
  }

  var stored = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch (e) {}

  // Escolha explícita anterior vence qualquer heurística (inclusive DNT).
  if (stored === 'granted') return grant()
  if (stored === 'denied') return
  // Sem escolha ainda: respeita Do Not Track como recusa silenciosa, mas NÃO
  // persiste como decisão do usuário — nada carrega (default já é denied) e, se
  // ele desligar o DNT depois, o banner volta a aparecer para ele poder optar.
  if (dnt) return

  // Sem escolha e sem DNT → mostra o banner quando o corpo existir.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner)
  } else {
    showBanner()
  }

  function showBanner() {
    if (document.getElementById('lab019-consent')) return

    var txt = isEn
      ? 'We use analytics and marketing cookies to understand how the site is used and improve your experience. It’s your call.'
      : 'Usamos cookies de análise e marketing para entender como o site é usado e melhorar sua experiência. Você decide.'
    var privHref = isEn ? '/en/privacy/' : '/privacidade/'
    var privLabel = isEn ? 'Privacy Policy' : 'Política de Privacidade'
    var accept = isEn ? 'Accept' : 'Aceitar'
    var reject = isEn ? 'Decline' : 'Recusar'
    var dialogLabel = isEn ? 'Cookie notice' : 'Aviso de cookies'

    var b = document.createElement('div')
    b.id = 'lab019-consent'
    b.className = 'consent-banner'
    b.setAttribute('role', 'region')
    b.setAttribute('aria-live', 'polite')
    b.setAttribute('aria-label', dialogLabel)
    b.innerHTML =
      '<div class="consent-inner">' +
      '<p class="consent-text">' +
      txt +
      ' <a href="' +
      privHref +
      '">' +
      privLabel +
      '</a>.</p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn btn-ghost consent-deny">' +
      reject +
      '</button>' +
      '<button type="button" class="btn btn-primary consent-accept">' +
      accept +
      '</button>' +
      '</div>' +
      '</div>'

    document.body.appendChild(b)

    function dismiss() {
      if (b.parentNode) b.parentNode.removeChild(b)
    }
    b.querySelector('.consent-accept').addEventListener('click', function () {
      grant()
      dismiss()
    })
    b.querySelector('.consent-deny').addEventListener('click', function () {
      deny()
      dismiss()
    })
  }
})()
