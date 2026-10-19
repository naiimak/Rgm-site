// Autocomplete matching, shared by the app (instant local search) and the server (tests).
// Ignores accents and case, and matches known names and nicknames ("ozil" -> Mesut Özil,
// "kaka" -> Kaká, "chicharito" -> Javier Hernández).

import type { PlayerListEntry } from './types.ts';

const SPECIAL: Record<string, string> = { ø: 'o', ł: 'l', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', ð: 'd', ı: 'i', þ: 'th' };

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[øłæœßđðıþ]/g, (ch) => SPECIAL[ch] ?? ch)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SearchIndex { entries: PlayerListEntry[]; names: string[][] }

export function buildIndex(entries: PlayerListEntry[]): SearchIndex {
  return { entries, names: entries.map((e) => [e.n, ...e.a].map(normalize)) };
}

/** Suggestions appear after 2 typed characters; most famous first within each match quality. */
export function search(index: SearchIndex, query: string, limit = 8): PlayerListEntry[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const scored: { e: PlayerListEntry; score: number }[] = [];
  index.entries.forEach((e, i) => {
    let best = 9;
    index.names[i].forEach((name, k) => {
      // k = 0 is the player's name; nicknames and full names rank just below a real-name match
      const alias = k > 0 ? 1 : 0;
      let score = 9;
      if (name === q) score = 0;
      else if (name.startsWith(q) || name.split(' ').some((w) => w.startsWith(q))) score = 2 + alias;
      else if (q.includes(' ') && name.includes(q)) score = 4 + alias;
      best = Math.min(best, score);
    });
    if (best < 9) scored.push({ e, score: best });
  });
  return scored.sort((a, b) => a.score - b.score || b.e.s - a.e.s).slice(0, limit).map((x) => x.e);
}

/** Flag for a nationality code: a configured flag, or one built from an "iso:XX" country code. */
export function flagFor(code: string, flags: Record<string, string>): string {
  if (flags[code]) return flags[code];
  const iso = /^iso:([A-Z]{2})$/.exec(code)?.[1];
  return iso ? String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🏳️';
}
