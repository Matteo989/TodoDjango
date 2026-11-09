// Accès à l'API du bot (REST + WebSocket temps réel)
import { useEffect, useRef, useState, useCallback } from "react";

const TOKEN_KEY = "mnbot_token";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* stockage indisponible */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("mnbot-unauthorized"));
    throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`);
  }
  return data as T;
}

/** Charge une ressource et la rafraîchit périodiquement et/ou à chaque événement temps réel. */
export function usePoll<T>(path: string | null, intervalMs = 10000, refreshOn: string[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    if (!pathRef.current) return;
    try {
      const d = await api<T>(pathRef.current);
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
    if (!intervalMs) return;
    const id = setInterval(reload, intervalMs);
    return () => clearInterval(id);
  }, [path, intervalMs, reload]);

  useLiveEvent(refreshOn, reload);
  return { data, error, loading, reload };
}

// ---------------------------------------------------------------- WebSocket

type Listener = (type: string, payload: any) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let connected = false;
const statusListeners = new Set<(c: boolean) => void>();

function setConnected(c: boolean) {
  connected = c;
  statusListeners.forEach((l) => l(c));
}

export function connectLive() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const token = getToken();
  socket = new WebSocket(`${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`);
  socket.onopen = () => setConnected(true);
  socket.onclose = () => {
    setConnected(false);
    setTimeout(connectLive, 3000);
  };
  socket.onerror = () => socket?.close();
  socket.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      listeners.forEach((l) => l(msg.type, msg.payload));
    } catch { /* message illisible ignoré */ }
  };
}

export function useLiveEvent(types: string[], handler: (payload: any, type: string) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  const key = types.join(",");
  useEffect(() => {
    if (!key) return;
    const set = new Set(key.split(","));
    const l: Listener = (type, payload) => { if (set.has(type)) ref.current(payload, type); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [key]);
}

export function useLiveStatus() {
  const [c, setC] = useState(connected);
  useEffect(() => {
    statusListeners.add(setC);
    return () => { statusListeners.delete(setC); };
  }, []);
  return c;
}
