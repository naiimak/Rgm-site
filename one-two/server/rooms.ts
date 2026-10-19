// Rooms, matchmaking, turn timers, bots and reconnection. The game server is the single source
// of truth: it shuffles, deals, holds every hand, checks every answer and decides every outcome.

import { randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server, Socket } from 'socket.io';
import { planBotTurn } from '../engine/bots.ts';
import { tutorialDeck } from '../engine/tutorial.ts';
import type { PlayerDB } from '../engine/database.ts';
import { Game, type ActionResult } from '../engine/game.ts';
import { DEFAULT_SETTINGS, type BotLevel, type Colour, type GameConfig, type GameEvent, type RoomSettings } from '../engine/types.ts';
import { gameXp, levelForXp } from './progression.ts';
import { dayKey, weekKey, type Store, type User } from './store.ts';

export type Mode = 'quick' | 'private' | 'solo' | 'tutorial';

interface Member {
  userId: string | null;
  name: string;
  avatar: string;
  isBot: boolean;
  botLevel?: BotLevel;
  socketId: string | null;
  connected: boolean;
  left: boolean;
}

interface Room {
  code: string;
  mode: Mode;
  settings: RoomSettings;
  bots: { count: number; level: BotLevel };
  hostId: string | null;
  members: Member[];
  status: 'lobby' | 'playing' | 'results';
  game: Game | null;
  seatOf: Map<string, number>; // userId -> seat index in the current game
  turnTimer: NodeJS.Timeout | null;
  botTimer: NodeJS.Timeout | null;
  quickTimer: NodeJS.Timeout | null;
  quickStartsAt: number | null;
  takeover: Map<number, NodeJS.Timeout>;
  lastActivity: number;
  /** When every human at a running table went offline (bots alone keep it going). */
  allAwaySince: number | null;
  emoteAt: Map<string, number>;
  lastResults: unknown;
}

export interface Context {
  io: Server;
  config: GameConfig;
  db: () => PlayerDB;
  store: Store;
  track: (event: string, props: Record<string, unknown>) => void;
  dataDir: string;
  publicUrl: string;
}

// No look-alikes: no O/0, no I/1.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const secureRng = () => randomInt(0, 2 ** 47) / 2 ** 47;

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;
const noop: Ack = () => {};

export class RoomManager {
  private rooms = new Map<string, Room>();
  private userRoom = new Map<string, string>();

  constructor(private readonly ctx: Context) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  stats() {
    const rooms = [...this.rooms.values()];
    return { rooms: rooms.length, playing: rooms.filter((r) => r.status === 'playing').length };
  }

  // ------------------------------------------------------------ socket wiring

  attach(socket: Socket, user: User): void {
    socket.data.userId = user.id;
    const resumed = this.userRoom.get(user.id);
    if (resumed) this.reconnect(socket, user, resumed);

    const on = (event: string, fn: (payload: any, ack: Ack) => void) =>
      socket.on(event, (payload: unknown, ack?: Ack) => {
        try {
          fn(payload ?? {}, typeof ack === 'function' ? ack : noop);
        } catch (e) {
          console.error(`[${event}]`, e);
          (typeof ack === 'function' ? ack : noop)({ ok: false, error: 'server_error' });
        }
      });

    on('join_room', (p, ack) => this.join(socket, user, p, ack));
    on('leave_room', (_p, ack) => { this.leave(user.id); ack({ ok: true }); });
    on('room_settings', (p, ack) => this.updateSettings(user, p, ack));
    on('start_game', (_p, ack) => this.hostStart(user, ack));
    on('rematch', (_p, ack) => this.rematch(user, ack));
    on('play_card', (p, ack) => this.act(user, ack, (g, seat) => g.play(seat, String(p.cardId), { playerId: p.playerId ? String(p.playerId) : undefined, colour: p.colour as Colour | undefined })));
    on('draw_card', (_p, ack) => this.act(user, ack, (g, seat) => g.draw(seat)));
    on('pass_card', (_p, ack) => this.act(user, ack, (g, seat) => g.pass(seat)));
    on('final_whistle', (_p, ack) => this.act(user, ack, (g, seat) => g.callWhistle(seat)));
    on('request_hint', (p, ack) => this.hint(user, p, ack));
    on('emote', (p) => this.emote(user, String(p.emoteId)));
    socket.on('disconnect', () => this.disconnect(user.id, socket.id));
  }

  // ------------------------------------------------------------ joining

  private join(socket: Socket, user: User, p: any, ack: Ack): void {
    const mode = p.mode as Mode;
    const current = this.userRoom.get(user.id);
    if (current && current !== p.code) this.leave(user.id);

    if (mode === 'quick') {
      let room = [...this.rooms.values()].find((r) => r.mode === 'quick' && r.status === 'lobby' && this.humans(r).length < this.ctx.config.rules.quickMatchSeats);
      room ??= this.createRoom('quick', DEFAULT_SETTINGS, { count: 0, level: 'medium' }, null);
      this.addHuman(room, socket, user);
      if (this.humans(room).length >= this.ctx.config.rules.quickMatchSeats) this.startGame(room);
      else if (!room.quickTimer) {
        const wait = this.ctx.config.rules.quickMatchWaitSeconds * 1000;
        room.quickStartsAt = Date.now() + wait;
        room.quickTimer = setTimeout(() => this.fillAndStartQuick(room!), wait);
      }
      this.broadcastRoom(room);
      return ack({ ok: true, code: room.code });
    }

    if (mode === 'private' && p.code) {
      const room = this.rooms.get(String(p.code).toUpperCase());
      if (!room || room.mode !== 'private') return ack({ ok: false, error: 'room_not_found' });
      if (room.members.some((m) => m.userId === user.id)) {
        this.reconnect(socket, user, room.code);
        return ack({ ok: true, code: room.code });
      }
      if (room.status !== 'lobby') return ack({ ok: false, error: 'game_in_progress' });
      if (room.members.length >= 6) return ack({ ok: false, error: 'room_full' });
      this.addHuman(room, socket, user);
      this.broadcastRoom(room);
      return ack({ ok: true, code: room.code });
    }

    const settings = sanitizeSettings(this.ctx.config, p.settings);
    const bots = sanitizeBots(p.bots, mode === 'solo' ? 1 : 0);
    if (mode === 'private') {
      const room = this.createRoom('private', settings, bots, user.id);
      this.addHuman(room, socket, user);
      this.syncBots(room);
      this.broadcastRoom(room);
      return ack({ ok: true, code: room.code });
    }
    if (mode === 'solo' || mode === 'tutorial') {
      const room = mode === 'tutorial'
        ? this.createRoom('tutorial', { ...DEFAULT_SETTINGS, turnSeconds: 30 }, { count: 1, level: 'easy' }, user.id)
        : this.createRoom('solo', settings, { count: Math.max(1, bots.count), level: bots.level }, user.id);
      this.addHuman(room, socket, user);
      this.syncBots(room);
      this.startGame(room);
      return ack({ ok: true, code: room.code });
    }
    ack({ ok: false, error: 'bad_mode' });
  }

  private createRoom(mode: Mode, settings: RoomSettings, bots: Room['bots'], hostId: string | null): Room {
    let code = '';
    do code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    while (this.rooms.has(code));
    const room: Room = {
      code, mode, settings, bots, hostId, members: [], status: 'lobby', game: null, seatOf: new Map(),
      turnTimer: null, botTimer: null, quickTimer: null, quickStartsAt: null, takeover: new Map(),
      lastActivity: Date.now(), allAwaySince: null, emoteAt: new Map(), lastResults: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  private addHuman(room: Room, socket: Socket, user: User): void {
    room.members.push({ userId: user.id, name: user.username, avatar: user.avatar, isBot: false, socketId: socket.id, connected: true, left: false });
    room.hostId ??= user.id;
    this.userRoom.set(user.id, room.code);
    socket.join(room.code);
    room.lastActivity = Date.now();
  }

  /** Make the room's bot seats match room.bots (lobby only). */
  private syncBots(room: Room): void {
    room.members = room.members.filter((m) => !m.isBot);
    const free = Math.min(room.bots.count, 6 - room.members.length);
    const names = [...this.ctx.config.bots.names].sort(() => secureRng() - 0.5);
    for (let i = 0; i < free; i++) {
      room.members.push({ userId: null, name: names[i % names.length], avatar: '🤖', isBot: true, botLevel: room.bots.level, socketId: null, connected: true, left: false });
    }
  }

  private fillAndStartQuick(room: Room): void {
    room.quickTimer = null;
    if (room.status !== 'lobby' || !this.rooms.has(room.code)) return;
    if (!this.humans(room).length) return this.destroy(room);
    room.bots = { count: this.ctx.config.rules.quickMatchSeats - this.humans(room).length, level: 'medium' };
    this.syncBots(room);
    this.startGame(room);
  }

  private updateSettings(user: User, p: any, ack: Ack): void {
    const room = this.roomOf(user.id);
    if (!room || room.status !== 'lobby' || room.mode !== 'private') return ack({ ok: false, error: 'not_in_lobby' });
    if (room.hostId !== user.id) return ack({ ok: false, error: 'host_only' });
    room.settings = sanitizeSettings(this.ctx.config, p.settings ?? room.settings);
    room.bots = sanitizeBots(p.bots ?? room.bots, 0);
    this.syncBots(room);
    this.broadcastRoom(room);
    ack({ ok: true });
  }

  private hostStart(user: User, ack: Ack): void {
    const room = this.roomOf(user.id);
    if (!room || room.status !== 'lobby') return ack({ ok: false, error: 'not_in_lobby' });
    if (room.hostId !== user.id) return ack({ ok: false, error: 'host_only' });
    if (room.members.length < 2) return ack({ ok: false, error: 'need_two_players' });
    this.startGame(room);
    ack({ ok: true });
  }

  private rematch(user: User, ack: Ack): void {
    const room = this.roomOf(user.id);
    if (!room || room.status !== 'results') return ack({ ok: false, error: 'not_finished' });
    room.members = room.members.filter((m) => !m.left);
    if (room.mode === 'solo' || room.mode === 'tutorial') {
      if (room.mode === 'tutorial') room.mode = 'solo';
      this.syncBots(room);
      this.startGame(room);
    } else {
      // Everyone stays in the same room; the host starts the next game from the lobby.
      room.status = 'lobby';
      room.game = null;
      if (room.mode === 'quick') room.mode = 'private';
      if (!room.members.some((m) => m.userId === room.hostId)) room.hostId = this.humans(room)[0]?.userId ?? null;
      this.broadcastRoom(room);
    }
    ack({ ok: true });
  }

  // ------------------------------------------------------------ playing

  private startGame(room: Room): void {
    if (room.quickTimer) clearTimeout(room.quickTimer);
    room.quickTimer = null;
    room.quickStartsAt = null;
    const { config } = this.ctx;
    const db = this.ctx.db(); // games finish on the data version they started with
    // Seats are random (the tutorial keeps the player in seat 0).
    if (room.mode !== 'tutorial') room.members.sort(() => secureRng() - 0.5);
    const game = new Game({
      id: `${room.code}-${Date.now().toString(36)}`,
      config, db, settings: room.settings, rng: secureRng,
      seats: room.members.map((m) => ({ name: m.name, avatar: m.avatar, isBot: m.isBot, botLevel: m.botLevel, userId: m.userId ?? undefined })),
      ...(room.mode === 'tutorial' ? { presetDeck: tutorialDeck(config, secureRng), firstSeat: 0 } : {}),
    });
    room.game = game;
    room.status = 'playing';
    room.seatOf = new Map(room.members.flatMap((m, i) => (m.userId ? [[m.userId, i] as [string, number]] : [])));
    room.lastActivity = Date.now();
    this.broadcastRoom(room);
    const events = game.start();
    this.ctx.track('match_start', {
      gameId: game.id, mode: room.mode, humans: this.humans(room).length, bots: room.members.filter((m) => m.isBot).length,
      settings: room.settings, dataVersion: db.version,
    });
    this.afterChange(room, events);
  }

  private act(user: User, ack: Ack, fn: (g: Game, seat: number) => ActionResult): void {
    const room = this.roomOf(user.id);
    const game = room?.game;
    if (!room || !game || room.status !== 'playing') return ack({ ok: false, error: 'no_game' });
    const seat = room.seatOf.get(user.id)!;
    const t0 = game.turnEndsAt - room.settings.turnSeconds * 1000;
    const result = fn(game, seat);
    if (!result.ok) return ack({ ok: false, error: result.error });
    for (const e of result.events) {
      if (e.type === 'play_result' && e.result.seat === seat && e.result.answer) {
        this.ctx.track('answer_submitted', {
          gameId: game.id, cardA: `${e.result.anchorBefore!.kind}:${e.result.anchorBefore!.ref}`, cardB: `${e.result.card.kind}:${e.result.card.ref}`,
          valid: e.result.valid, secondsTaken: Math.round((Date.now() - t0) / 100) / 10, usedHint: !!e.result.hinted,
        });
      }
    }
    ack({ ok: true });
    this.afterChange(room, result.events);
  }

  private hint(user: User, p: any, ack: Ack): void {
    const room = this.roomOf(user.id);
    const game = room?.game;
    if (!room || !game || room.status !== 'playing') return ack({ ok: false, error: 'no_game' });
    const payment = p.payment === 'ad' ? 'ad' : 'card';
    // Rewarded-ad hints: the ad network's server-side verification callback plugs in here.
    // This build accepts the app's simulated ad receipt.
    if (payment === 'ad' && !p.adReceipt) return ack({ ok: false, error: 'ad_not_verified' });
    const seat = room.seatOf.get(user.id)!;
    const result = game.hint(seat, String(p.cardId), payment);
    if (!result.ok) return ack({ ok: false, error: result.error });
    this.ctx.track('hint_used', { gameId: game.id, paidWith: payment, found: !!result.hint });
    ack({ ok: true, hint: result.hint ?? null });
    this.afterChange(room, result.events);
  }

  private emote(user: User, emoteId: string): void {
    const room = this.roomOf(user.id);
    if (!room?.game || !this.ctx.config.emotes.some((e) => e.id === emoteId)) return;
    const last = room.emoteAt.get(user.id) ?? 0;
    if (Date.now() - last < 2000) return;
    room.emoteAt.set(user.id, Date.now());
    this.ctx.io.to(room.code).emit('emote', { seat: room.seatOf.get(user.id), emoteId });
  }

  private afterChange(room: Room, events: GameEvent[]): void {
    const game = room.game!;
    room.lastActivity = Date.now();
    for (const e of events) {
      if (e.type === 'play_result') {
        this.ctx.io.to(room.code).emit('play_result', e.result);
        this.ctx.track('card_played', { gameId: game.id, cardType: e.result.card.kind, playType: e.result.playType, valid: e.result.valid, turn: game.turnNumber });
      } else if (e.type === 'turn_started') {
        this.ctx.io.to(room.code).emit('turn_started', { seat: e.seat, turnNumber: e.turnNumber, turnEndsAt: game.turnEndsAt, serverNow: Date.now() });
      } else if (e.type === 'draw') {
        this.ctx.io.to(room.code).emit('game_event', e);
        if (e.reason !== 'hint') this.ctx.track('card_drawn', { gameId: game.id, reason: e.reason, count: e.count });
      } else if (e.type !== 'game_over') {
        this.ctx.io.to(room.code).emit('game_event', e);
      }
    }
    this.broadcastState(room);
    if (game.phase === 'over') return this.finishGame(room);
    this.scheduleTurn(room);
  }

  private scheduleTurn(room: Room): void {
    const game = room.game!;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.botTimer) clearTimeout(room.botTimer);
    room.botTimer = null;
    const turnNumber = game.turnNumber;
    const seat = game.seats[game.turn];

    room.turnTimer = setTimeout(() => {
      if (room.game !== game || game.phase !== 'playing' || game.turnNumber !== turnNumber) return;
      let events: GameEvent[];
      if (!seat.isBot && !seat.connected && !seat.botControlled) {
        // Disconnected: the seat keeps playing on the timer by auto-drawing.
        const r = game.draw(seat.index);
        events = r.events;
        if (game.drawnCardId && game.turnNumber === turnNumber) events = [...events, ...game.pass(seat.index).events];
      } else {
        events = game.timeout().events;
      }
      this.afterChange(room, events);
    }, Math.max(0, game.turnEndsAt - Date.now()));

    if (!seat.isBot && !seat.botControlled) return;
    const level: BotLevel = seat.botLevel ?? 'medium';
    const drawnCardId = game.drawnCardId;
    const plan = room.mode === 'tutorial' && seat.isBot
      ? (drawnCardId ? { type: 'pass' as const, delayMs: 1200 } : { type: 'draw' as const, delayMs: 1800 })
      : planBotTurn(game, seat.index, level);
    room.botTimer = setTimeout(() => {
      if (room.game !== game || game.phase !== 'playing' || game.turnNumber !== turnNumber || game.drawnCardId !== drawnCardId) return;
      if (plan.type === 'play' && plan.callWhistle) this.afterWhistle(room, game.callWhistle(seat.index));
      let r = plan.type === 'play' ? game.play(seat.index, plan.cardId, { playerId: plan.playerId, colour: plan.colour })
        : plan.type === 'draw' ? game.draw(seat.index) : game.pass(seat.index);
      if (!r.ok) r = game.drawnCardId ? game.pass(seat.index) : game.draw(seat.index);
      this.afterChange(room, r.events);
    }, plan.delayMs);
  }

  private afterWhistle(room: Room, r: ActionResult): void {
    if (r.ok) for (const e of r.events) this.ctx.io.to(room.code).emit('game_event', e);
  }

  private finishGame(room: Room): void {
    const game = room.game!;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.botTimer) clearTimeout(room.botTimer);
    for (const t of room.takeover.values()) clearTimeout(t);
    room.takeover.clear();
    room.status = 'results';
    const { config, store } = this.ctx;
    const solo = room.mode === 'solo' || room.mode === 'tutorial';
    const placings = game.placings!;
    const rewards: Record<string, unknown> = {};

    for (const seat of game.seats) {
      if (!seat.userId) continue;
      const member = room.members.find((m) => m.userId === seat.userId);
      const user = store.userById(seat.userId);
      if (!user || member?.left) continue;
      const won = placings[0].seat === seat.index;
      const xp = gameXp(config, seat.stats, won, solo);
      const before = user.level;
      user.xp += xp;
      user.level = levelForXp(config, user.xp).level;
      const levelUps = user.level - before;
      const coins = config.progression.coins.perGame + (won ? config.progression.coins.perWin : 0) + levelUps * config.progression.coins.perLevel;
      user.coins += coins;
      const s = user.stats;
      s.games++;
      if (won) s.wins++;
      s.correctAnswers += seat.stats.correctAnswers;
      s.bestStreak = Math.max(s.bestStreak, seat.stats.bestStreak);
      for (const [name, n] of Object.entries(seat.stats.named)) s.named[name] = (s.named[name] ?? 0) + n;
      for (const r of game.log) if (r.seat === seat.index && r.valid && r.card.kind === 'club') s.clubCards[r.card.ref] = (s.clubCards[r.card.ref] ?? 0) + 1;
      if (!solo) {
        if (user.weekly.week !== weekKey()) user.weekly = { week: weekKey(), xp: 0 };
        user.weekly.xp += xp;
        user.onlineXp += xp;
      }
      user.lastGame = { gameId: game.id, coins, doubled: false };
      const starterPack = won && !user.starterPackOffered;
      if (starterPack) user.starterPackOffered = true;
      rewards[user.id] = { xp, coins, levelUps, level: user.level, totalCoins: user.coins, starterPack, solo };
    }
    store.save();

    const results = {
      gameId: game.id,
      mode: room.mode,
      placings: placings.map((p) => ({ ...p, name: game.seats[p.seat].name, avatar: game.seats[p.seat].avatar, isBot: game.seats[p.seat].isBot })),
    };
    room.lastResults = results;
    for (const m of room.members) {
      if (!m.socketId || !m.userId) continue;
      this.ctx.io.to(m.socketId).emit('game_over', { ...results, you: room.seatOf.get(m.userId), reward: rewards[m.userId] ?? null });
    }
    for (const seat of game.seats) {
      const member = room.members.find((m) => m.userId && m.userId === seat.userId);
      this.ctx.track('match_end', {
        gameId: game.id, mode: room.mode, isBot: seat.isBot, placing: placings.find((p) => p.seat === seat.index)!.place,
        durationSeconds: Math.round((Date.now() - game.startedAt) / 1000), cardsLeft: seat.hand.length, leftEarly: !!member?.left,
      });
    }
    // Full move log for disputes, bug fixing and analytics.
    try {
      const dir = join(this.ctx.dataDir, 'games');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${game.id}.json`), JSON.stringify({ id: game.id, mode: room.mode, dataVersion: game.db.version, settings: room.settings, seats: game.seats.map((s) => ({ name: s.name, isBot: s.isBot, userId: s.userId })), placings, history: game.history }));
    } catch (e) {
      console.error('could not write game log', e);
    }
    this.broadcastRoom(room);
    this.removeLeftMembers(room);
  }

  // ------------------------------------------------------------ leaving / reconnecting

  private leave(userId: string): void {
    const room = this.roomOf(userId);
    this.userRoom.delete(userId);
    if (!room) return;
    const member = room.members.find((m) => m.userId === userId);
    if (!member) return;
    const sock = member.socketId ? this.ctx.io.sockets.sockets.get(member.socketId) : null;
    sock?.leave(room.code);
    if (room.status === 'playing' && room.game) {
      // The seat stays in the game, played by a Medium bot.
      member.left = true;
      member.socketId = null;
      member.connected = false;
      const seat = room.game.seats[room.seatOf.get(userId)!];
      seat.connected = false;
      seat.botControlled = true;
      seat.botLevel = 'medium';
      if (!this.humans(room).some((m) => !m.left)) return this.destroy(room);
      this.broadcastState(room);
      if (room.game.turn === seat.index) this.scheduleTurn(room);
    } else {
      room.members = room.members.filter((m) => m !== member);
    }
    if (room.hostId === userId) room.hostId = this.humans(room).find((m) => !m.left)?.userId ?? null;
    if (!this.humans(room).some((m) => !m.left)) return this.destroy(room);
    this.broadcastRoom(room);
  }

  private disconnect(userId: string, socketId: string): void {
    const room = this.roomOf(userId);
    if (!room) return;
    const member = room.members.find((m) => m.userId === userId);
    if (!member || member.socketId !== socketId) return;
    member.socketId = null;
    member.connected = false;
    if (room.status === 'playing' && room.game) {
      const seatIndex = room.seatOf.get(userId)!;
      const seat = room.game.seats[seatIndex];
      seat.connected = false;
      this.ctx.track('disconnect', { gameId: room.game.id });
      // After the grace period a Medium bot takes the seat until the player comes back.
      room.takeover.set(seatIndex, setTimeout(() => {
        if (seat.connected || room.status !== 'playing') return;
        seat.botControlled = true;
        seat.botLevel = 'medium';
        this.broadcastState(room);
        if (room.game?.turn === seatIndex) this.scheduleTurn(room);
      }, this.ctx.config.rules.disconnectGraceSeconds * 1000));
      this.broadcastState(room);
    } else if (room.status === 'lobby' && room.mode === 'quick') {
      this.leave(userId);
    } else {
      this.broadcastRoom(room);
    }
  }

  private reconnect(socket: Socket, user: User, code: string): void {
    const room = this.rooms.get(code);
    const member = room?.members.find((m) => m.userId === user.id);
    if (!room || !member || member.left) {
      this.userRoom.delete(user.id);
      return;
    }
    member.socketId = socket.id;
    member.connected = true;
    socket.join(room.code);
    socket.emit('room_state', this.roomView(room, user.id));
    if (room.status === 'playing' && room.game) {
      const seatIndex = room.seatOf.get(user.id)!;
      const seat = room.game.seats[seatIndex];
      const away = room.takeover.get(seatIndex);
      if (away) clearTimeout(away);
      room.takeover.delete(seatIndex);
      seat.connected = true;
      seat.botControlled = false;
      seat.botLevel = undefined;
      this.ctx.track('reconnect', { gameId: room.game.id });
      this.broadcastState(room);
      if (room.game.turn === seatIndex) this.scheduleTurn(room);
    } else if (room.status === 'results' && room.lastResults) {
      socket.emit('game_over', { ...(room.lastResults as object), you: room.seatOf.get(user.id), reward: null });
    }
    this.broadcastRoom(room);
  }

  private removeLeftMembers(room: Room): void {
    room.members = room.members.filter((m) => !m.left);
    if (!this.humans(room).length) this.destroy(room);
  }

  private destroy(room: Room): void {
    for (const t of [room.turnTimer, room.botTimer, room.quickTimer, ...room.takeover.values()]) if (t) clearTimeout(t);
    for (const m of room.members) if (m.userId && this.userRoom.get(m.userId) === room.code) this.userRoom.delete(m.userId);
    this.rooms.delete(room.code);
  }

  /**
   * Room codes expire 30 minutes after the last game ends (or after 30 idle minutes).
   * A running game whose humans have all been offline for 10 minutes is closed.
   */
  private sweep(): void {
    const expiry = this.ctx.config.rules.roomCodeExpiryMinutes * 60_000;
    for (const room of this.rooms.values()) {
      if (room.status === 'playing') {
        const anyoneHere = this.humans(room).some((m) => m.connected && !m.left);
        room.allAwaySince = anyoneHere ? null : room.allAwaySince ?? Date.now();
        if (room.allAwaySince && Date.now() - room.allAwaySince > 10 * 60_000) this.destroy(room);
        continue;
      }
      if (Date.now() - room.lastActivity > expiry) this.destroy(room);
    }
  }

  // ------------------------------------------------------------ broadcasting

  private broadcastRoom(room: Room): void {
    for (const m of room.members) if (m.socketId) this.ctx.io.to(m.socketId).emit('room_state', this.roomView(room, m.userId));
  }

  private broadcastState(room: Room): void {
    const game = room.game;
    if (!game) return;
    for (const m of room.members) {
      if (!m.socketId || !m.userId) continue;
      this.ctx.io.to(m.socketId).emit('game_state', game.view(room.seatOf.get(m.userId) ?? null));
    }
  }

  private roomView(room: Room, userId: string | null) {
    return {
      code: room.code,
      mode: room.mode,
      status: room.status,
      settings: room.settings,
      bots: room.bots,
      isHost: room.hostId === userId,
      quickStartsAt: room.quickStartsAt,
      serverNow: Date.now(),
      shareUrl: `${this.ctx.publicUrl}/?room=${room.code}`,
      members: room.members.filter((m) => !m.left).map((m) => ({
        name: m.name, avatar: m.avatar, isBot: m.isBot, botLevel: m.botLevel, connected: m.connected,
        isHost: !!m.userId && m.userId === room.hostId, you: !!userId && m.userId === userId,
      })),
    };
  }

  private roomOf(userId: string): Room | null {
    const code = this.userRoom.get(userId);
    return code ? this.rooms.get(code) ?? null : null;
  }

  private humans(room: Room): Member[] {
    return room.members.filter((m) => !m.isBot);
  }

  // ------------------------------------------------------------ rewarded ads (results screen / home)

  grantAd(user: User, placement: string): { ok: boolean; error?: string; coins?: number } {
    const ads = this.ctx.config.progression.ads;
    if (placement === 'free_coins') {
      if (user.ads.day !== dayKey()) user.ads = { day: dayKey(), freeCoins: 0 };
      if (user.ads.freeCoins >= ads.freeCoinsPerDay) return { ok: false, error: 'daily_limit' };
      user.ads.freeCoins++;
      user.coins += ads.freeCoinsAmount;
      this.ctx.store.save();
      return { ok: true, coins: ads.freeCoinsAmount };
    }
    if (placement === 'double_coins') {
      if (!user.lastGame || user.lastGame.doubled) return { ok: false, error: 'not_available' };
      user.lastGame.doubled = true;
      user.coins += user.lastGame.coins;
      this.ctx.store.save();
      return { ok: true, coins: user.lastGame.coins };
    }
    return { ok: false, error: 'bad_placement' };
  }
}

function sanitizeSettings(config: GameConfig, s: any): RoomSettings {
  const turnSeconds = config.rules.turnSecondsOptions.includes(Number(s?.turnSeconds)) ? Number(s.turnSeconds) : DEFAULT_SETTINGS.turnSeconds;
  return {
    turnSeconds,
    safePlay: s?.safePlay ?? DEFAULT_SETTINGS.safePlay,
    stacking: s?.stacking ?? DEFAULT_SETTINGS.stacking,
    dimUnplayable: s?.dimUnplayable ?? DEFAULT_SETTINGS.dimUnplayable,
  };
}

function sanitizeBots(b: any, min: number): Room['bots'] {
  const level: BotLevel = ['easy', 'medium', 'hard'].includes(b?.level) ? b.level : 'medium';
  const count = Math.max(min, Math.min(5, Math.floor(Number(b?.count) || 0)));
  return { count, level };
}
