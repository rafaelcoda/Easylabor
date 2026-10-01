'use client';

import { createClient as createSupabase, type Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient, type ApiClient, type Me } from '../../../../packages/client/src';
import { API_URL, SUPABASE_KEY, SUPABASE_URL } from './config';

const supabase = createSupabase(SUPABASE_URL, SUPABASE_KEY);

type State =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'denied'; me: Me | null; noInvite?: boolean }
  | { status: 'ready'; me: Me };

interface Ctx {
  state: State;
  api: ApiClient;
  sendCode: (phone: string) => Promise<string | null>;
  verifyCode: (phone: string, code: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [state, setState] = useState<State>({ status: 'loading' });

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
    setState({ status: 'loading' });
    api.me().then(
      async (me) => {
        if (me.registered) return setState(me.role === 'admin' ? { status: 'ready', me } : { status: 'denied', me });
        // Primeiro acesso: se este telefone foi convidado para a equipe, o acesso é criado agora.
        try {
          await api.acceptInvite();
          const fresh = await api.me();
          setState(fresh.registered && fresh.role === 'admin' ? { status: 'ready', me: fresh } : { status: 'denied', me: fresh });
        } catch {
          setState({ status: 'denied', me, noInvite: true });
        }
      },
      () => setState({ status: 'denied', me: null }),
    );
  }, [session, api]);

  const value: Ctx = {
    state,
    api,
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
