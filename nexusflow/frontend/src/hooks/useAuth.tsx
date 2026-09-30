import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import * as api from '../services/api';
import type { AuthTokens } from '../types';

interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    !!localStorage.getItem('nexusflow_token')
  );
  const [username, setUsername] = useState<string | null>(() =>
    localStorage.getItem('nexusflow_username')
  );

  const login = useCallback(async (user: string, password: string) => {
    const tokens: AuthTokens = await api.login(user, password);
    api.storeTokens(tokens);
    localStorage.setItem('nexusflow_username', user);
    setUsername(user);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('nexusflow_refresh_token');
    if (refreshToken) {
      try { await api.logout(refreshToken); } catch { /* ignore */ }
    }
    api.clearTokens();
    localStorage.removeItem('nexusflow_username');
    setUsername(null);
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, username, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
