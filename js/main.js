(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     Store settings: edit these before launch.
     ------------------------------------------------------------------------ */
  const CONFIG = {
    locale: 'en-US',
    currency: 'USD',
    // Price per box, keyed by number of pouches in the box.
    boxPrices: { 6: 16, 12: 29, 24: 52 },
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
     Hero: flavor preview + squeeze-to-wobble
     ------------------------------------------------------------------------ */
  const dots = [...document.querySelectorAll('.flavor-dot')];
  const flavorName = document.querySelector('[data-flavor-name]');
  const wobbleBtn = document.querySelector('[data-wobble]');

  const wobble = () => {
    if (reducedMotion) return;
    wobbleBtn.classList.remove('is-wobbling');
    void wobbleBtn.offsetWidth; // restart the animation
    wobbleBtn.classList.add('is-wobbling');
  };
  wobbleBtn.addEventListener('animationend', (e) => {
    if (e.animationName === 'wobble') wobbleBtn.classList.remove('is-wobbling');
  });

  const showFlavor = (dot) => {
    dots.forEach((d) => d.setAttribute('aria-pressed', String(d === dot)));
    document.documentElement.dataset.flavor = dot.dataset.flavor;
    flavorName.textContent = dot.dataset.name;
    wobble();
  };

  // Gently cycle flavors while the hero is on screen, until the visitor picks one.
  let cycleTimer = null;
  let visitorPicked = false;
  const stopCycle = () => { clearInterval(cycleTimer); cycleTimer = null; };
  const startCycle = () => {
    if (reducedMotion || cycleTimer || visitorPicked) return;
    cycleTimer = setInterval(() => {
      const current = dots.findIndex((d) => d.getAttribute('aria-pressed') === 'true');
      showFlavor(dots[(current + 1) % dots.length]);
    }, 3500);
  };

  dots.forEach((dot) => dot.addEventListener('click', () => {
    visitorPicked = true;
    stopCycle();
    showFlavor(dot);
  }));
  wobbleBtn.addEventListener('click', wobble);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) startCycle();
      else stopCycle();
    }, { threshold: 0.4 }).observe(document.querySelector('.hero'));
  }

  /* ------------------------------------------------------------------------
     Order form
     ------------------------------------------------------------------------ */
  const form = document.getElementById('order-form');
  const qtyInput = form.elements.qty;
  const preview = document.querySelector('[data-preview]');
  const out = (name) => form.querySelector(`[data-out="${name}"]`);

  // Show the configured prices on the box-size cards.
  form.querySelectorAll('[data-price]').forEach((el) => {
    const price = CONFIG.boxPrices[el.dataset.price];
    el.textContent = money.format(price).replace(/\.00$/, '');
  });

  const clampQty = (n) => Math.min(20, Math.max(1, Number.isFinite(n) ? Math.round(n) : 1));

  const readOrder = () => {
    const flavorInput = form.querySelector('input[name="flavor"]:checked');
    const size = Number(form.elements.size.value);
    const plan = form.elements.plan.value;
    const qty = clampQty(parseFloat(qtyInput.value));
    const subtotal = CONFIG.boxPrices[size] * qty;
    const discount = plan === 'subscribe' ? subtotal * CONFIG.subscribeDiscount : 0;
    const afterDiscount = subtotal - discount;
    const shipping = afterDiscount >= CONFIG.freeShippingFrom ? 0 : CONFIG.shippingFee;
    return {
      flavor: flavorInput.value,
      flavorLabel: flavorInput.nextElementSibling.textContent.trim(),
      size, plan, qty, subtotal, discount, shipping,
      total: afterDiscount + shipping,
      toFreeShipping: CONFIG.freeShippingFrom - afterDiscount,
    };
  };

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

    preview.dataset.flavor = o.flavor;
    preview.querySelectorAll('[data-pouch]').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.pouch === o.flavor);
    });
  };

  form.addEventListener('change', (e) => {
    if (e.target === qtyInput) qtyInput.value = clampQty(parseFloat(qtyInput.value));
    render();
  });
  qtyInput.addEventListener('input', render);

  form.querySelectorAll('[data-step]').forEach((btn) => btn.addEventListener('click', () => {
    qtyInput.value = clampQty(parseFloat(qtyInput.value) + Number(btn.dataset.step));
    render();
  }));

  // "Choose …" buttons in the flavor section pre-select that flavor.
  document.querySelectorAll('[data-choose]').forEach((link) => link.addEventListener('click', () => {
    const radio = form.querySelector(`input[name="flavor"][value="${link.dataset.choose}"]`);
    if (radio) {
      radio.checked = true;
      render();
    }
  }));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    qtyInput.value = clampQty(parseFloat(qtyInput.value));
    const o = readOrder();
    const planLabel = o.plan === 'subscribe' ? 'Subscribe & save (every 4 weeks)' : 'One-time purchase';

    if (CONFIG.checkoutUrl) {
      const url = new URL(CONFIG.checkoutUrl, window.location.href);
      url.searchParams.set('flavor', o.flavor);
      url.searchParams.set('size', o.size);
      url.searchParams.set('plan', o.plan);
      url.searchParams.set('qty', o.qty);
      window.location.href = url.toString();
      return;
    }

    const body = [
      'Hi JellyFit, I’d like to order:',
      '',
      `Flavor: ${o.flavorLabel}`,
      `Box size: ${o.size} pouches`,
      `Boxes: ${o.qty}`,
      `Plan: ${planLabel}`,
      `Estimated total: ${money.format(o.total)}`,
      '',
      'Name:',
      'Shipping address:',
      'Phone:',
    ].join('\n');
    const subject = `Order: ${o.qty} × ${o.size}-pouch ${o.flavorLabel}`;
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
