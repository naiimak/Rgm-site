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
    email: 'hello@jellyfit.example',
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  const whatsappNumber = () => CONFIG.whatsappNumber.replace(/\D/g, '');
  const channel = () => (whatsappNumber() ? 'WhatsApp' : 'your email app');

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
  const saveToNetlify = (form) => fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(new FormData(form)).toString(),
    keepalive: true,
  }).then((res) => res.ok, () => false);

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
      const saved = saveToNetlify(form);
      send(message);
      saved.then((ok) => {
        status.textContent = message.thanks(ok);
        status.hidden = false;
      });
    });
  });

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
