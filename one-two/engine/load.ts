// Node-only loaders for the server, tests and scripts.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlayerDB } from './database.ts';
import type { DataClub, GameConfig, PlayerRecord } from './types.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(path = join(ROOT, 'config/game-config.json')): GameConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as GameConfig;
}

export function loadPlayers(path = join(ROOT, 'data/players.json')): { players: PlayerRecord[]; version: string; clubs: Record<string, DataClub> } {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as { version?: string; players: PlayerRecord[]; clubs?: Record<string, DataClub> };
  const version = parsed.version ?? createHash('sha1').update(raw).digest('hex').slice(0, 10);
  return { players: parsed.players, version, clubs: parsed.clubs ?? {} };
}

export function loadDatabase(): { config: GameConfig; db: PlayerDB } {
  const config = loadConfig();
  const { players, version, clubs } = loadPlayers();
  return { config, db: new PlayerDB(config, players, version, clubs) };
}
