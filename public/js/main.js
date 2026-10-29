(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     Settings: edit these before launch.
     ------------------------------------------------------------------------ */
  const CONFIG = {
    // WhatsApp number in international format, digits only, e.g. '9613123456'
    // for a Lebanese mobile. While empty, the forms open a pre-filled email to
    // `email` instead.
    whatsappNumber: '',
    email: 'hello@jellyfit.online',
    // Google Analytics 4 measurement ID, e.g. 'G-ABC123XYZ' (Admin > Data
    // streams in Google Analytics). While empty, no analytics code is loaded.
    ga4Id: '',
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------------
     Analytics: Google Analytics 4, loaded only once CONFIG.ga4Id is set.
     `track(name, params)` sends an event, or does nothing while it's off.
     ------------------------------------------------------------------------ */
  const track = (() => {
    const id = String(CONFIG.ga4Id || '').trim().toUpperCase();
    if (!/^G-[A-Z0-9]+$/.test(id)) return () => {};
    window.dataLayer = window.dataLayer || [];
    // gtag expects the `arguments` object itself, not an array.
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id);
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.append(script);
    return (name, params = {}) => window.gtag('event', name, params);
  })();

  /* ------------------------------------------------------------------------
     Where visitors come from: utm_* links (e.g. a QR code in a gym) and the
     referring website are saved with every sign-up in Netlify Forms. The
     first source seen in a visit is kept, so a reload doesn't lose it, but a
     tagged link always replaces it. The field is `referring_site` because
     Netlify adds its own `referrer` (the page the form was sent from).
     ------------------------------------------------------------------------ */
  const source = (() => {
    const params = new URLSearchParams(window.location.search);
    let referringSite = '';
    try {
      const host = new URL(document.referrer).hostname;
      if (host !== window.location.hostname) referringSite = host;
    } catch (e) { /* no referrer */ }
    const current = {
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      referring_site: referringSite,
    };
    try {
      const saved = JSON.parse(sessionStorage.getItem('jf-source'));
      if (saved && !current.utm_source) return saved;
      if (Object.values(current).some(Boolean)) sessionStorage.setItem('jf-source', JSON.stringify(current));
    } catch (e) { /* storage unavailable: use this page view's values */ }
    return current;
  })();
  // Links can carry anything in their utm_ tags, so keep each value short.
  document.querySelectorAll('[data-source-field]').forEach((input) => { input.value = String(source[input.name] || '').slice(0, 100); });

  /* ------------------------------------------------------------------------
     Header: shadow on scroll + mobile menu
     ------------------------------------------------------------------------ */
  const header = document.querySelector('[data-header]');
  const navToggle = document.querySelector('[data-nav-toggle]');

  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const setMenu = (open) => {
    header.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
  };
  navToggle.addEventListener('click', () => setMenu(!header.classList.contains('is-open')));
  header.querySelectorAll('.site-nav a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && header.classList.contains('is-open')) {
      setMenu(false);
      navToggle.focus();
    }
  });

  /* ------------------------------------------------------------------------
     Forms: each submission is saved to Netlify Forms (visible in the Netlify
     dashboard even if the visitor never presses send), then WhatsApp (or
     email) opens with the same details pre-filled.
     ------------------------------------------------------------------------ */
  // Optional fields that were left empty become null and are dropped.
  const MESSAGES = {
    join: (f) => ({
      subject: 'Add me to the JellyFit list',
      thanks: (saved) => (saved
        ? `Thanks, ${f.name}, you're on the list! Press send in ${channel()} too, so we can message you back.`
        : `Thanks, ${f.name}! Press send in ${channel()} to join the list.`),
      lines: [
        'Hi JellyFit! Please add me to the WhatsApp list.',
        '',
        `Name: ${f.name}`,
        `WhatsApp: ${f.phone}`,
        f.gym ? `My gym: ${f.gym}` : null,
        `Flavor I want first: ${f.flavor}`,
        f.reason ? `What caught my eye: ${f.reason}` : null,
      ],
    }),
    gym: (f) => ({
      subject: `JellyFit pilot: ${f.venue}`,
      thanks: (saved) => (saved
        ? `Thanks, ${f.name}! We've got your details and will be in touch about the pilot.`
        : `Thanks, ${f.name}! Press send in ${channel()} and we'll be in touch about the pilot.`),
      lines: [
        "Hi JellyFit, I'd like to talk about stocking JellyFit.",
        '',
        `Name: ${f.name}`,
        `Phone: ${f.phone}`,
        `Gym or venue: ${f.venue}`,
        f.area ? `Area: ${f.area}` : null,
      ],
    }),
  };

  const whatsappNumber = () => String(CONFIG.whatsappNumber || '').replace(/\D/g, '');
  const channelKey = () => (whatsappNumber() ? 'whatsapp' : 'email');
  const channel = () => (channelKey() === 'whatsapp' ? 'WhatsApp' : 'your email app');

  const send = ({ subject, lines }) => {
    const text = lines.filter((line) => line !== null).join('\n');
    const number = whatsappNumber();
    if (number) {
      window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } else {
      window.location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    }
  };

  // Resolves to true once Netlify has stored the submission. `keepalive` lets
  // the request finish even if the visitor switches to WhatsApp straight away.
  // A redirected POST (e.g. sent from the old netlify.app address) comes back
  // as a 200 page but stores nothing, so it doesn't count.
  const saveToNetlify = (form) => fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(new FormData(form)).toString(),
    keepalive: true,
  }).then((res) => res.ok && !res.redirected, () => false);

  const isFilled = (input) => (input.type === 'tel'
    ? input.value.replace(/\D/g, '').length >= 7
    : input.value.trim() !== '');

  document.querySelectorAll('[data-wa-form]').forEach((form) => {
    const error = form.querySelector('[data-form-error]');
    const status = form.querySelector('[data-form-status]');
    const required = [...form.querySelectorAll('[required]')];

    required.forEach((input) => input.addEventListener('input', () => {
      if (isFilled(input)) input.removeAttribute('aria-invalid');
    }));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // Ignore a second click while the first submission is still being saved.
      if (form.dataset.sending) return;
      const missing = required.filter((input) => !isFilled(input));
      required.forEach((input) => {
        if (missing.includes(input)) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      });
      error.hidden = missing.length === 0;
      if (missing.length) {
        status.hidden = true;
        missing[0].focus();
        return;
      }

      const fields = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));
      const message = MESSAGES[form.dataset.waForm](fields);
      // Start saving first, then open WhatsApp in the same click so pop-up
      // blockers allow it.
      form.dataset.sending = 'true';
      const saved = saveToNetlify(form);
      send(message);
      saved.then((ok) => {
        delete form.dataset.sending;
        if (ok) track('generate_lead', { form_name: form.getAttribute('name'), method: channelKey() });
        status.textContent = message.thanks(ok);
        status.hidden = false;
      });
    });
  });

  // Clicks on the main calls to action, and which FAQ questions get opened.
  document.querySelectorAll('a[href="#join"], a[href="#gyms"]').forEach((link) => link.addEventListener('click', () => {
    track('cta_click', { cta_text: link.textContent.trim(), cta_target: link.getAttribute('href').slice(1) });
  }));
  // The click runs before the question opens, so `open` is still false when
  // someone opens it. Opening by find-in-page or a highlight link isn't a click.
  document.querySelectorAll('.faq summary').forEach((summary) => summary.addEventListener('click', () => {
    if (!summary.parentElement.open) track('faq_open', { question: summary.textContent.trim() });
  }));

  /* ------------------------------------------------------------------------
     Scroll reveal + footer year
     ------------------------------------------------------------------------ */
  const revealables = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reducedMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealables.forEach((el) => io.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add('is-visible'));
  }

  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
})();
