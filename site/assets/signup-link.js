/*
 * Sign-up CTA for lab019.ai
 * Every <a data-signup> ("Testar grátis", "Testar a plataforma") points to the
 * sign-up screen of the platform and carries the utm_*, gclid and fbclid params
 * of the current page, so the account is tied to its origin. A link with
 * data-theme (topic pages) also carries that theme. The destination lives only here (SIGNUP_URL). Without JS
 * the link keeps its fallback href (the platform entry).
 */
;(function () {
  'use strict'

  var SIGNUP_URL = 'https://app.lab019.ai/signup'

  // search: location.search of the current page; keeps only the tracking params.
  // theme: optional topic theme of the page.
  function buildSignupUrl(search, theme) {
    var params = new URLSearchParams(search || '')
    var kept = new URLSearchParams()
    params.forEach(function (value, key) {
      if (/^utm_/i.test(key) || key === 'gclid' || key === 'fbclid') kept.append(key, value)
    })
    if (theme) kept.append('theme', theme)
    var query = kept.toString()
    return query ? SIGNUP_URL + '?' + query : SIGNUP_URL
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildSignupUrl: buildSignupUrl }
  }
  if (typeof document === 'undefined') return

  function apply() {
    var links = document.querySelectorAll('a[data-signup]')
    for (var i = 0; i < links.length; i++) {
      var url = buildSignupUrl(window.location.search, links[i].getAttribute('data-theme'))
      links[i].setAttribute('href', url)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply)
  } else {
    apply()
  }
})()
