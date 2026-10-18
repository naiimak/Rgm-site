// One-Two game server: REST API (accounts, shop, leaderboards, reports), the real-time game
// server (Socket.IO) and, in production, the built app.
//
//   npm run dev:server        (with `npm run dev:app` for the app on :5173)
//   npm run build && npm start

import { randomBytes } from 'node:crypto';
import { appendFile, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import { PlayerDB } from '../engine/database.ts';
import { ROOT, loadConfig, loadPlayers } from '../engine/load.ts';
import { renderAdmin } from './admin.ts';
import { levelForXp, randomUsername, usernameProblem } from './progression.ts';
import { RoomManager } from './rooms.ts';
import { Store, type User } from './store.ts';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'data');
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${process.env.NODE_ENV === 'production' ? PORT : 5173}`).replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY ?? randomBytes(9).toString('base64url');

const config = loadConfig();
let db = buildDb();
const store = new Store(join(DATA_DIR, 'store.json'));
mkdirSync(DATA_DIR, { recursive: true });

function buildDb(): PlayerDB {
  const { players, version } = loadPlayers();
  return new PlayerDB(config, players, version);
}

function track(event: string, props: Record<string, unknown>): void {
  appendFile(join(DATA_DIR, 'analytics.log'), JSON.stringify({ t: new Date().toISOString(), event, ...props }) + '\n', () => {});
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  // The phone app (Capacitor) runs on its own origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' }, pingInterval: 10_000, pingTimeout: 8_000 });
const rooms = new RoomManager({ io, config, db: () => db, store, track, dataDir: DATA_DIR, publicUrl: PUBLIC_URL });

// ------------------------------------------------------------------ helpers

type AuthedRequest = Request & { user: User };

function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  const user = store.userByToken(token);
  if (!user) return res.status(401).json({ error: 'not_signed_in' });
  (req as AuthedRequest).user = user;
  next();
}

function profile(u: User) {
  const lvl = levelForXp(config, u.xp);
  const fav = (rec: Record<string, number>) => Object.entries(rec).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const favouriteClub = fav(u.stats.clubCards);
  return {
    id: u.id, username: u.username, avatar: u.avatar, xp: u.xp, level: lvl.level, levelProgress: { into: lvl.into, needed: lvl.needed },
    coins: u.coins, owned: u.owned, equipped: u.equipped, linked: u.linked,
    freeCoinsLeft: u.ads.day === new Date().toISOString().slice(0, 10) ? config.progression.ads.freeCoinsPerDay - u.ads.freeCoins : config.progression.ads.freeCoinsPerDay,
    doubleCoinsAvailable: !!u.lastGame && !u.lastGame.doubled,
    stats: {
      games: u.stats.games, wins: u.stats.wins, winRate: u.stats.games ? Math.round((u.stats.wins / u.stats.games) * 100) : 0,
      correctAnswers: u.stats.correctAnswers, bestStreak: u.stats.bestStreak,
      mostNamed: fav(u.stats.named), favouriteClub: favouriteClub ? config.clubs.find((c) => c.id === favouriteClub)?.name ?? null : null,
    },
  };
}

function defaultsFor() {
  const defaults = config.shop.filter((i) => i.default);
  return { owned: defaults.map((i) => i.id), equipped: Object.fromEntries(defaults.map((i) => [i.category, i.id])) };
}

// ------------------------------------------------------------------ public data

/** What the phone needs to draw cards. Internal club names never leave the server. */
app.get('/api/config', (_req, res) => {
  res.json({
    configVersion: config.configVersion,
    dataVersion: db.version,
    leagues: config.leagues,
    clubs: config.clubs.map(({ id, league, name, kit }) => ({ id, league, name, kit })),
    coaches: config.coaches.map(({ id, name }) => ({ id, name })),
    nations: config.nations,
    trophies: config.trophies.map(({ id, name, icon }) => ({ id, name, icon })),
    flags: config.flags,
    emotes: config.emotes,
    avatars: config.avatars,
    shop: config.shop,
    coinPacks: config.coinPacks,
    rules: { turnSecondsOptions: config.rules.turnSecondsOptions, defaultTurnSeconds: config.rules.defaultTurnSeconds, quickMatchSeats: config.rules.quickMatchSeats },
    points: config.points,
    ads: config.progression.ads,
  });
});

/** Full player-name list for instant on-phone search. Validity is only ever checked on the server. */
app.get('/api/players', (req, res) => {
  const etag = `"${db.version}"`;
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.setHeader('ETag', etag);
  res.json({ version: db.version, players: db.playerList() });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, dataVersion: db.version, ...rooms.stats() }));

// ------------------------------------------------------------------ accounts

app.post('/api/guest', (req, res) => {
  const { owned, equipped } = defaultsFor();
  const avatar = config.avatars.includes(req.body?.avatar) ? req.body.avatar : config.avatars[Math.floor(Math.random() * config.avatars.length)];
  const user = store.createGuest(randomUsername((n) => store.usernameTaken(n)), avatar, owned, equipped);
  track('account_created', { userId: user.id });
  res.json({ token: user.token, profile: profile(user) });
});

app.get('/api/me', auth, (req, res) => res.json(profile((req as AuthedRequest).user)));

app.patch('/api/me', auth, (req, res) => {
  const user = (req as AuthedRequest).user;
  const { username, avatar } = req.body ?? {};
  if (username !== undefined && username !== user.username) {
    const problem = usernameProblem(String(username));
    if (problem) return res.status(400).json({ error: problem });
    if (store.usernameTaken(String(username), user.id)) return res.status(400).json({ error: 'That name is taken' });
    user.username = String(username);
  }
  if (avatar !== undefined) {
    if (!config.avatars.includes(avatar)) return res.status(400).json({ error: 'Unknown avatar' });
    user.avatar = avatar;
  }
  store.save();
  res.json(profile(user));
});

app.post('/api/me/link', auth, (_req, res) => {
  // Sign in with Google / Apple needs the native SDKs and store credentials (see README).
  res.status(501).json({ error: 'Account linking arrives with the store builds' });
});

app.delete('/api/me', auth, (req, res) => {
  store.deleteUser((req as AuthedRequest).user.id);
  res.json({ ok: true });
});

app.get('/api/leaderboard', (req, res) => {
  const me = store.userByToken(req.headers.authorization?.replace(/^Bearer /, ''));
  res.json(store.leaderboard(req.query.period === 'all' ? 'all' : 'weekly', me));
});

// ------------------------------------------------------------------ shop and ads

app.post('/api/shop/buy', auth, (req, res) => {
  const user = (req as AuthedRequest).user;
  const item = config.shop.find((i) => i.id === req.body?.itemId);
  if (!item) return res.status(404).json({ error: 'Unknown item' });
  if (user.owned.includes(item.id)) return res.status(400).json({ error: 'Already owned' });
  if (item.unlockLevel && levelForXp(config, user.xp).level < item.unlockLevel) return res.status(400).json({ error: `Unlocks at level ${item.unlockLevel}` });
  if (user.coins < item.price) return res.status(400).json({ error: 'Not enough coins' });
  user.coins -= item.price;
  user.owned.push(item.id);
  user.equipped[item.category] = item.id;
  store.save();
  res.json(profile(user));
});

app.post('/api/shop/equip', auth, (req, res) => {
  const user = (req as AuthedRequest).user;
  const item = config.shop.find((i) => i.id === req.body?.itemId);
  if (!item || !user.owned.includes(item.id)) return res.status(400).json({ error: 'Not owned' });
  user.equipped[item.category] = item.id;
  store.save();
  res.json(profile(user));
});

app.post('/api/purchase', auth, (_req, res) => {
  // Coin packs go through Apple / Google in-app purchase with receipts checked here.
  res.status(501).json({ error: 'Coin packs arrive with the store builds' });
});

/**
 * Rewarded ads. In the store builds the ad network calls the server (server-side verification)
 * and only then is the reward granted; this build trusts the app's simulated ad.
 */
app.post('/api/ads/reward', auth, (req, res) => {
  const user = (req as AuthedRequest).user;
  const r = rooms.grantAd(user, String(req.body?.placement));
  if (!r.ok) return res.status(400).json({ error: r.error });
  track('ad_completed', { placement: req.body?.placement });
  res.json({ granted: r.coins, profile: profile(user) });
});

// ------------------------------------------------------------------ reports and analytics

app.post('/api/reports', auth, (req, res) => {
  const user = (req as AuthedRequest).user;
  const b = req.body ?? {};
  const player = db.byId.get(String(b.playerId));
  if (!player || !b.cardA || !b.cardB) return res.status(400).json({ error: 'Incomplete report' });
  store.addReport({
    gameId: String(b.gameId ?? ''), dataVersion: db.version, cardA: String(b.cardA), cardB: String(b.cardB),
    playerId: player.id, playerName: player.name, verdict: b.verdict === 'valid' ? 'valid' : 'wrong', reporter: user.id,
  });
  track('answer_reported', { cardA: b.cardA, cardB: b.cardB, player: player.id, verdict: b.verdict });
  res.json({ ok: true });
});

const CLIENT_EVENTS = new Set(['app_open', 'tutorial_step', 'tutorial_complete', 'ad_offered', 'ad_completed']);
app.post('/api/events', (req, res) => {
  const { event, props } = req.body ?? {};
  if (CLIENT_EVENTS.has(event)) track(event, { ...(props ?? {}), client: true });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ admin

app.get('/admin', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).send('Add ?key=… (printed when the server starts, or set ADMIN_KEY)');
  res.type('html').send(renderAdmin(store.reports(), db, config, String(req.query.key), String(req.query.status ?? 'open')));
});

app.post('/admin/reports/:id', express.urlencoded({ extended: false }), (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.sendStatus(401);
  const status = ['open', 'confirmed', 'rejected'].includes(req.body.status) ? req.body.status : 'open';
  store.updateReport(req.params.id, status, String(req.body.note ?? ''));
  res.redirect(`/admin?key=${encodeURIComponent(String(req.query.key))}`);
});

/** Publish a new data version (after `npm run data`). Games in progress keep the version they started with. */
app.post('/admin/reload-data', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.sendStatus(401);
  db = buildDb();
  res.redirect(`/admin?key=${encodeURIComponent(String(req.query.key))}`);
});

// ------------------------------------------------------------------ app + sockets

const dist = join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

io.use((socket, next) => {
  const user = store.userByToken(socket.handshake.auth?.token);
  if (!user) return next(new Error('not_signed_in'));
  socket.data.user = user;
  next();
});
io.on('connection', (socket) => rooms.attach(socket, socket.data.user as User));

httpServer.listen(PORT, () => {
  console.log(`One-Two server on http://localhost:${PORT} · data ${db.version} · ${db.players.length} players`);
  console.log(`Admin: http://localhost:${PORT}/admin?key=${ADMIN_KEY}`);
});
