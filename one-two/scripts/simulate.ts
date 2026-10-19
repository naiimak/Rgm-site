// Milestone 1 acceptance: play N bot-only games through the real rules engine and check
// that nothing crashes and no rule is broken.
//
//   npm run simulate -- 1000

import { buildDeck } from '../engine/cards.ts';
import { planBotTurn } from '../engine/bots.ts';
import { subjectKey } from '../engine/database.ts';
import { Game } from '../engine/game.ts';
import { loadDatabase } from '../engine/load.ts';
import type { BotLevel, GameEvent } from '../engine/types.ts';

const games = Number(process.argv[2] ?? 1000);
const MAX_TURNS = 4000;
const { config, db } = loadDatabase();
const levels: BotLevel[] = ['easy', 'medium', 'hard'];

let seed = 12345;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];

const violations: string[] = [];
let finished = 0;
let stalled = 0;
let totalTurns = 0;
const stalls: string[] = [];
let links = 0;
let wrong = 0;
const wins: Record<BotLevel, number> = { easy: 0, medium: 0, hard: 0 };
const started = Date.now();

for (let n = 0; n < games; n++) {
  const seatCount = 2 + Math.floor(rng() * 5);
  const seatLevels = Array.from({ length: seatCount }, () => pick(levels));
  // A third of games leave some leagues out of the deck (at least 2 stay).
  const ids = config.leagues.map((l) => l.id);
  const leagues = rng() < 0.33 ? ids.filter(() => rng() < 0.5) : undefined;
  const settings = { turnSeconds: pick([10, 15, 20, 30]), safePlay: rng() < 0.8, stacking: rng() < 0.3, dimUnplayable: true, ...(leagues && leagues.length >= 2 ? { leagues } : {}) };
  const deckSize = buildDeck(config, settings.leagues).length;
  const game = new Game({
    id: `sim${n}`, config, db, settings, rng,
    seats: seatLevels.map((botLevel, i) => ({ name: `Bot ${i}`, isBot: true, botLevel })),
  });
  const check = (ctx: string, events: GameEvent[]) => {
    if (game.countCards() !== deckSize) violations.push(`game ${n} ${ctx}: ${game.countCards()} cards in play`);
    for (const e of events) {
      if (e.type !== 'play_result' || e.result.playType !== 'link') continue;
      const r = e.result;
      const ok = db.isValid(subjectKey(r.anchorBefore!), subjectKey(r.card), r.answer!.id);
      if (ok !== r.valid) violations.push(`game ${n}: ${r.answer!.name} judged ${r.valid} but table says ${ok}`);
      links++;
      if (!r.valid) wrong++;
    }
  };
  try {
    check('start', game.start());
    while (game.phase === 'playing' && game.turnNumber < MAX_TURNS) {
      const seat = game.turn;
      const plan = planBotTurn(game, seat, seatLevels[seat]);
      if (plan.type === 'play' && plan.callWhistle) game.callWhistle(seat);
      const result =
        plan.type === 'play' ? game.play(seat, plan.cardId, { playerId: plan.playerId, colour: plan.colour })
        : plan.type === 'draw' ? game.draw(seat)
        : game.pass(seat);
      if (!result.ok) {
        violations.push(`game ${n} turn ${game.turnNumber}: bot ${plan.type} rejected with ${result.error}`);
        game.timeout();
      } else {
        check(`turn ${game.turnNumber}`, result.events);
      }
    }
    totalTurns += game.turnNumber;
    if (game.phase === 'over') {
      finished++;
      wins[seatLevels[game.placings![0].seat]]++;
    } else { stalled++; stalls.push(`game ${n}: ${seatLevels.join('/')} bots, hands ${game.seats.map((s) => s.hand.length).join('/')}, leagues ${settings.leagues?.join('+') ?? 'all'}`); }
  } catch (e) {
    violations.push(`game ${n} crashed: ${(e as Error).stack}`);
  }
}

console.log(`${games} bot-only games in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`finished: ${finished}, hit the ${MAX_TURNS}-turn cap: ${stalled}, average turns: ${Math.round(totalTurns / games)}`);
console.log(`link answers: ${links} (${((wrong / Math.max(links, 1)) * 100).toFixed(1)}% wrong)`);
if (stalls.length) console.log(`still going at the turn cap (long games, not errors):\n${stalls.join('\n')}`);
console.log(`wins by level: ${JSON.stringify(wins)}`);
console.log(violations.length ? `${violations.length} violation(s):\n${violations.slice(0, 20).join('\n')}` : 'no crashes, no rule violations');
process.exitCode = violations.length ? 1 : 0;
