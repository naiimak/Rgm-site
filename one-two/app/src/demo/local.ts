// Demo build only (VITE_DEMO=1): runs the game in the browser with no server. It answers the
// app's REST calls and stands in for the Socket.IO connection, using the same rules engine and
// bots as the real server. Solo vs Bots and the tutorial work; online modes need the server.

import configJson from '../../../config/game-config.json';
import { planBotTurn } from '../../../engine/bots.ts';
import { PlayerDB } from '../../../engine/database.ts';
import { Game, type ActionResult } from '../../../engine/game.ts';
import { tutorialDeck } from '../../../engine/tutorial.ts';
import { DEFAULT_SETTINGS, type BotLevel, type Colour, type DataClub, type GameConfig, type GameEvent, type PlayerRecord, type RoomSettings } from '../../../engine/types.ts';
import { gameXp, levelForXp, usernameProblem } from '../../../server/progression.ts';

const config = configJson as unknown as GameConfig;
const PROFILE_KEY = 'onetwo.demo.profile';

let db: PlayerDB | null = null;

async function database(): Promise<PlayerDB> {
  if (db) return db;
  const res = await fetch(new URL('./demo-data/players.json', document.baseURI));
  const data = (await res.json()) as { version: string; players: PlayerRecord[]; clubs?: Record<string, DataClub> };
  db = new PlayerDB(config, data.players, data.version, data.clubs ?? {});
  return db;
}

// ------------------------------------------------------------------ local profile

interface LocalUser {
  username: string; avatar: string; xp: number; coins: number; owned: string[]; equipped: Record<string, string>;
  stats: { games: number; wins: number; correctAnswers: number; bestStreak: number; named: Record<string, number>; clubCards: Record<string, number> };
  ads: { day: string; freeCoins: number }; lastGame: { coins: number; doubled: boolean } | null;
}

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: progress lasts for this visit only */
  }
  return null;
}

let memoryUser: LocalUser | null = null;
function loadUser(): LocalUser {
  if (memoryUser) return memoryUser;
  const saved = store(PROFILE_KEY);
  if (saved) return (memoryUser = JSON.parse(saved) as LocalUser);
  const defaults = config.shop.filter((i) => i.default);
  const adj = ['Silky', 'Clinical', 'Golden', 'Rapid', 'Cheeky', 'Classy'];
  const noun = ['Winger', 'Striker', 'Keeper', 'Playmaker', 'Libero', 'Captain'];
  memoryUser = {
    username: `${adj[Math.floor(Math.random() * adj.length)]}${noun[Math.floor(Math.random() * noun.length)]}${Math.floor(Math.random() * 90 + 10)}`,
    avatar: config.avatars[Math.floor(Math.random() * config.avatars.length)], xp: 0, coins: 0,
    owned: defaults.map((i) => i.id), equipped: Object.fromEntries(defaults.map((i) => [i.category, i.id])),
    stats: { games: 0, wins: 0, correctAnswers: 0, bestStreak: 0, named: {}, clubCards: {} },
    ads: { day: today(), freeCoins: 0 }, lastGame: null,
  };
  saveUser();
  return memoryUser;
}

function saveUser() {
  if (memoryUser) store(PROFILE_KEY, JSON.stringify(memoryUser));
}

const today = () => new Date().toISOString().slice(0, 10);

function profile(u = loadUser()) {
  const lvl = levelForXp(config, u.xp);
  const fav = (rec: Record<string, number>) => Object.entries(rec).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const club = fav(u.stats.clubCards);
  return {
    id: 'demo', username: u.username, avatar: u.avatar, xp: u.xp, level: lvl.level, levelProgress: { into: lvl.into, needed: lvl.needed },
    coins: u.coins, owned: u.owned, equipped: u.equipped, linked: null,
    freeCoinsLeft: u.ads.day === today() ? config.progression.ads.freeCoinsPerDay - u.ads.freeCoins : config.progression.ads.freeCoinsPerDay,
    doubleCoinsAvailable: !!u.lastGame && !u.lastGame.doubled,
    stats: {
      games: u.stats.games, wins: u.stats.wins, winRate: u.stats.games ? Math.round((u.stats.wins / u.stats.games) * 100) : 0,
      correctAnswers: u.stats.correctAnswers, bestStreak: u.stats.bestStreak, mostNamed: fav(u.stats.named),
      favouriteClub: club ? config.clubs.find((c) => c.id === club)?.name ?? null : null,
    },
  };
}

class DemoError extends Error {}

// ------------------------------------------------------------------ REST stand-in

export async function demoApi(path: string, opts: { method?: string; body?: unknown }): Promise<unknown> {
  const body = (opts.body ?? {}) as Record<string, string>;
  const method = opts.method ?? (opts.body ? 'POST' : 'GET');
  const u = loadUser();
  const route = path.split('?')[0];
  switch (`${method} ${route}`) {
    case 'GET /api/config': {
      const d = await database();
      return {
        configVersion: config.configVersion, dataVersion: d.version, leagues: config.leagues,
        clubs: config.clubs.map(({ id, league, name, kit }) => ({ id, league, name, kit })),
        coaches: config.coaches.map(({ id, name }) => ({ id, name })), nations: config.nations,
        trophies: config.trophies.map(({ id, name, icon }) => ({ id, name, icon })), flags: config.flags, emotes: config.emotes,
        avatars: config.avatars, shop: config.shop, coinPacks: config.coinPacks,
        rules: { turnSecondsOptions: config.rules.turnSecondsOptions, defaultTurnSeconds: config.rules.defaultTurnSeconds, quickMatchSeats: config.rules.quickMatchSeats },
        points: config.points, ads: config.progression.ads,
      };
    }
    case 'GET /api/players': {
      const d = await database();
      return { version: d.version, players: d.playerList() };
    }
    case 'POST /api/guest': return { token: 'demo', profile: profile() };
    case 'GET /api/me': return profile();
    case 'PATCH /api/me': {
      if (body.username !== undefined && body.username !== u.username) {
        const problem = usernameProblem(String(body.username));
        if (problem) throw new DemoError(problem);
        u.username = String(body.username);
      }
      if (body.avatar !== undefined) u.avatar = body.avatar;
      saveUser();
      return profile();
    }
    case 'DELETE /api/me': memoryUser = null; store(PROFILE_KEY, ''); return { ok: true };
    case 'GET /api/leaderboard': return { top: [], me: null };
    case 'POST /api/shop/buy': {
      const item = config.shop.find((i) => i.id === body.itemId);
      if (!item) throw new DemoError('Unknown item');
      if (item.unlockLevel && levelForXp(config, u.xp).level < item.unlockLevel) throw new DemoError(`Unlocks at level ${item.unlockLevel}`);
      if (u.coins < item.price) throw new DemoError('Not enough coins');
      u.coins -= item.price;
      u.owned.push(item.id);
      u.equipped[item.category] = item.id;
      saveUser();
      return profile();
    }
    case 'POST /api/shop/equip': {
      const item = config.shop.find((i) => i.id === body.itemId);
      if (!item || !u.owned.includes(item.id)) throw new DemoError('Not owned');
      u.equipped[item.category] = item.id;
      saveUser();
      return profile();
    }
    case 'POST /api/ads/reward': {
      const ads = config.progression.ads;
      if (body.placement === 'free_coins') {
        if (u.ads.day !== today()) u.ads = { day: today(), freeCoins: 0 };
        if (u.ads.freeCoins >= ads.freeCoinsPerDay) throw new DemoError('daily_limit');
        u.ads.freeCoins++;
        u.coins += ads.freeCoinsAmount;
        saveUser();
        return { granted: ads.freeCoinsAmount, profile: profile() };
      }
      if (!u.lastGame || u.lastGame.doubled) throw new DemoError('not_available');
      u.lastGame.doubled = true;
      u.coins += u.lastGame.coins;
      saveUser();
      return { granted: u.lastGame.coins, profile: profile() };
    }
    case 'POST /api/me/link': throw new DemoError('Not available in the demo');
    case 'POST /api/reports':
    case 'POST /api/events': return { ok: true };
    default: throw new DemoError(`Not available in the demo (${route})`);
  }
}

// ------------------------------------------------------------------ Socket stand-in

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;
type Listener = (data: unknown) => void;

interface Seat { name: string; avatar: string; isBot: boolean; botLevel?: BotLevel; you?: boolean }

export class LocalSocket {
  connected = true;
  private listeners = new Map<string, Listener[]>();
  private mode: 'solo' | 'tutorial' = 'solo';
  private settings: RoomSettings = DEFAULT_SETTINGS;
  private bots: { count: number; level: BotLevel } = { count: 3, level: 'medium' };
  private seats: Seat[] = [];
  private game: Game | null = null;
  private you = 0;
  private status: 'lobby' | 'playing' | 'results' = 'lobby';
  private timers: ReturnType<typeof setTimeout>[] = [];

  on(event: string, fn: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
    if (event === 'connect') setTimeout(() => fn(undefined), 0);
    return this;
  }

  timeout(_ms: number) {
    return { emit: (event: string, payload: unknown, cb: (err: Error | null, res: unknown) => void) => this.handle(event, payload, (res) => cb(null, res)) };
  }

  emit(event: string, payload?: unknown, ack?: Ack): this {
    this.handle(event, payload, ack ?? (() => {}));
    return this;
  }

  disconnect(): void {
    this.clearTimers();
  }

  private fire(event: string, data?: unknown) {
    for (const fn of this.listeners.get(event) ?? []) fn(data);
  }

  private handle(event: string, payload: unknown, ack: Ack) {
    const p = (payload ?? {}) as Record<string, unknown>;
    const g = this.game;
    const act = (fn: (game: Game) => ActionResult, extra?: (r: ActionResult) => Record<string, unknown>) => {
      if (!g || this.status !== 'playing') return ack({ ok: false, error: 'no_game' });
      const r = fn(g);
      if (!r.ok) return ack({ ok: false, error: r.error });
      ack({ ok: true, ...(extra?.(r) ?? {}) });
      this.afterChange(r.events);
    };
    switch (event) {
      case 'join_room': {
        const mode = p.mode as string;
        if (mode === 'private') return ack({ ok: false, error: 'demo_online_only' });
        this.clearTimers();
        if (mode === 'tutorial') {
          this.mode = 'tutorial';
          this.settings = { ...DEFAULT_SETTINGS, turnSeconds: 30 };
          this.bots = { count: 1, level: 'easy' };
        } else {
          this.mode = 'solo';
          this.settings = mode === 'quick' ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, ...(p.settings as RoomSettings | undefined) };
          const b = (p.bots as { count: number; level: BotLevel } | undefined) ?? { count: 3, level: 'medium' };
          this.bots = mode === 'quick' ? { count: 3, level: 'medium' } : { count: Math.max(1, Math.min(5, b.count)), level: b.level };
        }
        ack({ ok: true, code: 'DEMO' });
        void this.start();
        return;
      }
      case 'leave_room':
        this.clearTimers();
        this.game = null;
        this.status = 'lobby';
        return ack({ ok: true });
      case 'rematch':
        if (this.mode === 'tutorial') { this.mode = 'solo'; this.settings = DEFAULT_SETTINGS; }
        ack({ ok: true });
        void this.start();
        return;
      case 'play_card':
        return act((game) => game.play(this.you, String(p.cardId), { playerId: p.playerId ? String(p.playerId) : undefined, colour: p.colour as Colour | undefined }));
      case 'draw_card': return act((game) => game.draw(this.you));
      case 'pass_card': return act((game) => game.pass(this.you));
      case 'final_whistle': return act((game) => game.callWhistle(this.you));
      case 'request_hint':
        return act((game) => game.hint(this.you, String(p.cardId), p.payment === 'ad' ? 'ad' : 'card'), (r) => ({ hint: r.ok ? r.hint ?? null : null }));
      case 'emote':
        this.fire('emote', { seat: this.you, emoteId: p.emoteId });
        return;
      default:
        return ack({ ok: false, error: 'demo_online_only' });
    }
  }

  private async start() {
    const d = await database();
    const names = [...config.bots.names].sort(() => Math.random() - 0.5);
    const u = loadUser();
    const me: Seat = { name: u.username, avatar: u.avatar, isBot: false, you: true };
    const avatars = [...config.avatars].filter((a) => a !== u.avatar).sort(() => Math.random() - 0.5);
    const bots: Seat[] = Array.from({ length: this.bots.count }, (_, i) => ({ name: names[i], avatar: avatars[i % avatars.length], isBot: true, botLevel: this.bots.level }));
    this.seats = this.mode === 'tutorial' ? [me, ...bots] : [me, ...bots].sort(() => Math.random() - 0.5);
    this.you = this.seats.findIndex((s) => s.you);
    this.game = new Game({
      id: `demo-${Date.now().toString(36)}`, config, db: d, settings: this.settings, rng: Math.random,
      seats: this.seats.map((s) => ({ name: s.name, avatar: s.avatar, isBot: s.isBot, botLevel: s.botLevel })),
      ...(this.mode === 'tutorial' ? { presetDeck: tutorialDeck(config, Math.random), firstSeat: 0 } : {}),
    });
    this.status = 'playing';
    this.fire('room_state', this.roomView());
    this.afterChange(this.game.start());
  }

  private roomView() {
    return {
      code: 'DEMO', mode: this.mode, status: this.status, settings: this.settings, bots: this.bots, isHost: true,
      quickStartsAt: null, serverNow: Date.now(), shareUrl: '',
      members: this.seats.map((s) => ({ name: s.name, avatar: s.avatar, isBot: s.isBot, botLevel: s.botLevel, connected: true, isHost: !!s.you, you: !!s.you })),
    };
  }

  private afterChange(events: GameEvent[]) {
    const game = this.game!;
    for (const e of events) {
      if (e.type === 'play_result') this.fire('play_result', e.result);
      else if (e.type === 'turn_started') this.fire('turn_started', { seat: e.seat, turnNumber: e.turnNumber, turnEndsAt: game.turnEndsAt, serverNow: Date.now() });
      else if (e.type !== 'game_over') this.fire('game_event', e);
    }
    this.fire('game_state', game.view(this.you));
    if (game.phase === 'over') return this.finish();
    this.schedule();
  }

  private schedule() {
    this.clearTimers();
    const game = this.game!;
    const turnNumber = game.turnNumber;
    const seat = game.seats[game.turn];
    this.timers.push(setTimeout(() => {
      if (this.game === game && game.phase === 'playing' && game.turnNumber === turnNumber) this.afterChange(game.timeout().events);
    }, Math.max(0, game.turnEndsAt - Date.now())));
    if (!seat.isBot) return;
    const drawn = game.drawnCardId;
    const plan = this.mode === 'tutorial'
      ? (drawn ? { type: 'pass' as const, delayMs: 1200 } : { type: 'draw' as const, delayMs: 1800 })
      : planBotTurn(game, seat.index, seat.botLevel ?? 'medium');
    this.timers.push(setTimeout(() => {
      if (this.game !== game || game.phase !== 'playing' || game.turnNumber !== turnNumber || game.drawnCardId !== drawn) return;
      if (plan.type === 'play' && plan.callWhistle) {
        const w = game.callWhistle(seat.index);
        if (w.ok) for (const e of w.events) this.fire('game_event', e);
      }
      let r = plan.type === 'play' ? game.play(seat.index, plan.cardId, { playerId: plan.playerId, colour: plan.colour })
        : plan.type === 'draw' ? game.draw(seat.index) : game.pass(seat.index);
      if (!r.ok) r = game.drawnCardId ? game.pass(seat.index) : game.draw(seat.index);
      this.afterChange(r.events);
    }, plan.delayMs));
  }

  private finish() {
    this.clearTimers();
    const game = this.game!;
    this.status = 'results';
    const placings = game.placings!;
    const seat = game.seats[this.you];
    const won = placings[0].seat === this.you;
    const u = loadUser();
    const xp = gameXp(config, seat.stats, won, true);
    const before = levelForXp(config, u.xp).level;
    u.xp += xp;
    const level = levelForXp(config, u.xp).level;
    const coins = config.progression.coins.perGame + (won ? config.progression.coins.perWin : 0) + (level - before) * config.progression.coins.perLevel;
    u.coins += coins;
    u.stats.games++;
    if (won) u.stats.wins++;
    u.stats.correctAnswers += seat.stats.correctAnswers;
    u.stats.bestStreak = Math.max(u.stats.bestStreak, seat.stats.bestStreak);
    for (const [name, n] of Object.entries(seat.stats.named)) u.stats.named[name] = (u.stats.named[name] ?? 0) + n;
    for (const r of game.log) if (r.seat === this.you && r.valid && r.card.kind === 'club') u.stats.clubCards[r.card.ref] = (u.stats.clubCards[r.card.ref] ?? 0) + 1;
    u.lastGame = { coins, doubled: false };
    saveUser();
    this.fire('room_state', this.roomView());
    this.fire('game_over', {
      gameId: game.id, mode: this.mode, you: this.you,
      placings: placings.map((pl) => ({ ...pl, name: game.seats[pl.seat].name, avatar: game.seats[pl.seat].avatar ?? '⚽', isBot: game.seats[pl.seat].isBot })),
      reward: { xp, coins, levelUps: level - before, level, totalCoins: u.coins, starterPack: false, solo: true },
    });
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
