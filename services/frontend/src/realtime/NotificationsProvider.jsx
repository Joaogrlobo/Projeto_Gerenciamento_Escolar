import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { API_URL, http } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const SOCKET_URL = `${API_URL.replace(/^http/, 'ws')}/ws/notifications`;
const ALLOWED_ROLES = ['admin', 'staff', 'teacher'];
const UNAUTHORIZED = 4401;
const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
const TOAST_MS = 6000;
const MAX_LATEST = 50;

const NotificationsContext = createContext({ unread: 0, connected: false, latest: [], markSeen: async () => {} });

export function canSeeNotifications(user) {
  return ALLOWED_ROLES.includes(String(user?.role || '').toLowerCase());
}

export function NotificationsProvider({ children }) {
  const { token, user } = useAuth();
  const enabled = Boolean(token) && canSeeNotifications(user);
  const [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(false);
  const [latest, setLatest] = useState([]);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (!enabled) {
      setUnread(0);
      setLatest([]);
      setToasts([]);
      return undefined;
    }
    let socket;
    let retryTimer;
    let retryDelay = FIRST_RETRY_MS;
    let stopped = false;

    function receive(notification) {
      setLatest((current) => [
        notification,
        ...current.filter((item) => item.event_id !== notification.event_id),
      ].slice(0, MAX_LATEST));
      setUnread((count) => count + 1);
      setToasts((current) => [...current, notification]);
      setTimeout(() => {
        setToasts((current) => current.filter((item) => item.event_id !== notification.event_id));
      }, TOAST_MS);
    }

    function open() {
      socket = new WebSocket(SOCKET_URL);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }));
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'ready') {
          retryDelay = FIRST_RETRY_MS;
          setConnected(true);
          http.get('/api/notifications/unread-count').then((result) => setUnread(result.count)).catch(() => {});
        } else if (data.type === 'notification') {
          receive(data.notification);
        }
      };
      socket.onclose = (event) => {
        setConnected(false);
        if (stopped) return;
        if (event.code === UNAUTHORIZED) {
          window.dispatchEvent(new Event('school:unauthorized'));
          return;
        }
        retryTimer = setTimeout(open, retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      };
    }

    open();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socket.close();
    };
  }, [enabled, token]);

  const markSeen = useCallback(async () => {
    try {
      await http.post('/api/notifications/seen');
      setUnread(0);
    } catch {
      // O contador é atualizado na próxima visita.
    }
  }, []);

  const value = useMemo(() => ({ unread, connected, latest, markSeen }), [unread, connected, latest, markSeen]);

  return <NotificationsContext.Provider value={value}>
    {children}
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((item) => <div className="toast" key={item.event_id}><strong>Novo aviso</strong><span>{item.message}</span></div>)}
    </div>
  </NotificationsContext.Provider>;
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
