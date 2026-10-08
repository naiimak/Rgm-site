# Rgm-site

Pre-launch website for **JellyFit**, a chilled protein jelly cup. Tagline: "Protein you actually crave."

**Product (target spec):** 100g cup, 20g complete protein from whey isolate, under 1g sugar, about 95 kcal, halal by design (agar base + halal-certified bovine gelatin). Launch flavors: Raspberry and Mango. Launching first in Beirut gyms.

It's a static site (plain HTML, CSS and JavaScript) with no build step and no dependencies. Everything that goes online lives in `public/`; anything else in the repo (this README, notes, documents) is never published.

## Run it locally

```bash
npx serve public       # or: python3 -m http.server 8080 --directory public
```

Then open the URL it prints. You can also open `public/index.html` directly in a browser.

## What's on the page

| Section | Purpose |
| --- | --- |
| Hero | Tagline, floating cup (cut out from the packshot), headline numbers |
| Why JellyFit | 20g complete protein, <1g sugar, ~95 kcal, halal by design |
| Complete protein | Whey isolate (9 of 9 essential amino acids) vs collagen (8 of 9), plus the protein promise |
| Flavors | Raspberry and Mango |
| Nutrition | Target values per 100g cup, marked as targets |
| Join the list | Consumer sign-up (name, WhatsApp number, gym, flavor, "what caught your eye"). Saved to Netlify Forms, then opens WhatsApp pre-filled |
| For gyms | Pilot enquiry form for gym owners (name, phone, venue, area). Saved to Netlify Forms, then opens WhatsApp pre-filled |
| FAQ | Availability, complete protein, halal, allergens, storage, GCC plans |

## The protein claim rule

The hero number is whey isolate protein only, always labelled "complete protein, from whey isolate". If collagen is ever added, it is listed separately and smaller and is never added into the 20g. Keep any copy changes consistent with this.

Gelatin is made from collagen, so the site says plainly that the jelly is set with a little gelatin whose protein isn't counted in the 20g. The site makes no skin or joint claims: those are health claims that need regulatory approval in the GCC, and the gelatin dose is set by the formula, not by any clinical evidence.

The mandatory nutrition table on the pack has to show **total** protein (whey plus gelatin), so it will read slightly above 20g. The 20g complete-protein figure belongs on the front of pack and in marketing.

## Before you launch

1. **WhatsApp number.** Set `CONFIG.whatsappNumber` at the top of `public/js/main.js` (digits only, with country code, e.g. `9613123456`). Until it's set, both forms open a pre-filled email instead.
2. **Email address.** Replace `hello@jellyfit.example` in `public/js/main.js` and `public/index.html`.
3. **Nutrition values.** The panel shows target values and says so. Once the formula is locked, replace them with lab-confirmed values, add the remaining rows (fat, carbohydrate, sodium) and the ingredient list, and remove the "target" wording.
4. **Mango packshot.** The flavor cards use an illustrated jelly. Real packshots can replace or sit alongside it.
5. **Floating cup.** `public/assets/jellyfit-raspberry-cup.webp` is the Raspberry packshot with the background removed (PNG fallback alongside). To swap in a new packshot, export it with a transparent background at a similar size. The float speed and height are in the `float` keyframes in `public/css/styles.css`; it stops for visitors who have reduced motion turned on.
6. **Social preview image.** The `og:image` tag needs an absolute URL once you know your domain.

## Deploy (Netlify)

`netlify.toml` already tells Netlify what to publish (`public/`, no build command), so there's nothing to configure.

1. Sign up at [netlify.com](https://www.netlify.com) with your GitHub account.
2. **Add new project → Import an existing project → GitHub**, allow Netlify to see `Rgm-site`, and pick it.
3. Choose the branch to deploy (`main`), leave the build settings as Netlify fills them in, and click **Deploy**.
4. Rename the project (for example `jellyfit`) to get a `jellyfit.netlify.app` address, or connect your own domain under **Domain management**.

After that, every push to the deployed branch updates the site automatically. On Netlify's free plan each production deploy uses part of the monthly credit allowance, so batch small changes into one push where you can.

### Collecting sign-ups (Netlify Forms)

Both forms (`waitlist` and `gym-pilot`) are Netlify forms. Every submission is saved in Netlify, even if the visitor never presses send in WhatsApp, and then WhatsApp opens with the same details. Form submissions don't use credits on Netlify's credit-based plans.

One-time setup after the first deploy:

1. In your Netlify project, open **Forms** and click **Enable form detection**.
2. Redeploy so Netlify finds the forms: **Deploys → Trigger deploy → Deploy project**. The `waitlist` and `gym-pilot` forms then appear under **Forms**.
3. To get an email for each sign-up: **Project configuration → Notifications → Form submission notifications → Add notification → Email notification**, choose the form and enter your address.

Submissions can be downloaded as a CSV from each form's page. A hidden honeypot field filters out basic spam bots. Locally (`npx serve public`) nothing is saved, but WhatsApp or email still opens.
