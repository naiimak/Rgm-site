// Persistence for accounts, progression, answer reports and leaderboards.
// v1 of this build keeps everything in one JSON file (data/store.json) behind this small
// interface; swapping it for PostgreSQL (the spec's recommendation) only touches this file.

import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface UserStats {
  games: number;
  wins: number;
  correctAnswers: number;
  bestStreak: number;
  named: Record<string, number>;
  clubCards: Record<string, number>;
}

export interface User {
  id: string;
  token: string;
  username: string;
  avatar: string;
  createdAt: string;
  xp: number;
  level: number;
  coins: number;
  stats: UserStats;
  owned: string[];
  equipped: Record<string, string>;
  weekly: { week: string; xp: number };
  onlineXp: number;
  ads: { day: string; freeCoins: number };
  lastGame: { gameId: string; coins: number; doubled: boolean } | null;
  starterPackOffered: boolean;
  linked: { provider: 'google' | 'apple' } | null;
}

export interface AnswerReport {
  id: string;
  createdAt: string;
  gameId: string;
  dataVersion: string;
  cardA: string;
  cardB: string;
  playerId: string;
  playerName: string;
  verdict: 'valid' | 'wrong';
  reporter: string;
  status: 'open' | 'confirmed' | 'rejected';
  reviewerNote: string;
}

interface StoreData { users: User[]; reports: AnswerReport[] }

export class Store {
  private data: StoreData = { users: [], reports: [] };
  private byToken = new Map<string, User>();
  private byId = new Map<string, User>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly path: string) {
    if (existsSync(path)) this.data = JSON.parse(readFileSync(path, 'utf8')) as StoreData;
    for (const u of this.data.users) this.index(u);
  }

  createGuest(username: string, avatar: string, defaults: string[], equipped: Record<string, string>): User {
    const user: User = {
      id: randomUUID(),
      token: randomBytes(24).toString('base64url'),
      username, avatar,
      createdAt: new Date().toISOString(),
      xp: 0, level: 1, coins: 0,
      stats: { games: 0, wins: 0, correctAnswers: 0, bestStreak: 0, named: {}, clubCards: {} },
      owned: defaults, equipped,
      weekly: { week: weekKey(), xp: 0 },
      onlineXp: 0,
      ads: { day: dayKey(), freeCoins: 0 },
      lastGame: null,
      starterPackOffered: false,
      linked: null,
    };
    this.data.users.push(user);
    this.index(user);
    this.save();
    return user;
  }

  userByToken(token: string | undefined): User | null {
    return token ? this.byToken.get(token) ?? null : null;
  }

  userById(id: string): User | null {
    return this.byId.get(id) ?? null;
  }

  usernameTaken(name: string, exceptId?: string): boolean {
    const n = name.toLowerCase();
    return this.data.users.some((u) => u.username.toLowerCase() === n && u.id !== exceptId);
  }

  deleteUser(id: string): void {
    const u = this.byId.get(id);
    if (!u) return;
    this.data.users = this.data.users.filter((x) => x.id !== id);
    this.byId.delete(id);
    this.byToken.delete(u.token);
    this.save();
  }

  /** Weekly (resets Monday 00:00 UTC) or all-time XP from online games; top 100 plus your own position. */
  leaderboard(period: 'weekly' | 'all', me: User | null) {
    const week = weekKey();
    const score = (u: User) => (period === 'weekly' ? (u.weekly.week === week ? u.weekly.xp : 0) : u.onlineXp);
    const ranked = this.data.users.filter((u) => score(u) > 0).sort((a, b) => score(b) - score(a));
    const row = (u: User, i: number) => ({ rank: i + 1, username: u.username, avatar: u.avatar, level: u.level, xp: score(u), you: u.id === me?.id });
    const myIndex = me ? ranked.findIndex((u) => u.id === me.id) : -1;
    return { top: ranked.slice(0, 100).map(row), me: myIndex >= 0 ? row(ranked[myIndex], myIndex) : null };
  }

  addReport(r: Omit<AnswerReport, 'id' | 'createdAt' | 'status' | 'reviewerNote'>): AnswerReport {
    const report: AnswerReport = { ...r, id: randomUUID(), createdAt: new Date().toISOString(), status: 'open', reviewerNote: '' };
    this.data.reports.push(report);
    this.save();
    return report;
  }

  reports(): AnswerReport[] {
    return [...this.data.reports].reverse();
  }

  updateReport(id: string, status: AnswerReport['status'], note: string): boolean {
    const r = this.data.reports.find((x) => x.id === id);
    if (!r) return false;
    r.status = status;
    r.reviewerNote = note;
    this.save();
    return true;
  }

  /** Call after mutating a user. Writes are batched and atomic (temp file + rename). */
  save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path + '.tmp', JSON.stringify(this.data));
      renameSync(this.path + '.tmp', this.path);
    }, 250);
  }

  private index(u: User): void {
    this.byToken.set(u.token, u);
    this.byId.set(u.id, u);
  }
}

export function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** ISO date of the most recent Monday (UTC). */
export function weekKey(d = new Date()): string {
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return dayKey(monday);
}
