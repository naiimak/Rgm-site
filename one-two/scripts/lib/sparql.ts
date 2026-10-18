// Wikidata Query Service client: throttled, retried, and cached on disk so an interrupted
// import resumes without re-asking finished queries.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINT = 'https://query.wikidata.org/sparql';
// Wikidata requires a descriptive User-Agent (https://meta.wikimedia.org/wiki/User-Agent_policy).
const USER_AGENT = process.env.WIKIDATA_USER_AGENT ?? 'OneTwo-data/0.1 (football trivia game data import; https://github.com/naiimak/Rgm-site)';
const GAP_MS = 1500;

export type Row = Record<string, string>;

let last = 0;

export class Sparql {
  constructor(private readonly cacheDir: string) {
    mkdirSync(cacheDir, { recursive: true });
  }

  async query(query: string): Promise<Row[]> {
    const key = createHash('sha1').update(query).digest('hex');
    const file = join(this.cacheDir, `${key}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Row[];
    for (let attempt = 1; ; attempt++) {
      const wait = last + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ query }),
          signal: AbortSignal.timeout(120_000),
        });
        if (res.status === 429 || res.status >= 500) {
          const retry = Number(res.headers.get('retry-after')) || 10 * attempt;
          if (attempt >= 6) throw new Error(`Wikidata ${res.status} after ${attempt} attempts`);
          console.warn(`  Wikidata ${res.status}, retrying in ${retry}s`);
          await sleep(retry * 1000);
          continue;
        }
        if (!res.ok) throw new Error(`Wikidata ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const json = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } };
        const rows = json.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
        writeFileSync(file, JSON.stringify(rows));
        return rows;
      } catch (e) {
        if (attempt >= 6) throw e;
        console.warn(`  query failed (${(e as Error).message}), retrying`);
        await sleep(5000 * attempt);
      }
    }
  }
}

export const qid = (uri: string) => uri.replace('http://www.wikidata.org/entity/', '');
export const year = (iso: string | undefined) => (iso ? Number(iso.replace(/^\+/, '').slice(0, 4)) : null);
export const lit = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@en`;

export function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
