// Merges hand-made club sheets ("<Club> Players & Trophies 1990–Present" workbooks) into
// data/players.json. Run after the Wikidata import (and squad sync).
//
//   npm run data:sheets                      (reads every .xlsx in data/manual/club-sheets/)
//
// Each sheet row says a player played for that club, his nationality, and his career trophies
// as free text. Rules, because the text is hand-written and sometimes wrong:
//   - club membership is trusted: a missing spell at the club is added (years unknown);
//   - trophies and league titles are ADDED only when the wording is unambiguous (winners only,
//     no runner-up/finalist/squad/contender, no post-1992 English second-tier "Division One");
//     nothing Wikidata already has is removed;
//   - players not in the database are added with the club, nationality and those trophies.
// Every change and every disagreement is written to data/sheets-report.md.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { ROOT, loadConfig } from '../engine/load.ts';
import { normalize } from '../engine/search.ts';
import type { DataClub, PlayerRecord } from '../engine/types.ts';

const DIR = join(ROOT, 'data/manual/club-sheets');
const config = loadConfig();

interface SheetRow { club: string; file: string; name: string; nationality: string; titles: string[]; trophies: string[]; skipped: string[] }

// Exact trophy names (after removing "3x" and anything in brackets) -> game codes.
const TITLE_NAMES: Record<string, string> = {
  'premier league': 'ENG', 'english premier league': 'ENG', 'premier league / first division': 'ENG', 'english first division': 'ENG', 'english division one': 'ENG',
  'la liga': 'ESP', 'serie a': 'ITA', 'bundesliga': 'GER', 'german bundesliga': 'GER', 'ligue 1': 'FRA', 'french division 1': 'FRA',
};
const TROPHY_NAMES: Record<string, string> = {
  'uefa champions league': 'CL', 'champions league': 'CL', 'european cup': 'CL',
  'fifa world cup': 'WC', 'world cup': 'WC',
  'uefa euro': 'EC', 'uefa european championship': 'EC', 'european championship': 'EC', 'euro': 'EC',
};
// "Football League First Division" / "Division One" were the second tier from 1992; only count them with a pre-1992 year.
const OLD_FIRST_DIVISION = new Set(['football league first division', 'first division', 'division one', 'division one champion']);
const COUNTRY: Record<string, string> = {
  ...Object.fromEntries(config.nations.map((n) => [normalize(n.name), n.id])),
  wales: 'WAL', scotland: 'SCO', 'czech republic': 'CZE', 'south korea': 'KOR', chile: 'CHI', sweden: 'SWE', ukraine: 'UKR', slovakia: 'SVK',
  georgia: 'GEO', gabon: 'GAB', norway: 'NOR', bulgaria: 'BUL', switzerland: 'SUI', colombia: 'COL', peru: 'PER', 'bosnia and herzegovina': 'BIH',
  serbia: 'SRB', turkey: 'TUR', romania: 'ROU', ghana: 'GHA', mali: 'MLI', austria: 'AUT', slovenia: 'SVN', 'ivoiry coast': 'CIV',
  ireland: 'iso:IE', 'republic of ireland': 'iso:IE', 'northern ireland': 'iso:GB', finland: 'iso:FI', hungary: 'iso:HU', russia: 'iso:RU',
  'south africa': 'iso:ZA', iceland: 'iso:IS', venezuela: 'iso:VE', ecuador: 'iso:EC', israel: 'iso:IL', mexico: 'iso:MX',
  jamaica: 'iso:JM', 'trinidad tobago': 'iso:TT', greece: 'iso:GR', paraguay: 'iso:PY', 'costa rica': 'iso:CR', canada: 'CAN',
};

/** Split on commas that are not inside brackets: "1x UEFA Euro (2008, 2012), 2x FA Cup". */
function splitItems(text: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseTrophies(text: string, honors: string): { titles: string[]; trophies: string[]; skipped: string[] } {
  const titles = new Set<string>(), trophies = new Set<string>(), skipped: string[] = [];
  for (const item of splitItems(text)) {
    const bracket = item.match(/\((.*)\)/)?.[1] ?? '';
    const name = normalize(item.replace(/^\s*\d+\s*x\s*/i, '').replace(/\(.*\)/, '')).replace(/ \/ /g, ' / ');
    if (/\b(no|wait|squad|contender|runner|finalist|semi|nominee|3rd|4th|play off)\b/i.test(`${item}`.replace(/-/g, ' '))) { skipped.push(item); continue; }
    if (TITLE_NAMES[name]) { titles.add(TITLE_NAMES[name]); continue; }
    if (OLD_FIRST_DIVISION.has(name)) {
      const y = Number(bracket.match(/(19|20)\d{2}/)?.[0]);
      if (y && y < 1992) titles.add('ENG');
      else skipped.push(item);
      continue;
    }
    if (TROPHY_NAMES[name]) trophies.add(TROPHY_NAMES[name]);
  }
  // Ballon d'Or: only "Winner" or a bare "Ballon d'Or (years)" — never runner-up, 3rd place or nominee.
  for (const h of splitItems(honors)) {
    if (/ballon d.or/i.test(h) && !/fifa world cup|runner|place|nominee|silver|kopa|women/i.test(h) && /(winner|\(\s*(19|20)\d{2})/i.test(h)) trophies.add('GB');
  }
  return { titles: [...titles], trophies: [...trophies], skipped };
}

async function readSheets(): Promise<SheetRow[]> {
  const rows: SheetRow[] = [];
  const files = readdirSync(DIR).filter((f) => f.endsWith('.xlsx')).sort();
  for (const file of files) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(DIR, file));
    const ws = wb.worksheets.find((w) => /all players/i.test(w.name)) ?? wb.worksheets[1];
    const titleCell = String(ws.getCell('A1').value ?? file);
    const clubName = normalize(titleCell.split(/\s[-–]\s/)[0]);
    const club = config.clubs.find((c) => normalize(c.internal) === clubName)
      ?? config.clubs.find((c) => normalize(file).includes(normalize(c.internal)));
    if (!club) { console.warn(`Skipping ${file}: club "${clubName}" is not one of the 50 card clubs`); continue; }
    let header = 0;
    ws.eachRow((row, i) => { if (!header && row.values && (row.values as unknown[]).some((v) => String(v) === 'Player Name')) header = i; });
    ws.eachRow((row, i) => {
      if (i <= header) return;
      const v = row.values as unknown[];
      const cells = v.slice(1).map((x) => (x == null ? '' : String(typeof x === 'object' && x && 'richText' in x ? (x as { richText: { text: string }[] }).richText.map((t) => t.text).join('') : x)));
      const nameIdx = cells.length >= 5 ? 1 : 0; // "Era | Player Name | Nationality | Trophies | Honors" or without Era
      const name = cells[nameIdx]?.trim();
      if (!name) return;
      const parsed = parseTrophies(cells[nameIdx + 2] ?? '', cells[nameIdx + 3] ?? '');
      rows.push({ club: club.id, file, name, nationality: cells[nameIdx + 1]?.trim() ?? '', ...parsed });
    });
  }
  return rows;
}

async function main() {
  const rows = await readSheets();
  const path = join(ROOT, 'data/players.json');
  const data = JSON.parse(readFileSync(path, 'utf8')) as { version: string; source: string; clubs?: Record<string, DataClub>; players: PlayerRecord[] };
  const byName = new Map<string, PlayerRecord[]>();
  const index = (p: PlayerRecord) => {
    for (const n of new Set([p.name, ...p.aliases].map(normalize))) byName.set(n, [...(byName.get(n) ?? []), p]);
  };
  data.players.forEach(index);
  const usedIds = new Set(data.players.map((p) => p.id));
  const clubName = (code: string) => config.clubs.find((c) => c.id === code)?.name ?? code;
  const lines: string[] = [];
  const skippedLines: string[] = [];
  let matched = 0, added = 0, spells = 0, factsAdded = 0;

  for (const r of rows) {
    const key = normalize(r.name);
    const options = byName.get(key) ?? byName.get(key.replace(/^(\w)\w* /, '$1 ')) ?? [];
    let p = options.find((o) => o.spells.some((s) => s.club === r.club)) ?? [...options].sort((a, b) => b.fame - a.fame)[0];
    const changes: string[] = [];
    if (!p) {
      let id = key.replace(/ /g, '-');
      if (usedIds.has(id)) id = `${id}-${r.club.toLowerCase()}`;
      usedIds.add(id);
      p = { id, name: r.name, aliases: [], nationality: COUNTRY[normalize(r.nationality)] ?? '', birthYear: 0, fame: 15, spells: [], titles: [], trophies: [], caps: [] };
      data.players.push(p);
      index(p);
      added++;
      changes.push('new player');
    } else matched++;
    if (!p.spells.some((s) => s.club === r.club)) {
      p.spells.push({ club: r.club, from: null, to: null });
      spells++;
      changes.push(`played for ${clubName(r.club)}`);
    }
    if (!p.nationality && COUNTRY[normalize(r.nationality)]) p.nationality = COUNTRY[normalize(r.nationality)];
    const newTitles = r.titles.filter((t) => !p!.titles.includes(t));
    const newTrophies = r.trophies.filter((t) => !p!.trophies.includes(t));
    if (newTitles.length) { p.titles = [...p.titles, ...newTitles].sort(); factsAdded += newTitles.length; changes.push(`league titles + ${newTitles.join(' ')}`); }
    if (newTrophies.length) { p.trophies = [...p.trophies, ...newTrophies].sort(); factsAdded += newTrophies.length; changes.push(`trophies + ${newTrophies.join(' ')}`); }
    const notInSheet = [...p.titles.filter((t) => !r.titles.includes(t)), ...p.trophies.filter((t) => !r.trophies.includes(t))];
    if (notInSheet.length && !changes.includes('new player')) changes.push(`Wikidata also has ${notInSheet.join(' ')} (not in the sheet; kept)`);
    if (changes.length) lines.push(`- **${p.name}** (${clubName(r.club)}): ${changes.join('; ')}`);
    if (r.skipped.length) skippedLines.push(`- ${r.name} (${clubName(r.club)}): ${r.skipped.join(' · ')}`);
  }

  data.version = `${data.version.replace(/\+sheets$/, '')}+sheets`;
  if (!/club sheets/.test(data.source)) data.source += ' Club sheets: data/manual/club-sheets.';
  writeFileSync(path, JSON.stringify(data));
  writeFileSync(join(ROOT, 'data/sheets-report.md'), [
    `# Club sheets merge`, ``,
    `${rows.length} sheet rows: ${matched} matched to existing players, ${added} new players, ${spells} club spells added, ${factsAdded} titles/trophies added.`, ``,
    `## Changes and disagreements`, ``, ...lines, ``,
    `## Trophy text not counted (ambiguous or not a win)`, ``, ...skippedLines,
  ].join('\n') + '\n');
  console.log(`${rows.length} rows: ${matched} matched, ${added} new, ${spells} spells added, ${factsAdded} titles/trophies added. Report: data/sheets-report.md`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
