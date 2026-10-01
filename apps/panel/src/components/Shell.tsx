'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/session';

const NAV = [
  { href: '/', label: 'Painel ao vivo' },
  { href: '/agenda/', label: 'Agenda' },
  { href: '/pedidos/', label: 'Pedidos' },
  { href: '/verificacao/', label: 'Verificação' },
];

/** Protege as telas: só entra quem está logado como admin. */
export function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { state, signOut } = useSession();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (state.status === 'out') router.replace('/login/');
  }, [state.status, router]);

  if (state.status === 'loading' || state.status === 'out') return <div className="main muted">Carregando…</div>;
  if (state.status === 'denied') {
    return (
      <div className="login card">
        <h1>Acesso restrito</h1>
        <p className="muted">Esta área é só da operação. Sua conta não tem permissão de administrador.</p>
        <button className="btn sec" onClick={signOut}>Sair</button>
      </div>
    );
  }
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">diária</div>
        <div className="sub">operação</div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={path === n.href || path === n.href.slice(0, -1) ? 'on' : ''}>{n.label}</Link>
        ))}
        <button onClick={signOut}>Sair</button>
      </aside>
      <main className="main">
        <h1>{title}</h1>
        {subtitle && <div className="sub-h">{subtitle}</div>}
        {children}
      </main>
    </div>
  );
}
