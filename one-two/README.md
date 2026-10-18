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

## What's built

Status against the spec's five milestones:

| Milestone | Status |
| --- | --- |
| 1. Data and rules engine | **Rules engine done and tested.** Every rule in the spec is enforced by the server. Player data is a hand-entered seed of 491 players, not yet the Wikidata import (see Player data). |
| 2. Solo vs Bots playable | **Done in the web/app build.** Game table, answer box with autocomplete, hints, Final Whistle, the 7-step tutorial, and Easy / Medium / Hard bots. Not yet run on a physical iPhone or Android phone. |
| 3. Online multiplayer | **Done.** Private Rooms with code and share link (WhatsApp included), Quick Match that fills empty seats with bots after 20 s, reconnect, and bot takeover after 30 s offline. |
| 4. Accounts, progression, shop, ads | **Partly done.** Guest accounts, usernames, avatars, XP, levels, coins, weekly and all-time leaderboards, profile stats, cosmetics shop, rewarded-ad placements, and the admin page for answer reports all work. Sign in with Apple/Google, real coin-pack purchases and real ads are stubs (see Not done yet). |
| 5. Beta and launch | Not started. |

### How it's checked

```bash
npm test             # 46 rules tests: every row of "What you must answer", every action card, penalties, setup, autocomplete
npm run simulate     # Milestone 1 acceptance: 1,000 bot-only games through the real engine
npm run coverage     # link-coverage check for all 4,753 card pairs -> data/coverage-report.md
npm run typecheck
```

Latest simulation: 1,000 games, no crashes and no rule violations. Every judged answer was re-checked against the link table, and every card was accounted for after every move. 908 games finished; 92 hit the 4,000-turn safety cap. Those were almost all Easy-bot-only tables: Easy bots only know the top 20% most famous players, which in a 491-player seed is about 100 players, so their hands grow faster than they shrink. Medium and Hard tables finish in a normal 22–49 turns (median). This should go away with the full player database. Real games always have a human, who ends them.

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

The spec's plan is: import from Wikidata, clean the data, then have an AI check the top 500 players, the 10 coaches and the 24 national teams. Wikidata was not reachable from the environment this was built in, so the database is currently a **hand-entered seed of 491 well-known players**. It has not been verified and must not ship as is.

- Edit `data/players.seed.psv`, then `npm run data` to rebuild `data/players.json`. The admin page's "Publish new data version" button loads it into a running server; games in progress finish on the version they started with.
- Coverage today: 42% of the 4,753 card pairs have no valid player, and 18% have exactly one (see `data/coverage-report.md`). The game handles this (unplayable cards are dimmed, Safe Play and action cards keep games moving), but a full import should fix most of these gaps, because the seed has only a few players for each African, Asian and North American nation and for the smaller clubs.
- **Next step:** a Wikidata import script that writes the same `players.json` format (`id, name, aliases, nationality, birthYear, fame, spells[{club, from, to}], titles, trophies, caps`), using the sitelinks count as `fame`, plus the AI review step. The tables and cleaning rules are in the spec's "Player database" section.

## Decisions I made where the spec was silent or inconsistent

- **Deck size:** Setup says a 104-card deck, but Deck composition and the card table say 151. I used 151.
- **League Champion points:** not listed in the end-of-game points; I scored them like League cards (10).
- **Timer runs out after you've drawn:** the turn ends with no extra 2-card penalty, because you already acted.
- **Disconnected seats "auto-draw":** a disconnected player's seat draws 1 card when their timer runs out (no penalty), for the 30 s before a bot takes over.
- **Bots calling Final Whistle:** Easy remembers 70% of the time, Medium 90% and Hard always (set in config).
- **Coach spells:** a season counts if the coach was permanent head coach at any point in it (for example, Zidane's January 2016 start counts for 2015/16). Interim spells are left out.
- **Already-named rule:** applies to hints too, so a hint never suggests someone already used.

## Not done yet (needs store accounts, keys or a decision from you)

- Wikidata import and the AI data review (see above).
- **Sign in with Apple and Google:** the buttons are there; the server returns "arrives with the store builds" until the native SDKs and keys are set up.
- **Coin packs:** shown in the shop but disabled; they need Apple/Google in-app purchase with receipts checked on the server. The Starter Pack is flagged after the first win but not sold yet.
- **Rewarded ads:** all three placements (hint, double coins, free coins) work with limits enforced by the server, but the ad itself is a 3-second placeholder. Store builds need Google AdMob with server-side verification (the hook is in `server/index.ts` and `server/rooms.ts`), Google's consent tool for Europe, and Apple's tracking prompt.
- **Analytics:** every event in the spec's table is recorded, but to a log file (`data/analytics.log`) rather than Firebase. Crash reporting needs Crashlytics in the store builds.
- **Scale:** one server process with in-memory rooms and a JSON-file store. That's fine for a beta; for launch, move `store.ts` to PostgreSQL and room state to Redis as the spec recommends. Matchmaking has a single region.
- **Before launch:** legal review of the display names and coach names, a maintained profanity list (the current one is a short starter list), terms and privacy policy pages, and music.
