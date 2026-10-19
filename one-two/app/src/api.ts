// Talking to the server: REST for accounts/shop/etc., Socket.IO for live play.

import { io, type Socket } from 'socket.io-client';
import type { PlayerListEntry } from '../../engine/types.ts';

export const SERVER: string = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') ?? '';
/** Demo build: no server, the game runs in the browser (Solo vs Bots and the tutorial). */
export const DEMO = import.meta.env.VITE_DEMO === '1';
let demo: typeof import('./demo/local.ts') | null = null;

const TOKEN_KEY = 'onetwo.token';
const PLAYERS_KEY = 'onetwo.players';

export function storage(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: run without saved state */
  }
  return value ?? null;
}

export const getToken = () => storage(TOKEN_KEY);
export const setToken = (t: string | null) => storage(TOKEN_KEY, t);

export class ApiError extends Error {}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  if (DEMO) {
    demo ??= await import('./demo/local.ts');
    try {
      return (await demo.demoApi(path, opts)) as T;
    } catch (e) {
      throw new ApiError((e as Error).message);
    }
  }
  const token = getToken();
  const res = await fetch(`${SERVER}${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** The full name list lives on the phone for instant search; re-downloaded only when the data version changes. */
export async function loadPlayerList(version: string): Promise<PlayerListEntry[]> {
  const cached = storage(PLAYERS_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { version: string; players: PlayerListEntry[] };
      if (parsed.version === version) return parsed.players;
    } catch {
      /* fall through and refetch */
    }
  }
  const fresh = await api<{ version: string; players: PlayerListEntry[] }>('/api/players');
  storage(PLAYERS_KEY, JSON.stringify(fresh));
  return fresh.players;
}

export function connect(token: string): Socket {
  if (DEMO && demo) return new demo.LocalSocket() as unknown as Socket;
  return io(SERVER || undefined, { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
}

export function emit<T = { ok: boolean; error?: string }>(socket: Socket, event: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve) => socket.timeout(8000).emit(event, payload, (err: Error | null, res: T) => resolve(err ? ({ ok: false, error: 'timeout' } as T) : res)));
}

export function track(event: string, props: Record<string, unknown> = {}): void {
  if (DEMO) return;
  void fetch(`${SERVER}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, props }) }).catch(() => {});
}

// ------------------------------------------------------------------ preferences

export interface Prefs { sound: boolean; music: boolean; vibration: boolean; personalisedAds: boolean }
const PREFS_KEY = 'onetwo.prefs';

export function loadPrefs(): Prefs {
  const defaults: Prefs = { sound: true, music: false, vibration: true, personalisedAds: false };
  try {
    return { ...defaults, ...JSON.parse(storage(PREFS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export function savePrefs(p: Prefs): void {
  storage(PREFS_KEY, JSON.stringify(p));
}

let audio: AudioContext | null = null;

/** Tiny synthesized sound effects (no audio files to download). */
export function sfx(kind: 'tap' | 'good' | 'bad' | 'turn' | 'win', prefs: Prefs): void {
  if (prefs.vibration && 'vibrate' in navigator && (kind === 'bad' || kind === 'turn')) navigator.vibrate(kind === 'bad' ? [60, 40, 60] : 40);
  if (!prefs.sound) return;
  try {
    audio ??= new AudioContext();
    const notes: Record<string, number[]> = { tap: [660], good: [523, 784], bad: [220, 180], turn: [880], win: [523, 659, 784, 1047] };
    notes[kind].forEach((freq, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      const t = audio!.currentTime + i * 0.09;
      o.frequency.value = freq;
      o.type = kind === 'bad' ? 'sawtooth' : 'triangle';
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(audio!.destination);
      o.start(t);
      o.stop(t + 0.18);
    });
  } catch {
    /* audio unavailable */
  }
}
