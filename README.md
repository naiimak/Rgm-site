# Rgm-site

Pre-launch website for **JellyFit**, a chilled protein jelly cup. Tagline: "Protein you actually crave."

**Product (target spec):** 100g cup, 20g complete protein from whey isolate, under 1g sugar, about 95 kcal, halal by design (agar base + halal-certified bovine gelatin). Launch flavors: Raspberry and Mango. Launching first in Beirut gyms.

It's a static site (plain HTML, CSS and JavaScript) with no build step and no dependencies, so it runs on any static host.

## Run it locally

```bash
npx serve .            # or: python3 -m http.server 8080
```

Then open the URL it prints. You can also open `index.html` directly in a browser.

## What's on the page

| Section | Purpose |
| --- | --- |
| Hero | Tagline, floating cup (cut out from the packshot), headline numbers |
| Why JellyFit | 20g complete protein, <1g sugar, ~95 kcal, halal by design |
| Complete protein | Whey isolate (9 of 9 essential amino acids) vs collagen (8 of 9), plus the protein promise |
| Flavors | Raspberry and Mango |
| Nutrition | Target values per 100g cup, marked as targets |
| Join the list | Consumer sign-up that opens WhatsApp pre-filled with name, gym, flavor and "what caught your eye" |
| For gyms | Pilot enquiry form for gym owners and venues |
| FAQ | Availability, complete protein, halal, allergens, storage, GCC plans |

## The protein claim rule

The hero number is whey isolate protein only, always labelled "complete protein, from whey isolate". If collagen is ever added, it is listed separately and smaller and is never added into the 20g. Keep any copy changes consistent with this.

## Before you launch

1. **WhatsApp number.** Set `CONFIG.whatsappNumber` at the top of `js/main.js` (digits only, with country code, e.g. `9613123456`). Until it's set, both forms open a pre-filled email instead.
2. **Email address.** Replace `hello@jellyfit.example` in `js/main.js` and `index.html`.
3. **Nutrition values.** The panel shows target values and says so. Once the formula is locked, replace them with lab-confirmed values, add the remaining rows (fat, carbohydrate, sodium) and the ingredient list, and remove the "target" wording.
4. **Mango packshot.** The flavor cards use an illustrated jelly. Real packshots can replace or sit alongside it.
5. **Floating cup.** `assets/jellyfit-raspberry-cup.webp` is the Raspberry packshot with the background removed (PNG fallback alongside). To swap in a new packshot, export it with a transparent background at a similar size. The float speed and height are in the `float` keyframes in `css/styles.css`; it stops for visitors who have reduced motion turned on.
6. **Social preview image.** The `og:image` tag needs an absolute URL once you know your domain.

## Deploy

**GitHub Pages:** go to *Settings → Pages*, choose *Deploy from a branch*, then pick `main` and `/ (root)`.

Netlify, Vercel and Cloudflare Pages also work. There's no build command, and the publish directory is the repository root.
