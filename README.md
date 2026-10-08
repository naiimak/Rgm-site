# Rgm-site

Marketing and ordering site for **JellyFit**, a ready-to-eat raspberry protein jelly cup.

**Product facts (from the cup):** 20g complete protein from whey isolate, less than 1g sugar, 95 kcal, halal.

It's a static site (plain HTML, CSS and JavaScript) with no build step and no dependencies, so it runs on any static host.

## Run it locally

```bash
npx serve .            # or: python3 -m http.server 8080
```

Then open the URL it prints. You can also open `index.html` directly in a browser.

## What's on the page

| Section | Notes |
| --- | --- |
| Hero | Cup photo with protein, sugar, calorie and halal callouts |
| Why JellyFit | The four headline numbers, explained |
| When to eat | After training, between meals, after dinner |
| Nutrition | Per-cup panel with the values printed on the cup |
| Order | Pack size, one-time or subscribe, quantity and a live total |
| FAQ | Expandable questions, including the milk allergen note |

## Files

```
index.html                       page content
css/styles.css                   all styles; brand colors are tokens at the top
js/main.js                       store settings (CONFIG) and interactions
assets/jellyfit-raspberry.webp   cup photo, cropped for the page (.jpg fallback alongside)
assets/jellyfit-raspberry-wide.jpg  full photo for social sharing previews
assets/favicon.svg
```

## Before you launch

The product facts come from the cup design. The commercial details are **placeholders**:

1. **Prices, discount and shipping** are in `CONFIG` at the top of `js/main.js`. The pack-size cards read their prices from there. The free-shipping threshold and subscribe discount are also written into the announcement bar and the order form in `index.html`, so update those too.
2. **Checkout.** By default, "Order now" opens a pre-filled order email to `CONFIG.orderEmail`. To send shoppers to a hosted checkout instead (Shopify, a Stripe Payment Link, etc.), set `CONFIG.checkoutUrl`. The pack size, plan and quantity are appended as query parameters.
3. **Email addresses.** Search for `jellyfit.example` and replace every occurrence with your real addresses.
4. **Full nutrition label.** The nutrition panel shows only what's printed on the cup. When you have the full label, add the remaining rows (fat, carbohydrate, sodium, etc.) and the ingredient list in the `#nutrition` section of `index.html`.
5. **Social preview image.** The `og:image` tag needs an absolute URL once you know your domain.
6. **More flavors.** The order email uses `CONFIG.flavor`. Adding a second flavor would need a flavor picker in the order form.

## Deploy

**GitHub Pages:** go to *Settings → Pages*, choose *Deploy from a branch*, then pick `main` and `/ (root)`.

Netlify, Vercel and Cloudflare Pages also work. There's no build command, and the publish directory is the repository root.
