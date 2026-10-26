import { useEffect, useRef, useState } from 'react';
import type { CompanyEvent, CompanyState, ServerFrame } from '@olympus/shared';

const TOKEN_KEY = 'olympus-owner-token';
const MAX_EVENTS = 400;

/** Reads the owner token from ?token= once, keeps it for this tab, and removes it from the URL. */
export function readToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      // Storage can be blocked; the token still works for this page load.
    }
    url.searchParams.delete('token');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {}

export async function api<T = unknown>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-olympus-token': token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'unauthorized';

/** Live company state over the daemon's WebSocket, with automatic reconnect. */
export function useCompany(token: string) {
  const [state, setState] = useState<CompanyState | null>(null);
  const [events, setEvents] = useState<CompanyEvent[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const retry = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let closed = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}`);
      socket.onopen = () => {
        retry.current = 0;
        setConnection('live');
      };
      socket.onmessage = (msg) => {
        const frame = JSON.parse(String(msg.data)) as ServerFrame;
        setState(frame.state);
        if (frame.kind === 'hello') {
          setEvents(frame.recentEvents.slice(-MAX_EVENTS));
        } else {
          setEvents((prev) => {
            const next = prev.length >= MAX_EVENTS ? prev.slice(-MAX_EVENTS + 1) : prev.slice();
            next.push(frame.event);
            return next;
          });
        }
      };
      socket.onclose = async () => {
        if (closed) return;
        // A rejected handshake looks like a normal close; check whether the token is the problem.
        const health = await fetch('/api/state', { headers: { 'x-olympus-token': token } }).catch(() => null);
        if (health?.status === 401) {
          setConnection('unauthorized');
          return;
        }
        setConnection('reconnecting');
        const delay = Math.min(10_000, 500 * 2 ** retry.current++);
        timer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, [token]);

  return { state, events, connection };
}
