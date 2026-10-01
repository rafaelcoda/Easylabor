'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/session';

const NAV = [
  { href: '/', label: 'Painel ao vivo' },
  { href: '/agenda/', label: 'Agenda' },
  { href: '/pedidos/', label: 'Pedidos' },
  { href: '/profissionais/', label: 'Profissionais' },
  { href: '/colaboradores/', label: 'Colaboradores' },
  { href: '/clientes/', label: 'Clientes' },
  { href: '/verificacao/', label: 'Verificação' },
  { href: '/equipe/', label: 'Equipe' },
  { href: '/plataforma/', label: 'Plataforma' },
];
const isOn = (path: string, href: string) => path === href || path === href.slice(0, -1) || (href !== '/' && path.startsWith(href.slice(0, -1)));

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
        <div className="logo-head"><img src="/simbolo.svg" alt="" /><div><div className="t">Easylabor</div><div className="s">Operação</div></div></div>
        <h1>Acesso restrito</h1>
        <p className="muted">{state.noInvite ? 'Este telefone não tem convite para a equipe da operação. Peça a um administrador para convidar você e entre de novo.' : 'Esta área é só da operação. Sua conta não tem permissão de acesso.'}</p>
        <button className="btn sec" onClick={signOut}>Sair</button>
      </div>
    );
  }
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><img src="/simbolo-fundo-escuro.svg" alt="" />Easylabor</div>
        <div className="sub">Operação</div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={isOn(path, n.href) ? 'on' : ''}>{n.label}</Link>
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
