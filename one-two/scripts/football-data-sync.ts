// Brings data/players.json up to date with this season's squads from football-data.org.
// Run it after scripts/wikidata-import.ts, and again after each transfer window.
//
//   FOOTBALL_DATA_KEY=… npm run data:squads
//
// For every one of the 38 card clubs currently in its top flight:
//   - players in the squad get an open spell at the club (added if Wikidata doesn't have it yet),
//     and any other open spell at a card club is closed (they moved);
//   - players with an open spell at the club who are no longer in the squad get it closed;
//   - squad players missing from the database are added (fame 0, so they sort last).
// The free plan covers the current season of the top divisions, which is all this needs.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig } from '../engine/load.ts';
import { normalize } from '../engine/search.ts';
import type { DataClub, PlayerRecord } from '../engine/types.ts';

const KEY = process.env.FOOTBALL_DATA_KEY;
if (!KEY) {
  console.error('Set FOOTBALL_DATA_KEY (your football-data.org API key) first.');
  process.exit(1);
}

const COMPETITIONS: Record<string, string> = { PL: 'ENG', PD: 'ESP', SA: 'ITA', BL1: 'GER', FL1: 'FRA' };
// football-data.org team names that don't contain our internal club name.
const NAME_OVERRIDES: Record<string, string> = {
  'fc internazionale milano': 'INT', 'fc bayern munchen': 'BAY', 'bv borussia 09 dortmund': 'BVB', 'club atletico de madrid': 'ATM',
  'rcd espanyol de barcelona': 'ESY', 'real betis balompie': 'BET', 'rc deportivo la coruna': 'DEP', 'rb leipzig': 'RBL',
  'vfl wolfsburg': 'WOB', 'sv werder bremen': 'SVW', 'olympique de marseille': 'OMR', 'olympique lyonnais': 'LYO',
  'as monaco fc': 'MON', 'lille osc': 'LIL', 'ogc nice': 'NIC', 'stade rennais fc 1901': 'REN', 'racing club de lens': 'LEN',
  'as saint etienne': 'STE', 'fc girondins de bordeaux': 'BDX', 'ss lazio': 'LAZ', 'acf fiorentina': 'FIO', 'atalanta bc': 'ATA',
};

interface FdPlayer { id: number; name: string; dateOfBirth: string | null; nationality: string | null }
interface FdTeam { id: number; name: string; shortName: string; tla: string; squad: FdPlayer[] }

const config = loadConfig();
const path = join(ROOT, 'data/players.json');
const data = JSON.parse(readFileSync(path, 'utf8')) as { version: string; source: string; clubs?: Record<string, DataClub>; players: PlayerRecord[] };
const players = data.players;
const cardClubs = new Set(config.clubs.map((c) => c.id));
const countryCode = new Map(config.nations.map((n) => [normalize(n.name), n.id]));
for (const [name, code] of Object.entries({ 'cote divoire': 'CIV', 'united states': 'USA', 'korea republic': 'KOR', 'czech republic': 'CZE', 'czechia': 'CZE', wales: 'WAL', scotland: 'SCO', sweden: 'SWE', norway: 'NOR', switzerland: 'SUI', austria: 'AUT', serbia: 'SRB', turkey: 'TUR', turkiye: 'TUR', colombia: 'COL', chile: 'CHI', ghana: 'GHA', mali: 'MLI', guinea: 'GIN', canada: 'CAN', slovenia: 'SVN', slovakia: 'SVK', georgia: 'GEO', ukraine: 'UKR' })) countryCode.set(name, code);

async function fd<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.football-data.org/v4/${path}`, { headers: { 'X-Auth-Token': KEY! } });
    if (res.status === 429 && attempt < 5) { await sleep(65_000); continue; }
    if (!res.ok) throw new Error(`football-data.org ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
    await sleep(6500); // free plan: 10 requests a minute
    return (await res.json()) as T;
  }
}

function clubFor(team: FdTeam): string | null {
  const names = [team.name, team.shortName].map(normalize);
  const override = names.map((n) => NAME_OVERRIDES[n]).find(Boolean);
  if (override) return config.clubs.some((c) => c.id === override) ? override : null;
  for (const c of config.clubs) {
    const ours = normalize(c.internal);
    if (names.some((n) => n === ours || n.split(' ').join(' ').includes(ours) || (ours.length > 5 && ours.includes(n)))) return c.id;
  }
  return null;
}

async function main() {
  const index = new Map<string, PlayerRecord>();
  for (const p of players) for (const n of [p.name, ...p.aliases]) {
    const k = `${normalize(n)}|${p.birthYear}`;
    if (!index.has(k)) index.set(k, p);
  }
  const usedIds = new Set(players.map((p) => p.id));
  const log: string[] = [];
  let added = 0, opened = 0, closed = 0, matched = 0;
  const seenClubs = new Set<string>();

  for (const [comp, league] of Object.entries(COMPETITIONS)) {
    const res = await fd<{ season: { startDate: string }; teams: FdTeam[] }>(`competitions/${comp}/teams`);
    const season = Number(res.season.startDate.slice(0, 4));
    for (const team of res.teams) {
      const club = clubFor(team);
      if (!club) continue;
      if (config.clubs.find((c) => c.id === club)!.league !== league) { log.push(`- skipped ${team.name}: matched ${club} in the wrong league`); continue; }
      seenClubs.add(club);
      const inSquad = new Set<string>();
      for (const fp of team.squad) {
        const born = fp.dateOfBirth ? Number(fp.dateOfBirth.slice(0, 4)) : 0;
        let p: PlayerRecord | undefined = [0, -1, 1].map((d) => index.get(`${normalize(fp.name)}|${born + d}`)).find(Boolean) ?? nameVariant(fp.name, born, club);
        if (!p) {
          let id = normalize(fp.name).replace(/ /g, '-');
          if (usedIds.has(id)) id = `${id}-${born}`;
          usedIds.add(id);
          p = {
            id, name: fp.name, aliases: [], nationality: countryCode.get(normalize(fp.nationality ?? '')) ?? '', birthYear: born, fame: 0,
            spells: [{ club, from: season, to: null }], titles: [], trophies: [], caps: [],
          };
          players.push(p);
          index.set(`${normalize(fp.name)}|${born}`, p);
          added++;
          log.push(`- added ${fp.name} (${born}) at ${clubName(club)}`);
        } else {
          matched++;
          const here = p.spells.some((s) => s.club === club && (s.to === null || s.to >= season));
          if (!here) {
            p.spells.push({ club, from: season, to: null });
            opened++;
            log.push(`- ${p.name}: now at ${clubName(club)}`);
          }
          for (const s of p.spells) {
            if (s.to === null && s.from !== null && s.club !== club && cardClubs.has(s.club)) {
              s.to = season;
              closed++;
              log.push(`- ${p.name}: left ${clubName(s.club)}`);
            }
          }
        }
        inSquad.add(p.id);
      }
      // Open spells at this club for players no longer in its squad.
      for (const p of players) {
        if (inSquad.has(p.id)) continue;
        for (const s of p.spells) {
          if (s.club === club && s.to === null && s.from !== null && s.from < season) {
            s.to = season;
            closed++;
            log.push(`- ${p.name}: no longer at ${clubName(club)}`);
          }
        }
      }
    }
  }

  const missing = config.clubs.filter((c) => !seenClubs.has(c.id)).map((c) => c.name);
  data.version = `${data.version.replace(/\+fd-.*$/, '')}+fd-${new Date().toISOString().slice(0, 10)}`;
  data.source = data.source.replace(/ Current squads:.*$/, '') + ` Current squads: football-data.org (${new Date().toISOString().slice(0, 10)}).`;
  writeFileSync(path, JSON.stringify(data));
  writeFileSync(join(ROOT, 'data/squads-report.md'), [
    `# Squad sync (football-data.org)`, ``,
    `Data version \`${data.version}\`. ${matched} squad players matched, ${added} added, ${opened} new club spells, ${closed} spells closed.`, ``,
    `Card clubs not in a top-flight squad list this season (not updated): ${missing.join(', ') || 'none'}.`, ``,
    `## Changes`, ``, ...log,
  ].join('\n') + '\n');
  console.log(`${matched} matched, ${added} added, ${opened} spells opened, ${closed} closed. Not in a top flight now: ${missing.join(', ') || 'none'}.`);
  console.log('Details: data/squads-report.md');
}

/**
 * Same player under another spelling ("Vitalii" / "Vitaliy Mykolenko", "Victor Nilsson-Lindelöf"):
 * same birth year (±1) and a shared name part of 4+ letters, preferring someone already at the club.
 */
function nameVariant(name: string, born: number, club: string): PlayerRecord | undefined {
  if (!born) return undefined;
  const parts = new Set(normalize(name).split(/[ -]/).filter((t) => t.length >= 4));
  const options = players.filter((p) => Math.abs(p.birthYear - born) <= 1 && normalize(p.name).split(/[ -]/).some((t) => parts.has(t)));
  return options.find((p) => p.spells.some((s) => s.club === club)) ?? (options.length === 1 ? options[0] : undefined);
}

function clubName(code: string) {
  return config.clubs.find((c) => c.id === code)?.name ?? code;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
