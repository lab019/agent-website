/*
 * Sign-up CTA for lab019.ai
 * Every <a data-signup> ("Testar grátis") points to the sign-up screen of the
 * platform and carries the utm_* params of the current page, so the account is
 * tied to its origin. The destination lives only here (SIGNUP_URL). Without JS
 * the link keeps its fallback href (the platform entry).
 */
;(function () {
  'use strict'

  var SIGNUP_URL = 'https://app.lab019.ai/signup'

  // search: location.search of the current page; keeps only utm_* params.
  function buildSignupUrl(search) {
    var params = new URLSearchParams(search || '')
    var utm = new URLSearchParams()
    params.forEach(function (value, key) {
      if (/^utm_/i.test(key)) utm.append(key, value)
    })
    var query = utm.toString()
    return query ? SIGNUP_URL + '?' + query : SIGNUP_URL
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildSignupUrl: buildSignupUrl }
  }
  if (typeof document === 'undefined') return

  function apply() {
    var url = buildSignupUrl(window.location.search)
    var links = document.querySelectorAll('a[data-signup]')
    for (var i = 0; i < links.length; i++) links[i].setAttribute('href', url)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply)
  } else {
    apply()
  }
})()
