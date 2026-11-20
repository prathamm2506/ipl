import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { socket, send, session as store } from './socket.js';
import { beep } from './util.js';
import Home from './components/Home.jsx';
import Lobby from './components/Lobby.jsx';
import Retention from './components/Retention.jsx';
import Auction from './components/Auction.jsx';
import Nomination from './components/Nomination.jsx';
import Results from './components/Results.jsx';
import { Toasts, Reactions } from './components/ui.jsx';
import { GameContext } from './context.js';

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [catalog, setCatalog] = useState(null);
  const [game, setGame] = useState(null);
  const [session, setSession] = useState(store.get());
  const [toasts, setToasts] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [sound, setSound] = useState(() => localStorage.getItem('ipl-sound') !== 'off');
  const offset = useRef(0);
  const sessionRef = useRef(session);
  const soundRef = useRef(sound);
  const gameRef = useRef(game);
  sessionRef.current = session; soundRef.current = sound; gameRef.current = game;

  const toast = useCallback((text, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const leave = useCallback(() => {
    store.clear(); setSession(null); setGame(null);
    const url = new URL(window.location.href); url.searchParams.delete('room'); window.history.replaceState({}, '', url);
  }, []);

  const enterRoom = useCallback((res, name) => {
    const s = { code: res.code, token: res.token, seatId: res.seatId, name };
    store.set(s); setSession(s);
    const url = new URL(window.location.href); url.searchParams.set('room', res.code); window.history.replaceState({}, '', url);
  }, []);

  useEffect(() => {
    const rejoin = async () => {
      const s = sessionRef.current;
      if (!s) return;
      const res = await send('room:join', { code: s.code, token: s.token, name: s.name });
      if (res.error) { toast(res.error, 'error'); leave(); }
      else if (res.seatId !== s.seatId) enterRoom(res, s.name);
    };
    const onConnect = () => { setConnected(true); rejoin(); };
    const onDisconnect = () => setConnected(false);
    const onState = (s) => { offset.current = s.serverNow - Date.now(); setGame(s); };
    const onEvent = (e) => {
      const g = gameRef.current; const me = sessionRef.current;
      const myTeam = g && me && g.seats.find((x) => x.id === me.seatId)?.teamId;
      if (e.type === 'reaction') {
        const id = Math.random().toString(36).slice(2);
        setReactions((r) => [...r.slice(-12), { id, emoji: e.emoji, from: e.from, x: 10 + Math.random() * 80 }]);
        setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2600);
      } else if (e.type === 'bid') {
        if (soundRef.current) beep(e.team === myTeam ? 880 : 520, 70);
        if (myTeam && e.outbid === myTeam && e.team !== myTeam) { toast(`Outbid by ${e.team}!`, 'warn'); if (soundRef.current) beep(220, 220, 'sawtooth'); }
      } else if (e.type === 'sold') {
        if (soundRef.current) { beep(392, 120); setTimeout(() => beep(523, 120), 130); setTimeout(() => beep(784, 220), 260); }
        if (e.team === myTeam) toast('Player bought! 🎉', 'good');
      }
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('catalog', setCatalog);
    socket.on('state', onState);
    socket.on('event', onEvent);
    socket.on('kicked', () => { toast('You were removed from the room', 'error'); leave(); });
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('catalog', setCatalog);
      socket.off('state', onState); socket.off('event', onEvent); socket.off('kicked');
    };
  }, [toast, leave, enterRoom]);

  const me = useMemo(() => (game && session ? game.seats.find((s) => s.id === session.seatId) : null), [game, session]);
  const myTeam = useMemo(() => (game && me?.teamId ? game.teams.find((t) => t.id === me.teamId) : null), [game, me]);

  const act = useCallback(async (event, payload) => {
    const res = await send(event, payload);
    if (res?.error) toast(res.error, 'error');
    return res;
  }, [toast]);

  const ctx = { game, catalog, me, myTeam, session, act, toast, offset, sound, setSound: (v) => { setSound(v); localStorage.setItem('ipl-sound', v ? 'on' : 'off'); }, leave, enterRoom, connected };

  let page;
  if (!session || !game || !catalog) page = <Home />;
  else if (game.phase === 'lobby') page = <Lobby />;
  else if (game.phase === 'retention') page = <Retention />;
  else if (game.phase === 'nomination') page = <Nomination />;
  else if (game.phase === 'complete') page = <Results />;
  else page = <Auction />;

  return (
    <GameContext.Provider value={ctx}>
      {!connected && <div className="offline-bar">Reconnecting to the server… (free servers can take up to a minute to wake up)</div>}
      {page}
      <Toasts toasts={toasts} />
      <Reactions items={reactions} />
    </GameContext.Provider>
  );
}
