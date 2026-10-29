# Rgm-site

Pre-launch website for **JellyFit**, a chilled protein jelly cup. Tagline: "Protein you actually crave."

Live at **https://jellyfit.online** (Netlify project `jellyfit28`).

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
| FAQ | Availability, shake/bar comparison, complete protein, halal, allergens, storage, GCC plans |

## Search engines (SEO)

- **Title and description** in the `<head>` of `public/index.html` are what Google shows in results. Keep the title under about 60 characters and the description under about 160.
- **Structured data:** the `application/ld+json` block in the `<head>` describes JellyFit (Organization, WebSite) and repeats the FAQ. After editing the FAQ or any fact on the page, run `python3 scripts/sync-structured-data.py`: it copies the FAQ into that block and sets today's date in the block, `sitemap.xml` and `llms.txt`. `--check` only reports differences.
- **`robots.txt` and `sitemap.xml`** are in `public/`. The sitemap's `<lastmod>` is set by the sync script above.
- **`404.html`** is the branded "page not found" page Netlify shows for any missing address.
- **One address:** `netlify.toml` forwards `jellyfit28.netlify.app` to `https://jellyfit.online`, so Google only indexes the real domain.
- **Fonts** (Poppins 800 and DM Sans, trimmed to the 400–700 weights the site uses) are served from `public/fonts/`, not from Google Fonts, so text can render without waiting on another server. Latin Extended files load only when a page needs one of their letters. `netlify.toml` lets browsers keep font files for a year, so their names carry a fingerprint of their contents: if a font changes, give the file a new name and update `css/styles.css` and the two preload links in `index.html`.

## AI assistants (ChatGPT, Claude, Perplexity, Google AI answers)

- **`llms.txt`** in `public/` is a plain-text fact sheet about JellyFit for AI assistants: key facts, the protein claim, and links. Its facts are written by hand: keep them in step with the page whenever a fact changes (price, where to buy, nutrition, flavors). The sync script updates its date.
- `robots.txt` lets every crawler in, AI crawlers included. Everything on the page is plain HTML, so crawlers that don't run JavaScript still see all of it.
- The FAQ answers the questions people ask chatbots (what it is, ingredients, price, where to buy, halal, allergens). The structured data repeats it: run the sync script after any FAQ change.

## Tracking

**Where sign-ups come from.** Each form saves `utm_source`, `utm_medium`, `utm_campaign` and `referring_site` (the website the visitor came from) with the submission. A tagged link always replaces an earlier, untagged source in the same visit. Netlify also adds its own `referrer` column, which is the page the form was sent from, so you can see them in Netlify Forms. Use tagged links wherever you share the site, for example:

- Gym QR code: `https://jellyfit.online/?utm_source=gym-name&utm_medium=qr&utm_campaign=pilot`
- Instagram bio: `https://jellyfit.online/?utm_source=instagram&utm_medium=bio`

**Google Analytics 4 (optional).** Create a GA4 property, copy its measurement ID (`G-…`) into `CONFIG.ga4Id` in `public/js/main.js`, and push. Until then no analytics code loads. Once on, it records page views plus these events:

| Event | When |
| --- | --- |
| `generate_lead` | A waitlist or gym form is saved in Netlify Forms (`form_name`, `method`) |
| `cta_click` | A "Join the list" or "For gyms" button or link is clicked |
| `faq_open` | Someone clicks an FAQ question open (`question`); questions opened by the browser for find-in-page or highlight links don't count |

In GA4, mark `generate_lead` as a key event. Google Analytics uses cookies, so if you run ads or target visitors in the EU or UAE, add a consent banner before turning it on.

## Security

The site is static: there are no logins, passwords, database, API keys or file uploads. The only data it collects is the two sign-up forms, which Netlify Forms stores in the Netlify account.

- **Security headers** (in `netlify.toml`, for every page):
  - `Content-Security-Policy` lets the browser run only this site's own files, so an injected script can't run.
    - The one inline script in `index.html` (it adds the `js` class) is allowed by its sha256 hash. If that line ever changes, update the hash: `printf "%s" "<the script's exact text>" | openssl dgst -sha256 -binary | base64`.
    - The Google domains are there only for Google Analytics, which stays off until `CONFIG.ga4Id` is set.
  - `Permissions-Policy` blocks camera, microphone, location, payment and USB.
  - `X-Frame-Options: DENY` and `frame-ancestors 'none'` stop other sites from framing the page.
  - `Cross-Origin-Opener-Policy`, `nosniff` and `Referrer-Policy` round out the set.
  - Netlify forces HTTPS and sends `Strict-Transport-Security`.
- **Forms:**
  - Bots are filtered by a hidden honeypot field and Netlify's built-in spam filter. Flagged submissions go to the Spam tab under Forms.
  - Every field has a length limit, and the source fields are capped at 100 characters.
  - Visitors' input is only ever shown as plain text or URL-encoded into the WhatsApp or email link, never inserted as HTML.
- **No secrets in this repository.** It's public on GitHub, so never commit API keys, passwords, tokens or private documents (such as the business plan). If the site ever needs a secret, it goes in Netlify's environment variables, not in a file. The GA4 measurement ID and the WhatsApp number are meant to be public.
- **Sign-up exports:** before opening a Netlify Forms CSV in Excel or Google Sheets, import it as text. A submitted value that starts with `=`, `+`, `-` or `@` could otherwise run as a formula.
- **Accounts are the real keys to the site.** Use two-factor sign-in on GitHub, Netlify, Dynadot and the Gmail that receives hello@jellyfit.online. Keep the domain's transfer lock and auto-renew on in Dynadot.

## The protein claim rule

The hero number is whey isolate protein only, always labelled "complete protein, from whey isolate". If collagen is ever added, it is listed separately and smaller and is never added into the 20g. Keep any copy changes consistent with this.

Gelatin is made from collagen, so the site says plainly that the jelly is set with a little gelatin whose protein isn't counted in the 20g. The site makes no skin or joint claims: those are health claims that need regulatory approval in the GCC, and the gelatin dose is set by the formula, not by any clinical evidence.

The mandatory nutrition table on the pack has to show **total** protein (whey plus gelatin), so it will read slightly above 20g. The 20g complete-protein figure belongs on the front of pack and in marketing.

## Before you launch

1. **WhatsApp number.** Set `CONFIG.whatsappNumber` at the top of `public/js/main.js` (digits only, with country code, e.g. `9613123456`). Until it's set, both forms open a pre-filled email instead.
2. **Email address.** The site uses `hello@jellyfit.online` (forwarded by Dynadot). If it changes, update `CONFIG.email` in `public/js/main.js`, the `mailto:` links and the `email` in the structured data in `public/index.html`, and the contact line in `public/llms.txt`.
3. **Nutrition values.** The panel shows target values and says so. Once the formula is locked, replace them with lab-confirmed values, add the remaining rows (fat, carbohydrate, sodium) and the ingredient list, and remove the "target" wording.
4. **Mango packshot.** The flavor cards use an illustrated jelly. Real packshots can replace or sit alongside it.
5. **Floating cup.** `public/assets/jellyfit-raspberry-cup.webp` is the Raspberry packshot with the background removed (PNG fallback alongside). To swap in a new packshot, export it with a transparent background at a similar size. The float speed and height are in the `float` keyframes in `public/css/styles.css`; it stops for visitors who have reduced motion turned on.
6. **Google Search Console.** Add `jellyfit.online` as a Domain property, verify it with the TXT record Google gives you (add it in Dynadot's DNS settings), then submit `https://jellyfit.online/sitemap.xml`.
7. **Domain.** Everything points at `https://jellyfit.online`. If the domain ever changes, update it in `public/index.html` (canonical link, `og:url`, `og:image` and the structured data), `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt`, the redirect in `netlify.toml`, and the email address (step 2).

## Brand assets

The logo, icon, profile pictures and brand brief live in `brand/` (see `brand/README.md`). That folder is not published on the website.

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
