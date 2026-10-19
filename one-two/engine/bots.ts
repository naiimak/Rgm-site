// Server-side bots. They use the same rules and the same valid-player table as humans and
// differ only in how often and how fast they answer (rates live in config).

import { cardPoints, isWild } from './cards.ts';
import { subjectKey } from './database.ts';
import type { Game } from './game.ts';
import { type BotLevel, type Card, type Colour } from './types.ts';

export type BotPlan =
  | { type: 'play'; cardId: string; playerId?: string; colour?: Colour; callWhistle: boolean; delayMs: number }
  | { type: 'draw'; delayMs: number }
  | { type: 'pass'; delayMs: number };

interface Option { card: Card; mode: 'link' | 'safe' | 'match'; known: string[] }

export function planBotTurn(game: Game, seatIndex: number, level: BotLevel): BotPlan {
  const cfg = game.config.bots[level];
  const rng = game.rng;
  const seat = game.seats[seatIndex];
  const quick = () => Math.round(1200 + rng() * 1300);
  const thinking = () => {
    const [lo, hi] = cfg.answerSeconds;
    const ms = (lo + rng() * (hi - lo)) * 1000;
    return Math.round(Math.min(ms, game.settings.turnSeconds * 1000 - 800));
  };
  const drawOrPass = (): BotPlan => (game.drawnCardId ? { type: 'pass', delayMs: quick() } : { type: 'draw', delayMs: quick() });

  // A +2/+4 is waiting (stacking rooms): stack it on if we can, otherwise take the cards.
  if (game.pendingDraw) {
    const stack = seat.hand.find((c) => c.kind === 'action' && c.ref === game.pendingDraw!.action);
    if (stack && (level !== 'easy' || rng() < 0.5)) {
      return { type: 'play', cardId: stack.id, colour: isWild(stack) ? favouriteColour(game, seat.hand, stack, rng) : undefined, callWhistle: false, delayMs: quick() };
    }
    return { type: 'draw', delayMs: quick() };
  }

  const candidates = game.drawnCardId ? seat.hand.filter((c) => c.id === game.drawnCardId) : seat.hand;
  const options: Option[] = [];
  for (const card of candidates) {
    if (card.kind === 'action') {
      if (game.canMatch(card)) options.push({ card, mode: 'match', known: [] });
      continue;
    }
    const known = game.linkablePlayers(card).filter((id) => game.db.percentile(id) <= cfg.famePercentile);
    if (known.length) options.push({ card, mode: 'link', known });
    else if (game.canSafePlay(card)) options.push({ card, mode: 'safe', known: [] });
  }
  if (!options.length) return drawOrPass();

  const choice = choose(game, seatIndex, level, options);
  const callWhistle = seat.hand.length === 2 && !seat.whistle && rng() < cfg.whistleRate;

  if (choice.mode !== 'link') {
    return {
      type: 'play', cardId: choice.card.id, callWhistle, delayMs: quick(),
      colour: isWild(choice.card) ? favouriteColour(game, seat.hand, choice.card, rng) : undefined,
    };
  }

  // Link play: answer correctly at the configured rate; otherwise give up or guess wrong.
  if (rng() < cfg.correctRate) {
    const pool = choice.known.slice(0, 6);
    return { type: 'play', cardId: choice.card.id, playerId: pool[Math.floor(rng() * pool.length)], callWhistle, delayMs: thinking() };
  }
  if (rng() < 0.5) return { ...drawOrPass(), delayMs: thinking() };
  const wrong = wrongGuess(game, choice.card, cfg.famePercentile);
  if (!wrong) return { ...drawOrPass(), delayMs: thinking() };
  return { type: 'play', cardId: choice.card.id, playerId: wrong, callWhistle, delayMs: thinking() };
}

function choose(game: Game, seatIndex: number, level: BotLevel, options: Option[]): Option {
  if (level === 'easy') return options[0]; // first playable card

  const rank = (o: Option): number => {
    if (o.mode === 'link') return 0;
    if (o.mode === 'safe') return 1;
    return isWild(o.card) ? 3 : 2;
  };

  if (level === 'hard') {
    // Hit the next player with +2/+4 when they are the one closest to winning.
    const next = game.seats[seatAt(game, seatIndex, 1)];
    const others = game.seats.filter((s) => s.index !== seatIndex);
    const fewest = Math.min(...others.map((s) => s.hand.length));
    if (next.hand.length === fewest || next.hand.length <= 2) {
      const yellow = options.find((o) => o.card.kind === 'action' && o.card.ref === 'yellow');
      if (yellow) return yellow;
      const plus4 = options.find((o) => o.card.ref === 'hattrick' && o.card.kind === 'action');
      if (plus4 && (next.hand.length <= 2 || game.seats[seatIndex].hand.length <= 2)) return plus4;
    }
    // Otherwise shed the most expensive cards first and keep wilds for the end.
    return [...options].sort((a, b) => rank(a) - rank(b) || cardPoints(game.config, b.card) - cardPoints(game.config, a.card))[0];
  }

  // Medium: prefers link plays, saves wilds for later.
  return [...options].sort((a, b) => rank(a) - rank(b))[0];
}

function seatAt(game: Game, from: number, steps: number): number {
  const n = game.seats.length;
  return (((from + game.direction * steps) % n) + n) % n;
}

function favouriteColour(game: Game, hand: Card[], playing: Card, rng: () => number): Colour {
  const counts = new Map<Colour, number>();
  for (const c of hand) if (c.id !== playing.id && c.colour) counts.set(c.colour, (counts.get(c.colour) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : game.colours[Math.floor(rng() * game.colours.length)];
}

/** A famous player who is NOT a valid link (a believable wrong answer). */
function wrongGuess(game: Game, card: Card, famePercentile: number): string | null {
  const a = subjectKey(game.anchor);
  const b = subjectKey(card);
  const pool = game.db.players.filter((p) => !game.used.has(p.id) && game.db.percentile(p.id) <= Math.max(famePercentile, 0.3) && !game.db.isValid(a, b, p.id));
  if (!pool.length) return null;
  return pool[Math.floor(game.rng() * pool.length)].id;
}
