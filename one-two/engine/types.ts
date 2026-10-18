// Shared types for the One-Two rules engine, server and app.

export type LeagueId = string; // ENG ESP ITA GER FRA
export type Colour = 'red' | 'yellow' | 'blue' | 'green' | 'purple';
export const COLOURS: Colour[] = ['red', 'yellow', 'blue', 'green', 'purple'];

export type SubjectKind = 'club' | 'league' | 'champion' | 'trophy' | 'coach' | 'national';
export type ActionKind = 'yellow' | 'red' | 'var' | 'transfer' | 'hattrick';
export type CardKind = SubjectKind | 'action';

export interface Card {
  id: string;
  kind: CardKind;
  /** Club / league / trophy / coach / nation id for subject cards; action kind for action cards. */
  ref: string;
  /** League colour, or null for colourless subject cards (trophy, coach, national) and wilds. */
  colour: Colour | null;
}

export interface LeagueDef { id: LeagueId; colour: Colour; hex: string; symbol: string; name: string; country: string; flag: string }
export interface ClubDef { id: string; league: LeagueId; internal: string; name: string; kit: string[]; notTopFlight?: [number, number][] }
export interface OtherClubDef { league: LeagueId | null; notTopFlight?: [number, number][] }
export interface CoachDef { id: string; name: string; spells: [string, number, number][] }
export interface NationDef { id: string; name: string; flag: string; colours: string[] }
export interface TrophyDef { id: string; name: string; copies: number; icon: string }
export interface BotLevelDef { correctRate: number; answerSeconds: [number, number]; famePercentile: number; whistleRate: number }
export type BotLevel = 'easy' | 'medium' | 'hard';
export interface ShopItem { id: string; category: string; name: string; price: number; default?: boolean; unlockLevel?: number }

export interface GameConfig {
  configVersion: string;
  currentSeasonEnd: number;
  leagues: LeagueDef[];
  clubs: ClubDef[];
  otherClubs: Record<string, OtherClubDef | string>;
  coaches: CoachDef[];
  nations: NationDef[];
  trophies: TrophyDef[];
  flags: Record<string, string>;
  deck: {
    clubCopies: number; leagueCopies: number; championCopies: number; coachCopies: number; nationalCopies: number;
    actions: Record<ActionKind, { perColour?: number; wild?: number }>;
  };
  points: Record<string, number>;
  rules: {
    handSize: number; defaultTurnSeconds: number; turnSecondsOptions: number[]; wrongAnswerDraw: number; timeoutDraw: number;
    finalWhistlePenalty: number; disconnectGraceSeconds: number; quickMatchSeats: number; quickMatchWaitSeconds: number; roomCodeExpiryMinutes: number;
  };
  bots: Record<BotLevel, BotLevelDef> & { names: string[] };
  progression: {
    xp: { finish: number; win: number; correctLink: number; correctSpecial: number; safeOrMatch: number; hinted: number };
    soloXpMultiplier: number; levelBase: number; levelStep: number;
    coins: { perGame: number; perWin: number; perLevel: number };
    ads: { hintPerGame: number; doubleCoinsPerGame: number; freeCoinsPerDay: number; freeCoinsAmount: number };
  };
  emotes: { id: string; text: string }[];
  avatars: string[];
  shop: ShopItem[];
  coinPacks: { id: string; coins: number; price: string }[];
}

/** A club spell. `from` is null when the source has no start year; `to` is null when the player is still there (or the end is unknown). */
export interface Spell { club: string; from: number | null; to: number | null }

/** Club facts that come with the player data (pipeline output): league and the seasons (start years) it was in the top flight. */
export interface DataClub { league: string | null; seasons?: number[] }

/** One row of data/players.json (the output of the data pipeline). */
export interface PlayerRecord {
  id: string;
  name: string;
  aliases: string[];
  nationality: string;
  birthYear: number;
  fame: number;
  spells: Spell[];
  titles: LeagueId[];
  trophies: string[];
  caps: string[];
}

/** Compact player entry sent to phones for the autocomplete (validity is never sent). */
export interface PlayerListEntry { id: string; n: string; a: string[]; f: string; b: number; s: number }

export interface RoomSettings {
  turnSeconds: number;
  safePlay: boolean;
  stacking: boolean;
  dimUnplayable: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = { turnSeconds: 15, safePlay: true, stacking: false, dimUnplayable: true };

export type PlayType = 'link' | 'safe' | 'match' | 'wild';

/** What every phone sees after a play. */
export interface PlayResult {
  seat: number;
  playerName: string;
  card: Card;
  playType: PlayType;
  valid: boolean;
  /** Footballer named (link plays only). */
  answer?: { id: string; name: string };
  /** e.g. ["Manchester Red 2003–09, 2021–22", "Madrid White 2009–18"] */
  connections?: string[];
  /** Why a wrong answer was wrong, e.g. "Never played for Madrid White". */
  reason?: string;
  penalty?: number;
  anchorBefore?: Card;
  chosenColour?: Colour;
  hinted?: boolean;
}

export type GameEvent =
  | { type: 'play_result'; result: PlayResult }
  | { type: 'draw'; seat: number; count: number; reason: 'choice' | 'timeout' | 'penalty' | 'yellow' | 'hattrick' | 'whistle' | 'hint' | 'stack' }
  | { type: 'skip'; seat: number; reason: 'red' | 'var' | 'yellow' | 'hattrick' }
  | { type: 'reverse'; direction: 1 | -1 }
  | { type: 'whistle'; seat: number }
  | { type: 'reshuffle'; size: number }
  | { type: 'turn_started'; seat: number; turnNumber: number }
  | { type: 'game_over'; placings: Placing[] };

export interface Placing { seat: number; place: number; points: number; cardsLeft: number }

export interface SeatStats {
  /** All correct link answers (profile stat). */
  correctAnswers: number;
  /** Correct, unhinted answers on League Champion, Trophy or Coach cards (+20 XP each). */
  correctSpecial: number;
  /** Other correct, unhinted answers (+10 XP each). */
  correctPlain: number;
  hintedAnswers: number;
  wrongAnswers: number;
  safeOrMatchPlays: number;
  currentStreak: number;
  bestStreak: number;
  named: Record<string, number>;
}

export interface PublicSeat {
  seat: number;
  name: string;
  avatar: string;
  isBot: boolean;
  botLevel?: BotLevel;
  botControlled: boolean;
  connected: boolean;
  cardCount: number;
  whistle: boolean;
}

/** Sent to one phone: everything public plus only that player's own hand. */
export interface GameStateView {
  gameId: string;
  dataVersion: string;
  phase: 'playing' | 'over';
  seats: PublicSeat[];
  you: number | null;
  hand: Card[];
  playable: string[];
  safePlayable: string[];
  anchor: Card;
  top: Card;
  activeColour: Colour;
  direction: 1 | -1;
  turn: number;
  turnNumber: number;
  turnEndsAt: number;
  serverNow: number;
  deckCount: number;
  drawnCardId: string | null;
  pendingDraw: { amount: number; action: ActionKind } | null;
  hintUsedThisTurn: boolean;
  adHintAvailable: boolean;
  log: PlayResult[];
  settings: RoomSettings;
  placings: Placing[] | null;
}
