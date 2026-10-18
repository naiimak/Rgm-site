// XP, levels, coins, usernames.

import type { GameConfig, SeatStats } from '../engine/types.ts';

/** XP needed to go from level n to n+1: levelBase + levelStep × n (e.g. 200 + 50n). */
export function levelForXp(config: GameConfig, xp: number): { level: number; into: number; needed: number } {
  const { levelBase, levelStep } = config.progression;
  let level = 1;
  let left = xp;
  while (left >= levelBase + levelStep * level) {
    left -= levelBase + levelStep * level;
    level++;
  }
  return { level, into: left, needed: levelBase + levelStep * level };
}

export function gameXp(config: GameConfig, stats: SeatStats, won: boolean, solo: boolean): number {
  const x = config.progression.xp;
  const raw = x.finish + (won ? x.win : 0) + stats.correctPlain * x.correctLink + stats.correctSpecial * x.correctSpecial + stats.hintedAnswers * x.hinted;
  return Math.round(raw * (solo ? config.progression.soloXpMultiplier : 1));
}

const ADJECTIVES = ['Silky', 'Clinical', 'Golden', 'Rapid', 'Cheeky', 'Tidy', 'Lethal', 'Calm', 'Tireless', 'Classy', 'Bold', 'Sharp'];
const NOUNS = ['Winger', 'Striker', 'Keeper', 'Libero', 'Playmaker', 'Fullback', 'Poacher', 'Regista', 'Sweeper', 'Captain', 'Number10', 'Anchor'];

export function randomUsername(taken: (name: string) => boolean): string {
  for (;;) {
    const name = `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}${NOUNS[Math.floor(Math.random() * NOUNS.length)]}${Math.floor(Math.random() * 90 + 10)}`;
    if (name.length <= 16 && !taken(name)) return name;
  }
}

// A short starter list; a maintained profanity list should replace it before launch.
const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'fag', 'whore', 'slut', 'rape', 'nazi', 'hitler', 'dick', 'pussy', 'wank', 'twat', 'bastard', 'cock'];

export function usernameProblem(name: string): string | null {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return '3–16 letters, numbers or _';
  const flat = name.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/[^a-z]/g, '');
  if (BLOCKED.some((w) => flat.includes(w))) return 'Please choose a different name';
  return null;
}
