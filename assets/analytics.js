/* Consent-gated Google Analytics 4 loader.
 *
 * Usage (once per page, before </body>):
 *   <script src="/assets/analytics.js" defer data-ga-id="G-XXXXXXXXXX" data-require-consent="true"></script>
 *
 * - No data-ga-id (or an invalid one): this script does nothing: no banner, no cookies, no requests.
 * - data-require-consent="true" (the default): nothing is loaded from Google until the visitor
 *   presses Accept. Decline is remembered. A browser "Do Not Track" or Global Privacy Control
 *   signal counts as a decline, without showing a banner.
 * - data-require-consent="false": loads immediately. Only choose this where the law of your
 *   visitors' countries allows analytics without consent, and say so in the privacy policy.
 * - Elements with data-cookie-settings reopen the choice (put a link in the footer).
 * - Elements with data-analytics-event="generate_lead" (e.g. on the thank-you page) send that
 *   GA4 event once analytics is loaded.
 *
 * - Once analytics is loaded (so only after consent) it also reports the funnel, as GA4 events:
 *     scroll_depth  {percent: 25 | 50 | 75 | 90}, once each per page view
 *     cta_click     {cta, label}   clicks on [data-cta] (data-cta="primary" etc.)
 *     phone_click / email_click    clicks on tel: and mailto: links (no label: the number or address is not reported)
 *     any element with data-track="event_name" sends that event when clicked
 *   Parameters are the element's own words (button label, up to 40 characters), never form values.
 *   Form completion is the generate_lead event on the thank-you page (data-analytics-event above).
 *
 * This is a starting point, not legal advice: check the consent rules that apply to you.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var id = ((script && script.getAttribute('data-ga-id')) || '').trim();
  if (!/^G-[A-Z0-9]{6,12}$/.test(id)) return; // not configured

  // Banner wording defaults to English; set data-consent-text, data-accept, data-decline and data-consent-label to translate.
  var TEXT = {
    label: (script && script.getAttribute('data-consent-label')) || 'Analytics cookies',
    text: (script && script.getAttribute('data-consent-text')) || 'We would like to use analytics cookies to see how the site is used and improve it. Nothing is sent to Google unless you accept.',
    accept: (script && script.getAttribute('data-accept')) || 'Accept',
    decline: (script && script.getAttribute('data-decline')) || 'Decline'
  };
  var requireConsent = !script || script.getAttribute('data-require-consent') !== 'false';
  var KEY = 'poc-analytics-consent';
  var banner = null;

  function read() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function write(value) {
    try { window.localStorage.setItem(KEY, value); } catch (e) { /* storage unavailable: choice lasts for this page only */ }
  }
  function optedOutBySignal() {
    return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  }

  function load() {
    if (window.__pocAnalyticsLoaded) return;
    window.__pocAnalyticsLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id);
    var tag = document.createElement('script');
    tag.async = true;
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(tag);
    var events = document.querySelectorAll('[data-analytics-event]');
    for (var i = 0; i < events.length; i++) {
      window.gtag('event', events[i].getAttribute('data-analytics-event'));
    }
    trackFunnel();
  }

  var tracking = false;
  function trackFunnel() {
    if (tracking) return;
    tracking = true;

    // scroll depth: 25/50/75/90 percent of the page, each reported once
    var marks = [25, 50, 75, 90], sent = {}, queued = false;
    function depth() {
      queued = false;
      var doc = document.documentElement;
      var total = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
      if (!total) return;
      var seen = Math.round(((window.pageYOffset || doc.scrollTop || 0) + (window.innerHeight || doc.clientHeight || 0)) / total * 100);
      for (var m = 0; m < marks.length; m++) {
        if (seen >= marks[m] && !sent[marks[m]]) {
          sent[marks[m]] = true;
          window.gtag('event', 'scroll_depth', { percent: marks[m] });
        }
      }
    }
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || window.setTimeout)(depth);
    }, { passive: true });
    depth(); // a short page can already be fully in view

    // clicks on calls to action, phone and email links
    function label(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); }
    document.addEventListener('click', function (e) {
      var node = e.target && e.target.closest ? e.target.closest('a, button, [data-cta], [data-track]') : null;
      if (!node) return;
      var custom = node.closest('[data-track]');
      if (custom) window.gtag('event', custom.getAttribute('data-track'), { label: label(custom) });
      var cta = node.closest('[data-cta]');
      if (cta) window.gtag('event', 'cta_click', { cta: cta.getAttribute('data-cta') || 'cta', label: label(cta) });
      var link = node.closest('a[href]');
      var href = link ? link.getAttribute('href') : '';
      if (/^tel:/i.test(href)) window.gtag('event', 'phone_click');
      else if (/^mailto:/i.test(href)) window.gtag('event', 'email_click');
    }, true);
  }

  function closeBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  function showBanner() {
    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', TEXT.label);

    var text = document.createElement('p');
    text.textContent = TEXT.text;

    var row = document.createElement('div');
    row.className = 'btn-row';
    var accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'btn';
    accept.textContent = TEXT.accept;
    var decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'btn btn-secondary';
    decline.textContent = TEXT.decline;

    accept.addEventListener('click', function () { write('granted'); closeBanner(); load(); });
    decline.addEventListener('click', function () { write('denied'); closeBanner(); });

    row.appendChild(accept);
    row.appendChild(decline);
    banner.appendChild(text);
    banner.appendChild(row);
    document.body.appendChild(banner);
  }

  function start() {
    var openers = document.querySelectorAll('[data-cookie-settings]');
    for (var i = 0; i < openers.length; i++) {
      openers[i].addEventListener('click', function (e) {
        e.preventDefault();
        if (!requireConsent) return;
        write('');
        showBanner();
      });
    }

    if (!requireConsent) return load();
    if (optedOutBySignal()) return;
    var choice = read();
    if (choice === 'granted') return load();
    if (choice === 'denied') return;
    showBanner();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
