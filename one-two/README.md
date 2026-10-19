# One-Two

A real-time football trivia card game, built from *Football Card Game – Product Spec v1*. It plays like UNO, except every play is a link: Manchester Red on the table, you play Madrid White, you answer "Cristiano Ronaldo".

This folder holds the whole product: the rules engine, the game server, the app (iOS, Android and web from one codebase) and the player-data tools. It is separate from the JellyFit site in the rest of this repository: Netlify only publishes `public/`, so nothing here goes online with the site.

## Run it

Needs Node.js 20 or newer.

```bash
cd one-two
npm install
npm run build        # builds the app into dist/
npm start            # game server + app on http://localhost:3000
```

Open http://localhost:3000 on a phone-sized window. A first visit plays the tutorial; after that you land on Home. Open a second browser (or a private window) to play a Private Room or Quick Match against yourself.

For development, run `npm run dev:server` and `npm run dev:app` in two terminals and open http://localhost:5173 (the app reloads as you edit).

| Setting | What it does | Default |
| --- | --- | --- |
| `PORT` | Server port | `3000` |
| `PUBLIC_URL` | Address used in room share links | `http://localhost:3000` (`:5173` in dev) |
| `ADMIN_KEY` | Key for the admin page (`/admin?key=…`) | random, printed at start |
| `DATA_DIR` | Where accounts, game logs and analytics are written | `data/` |
| `VITE_SERVER_URL` | Server address baked into the phone app at build time | same origin |

## Put it online (Fly.io)

`Dockerfile` and `fly.toml` deploy the server and app as one machine in Frankfurt, with a 1 GB volume for accounts, progress, game logs and analytics. Rooms live in memory, so keep it to **one** machine until room state moves to Redis.

```bash
fly launch --copy-config --no-deploy        # choose a unique app name; update app and PUBLIC_URL in fly.toml to match
fly volumes create onetwo_data --region fra --size 1
fly secrets set ADMIN_KEY=<a long random string>
fly deploy
```

The game is then at `https://<app-name>.fly.dev`, and the admin page at `/admin?key=<ADMIN_KEY>`. The machine stops when nobody is connected and starts again on the next visit (a few seconds).

`npm run build:demo` builds a server-less demo (tutorial and Solo vs Bots in the browser) into `dist-demo/`.

## What's built

Status against the spec's five milestones:

| Milestone | Status |
| --- | --- |
| 1. Data and rules engine | **Done.** Every rule in the spec is enforced by the server. 21,000+ players from Wikidata, football-data.org and your club sheets; the AI review step is still to do (see Player data). |
| 2. Solo vs Bots playable | **Done in the web/app build.** Game table, answer box with autocomplete, hints, Final Whistle, the 7-step tutorial, and Easy / Medium / Hard bots. Not yet run on a physical iPhone or Android phone. |
| 3. Online multiplayer | **Done.** Private Rooms with code and share link (WhatsApp included), Quick Match that fills empty seats with bots after 20 s, reconnect, and bot takeover after 30 s offline. |
| 4. Accounts, progression, shop, ads | **Partly done.** Guest accounts, usernames, avatars, XP, levels, coins, weekly and all-time leaderboards, profile stats, cosmetics shop, rewarded-ad placements, and the admin page for answer reports all work. Sign in with Apple/Google, real coin-pack purchases and real ads are stubs (see Not done yet). |
| 5. Beta and launch | Not started. |

### How it's checked

```bash
npm test             # 46 rules tests: every row of "What you must answer", every action card, penalties, setup, autocomplete
npm run simulate     # Milestone 1 acceptance: 1,000 bot-only games through the real engine
npm run coverage     # link-coverage check for all 3,655 card pairs -> data/coverage-report.md
npm run typecheck
```

Latest simulation (with the full player database): 1,000 games, all finished, average 46 turns, no crashes and no rule violations. Every judged answer was re-checked against the link table, and every card was accounted for after every move.

The full flows were also played end to end in a headless browser: the tutorial to a win, a 4-player solo game, a Private Room joined through its share link, a player dropping out (seat marked away, then a bot takes over after 30 s, then the player rejoins and gets the seat back), and a Quick Match filled with bots.

## How it's built

```
config/game-config.json   cards, leagues, clubs, coaches, nations, deck counts, points, bot rates,
                          XP/coins, shop: every tunable lives here (spec: "server config, not app code")
data/players.seed.psv     hand-entered player seed (one line per player)
data/players.json         built player database the server loads (npm run data)
data/coverage-report.md   link-coverage report
engine/                   rules engine shared by server, tests and app (pure TypeScript)
  game.ts                 the rules: turns, link/match/safe plays, actions, penalties, hints, Final Whistle, end of game
  database.ts             player conditions and the precomputed link cache (all card pairs)
  bots.ts                 Easy / Medium / Hard bots
  search.ts               accent-insensitive, nickname-aware autocomplete
server/                   Node.js game server (Express + Socket.IO)
  rooms.ts                rooms, matchmaking, timers, bots, reconnects, rewards
  store.ts                accounts, reports, leaderboards (JSON file; swap for PostgreSQL here)
  index.ts                REST API, admin page, analytics log
app/                      the app (React + Vite), wrapped for iOS/Android with Capacitor
scripts/                  data build, coverage check, bot simulation
tests/                    rules tests
```

The server is the single source of truth: it shuffles with a cryptographically secure random number generator, holds every hand, checks every answer against the precomputed link table and runs every timer. Each phone receives the public state plus its own hand only. Every finished game's full move log is written to `data/games/`.

The real-time messages follow the spec's names: `join_room`, `leave_room`, `start_game`, `play_card`, `draw_card`, `request_hint`, `final_whistle` and `emote` from the app; `game_state`, `play_result`, `turn_started` and `game_over` from the server. A few extras support the UI: `pass_card` (keep a drawn card), `room_settings`, `rematch`, `room_state` and `game_event`.

### Phone apps (iOS and Android)

The app is one React codebase, packaged for both stores with [Capacitor](https://capacitorjs.com). On a Mac with Xcode, or a machine with Android Studio:

```bash
VITE_SERVER_URL=https://your-game-server.example npm run build
npx cap add ios        # or: npx cap add android
npx cap open ios       # opens Xcode / Android Studio to run on a phone and submit
```

The spec recommends Flutter or React Native and allows alternatives. I used React + Capacitor because it meets the same requirement (one codebase for iOS and Android) and could be built and tested end to end in this environment, where no Flutter SDK or phone emulator is available. The app is about 74 KB gzipped, far under the 100 MB limit. If you'd rather have Flutter, the engine and server stay as they are; only `app/` would be rewritten.

## Player data

`data/players.json` holds **21,000+ players active from 1990 onwards**, built in three steps. Run them in this order whenever the data is refreshed (the spec asks for each transfer window):

```bash
npm run data:wikidata                              # 1. careers, titles and trophies from Wikidata (~10 min first time, cached after)
FOOTBALL_DATA_KEY=your-key npm run data:squads     # 2. this season's squads from football-data.org
npm run data:sheets                                # 3. your club sheets in data/manual/club-sheets/
npm run coverage                                   # check: how many card pairs have valid answers
```

Then press "Publish new data version" on the admin page (games in progress finish on the version they started with).

1. **Wikidata** (free, CC0): every player with a senior spell at one of the 38 card clubs (or the 12 former card clubs) or a cap for one of the 24 nations, active in 1990 or later. Their name, nicknames, birth year, nationality, club spells and fame (number of Wikipedia languages). League titles and Champions League wins are worked out from each season's winner and the player's spell at that club; World Cup and Euro wins from tournament participation plus the winning nation. The Ballon d'Or comes straight from Wikidata. Card titles are in `data/wikidata-sources.json`.
2. **football-data.org** (key in `FOOTBALL_DATA_KEY`, never stored in the repo): adds this season's transfers and players Wikidata hasn't caught up with, and ends spells of players who have left. The free plan only covers the current season, so it can't supply history.
3. **Club sheets** (`data/manual/club-sheets/*.xlsx`, in the "Players & Trophies 1990–Present" format): club membership is trusted, and unambiguous trophies are added (winners only, no runners-up or post-1992 second-tier "Division One"). Nothing from Wikidata is removed. `data/player-data-template.xlsx` is a fuller template with years per club.

Every step writes a report to check: `data/import-report.md` (where Wikidata and the old hand-entered seed disagree), `data/squads-report.md`, `data/sheets-report.md` and `data/coverage-report.md`.

Coverage: 16% of the 3,655 card pairs have no valid player (most are impossible anyway, like two national teams) and 9% have exactly one. With the 491-player seed it was 42% and 18%. All 1,000 simulated bot games now finish.

**Known approximations** (the spec's AI review should check these, starting with the most famous players):
- A league title or Champions League counts if the player's spell at the winning club covers that season. When Wikidata only has the year someone left, a player who left mid-season can wrongly get that season's title (e.g. Vieira and Inter's 2010 Champions League).
- Missing end dates are estimated from the next club, or age 36 for a last club.
- Tournament wins need Wikidata to list the player as a participant, and some are missing (e.g. Özil in 2014, Lautaro Martínez in 2022).
- Players added from football-data.org or the club sheets may have no birth year or start year at their club.

The phone downloads the full name list (about 1.9 MB, cached until the data changes) so search is instant.

## Decisions I made where the spec was silent or inconsistent

- **Fewer clubs, more League Champion cards (your change):** Espanyol, Deportivo, Real Sociedad, Parma, Sampdoria, Hamburg, Werder Bremen, Stuttgart, Bordeaux, Saint-Étienne, Lens and Rennes are no longer cards (38 clubs left). Each was replaced by a League Champion card of the same league (England 1, Spain 4, Italy 3, Germany 4, France 5), so every league colour still has 13 subject cards and the deck stays at 151. Careers at those clubs still count for the league cards and for coach cards (Ancelotti at Parma).
- **Deck size:** Setup says a 104-card deck, but Deck composition and the card table say 151. I used 151.
- **League Champion points:** not listed in the end-of-game points; I scored them like League cards (10).
- **Timer runs out after you've drawn:** the turn ends with no extra 2-card penalty, because you already acted.
- **Disconnected seats "auto-draw":** a disconnected player's seat draws 1 card when their timer runs out (no penalty), for the 30 s before a bot takes over.
- **Bots calling Final Whistle:** Easy remembers 70% of the time, Medium 90% and Hard always (set in config).
- **Coach spells:** a season counts if the coach was permanent head coach at any point in it (for example, Zidane's January 2016 start counts for 2015/16). Interim spells are left out.
- **Already-named rule:** applies to hints too, so a hint never suggests someone already used.

## Not done yet (needs store accounts, keys or a decision from you)

- The AI data review (see Player data).
- **Sign in with Apple and Google:** the buttons are there; the server returns "arrives with the store builds" until the native SDKs and keys are set up.
- **Coin packs:** shown in the shop but disabled; they need Apple/Google in-app purchase with receipts checked on the server. The Starter Pack is flagged after the first win but not sold yet.
- **Rewarded ads:** all three placements (hint, double coins, free coins) work with limits enforced by the server, but the ad itself is a 3-second placeholder. Store builds need Google AdMob with server-side verification (the hook is in `server/index.ts` and `server/rooms.ts`), Google's consent tool for Europe, and Apple's tracking prompt.
- **Analytics:** every event in the spec's table is recorded, but to a log file (`data/analytics.log`) rather than Firebase. Crash reporting needs Crashlytics in the store builds.
- **Scale:** one server process with in-memory rooms and a JSON-file store. That's fine for a beta; for launch, move `store.ts` to PostgreSQL and room state to Redis as the spec recommends. Matchmaking has a single region.
- **Before launch:** legal review of the display names and coach names, a maintained profanity list (the current one is a short starter list), terms and privacy policy pages, and music.
