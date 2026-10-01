import 'react-native-url-polyfill/auto';
import { createClient as createSupabase, type Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient, type ApiClient, type Me } from './client';
import { API_URL, SUPABASE_KEY, SUPABASE_URL } from './config';
import { secureStorage } from './storage';

const supabase = createSupabase(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

export type State =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'unregistered'; me: Me }
  | { status: 'ready'; me: Me }
  | { status: 'error'; message: string };

interface Ctx {
  state: State;
  api: ApiClient;
  refresh: () => Promise<void>;
  sendCode: (phone: string) => Promise<string | null>;
  verifyCode: (phone: string, code: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const api = useMemo(
    () => createClient({ baseUrl: API_URL, getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null }),
    [],
  );

  useEffect(() => {
    if (session === undefined) return;
    if (!session) return setState({ status: 'out' });
    api.me().then(
      (me) => setState(me.registered ? { status: 'ready', me } : { status: 'unregistered', me }),
      (e: Error) => setState({ status: 'error', message: e.message }),
    );
  }, [session, api, tick]);

  const value: Ctx = {
    state,
    api,
    refresh: async () => setTick((t) => t + 1),
    async sendCode(phone) {
      const { error } = await supabase.auth.signInWithOtp({ phone });
      return error ? error.message : null;
    },
    async verifyCode(phone, code) {
      const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
      return error ? error.message : null;
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('useSession fora do SessionProvider');
  return v;
}
