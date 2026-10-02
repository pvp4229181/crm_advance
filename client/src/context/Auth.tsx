import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../lib/api';
import type { User } from '../lib/types';
import { useQueryClient } from '@tanstack/react-query';
type AuthValue = {
  user: User | null;
  loading: boolean;
  login: (e: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
};
const C = createContext<AuthValue>(null!);
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const expire = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener('crm:session-expired', expire);
    const controller = new AbortController();
    api<{ user: User }>('/auth/me', { signal: controller.signal })
      .then((x) => setUser(x.user))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => {
      controller.abort();
      window.removeEventListener('crm:session-expired', expire);
    };
  }, [queryClient]);
  async function login(email: string, password: string) {
    const r = await api<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await queryClient.cancelQueries();
    queryClient.clear();
    setUser(r.user);
  }
  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
    await queryClient.cancelQueries();
    queryClient.clear();
  }
  return (
    <C.Provider value={{ user, loading, login, logout }}>{children}</C.Provider>
  );
}
export const useAuth = () => useContext(C);
