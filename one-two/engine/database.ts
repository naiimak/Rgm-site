// Player database: answers "which players connect these two subject cards?".
// Every valid link between two subject cards is precomputed into a link cache at
// start-up, so checking an answer during a game is a set lookup.

import type { Card, GameConfig, PlayerListEntry, PlayerRecord, Spell, SubjectKind } from './types.ts';

export const SUBJECT_KINDS: SubjectKind[] = ['club', 'league', 'champion', 'trophy', 'coach', 'national'];

export function subjectKey(card: Pick<Card, 'kind' | 'ref'>): string {
  return `${card.kind}:${card.ref}`;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface ClubInfo { league: string | null; notTopFlight: [number, number][]; displayName: string | null }

export class PlayerDB {
  readonly config: GameConfig;
  readonly players: PlayerRecord[];
  readonly byId = new Map<string, PlayerRecord>();
  readonly version: string;
  /** subject key -> ids of players meeting that card's condition */
  private readonly sets = new Map<string, Set<string>>();
  /** pair key -> valid player ids, most famous first */
  private readonly links = new Map<string, string[]>();
  private readonly clubs = new Map<string, ClubInfo>();
  private readonly famePercentile = new Map<string, number>();

  constructor(config: GameConfig, players: PlayerRecord[], version = 'seed') {
    this.config = config;
    this.players = players;
    this.version = version;
    for (const c of config.clubs) this.clubs.set(c.id, clubInfo(c, c.name));
    for (const [id, raw] of Object.entries(config.otherClubs)) {
      if (id.startsWith('_') || typeof raw === 'string') continue;
      this.clubs.set(id, clubInfo(raw, null));
    }
    for (const p of players) this.byId.set(p.id, p);

    const ranked = [...players].sort((a, b) => b.fame - a.fame);
    ranked.forEach((p, i) => this.famePercentile.set(p.id, (i + 1) / ranked.length));

    for (const key of this.subjectKeys()) {
      const set = new Set<string>();
      for (const p of players) if (this.meets(p, key)) set.add(p.id);
      this.sets.set(key, set);
    }
    const keys = this.subjectKeys();
    for (let i = 0; i < keys.length; i++) {
      for (let j = i; j < keys.length; j++) {
        const a = this.sets.get(keys[i])!;
        const b = this.sets.get(keys[j])!;
        const [small, big] = a.size < b.size ? [a, b] : [b, a];
        const ids: string[] = [];
        for (const id of small) if (big.has(id)) ids.push(id);
        ids.sort((x, y) => this.byId.get(y)!.fame - this.byId.get(x)!.fame);
        this.links.set(pairKey(keys[i], keys[j]), ids);
      }
    }
  }

  /** The 98 distinct subject cards: 50 clubs, 5 leagues, 5 champions, 4 trophies, 10 coaches, 24 nations. */
  subjectKeys(): string[] {
    const c = this.config;
    return [
      ...c.clubs.map((x) => `club:${x.id}`),
      ...c.leagues.map((x) => `league:${x.id}`),
      ...c.leagues.map((x) => `champion:${x.id}`),
      ...c.trophies.map((x) => `trophy:${x.id}`),
      ...c.coaches.map((x) => `coach:${x.id}`),
      ...c.nations.map((x) => `national:${x.id}`),
    ];
  }

  validPlayers(a: string, b: string): string[] {
    return this.links.get(pairKey(a, b)) ?? [];
  }

  isValid(a: string, b: string, playerId: string): boolean {
    const set = this.sets.get(a);
    const set2 = this.sets.get(b);
    return !!set?.has(playerId) && !!set2?.has(playerId);
  }

  /** 0..1, where 0.05 means "in the 5% most famous players". */
  percentile(playerId: string): number {
    return this.famePercentile.get(playerId) ?? 1;
  }

  meets(p: PlayerRecord, key: string): boolean {
    const [kind, ref] = key.split(':');
    switch (kind) {
      case 'club': return p.spells.some((s) => s.club === ref);
      case 'league': return p.spells.some((s) => this.spellInLeague(s, ref));
      case 'champion': return p.titles.includes(ref);
      case 'trophy': return p.trophies.includes(ref);
      case 'coach': return this.coachOverlaps(p, ref).length > 0;
      case 'national': return p.caps.includes(ref);
      default: return false;
    }
  }

  /** Human-readable reason this player satisfies one card, shown after a valid answer. */
  connection(p: PlayerRecord, key: string): string {
    const [kind, ref] = key.split(':');
    const c = this.config;
    switch (kind) {
      case 'club': {
        const name = c.clubs.find((x) => x.id === ref)?.name ?? ref;
        return `${name} ${p.spells.filter((s) => s.club === ref).map((s) => years(s.from, s.to)).join(', ')}`;
      }
      case 'league': {
        const league = c.leagues.find((x) => x.id === ref)!;
        const named = unique(p.spells.filter((s) => this.spellInLeague(s, ref)).map((s) => this.clubs.get(s.club)?.displayName ?? null));
        const shown = named.filter((n): n is string => !!n);
        const extra = named.length > shown.length ? (shown.length ? ' and others' : 'a top-flight club') : '';
        return `${league.name}: ${[shown.join(', '), extra].filter(Boolean).join(' ')}`.trim();
      }
      case 'champion': return `Won the ${c.leagues.find((x) => x.id === ref)!.name} title`;
      case 'trophy': return `Won ${c.trophies.find((x) => x.id === ref)!.name}`;
      case 'coach': {
        const coach = c.coaches.find((x) => x.id === ref)!;
        const parts = this.coachOverlaps(p, ref).map(({ club, from, to }) => {
          const clubName = this.clubs.get(club)?.displayName;
          return `${clubName ? clubName + ' ' : ''}${years(from, to)}`;
        });
        return `Under ${coach.name}: ${unique(parts).join(', ')}`;
      }
      case 'national': return `Capped by ${c.nations.find((x) => x.id === ref)!.name}`;
      default: return key;
    }
  }

  /** Why a wrong answer was wrong: names the first card condition the player fails. */
  whyNot(p: PlayerRecord, a: string, b: string): string {
    for (const key of [b, a]) {
      if (this.meets(p, key)) continue;
      const [kind, ref] = key.split(':');
      const c = this.config;
      switch (kind) {
        case 'club': return `Never played for ${c.clubs.find((x) => x.id === ref)?.name}`;
        case 'league': return `Never played in ${c.leagues.find((x) => x.id === ref)?.name}`;
        case 'champion': return `Never won the ${c.leagues.find((x) => x.id === ref)?.name} title`;
        case 'trophy': return `Never won ${c.trophies.find((x) => x.id === ref)?.name}`;
        case 'coach': return `Never played under ${c.coaches.find((x) => x.id === ref)?.name}`;
        case 'national': return `Never played for ${c.nations.find((x) => x.id === ref)?.name}`;
      }
    }
    return 'Not a valid link';
  }

  /** The phone's autocomplete list: every player, never filtered to valid answers. */
  playerList(): PlayerListEntry[] {
    return [...this.players]
      .sort((a, b) => b.fame - a.fame)
      .map((p) => ({ id: p.id, n: p.name, a: p.aliases, f: p.nationality, b: p.birthYear, s: p.fame }));
  }

  private spellInLeague(s: Spell, league: string): boolean {
    const info = this.clubs.get(s.club);
    if (!info || info.league !== league) return false;
    const end = s.to ?? this.config.currentSeasonEnd;
    // seasons start in years from..end-1; a same-year spell counts as one season
    for (let y = s.from; y < Math.max(end, s.from + 1); y++) {
      if (!info.notTopFlight.some(([a, b]) => y >= a && y < b)) return true;
    }
    return false;
  }

  /** Club spells where the player and the coach's permanent spell overlap by at least one season. */
  private coachOverlaps(p: PlayerRecord, coachId: string): { club: string; from: number; to: number }[] {
    const coach = this.config.coaches.find((c) => c.id === coachId);
    if (!coach) return [];
    const out: { club: string; from: number; to: number }[] = [];
    for (const s of p.spells) {
      const sEnd = Math.max(s.to ?? this.config.currentSeasonEnd, s.from + 1);
      for (const [club, cFrom, cTo] of coach.spells) {
        if (club !== s.club) continue;
        const from = Math.max(s.from, cFrom);
        const to = Math.min(sEnd, cTo);
        if (from < to) out.push({ club, from, to });
      }
    }
    return out;
  }
}

function clubInfo(c: { league?: string | null; notTopFlight?: [number, number][] }, name: string | null): ClubInfo {
  return { league: c.league ?? null, notTopFlight: c.notTopFlight ?? [], displayName: name };
}

function years(from: number, to: number | null): string {
  if (to === null) return `${from}–`;
  if (to <= from + 1) return `${from}–${String(from + 1).slice(2)}`;
  return `${from}–${String(to).slice(2)}`;
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
