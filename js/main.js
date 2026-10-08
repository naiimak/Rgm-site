(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     Store settings: edit these before launch.
     ------------------------------------------------------------------------ */
  const CONFIG = {
    locale: 'en-US',
    currency: 'USD',
    flavor: 'Raspberry',
    // Price per pack, keyed by number of cups in the pack.
    packPrices: { 6: 18, 12: 32, 24: 58 },
    subscribeDiscount: 0.15,
    freeShippingFrom: 40,
    shippingFee: 5.95,
    // Paste a hosted checkout URL (Shopify, Stripe Payment Link, etc.) to send
    // shoppers there; the order is appended as query parameters. Leave empty to
    // open a pre-filled order email to `orderEmail` instead.
    checkoutUrl: '',
    orderEmail: 'orders@jellyfit.example',
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const money = new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency });

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
     Order form
     ------------------------------------------------------------------------ */
  const form = document.getElementById('order-form');
  const qtyInput = form.elements.qty;
  const badge = document.querySelector('[data-pack-badge]');
  const out = (name) => document.querySelector(`[data-out="${name}"]`);

  // Show the configured prices on the pack-size cards.
  form.querySelectorAll('[data-price]').forEach((el) => {
    el.textContent = money.format(CONFIG.packPrices[el.dataset.price]).replace(/\.00$/, '');
  });

  const clampQty = (n) => Math.min(20, Math.max(1, Number.isFinite(n) ? Math.round(n) : 1));

  const readOrder = () => {
    const size = Number(form.elements.size.value);
    const plan = form.elements.plan.value;
    const qty = clampQty(parseFloat(qtyInput.value));
    const subtotal = CONFIG.packPrices[size] * qty;
    const discount = plan === 'subscribe' ? subtotal * CONFIG.subscribeDiscount : 0;
    const afterDiscount = subtotal - discount;
    const shipping = afterDiscount >= CONFIG.freeShippingFrom ? 0 : CONFIG.shippingFee;
    return {
      size, plan, qty, subtotal, discount, shipping,
      cups: size * qty,
      total: afterDiscount + shipping,
      toFreeShipping: CONFIG.freeShippingFrom - afterDiscount,
    };
  };

  let lastCups = null;
  const render = () => {
    const o = readOrder();
    out('subtotal').textContent = money.format(o.subtotal);
    out('discount').textContent = `−${money.format(o.discount)}`;
    form.querySelector('[data-row="discount"]').hidden = o.discount === 0;
    out('shipping').textContent = o.shipping === 0 ? 'Free' : money.format(o.shipping);
    out('total').textContent = money.format(o.total);
    out('hint').textContent = o.shipping === 0
      ? 'You’ve unlocked free shipping.'
      : `Add ${money.format(o.toFreeShipping)} more for free shipping.`;

    out('count').textContent = o.cups;
    if (lastCups !== null && lastCups !== o.cups && !reducedMotion) {
      badge.classList.remove('is-bumping');
      void badge.offsetWidth; // restart the animation
      badge.classList.add('is-bumping');
    }
    lastCups = o.cups;
  };
  badge.addEventListener('animationend', () => badge.classList.remove('is-bumping'));

  form.addEventListener('change', (e) => {
    if (e.target === qtyInput) qtyInput.value = clampQty(parseFloat(qtyInput.value));
    render();
  });
  qtyInput.addEventListener('input', render);

  form.querySelectorAll('[data-step]').forEach((btn) => btn.addEventListener('click', () => {
    qtyInput.value = clampQty(parseFloat(qtyInput.value) + Number(btn.dataset.step));
    render();
  }));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    qtyInput.value = clampQty(parseFloat(qtyInput.value));
    const o = readOrder();
    const planLabel = o.plan === 'subscribe' ? 'Subscribe & save (every 4 weeks)' : 'One-time purchase';

    if (CONFIG.checkoutUrl) {
      const url = new URL(CONFIG.checkoutUrl, window.location.href);
      url.searchParams.set('size', o.size);
      url.searchParams.set('plan', o.plan);
      url.searchParams.set('qty', o.qty);
      window.location.href = url.toString();
      return;
    }

    const body = [
      'Hi JellyFit, I’d like to order:',
      '',
      `Flavor: ${CONFIG.flavor}`,
      `Pack size: ${o.size} cups`,
      `Packs: ${o.qty}`,
      `Plan: ${planLabel}`,
      `Estimated total: ${money.format(o.total)}`,
      '',
      'Name:',
      'Delivery address:',
      'Phone:',
    ].join('\n');
    const subject = `Order: ${o.qty} × ${o.size}-cup ${CONFIG.flavor}`;
    window.location.href = `mailto:${CONFIG.orderEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });

  render();

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
