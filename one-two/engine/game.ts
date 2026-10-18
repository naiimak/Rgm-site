// The One-Two rules engine. The server owns one Game per table and is the only thing that
// changes it; phones only ever receive views of it (see view()). Every rule in the spec's
// "Game rules" section is enforced here.

import { buildDeck, cardPoints, isSubject, isWild } from './cards.ts';
import { PlayerDB, subjectKey } from './database.ts';
import {
  COLOURS, type ActionKind, type BotLevel, type Card, type Colour, type GameConfig, type GameEvent, type GameStateView,
  type Placing, type PlayResult, type RoomSettings, type SeatStats,
} from './types.ts';

export interface SeatInit {
  name: string;
  avatar?: string;
  isBot: boolean;
  botLevel?: BotLevel;
  userId?: string;
}

export interface Seat extends SeatInit {
  index: number;
  hand: Card[];
  whistle: boolean;
  connected: boolean;
  /** A human seat temporarily played by a Medium bot after a disconnect. */
  botControlled: boolean;
  adHintUsed: boolean;
  stats: SeatStats;
}

export interface GameOptions {
  id: string;
  config: GameConfig;
  db: PlayerDB;
  seats: SeatInit[];
  settings: RoomSettings;
  /** Must be cryptographically secure on the server. */
  rng: () => number;
  now?: () => number;
  /** Tutorial / tests: fixed deck, first card = top of the deck. */
  presetDeck?: Card[];
  firstSeat?: number;
}

export type PlayOptions = { playerId?: string; colour?: Colour };

export type ActionResult =
  | { ok: true; events: GameEvent[]; hint?: { playerId: string; name: string } | null }
  | { ok: false; error: GameError; events: GameEvent[] };

export type GameError =
  | 'game_over' | 'not_your_turn' | 'not_in_hand' | 'must_play_drawn' | 'must_stack_or_draw' | 'colour_required'
  | 'no_match' | 'answer_required' | 'already_used' | 'unknown_player' | 'already_drew' | 'nothing_drawn'
  | 'hint_used' | 'ad_hint_used' | 'not_subject' | 'whistle_not_allowed';

export interface HistoryEntry { t: number; seat: number; action: string; detail?: unknown; events: GameEvent[] }

export class Game {
  readonly id: string;
  readonly config: GameConfig;
  readonly db: PlayerDB;
  readonly settings: RoomSettings;
  readonly seats: Seat[];
  readonly rng: () => number;
  readonly now: () => number;
  readonly startedAt: number;

  deck: Card[] = []; // last element = top of the draw pile
  pile: Card[] = []; // last element = top of the discard pile
  anchor!: Card;
  activeColour!: Colour;
  direction: 1 | -1 = 1;
  turn = 0;
  turnNumber = 0;
  turnEndsAt = 0;
  phase: 'playing' | 'over' = 'playing';
  drawnCardId: string | null = null;
  pendingDraw: { amount: number; action: ActionKind } | null = null;
  hintUsedThisTurn = false;
  hintCardId: string | null = null;
  used = new Set<string>();
  log: PlayResult[] = [];
  history: HistoryEntry[] = [];
  placings: Placing[] | null = null;
  private whistlePenaltyDue = false;
  private readonly presetDeck?: Card[];
  private readonly firstSeat?: number;

  constructor(o: GameOptions) {
    this.id = o.id;
    this.config = o.config;
    this.db = o.db;
    this.settings = o.settings;
    this.rng = o.rng;
    this.now = o.now ?? Date.now;
    this.presetDeck = o.presetDeck;
    this.firstSeat = o.firstSeat;
    this.startedAt = this.now();
    this.seats = o.seats.map((s, index) => ({
      ...s, index, hand: [], whistle: false, connected: true, botControlled: false, adHintUsed: false,
      stats: { correctAnswers: 0, correctSpecial: 0, correctPlain: 0, hintedAnswers: 0, wrongAnswers: 0, safeOrMatchPlays: 0, currentStreak: 0, bestStreak: 0, named: {} },
    }));
  }

  // ---------------------------------------------------------------- setup

  start(): GameEvent[] {
    const events: GameEvent[] = [];
    if (this.presetDeck) {
      this.deck = [...this.presetDeck].reverse();
    } else {
      this.deck = this.shuffle(buildDeck(this.config));
    }
    for (let round = 0; round < this.config.rules.handSize; round++) {
      for (const seat of this.seats) seat.hand.push(this.deck.pop()!);
    }
    // The first anchor must be a Club card; anything else goes back into the deck.
    for (;;) {
      const card = this.deck.pop()!;
      if (card.kind === 'club') { this.anchor = card; break; }
      const at = this.presetDeck ? 0 : Math.floor(this.rng() * (this.deck.length + 1));
      this.deck.splice(at, 0, card);
    }
    this.pile = [this.anchor];
    this.activeColour = this.anchor.colour!;
    this.turn = this.firstSeat ?? Math.floor(this.rng() * this.seats.length);
    this.turnNumber = 1;
    this.resetTurnTimer();
    events.push({ type: 'turn_started', seat: this.turn, turnNumber: this.turnNumber });
    this.record(-1, 'start', { anchor: this.anchor, first: this.turn }, events);
    return events;
  }

  // ---------------------------------------------------------------- queries

  get top(): Card {
    return this.pile[this.pile.length - 1];
  }

  seatAt(steps: number): number {
    const n = this.seats.length;
    return (((this.turn + this.direction * steps) % n) + n) % n;
  }

  /** Valid, not-yet-named players linking this card to the anchor. */
  linkablePlayers(card: Card): string[] {
    if (!isSubject(card)) return [];
    return this.db.validPlayers(subjectKey(this.anchor), subjectKey(card)).filter((id) => !this.used.has(id));
  }

  canSafePlay(card: Card): boolean {
    return this.settings.safePlay && card.kind === 'club' && card.colour === this.activeColour;
  }

  canMatch(card: Card): boolean {
    if (card.kind !== 'action') return false;
    if (isWild(card)) return true;
    return card.colour === this.activeColour || (this.top.kind === 'action' && this.top.ref === card.ref);
  }

  /** How (if at all) this seat could play this card right now. Used for dimming and bots. */
  playMode(seatIndex: number, card: Card): 'link' | 'safe' | 'match' | null {
    if (this.phase !== 'playing' || seatIndex !== this.turn) return this.passivePlayMode(card);
    if (this.drawnCardId && card.id !== this.drawnCardId) return null;
    if (this.pendingDraw) return card.kind === 'action' && card.ref === this.pendingDraw.action ? 'match' : null;
    return this.passivePlayMode(card);
  }

  private passivePlayMode(card: Card): 'link' | 'safe' | 'match' | null {
    if (card.kind === 'action') return this.canMatch(card) ? 'match' : null;
    if (this.linkablePlayers(card).length > 0) return 'link';
    if (this.canSafePlay(card)) return 'safe';
    return null;
  }

  // ---------------------------------------------------------------- actions

  play(seatIndex: number, cardId: string, opts: PlayOptions = {}): ActionResult {
    const fail = this.checkTurn(seatIndex);
    if (fail) return fail;
    const seat = this.seats[seatIndex];
    const idx = seat.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return err('not_in_hand');
    const card = seat.hand[idx];
    if (this.drawnCardId && card.id !== this.drawnCardId) return err('must_play_drawn');
    if (this.pendingDraw && !(card.kind === 'action' && card.ref === this.pendingDraw.action)) return err('must_stack_or_draw');

    const events: GameEvent[] = [];
    const base = { seat: seatIndex, playerName: seat.name, card, anchorBefore: this.anchor };

    if (card.kind === 'action') {
      if (isWild(card) && (!opts.colour || !COLOURS.includes(opts.colour))) return err('colour_required');
      if (!this.canMatch(card)) return err('no_match');
      seat.hand.splice(idx, 1);
      this.pile.push(card);
      this.activeColour = isWild(card) ? opts.colour! : card.colour!;
      seat.stats.safeOrMatchPlays++;
      this.pushResult(events, { ...base, playType: isWild(card) ? 'wild' : 'match', valid: true, chosenColour: isWild(card) ? opts.colour : undefined });
      if (this.checkWin(seatIndex, events)) return this.done(seatIndex, 'play', { cardId, ...opts }, events);
      this.noteWhistle(seat);
      this.applyAction(card.ref as ActionKind, events);
      return this.done(seatIndex, 'play', { cardId, ...opts }, events);
    }

    // Subject card
    if (!opts.playerId) {
      if (!this.canSafePlay(card)) return err('answer_required');
      seat.hand.splice(idx, 1);
      this.placeSubject(card);
      seat.stats.safeOrMatchPlays++;
      this.pushResult(events, { ...base, playType: 'safe', valid: true });
    } else {
      if (this.used.has(opts.playerId)) return err('already_used'); // no penalty, timer keeps running
      const player = this.db.byId.get(opts.playerId);
      if (!player) return err('unknown_player');
      const a = subjectKey(this.anchor);
      const b = subjectKey(card);
      const hinted = this.hintCardId === card.id;
      if (!this.db.isValid(a, b, player.id)) {
        seat.stats.wrongAnswers++;
        seat.stats.currentStreak = 0;
        const penalty = this.config.rules.wrongAnswerDraw;
        this.pushResult(events, { ...base, playType: 'link', valid: false, answer: { id: player.id, name: player.name }, reason: this.db.whyNot(player, a, b), penalty, hinted });
        this.drawCards(seatIndex, penalty, 'penalty', events);
        this.endTurn(1, events);
        return this.done(seatIndex, 'play', { cardId, ...opts }, events);
      }
      seat.hand.splice(idx, 1);
      this.used.add(player.id);
      this.placeSubject(card);
      const s = seat.stats;
      s.correctAnswers++;
      s.currentStreak++;
      s.bestStreak = Math.max(s.bestStreak, s.currentStreak);
      s.named[player.name] = (s.named[player.name] ?? 0) + 1;
      if (hinted) s.hintedAnswers++;
      else if (card.kind === 'champion' || card.kind === 'trophy' || card.kind === 'coach') s.correctSpecial++;
      else s.correctPlain++;
      this.pushResult(events, {
        ...base, playType: 'link', valid: true, hinted,
        answer: { id: player.id, name: player.name },
        connections: [this.db.connection(player, a), this.db.connection(player, b)],
      });
    }
    if (this.checkWin(seatIndex, events)) return this.done(seatIndex, 'play', { cardId, ...opts }, events);
    this.noteWhistle(seat);
    this.endTurn(1, events);
    return this.done(seatIndex, 'play', { cardId, ...opts }, events);
  }

  draw(seatIndex: number): ActionResult {
    const fail = this.checkTurn(seatIndex);
    if (fail) return fail;
    if (this.drawnCardId) return err('already_drew');
    const events: GameEvent[] = [];
    if (this.pendingDraw) {
      const { amount, action } = this.pendingDraw;
      this.pendingDraw = null;
      this.drawCards(seatIndex, amount, 'stack', events);
      events.push({ type: 'skip', seat: seatIndex, reason: action === 'yellow' ? 'yellow' : 'hattrick' });
      this.endTurn(1, events);
      return this.done(seatIndex, 'draw', undefined, events);
    }
    const [card] = this.drawCards(seatIndex, 1, 'choice', events);
    if (card && this.playMode(seatIndex, card)) {
      this.drawnCardId = card.id; // may play it now, or keep it with pass()
    } else {
      this.endTurn(1, events);
    }
    return this.done(seatIndex, 'draw', undefined, events);
  }

  /** Keep the card just drawn and end the turn. */
  pass(seatIndex: number): ActionResult {
    const fail = this.checkTurn(seatIndex);
    if (fail) return fail;
    if (!this.drawnCardId) return err('nothing_drawn');
    const events: GameEvent[] = [];
    this.endTurn(1, events);
    return this.done(seatIndex, 'pass', undefined, events);
  }

  /** Server-side timer expiry for the current turn. */
  timeout(): ActionResult {
    if (this.phase !== 'playing') return err('game_over');
    const seatIndex = this.turn;
    if (this.drawnCardId) return this.pass(seatIndex); // already acted this turn by drawing
    if (this.pendingDraw) return this.draw(seatIndex);
    const events: GameEvent[] = [];
    this.drawCards(seatIndex, this.config.rules.timeoutDraw, 'timeout', events);
    this.endTurn(1, events);
    return this.done(seatIndex, 'timeout', undefined, events);
  }

  hint(seatIndex: number, cardId: string, payment: 'card' | 'ad'): ActionResult {
    const fail = this.checkTurn(seatIndex);
    if (fail) return fail;
    if (this.hintUsedThisTurn) return err('hint_used');
    const seat = this.seats[seatIndex];
    const card = seat.hand.find((c) => c.id === cardId);
    if (!card) return err('not_in_hand');
    if (!isSubject(card)) return err('not_subject');
    if (payment === 'ad' && seat.adHintUsed) return err('ad_hint_used');
    const candidates = this.linkablePlayers(card);
    if (!candidates.length) return { ok: true, events: [], hint: null }; // nothing to show, nothing charged
    const events: GameEvent[] = [];
    if (payment === 'card') this.drawCards(seatIndex, 1, 'hint', events);
    else seat.adHintUsed = true;
    this.hintUsedThisTurn = true;
    this.hintCardId = card.id;
    const pick = candidates[Math.floor(this.rng() * Math.min(3, candidates.length))];
    const player = this.db.byId.get(pick)!;
    this.done(seatIndex, 'hint', { cardId, payment }, events);
    return { ok: true, events, hint: { playerId: player.id, name: player.name } };
  }

  callWhistle(seatIndex: number): ActionResult {
    if (this.phase !== 'playing') return err('game_over');
    const seat = this.seats[seatIndex];
    if (seat.hand.length !== 2 || seat.whistle) return err('whistle_not_allowed');
    seat.whistle = true;
    const events: GameEvent[] = [{ type: 'whistle', seat: seatIndex }];
    return this.done(seatIndex, 'final_whistle', undefined, events);
  }

  // ---------------------------------------------------------------- views

  view(viewer: number | null): GameStateView {
    const you = viewer !== null && viewer >= 0 ? viewer : null;
    const hand = you !== null ? this.seats[you].hand : [];
    const playable = you !== null ? hand.filter((c) => this.playMode(you, c)).map((c) => c.id) : [];
    const safePlayable = you !== null && you === this.turn && !this.pendingDraw
      ? hand.filter((c) => this.canSafePlay(c) && (!this.drawnCardId || c.id === this.drawnCardId)).map((c) => c.id)
      : [];
    return {
      gameId: this.id,
      dataVersion: this.db.version,
      phase: this.phase,
      seats: this.seats.map((s) => ({
        seat: s.index, name: s.name, avatar: s.avatar ?? '⚽', isBot: s.isBot, botLevel: s.botLevel,
        botControlled: s.botControlled, connected: s.connected, cardCount: s.hand.length, whistle: s.whistle,
      })),
      you,
      hand,
      playable,
      safePlayable,
      anchor: this.anchor,
      top: this.top,
      activeColour: this.activeColour,
      direction: this.direction,
      turn: this.turn,
      turnNumber: this.turnNumber,
      turnEndsAt: this.turnEndsAt,
      serverNow: this.now(),
      deckCount: this.deck.length,
      drawnCardId: you === this.turn ? this.drawnCardId : null,
      pendingDraw: this.pendingDraw,
      hintUsedThisTurn: you === this.turn && this.hintUsedThisTurn,
      adHintAvailable: you !== null && !this.seats[you].adHintUsed,
      log: this.log.slice(-30),
      settings: this.settings,
      placings: this.placings,
    };
  }

  /** Every card is in exactly one place. Used by tests and the bot simulation. */
  countCards(): number {
    return this.deck.length + this.pile.length + this.seats.reduce((n, s) => n + s.hand.length, 0);
  }

  // ---------------------------------------------------------------- internals

  private checkTurn(seatIndex: number): ActionResult | null {
    if (this.phase !== 'playing') return err('game_over');
    if (seatIndex !== this.turn) return err('not_your_turn');
    return null;
  }

  private placeSubject(card: Card): void {
    this.pile.push(card);
    this.anchor = card;
    if (card.colour) this.activeColour = card.colour;
  }

  private applyAction(action: ActionKind, events: GameEvent[]): void {
    const next = this.seatAt(1);
    switch (action) {
      case 'yellow':
      case 'hattrick': {
        const amount = action === 'yellow' ? 2 : 4;
        if (this.settings.stacking) {
          this.pendingDraw = { amount: (this.pendingDraw?.amount ?? 0) + amount, action };
          this.endTurn(1, events);
        } else {
          this.drawCards(next, amount, action, events);
          events.push({ type: 'skip', seat: next, reason: action });
          this.endTurn(2, events);
        }
        return;
      }
      case 'red':
        events.push({ type: 'skip', seat: next, reason: 'red' });
        this.endTurn(2, events);
        return;
      case 'var':
        if (this.seats.length === 2) {
          events.push({ type: 'skip', seat: next, reason: 'var' });
          this.endTurn(2, events);
        } else {
          this.direction = this.direction === 1 ? -1 : 1;
          events.push({ type: 'reverse', direction: this.direction });
          this.endTurn(1, events);
        }
        return;
      case 'transfer':
        this.endTurn(1, events);
    }
  }

  private noteWhistle(seat: Seat): void {
    if (seat.hand.length === 1 && !seat.whistle) this.whistlePenaltyDue = true;
  }

  private checkWin(seatIndex: number, events: GameEvent[]): boolean {
    if (this.seats[seatIndex].hand.length > 0) return false;
    this.phase = 'over';
    const others = this.seats
      .filter((s) => s.index !== seatIndex)
      .map((s) => ({ seat: s.index, points: s.hand.reduce((n, c) => n + cardPoints(this.config, c), 0), cardsLeft: s.hand.length }))
      .sort((a, b) => a.points - b.points || a.cardsLeft - b.cardsLeft || a.seat - b.seat);
    this.placings = [{ seat: seatIndex, points: 0, cardsLeft: 0 }, ...others].map((p, i) => ({ ...p, place: i + 1 }));
    events.push({ type: 'game_over', placings: this.placings });
    return true;
  }

  private endTurn(steps: number, events: GameEvent[]): void {
    if (this.whistlePenaltyDue) {
      this.whistlePenaltyDue = false;
      this.drawCards(this.turn, this.config.rules.finalWhistlePenalty, 'whistle', events);
    }
    this.drawnCardId = null;
    this.hintUsedThisTurn = false;
    this.hintCardId = null;
    this.turn = this.seatAt(steps);
    this.turnNumber++;
    this.resetTurnTimer();
    events.push({ type: 'turn_started', seat: this.turn, turnNumber: this.turnNumber });
  }

  private resetTurnTimer(): void {
    this.turnEndsAt = this.now() + this.settings.turnSeconds * 1000;
  }

  private drawCards(seatIndex: number, count: number, reason: Extract<GameEvent, { type: 'draw' }>['reason'], events: GameEvent[]): Card[] {
    const seat = this.seats[seatIndex];
    const drawn: Card[] = [];
    for (let i = 0; i < count; i++) {
      if (!this.deck.length) this.reshuffle(events);
      const card = this.deck.pop();
      if (!card) break; // every card is in someone's hand: nothing to draw
      seat.hand.push(card);
      drawn.push(card);
    }
    if (seat.hand.length > 2) seat.whistle = false;
    events.push({ type: 'draw', seat: seatIndex, count: drawn.length, reason });
    return drawn;
  }

  /** Deck ran out: the discard pile except the anchor and the top card becomes the new deck. */
  private reshuffle(events: GameEvent[]): void {
    const keep = new Set([this.anchor.id, this.top.id]);
    const rest = this.pile.filter((c) => !keep.has(c.id));
    if (!rest.length) return;
    this.pile = this.pile.filter((c) => keep.has(c.id));
    this.deck = this.shuffle(rest);
    events.push({ type: 'reshuffle', size: this.deck.length });
  }

  private shuffle<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private pushResult(events: GameEvent[], result: PlayResult): void {
    this.log.push(result);
    events.push({ type: 'play_result', result });
  }

  private done(seat: number, action: string, detail: unknown, events: GameEvent[]): ActionResult {
    this.record(seat, action, detail, events);
    return { ok: true, events };
  }

  private record(seat: number, action: string, detail: unknown, events: GameEvent[]): void {
    this.history.push({ t: this.now() - this.startedAt, seat, action, detail, events });
  }
}

function err(error: GameError): ActionResult {
  return { ok: false, error, events: [] };
}
