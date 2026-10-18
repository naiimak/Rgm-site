// Deck construction and card descriptions. Card definitions come from config/game-config.json,
// so cards can be added or rebalanced without an app update.

import type { ActionKind, Card, Colour, GameConfig } from './types.ts';

export const ACTION_NAMES: Record<ActionKind, string> = {
  yellow: 'Yellow Card (+2)',
  red: 'Red Card',
  var: 'VAR',
  transfer: 'Transfer Window',
  hattrick: 'Hat-trick (+4)',
};

export function isWild(card: Card): boolean {
  return card.kind === 'action' && (card.ref === 'transfer' || card.ref === 'hattrick');
}

export function isSubject(card: Card): boolean {
  return card.kind !== 'action';
}

export function leagueColour(config: GameConfig, leagueId: string): Colour {
  return config.leagues.find((l) => l.id === leagueId)!.colour;
}

export function buildDeck(config: GameConfig): Card[] {
  const cards: Omit<Card, 'id'>[] = [];
  const d = config.deck;
  const repeat = (n: number, card: Omit<Card, 'id'>) => { for (let i = 0; i < n; i++) cards.push(card); };

  for (const club of config.clubs) repeat(d.clubCopies, { kind: 'club', ref: club.id, colour: leagueColour(config, club.league) });
  for (const l of config.leagues) {
    repeat(d.leagueCopies, { kind: 'league', ref: l.id, colour: l.colour });
    const champions = typeof d.championCopies === 'number' ? d.championCopies : d.championCopies[l.id] ?? 0;
    repeat(champions, { kind: 'champion', ref: l.id, colour: l.colour });
  }
  for (const t of config.trophies) repeat(t.copies, { kind: 'trophy', ref: t.id, colour: null });
  for (const c of config.coaches) repeat(d.coachCopies, { kind: 'coach', ref: c.id, colour: null });
  for (const n of config.nations) repeat(d.nationalCopies, { kind: 'national', ref: n.id, colour: null });
  for (const [action, spec] of Object.entries(d.actions) as [ActionKind, { perColour?: number; wild?: number }][]) {
    if (spec.perColour) for (const l of config.leagues) repeat(spec.perColour, { kind: 'action', ref: action, colour: l.colour });
    if (spec.wild) repeat(spec.wild, { kind: 'action', ref: action, colour: null });
  }
  return cards.map((c, i) => ({ ...c, id: `c${i}` }));
}

export function cardPoints(config: GameConfig, card: Card): number {
  return config.points[card.kind === 'action' ? card.ref : card.kind] ?? 0;
}

/** Display title of a card, e.g. "Manchester Red", "Italy – Top Flight", "Golden Ball". */
export function cardTitle(config: GameConfig, card: Pick<Card, 'kind' | 'ref'>): string {
  switch (card.kind) {
    case 'club': return config.clubs.find((c) => c.id === card.ref)?.name ?? card.ref;
    case 'league': return config.leagues.find((l) => l.id === card.ref)?.name ?? card.ref;
    case 'champion': return `${config.leagues.find((l) => l.id === card.ref)?.country ?? card.ref} Champion`;
    case 'trophy': return config.trophies.find((t) => t.id === card.ref)?.name ?? card.ref;
    case 'coach': return config.coaches.find((c) => c.id === card.ref)?.name ?? card.ref;
    case 'national': return config.nations.find((n) => n.id === card.ref)?.name ?? card.ref;
    case 'action': return ACTION_NAMES[card.ref as ActionKind] ?? card.ref;
  }
}
