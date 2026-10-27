import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { http, TOKEN_KEY } from '../api/client';

const AuthContext = createContext(null);

function decodePayload(token) {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(encoded))));
  } catch {
    return null;
  }
}

function readSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return { token: null, user: null };
  const payload = decodePayload(token);
  if (!payload || (payload.exp && payload.exp * 1000 <= Date.now())) {
    localStorage.removeItem(TOKEN_KEY);
    return { token: null, user: null };
  }
  return { token, user: payload };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession);
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setSession({ token: null, user: null });
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => logout();
    window.addEventListener('school:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('school:unauthorized', handleUnauthorized);
  }, [logout]);

  const authenticate = useCallback(async (endpoint, values) => {
    const response = await http.post(endpoint, values);
    const token = response?.token || response?.accessToken || response?.access_token;
    if (!token) throw new Error('A resposta de autenticação não contém um token válido.');
    localStorage.setItem(TOKEN_KEY, token);
    setSession({ token, user: decodePayload(token) });
  }, []);

  const value = useMemo(() => ({
    ...session,
    login: (values) => authenticate('/api/auth/login', values),
    register: (values) => http.post('/api/auth/register', values),
    logout,
    isAdmin: ['admin', 'administrator'].includes(String(session.user?.role || session.user?.perfil || '').toLowerCase()),
    displayName: session.user?.name || session.user?.email || session.user?.sub || 'Usuário',
  }), [session, authenticate, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
