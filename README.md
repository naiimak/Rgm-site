# Rgm-site

Marketing and ordering site for **JellyFit**, a squeezable energy jelly.

It's a static site (plain HTML, CSS and JavaScript) with no build step and no dependencies, so it runs on any static host.

## Run it locally

```bash
npx serve .            # or: python3 -m http.server 8080
```

Then open the URL it prints. You can also open `index.html` directly in a browser.

## What's on the page

| Section | Notes |
| --- | --- |
| Hero | Flavor dots recolor the pouch and the site accent. Click the pouch to wobble it. |
| Benefits | Four feature cards |
| How to use | Before / during / after timing |
| Flavors | Four flavor cards. "Choose" pre-selects the flavor in the order form. |
| Nutrition | Facts panel, ingredient list and dietary tags |
| Order | Flavor, box size, one-time or subscribe, quantity, and a live total |
| FAQ | Expandable questions |

## Files

```
index.html        page content and the shared SVG pouch artwork
css/styles.css    all styles; flavor colors are tokens at the top
js/main.js        store settings (CONFIG) and interactions
assets/favicon.svg
```

## Before you launch

All product details are **placeholder copy**. Replace them with your real information:

1. **Nutrition facts and ingredients** in the `#nutrition` section of `index.html`. These must match your product label.
2. **Claims and tags** ("Plant-based", "Gluten-free", "Caffeine-free", "Recyclable pouch", etc.) in the hero, nutrition section and FAQ. Keep only the ones that are true for your product.
3. **Prices, discount and shipping** in `CONFIG` at the top of `js/main.js`. The box-size cards read their prices from there. The free-shipping threshold, the subscribe discount and the shipping fee are also written into the announcement bar and the FAQ text in `index.html`, so update those too.
4. **Checkout.** By default, "Order now" opens a pre-filled order email to `CONFIG.orderEmail`. To send shoppers to a hosted checkout instead (Shopify, a Stripe Payment Link, etc.), set `CONFIG.checkoutUrl`. The flavor, size, plan and quantity are appended as query parameters.
5. **Email addresses.** Search for `jellyfit.example` and replace every occurrence with your real addresses.
6. **Flavors.** Names and descriptions are in `index.html`. Colors are the `--strawberry`, `--mango`, `--lime` and `--blueberry` tokens in `css/styles.css`.

## Deploy

**GitHub Pages:** go to *Settings → Pages*, choose *Deploy from a branch*, then pick `main` and `/ (root)`.

Netlify, Vercel and Cloudflare Pages also work. There's no build command, and the publish directory is the repository root.
