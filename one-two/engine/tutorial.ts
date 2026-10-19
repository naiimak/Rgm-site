// Scripted deck for the first-time tutorial (player = seat 0, one bot that only draws).
// The player's hand teaches, in order: a link play, Safe Play, an action card, a trophy card,
// a wild, then Final Whistle and the winning card.

import { buildDeck } from './cards.ts';
import type { Card, GameConfig } from './types.ts';

export function tutorialDeck(config: GameConfig, rng: () => number): Card[] {
  const all = buildDeck(config);
  const take = (kind: string, ref: string, colour?: string | null) => {
    const i = all.findIndex((c) => c.kind === kind && c.ref === ref && (colour === undefined || c.colour === colour));
    return all.splice(i, 1)[0];
  };
  const spain = config.leagues.find((l) => l.id === 'ESP')!.colour;
  const player = [take('club', 'RMA'), take('club', 'BAR'), take('action', 'red', spain), take('trophy', 'GB'), take('action', 'transfer', null), take('club', 'MIL'), take('club', 'INT')];
  const bot = [take('national', 'AUS'), take('national', 'JPN'), take('national', 'USA'), take('coach', 'SIM'), take('national', 'EGY'), take('national', 'ALG'), take('national', 'SEN')];
  const anchor = take('club', 'MUN');
  const rest = all.sort(() => rng() - 0.5);
  const dealt = player.flatMap((c, i) => [c, bot[i]]);
  return [...dealt, anchor, ...rest];
}
