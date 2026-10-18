// Client-side shapes of what the server sends, plus card wording helpers.

import type { BotLevel, Card, Colour, LeagueDef, NationDef, RoomSettings, ShopItem } from '../../engine/types.ts';

export interface ClientConfig {
  configVersion: string;
  dataVersion: string;
  leagues: LeagueDef[];
  clubs: { id: string; league: string; name: string; kit: string[] }[];
  coaches: { id: string; name: string }[];
  nations: NationDef[];
  trophies: { id: string; name: string; icon: string }[];
  flags: Record<string, string>;
  emotes: { id: string; text: string }[];
  avatars: string[];
  shop: ShopItem[];
  coinPacks: { id: string; coins: number; price: string }[];
  rules: { turnSecondsOptions: number[]; defaultTurnSeconds: number; quickMatchSeats: number };
  points: Record<string, number>;
  ads: { hintPerGame: number; doubleCoinsPerGame: number; freeCoinsPerDay: number; freeCoinsAmount: number };
}

export interface Profile {
  id: string;
  username: string;
  avatar: string;
  xp: number;
  level: number;
  levelProgress: { into: number; needed: number };
  coins: number;
  owned: string[];
  equipped: Record<string, string>;
  linked: { provider: string } | null;
  freeCoinsLeft: number;
  doubleCoinsAvailable: boolean;
  stats: { games: number; wins: number; winRate: number; correctAnswers: number; bestStreak: number; mostNamed: string | null; favouriteClub: string | null };
}

export interface RoomView {
  code: string;
  mode: 'quick' | 'private' | 'solo' | 'tutorial';
  status: 'lobby' | 'playing' | 'results';
  settings: RoomSettings;
  bots: { count: number; level: BotLevel };
  isHost: boolean;
  quickStartsAt: number | null;
  serverNow: number;
  shareUrl: string;
  members: { name: string; avatar: string; isBot: boolean; botLevel?: BotLevel; connected: boolean; isHost: boolean; you: boolean }[];
}

export interface GameOverView {
  gameId: string;
  mode: RoomView['mode'];
  you: number | undefined;
  placings: { seat: number; place: number; points: number; cardsLeft: number; name: string; avatar: string; isBot: boolean }[];
  reward: { xp: number; coins: number; levelUps: number; level: number; totalCoins: number; starterPack: boolean; solo: boolean } | null;
}

export function leagueOf(config: ClientConfig, id: string) {
  return config.leagues.find((l) => l.id === id)!;
}

export function colourHex(config: ClientConfig, colour: Colour | null): string {
  return config.leagues.find((l) => l.colour === colour)?.hex ?? '#888';
}

export function colourSymbol(config: ClientConfig, colour: Colour | null): string {
  return config.leagues.find((l) => l.colour === colour)?.symbol ?? '';
}

const ACTION_TITLES: Record<string, string> = { yellow: 'Yellow Card', red: 'Red Card', var: 'VAR', transfer: 'Transfer Window', hattrick: 'Hat-trick' };

export function cardTitle(config: ClientConfig, card: Pick<Card, 'kind' | 'ref'>): string {
  switch (card.kind) {
    case 'club': return config.clubs.find((c) => c.id === card.ref)?.name ?? card.ref;
    case 'league': return leagueOf(config, card.ref).name;
    case 'champion': return `${leagueOf(config, card.ref).country} Champion`;
    case 'trophy': return config.trophies.find((t) => t.id === card.ref)?.name ?? card.ref;
    case 'coach': return config.coaches.find((c) => c.id === card.ref)?.name ?? card.ref;
    case 'national': return config.nations.find((n) => n.id === card.ref)?.name ?? card.ref;
    case 'action': return ACTION_TITLES[card.ref] ?? card.ref;
  }
}

/** "played for Madrid White", "won Golden Ball", ... */
export function condition(config: ClientConfig, card: Pick<Card, 'kind' | 'ref'>): string {
  switch (card.kind) {
    case 'club': return `played for ${cardTitle(config, card)}`;
    case 'league': return `played in ${leagueOf(config, card.ref).name}`;
    case 'champion': return `won the ${leagueOf(config, card.ref).name} title`;
    case 'trophy': return `won ${cardTitle(config, card)}`;
    case 'coach': return `played under ${cardTitle(config, card)}`;
    case 'national': return `played for ${cardTitle(config, card)}`;
    default: return '';
  }
}

export function question(config: ClientConfig, anchor: Card, card: Card): string {
  return `Name a player who ${condition(config, anchor)} and ${condition(config, card)}`;
}

export const ERRORS: Record<string, string> = {
  already_used: 'Already used this game — pick someone else',
  not_your_turn: 'Not your turn',
  must_play_drawn: 'You can only play the card you just drew',
  must_stack_or_draw: 'Stack a matching card or take the cards',
  no_match: 'That card doesn’t match the colour or symbol',
  answer_required: 'Name a player to play this card',
  colour_required: 'Pick a colour',
  hint_used: 'One hint per turn',
  ad_hint_used: 'Ad hint already used this game',
  room_not_found: 'No room with that code',
  game_in_progress: 'That game has already started',
  room_full: 'That room is full',
  need_two_players: 'You need at least 2 players',
  timeout: 'Connection is slow — try again',
};
