import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { BotLevel, GameStateView, PlayResult, RoomSettings } from '../../engine/types.ts';
import { buildIndex, type SearchIndex } from '../../engine/search.ts';
import { ApiError, api, connect, emit, getToken, loadPlayerList, loadPrefs, setToken, sfx, storage, track, type Prefs } from './api.ts';
import type { ClientConfig, GameOverView, Profile, RoomView } from './model.ts';
import { GameTable } from './screens/GameTable.tsx';
import { PORTRAIT_PHONE, RotatePrompt, useMedia } from './components/ui.tsx';
import { Home, Leaderboard, Lobby, PrivateSetup, ProfileScreen, Results, SettingsScreen, Shop, SoloSetup, errorText, type Nav } from './screens/Menus.tsx';

type Screen = 'splash' | 'home' | 'solo' | 'private' | 'lobby' | 'game' | 'results' | 'profile' | 'leaderboard' | 'shop' | 'settings';
const TUTORIAL_DONE = 'onetwo.tutorialDone';

export function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [splashMsg, setSplashMsg] = useState('Loading…');
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [game, setGame] = useState<GameStateView | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [results, setResults] = useState<GameOverView | null>(null);
  const [lastPlay, setLastPlay] = useState<{ result: PlayResult; at: number } | null>(null);
  const [emotes, setEmotes] = useState<{ seat: number; emoteId: string; at: number }[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [connected, setConnected] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const portrait = useMedia(PORTRAIT_PHONE);
  const [uprightOk, setUprightOk] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const pendingRoom = useRef<string | null>(new URLSearchParams(location.search).get('room'));

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    (async () => {
      try {
        const cfg = await api<ClientConfig>('/api/config');
        setConfig(cfg);
        setSplashMsg('Updating player list…');
        const players = await loadPlayerList(cfg.dataVersion);
        setIndex(buildIndex(players));
        let me: Profile;
        try {
          if (!getToken()) throw new ApiError('no token');
          me = await api<Profile>('/api/me');
        } catch {
          const g = await api<{ token: string; profile: Profile }>('/api/guest', { body: {} });
          setToken(g.token);
          me = g.profile;
        }
        setProfile(me);
        track('app_open', { firstOpen: !storage(TUTORIAL_DONE), dataVersion: cfg.dataVersion });
        openSocket();
      } catch (e) {
        setSplashMsg(`Can’t reach the server. ${(e as Error).message}`);
      }
    })();
    return () => { socketRef.current?.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openSocket = () => {
    const socket = connect(getToken()!);
    socketRef.current = socket;
    let first = true;
    socket.on('connect', () => {
      setConnected(true);
      if (!first) return;
      first = false;
      // First launch: tutorial game first (no sign-up wall). Deep links go straight to the room.
      if (pendingRoom.current) {
        const code = pendingRoom.current;
        pendingRoom.current = null;
        history.replaceState(null, '', location.pathname);
        void emit(socket, 'join_room', { mode: 'private', code }).then((r) => { if (!r.ok) { setBanner(errorText(r.error)); setScreen('home'); } });
      } else if (!storage(TUTORIAL_DONE)) {
        void emit(socket, 'join_room', { mode: 'tutorial' });
      } else {
        setScreen((s) => (s === 'splash' ? 'home' : s));
      }
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('room_state', (r: RoomView) => {
      setRoom(r);
      setClockOffset(r.serverNow - Date.now());
      if (r.status === 'lobby') setScreen('lobby');
      if (r.status === 'playing') setScreen('game');
    });
    socket.on('game_state', (g: GameStateView) => {
      setGame(g);
      setClockOffset(g.serverNow - Date.now());
      setScreen((s) => (s === 'results' ? s : 'game'));
    });
    socket.on('play_result', (result: PlayResult) => {
      setLastPlay({ result, at: Date.now() });
      if (result.playType === 'link') sfx(result.valid ? 'good' : 'bad', prefsRef.current);
    });
    socket.on('emote', (e: { seat: number; emoteId: string }) => {
      const at = Date.now();
      setEmotes((xs) => [...xs.filter((x) => at - x.at < 3000), { ...e, at }]);
      setTimeout(() => setEmotes((xs) => xs.filter((x) => x.at !== at)), 3000);
    });
    socket.on('game_over', (r: GameOverView) => {
      setResults(r);
      if (r.placings[0]?.seat === r.you) sfx('win', prefsRef.current);
      if (r.mode === 'tutorial') { storage(TUTORIAL_DONE, '1'); track('tutorial_complete', { skipped: false }); }
      if (r.reward) setProfile((p) => (p ? { ...p, coins: r.reward!.totalCoins, level: r.reward!.level, doubleCoinsAvailable: true } : p));
      setTimeout(() => setScreen('results'), 1400);
      void api<Profile>('/api/me').then(setProfile).catch(() => {});
    });
  };

  // ---------------------------------------------------------------- actions
  const nav: Nav = useCallback((s) => setScreen(s), []);
  const socket = socketRef.current;

  const join = async (payload: Record<string, unknown>): Promise<string | null> => {
    if (!socket) return 'Not connected';
    setResults(null);
    setLastPlay(null);
    const r = await emit(socket, 'join_room', payload);
    if (!r.ok) setBanner(errorText(r.error));
    return r.ok ? null : errorText(r.error);
  };

  const leave = async () => {
    if (socket) await emit(socket, 'leave_room');
    setRoom(null);
    setGame(null);
    setResults(null);
    setScreen('home');
    void api<Profile>('/api/me').then(setProfile).catch(() => {});
  };

  const flags = useMemo(() => config?.flags ?? {}, [config]);

  // Where the browser allows it (Android installed app / fullscreen), lock the table to landscape.
  useEffect(() => {
    if (screen !== 'game') return;
    const o = window.screen?.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    o?.lock?.('landscape').catch(() => {});
    return () => { try { o?.unlock?.(); } catch { /* not locked */ } };
  }, [screen]);

  // ---------------------------------------------------------------- render
  if (screen === 'splash' || !config || !profile || !index || !socket) {
    return (
      <div className="screen splash">
        <div className="logo big">One<span>·</span>Two</div>
        <p>{splashMsg}</p>
      </div>
    );
  }

  const offline = !connected && <div className="offline">Reconnecting… your seat is kept for you</div>;
  const bannerEl = banner && <div className="toast" role="status" onClick={() => setBanner(null)}>{banner}</div>;

  switch (screen) {
    case 'home':
      return <>{offline}{bannerEl}<Home profile={profile} config={config} nav={nav} setProfile={setProfile} onQuick={() => void join({ mode: 'quick' })} /></>;
    case 'solo':
      return <SoloSetup config={config} nav={nav} onStart={(settings: RoomSettings, bots: { count: number; level: BotLevel }) => void join({ mode: 'solo', settings, bots })} />;
    case 'private':
      return <PrivateSetup config={config} nav={nav} onCreate={(settings, bots) => void join({ mode: 'private', settings, bots })} onJoin={(code) => join({ mode: 'private', code })} />;
    case 'lobby':
      return room ? <>{offline}<Lobby room={room} config={config} clockOffset={clockOffset} onLeave={leave}
        onStart={async () => { const r = await emit(socket, 'start_game'); return r.ok ? null : errorText(r.error); }}
        onSettings={(settings, bots) => void emit(socket, 'room_settings', { settings, bots })} /></> : null;
    case 'game':
      return game ? <>{offline}{portrait && !uprightOk && <RotatePrompt onDismiss={() => setUprightOk(true)} />}<GameTable config={config} game={game} clockOffset={clockOffset} room={room} socket={socket} profile={profile} prefs={prefs}
        index={index} flags={flags} lastPlay={lastPlay} emotes={emotes} onLeave={leave}
        onSkipTutorial={() => { storage(TUTORIAL_DONE, '1'); track('tutorial_complete', { skipped: true }); void leave(); }} /></> : null;
    case 'results':
      return results ? <Results results={results} profile={profile} setProfile={setProfile} onHome={leave}
        onRematch={async () => { setLastPlay(null); const r = await emit(socket, 'rematch'); if (!r.ok) void leave(); }} /> : null;
    case 'profile':
      return <ProfileScreen profile={profile} config={config} nav={nav} setProfile={setProfile} />;
    case 'leaderboard':
      return <Leaderboard nav={nav} />;
    case 'shop':
      return <Shop profile={profile} config={config} nav={nav} setProfile={setProfile} />;
    case 'settings':
      return <SettingsScreen config={config} nav={nav} prefs={prefs} setPrefs={setPrefs} dataVersion={config.dataVersion}
        onReplayTutorial={() => void join({ mode: 'tutorial' })}
        onDeleted={() => { setToken(null); storage(TUTORIAL_DONE, null); location.reload(); }} />;
  }
}
