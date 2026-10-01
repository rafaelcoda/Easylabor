'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ACCOUNT_STATUS_LABEL, auditLabel, categoryName, errorMessage, formatBRL } from '../../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { Badge, Facts, StatusBadge, useLoad } from '@/components/ui';
import { dateBR, dateTimeBR, phoneBR } from '@/lib/format';
import { useSession } from '@/lib/session';

function Detail() {
  const { api } = useSession();
  const id = useSearchParams().get('id') ?? '';
  const d = useLoad(() => api.adminClient(id), [api, id], 0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await fn(); d.reload(); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(false); }
  };

  if (d.error) return <Shell title="Cliente"><Link className="back" href="/clientes/">‹ Clientes</Link><p className="err">{d.error}</p></Shell>;
  if (!d.data) return <Shell title="Cliente"><p className="muted">Carregando…</p></Shell>;
  const { user, profile, addresses, totals, bookings, history } = d.data;

  return (
    <Shell title={user.full_name} subtitle={`${phoneBR(user.phone)} · cadastro em ${dateBR(user.created_at)}`}>
      <Link className="back" href="/clientes/">‹ Clientes</Link>
      <div className="head-row">
        <div className="row">{user.status === 'active' ? <Badge tone="ok">Conta ativa</Badge> : <Badge tone="bad">Conta {ACCOUNT_STATUS_LABEL[user.status].toLowerCase()}</Badge>}{profile?.kind === 'company' && <Badge tone="done">Empresa</Badge>}</div>
        <div className="actions">
          {user.status === 'active' && <button className="btn bad" disabled={busy} onClick={() => { const r = window.prompt('Motivo da suspensão (obrigatório). O cliente deixa de entrar no app:')?.trim(); if (r) void act(() => api.suspendUser(id, r)); }}>Suspender conta</button>}
          {user.status === 'suspended' && <button className="btn" disabled={busy} onClick={() => act(() => api.reactivateUser(id))}>Reativar conta</button>}
        </div>
      </div>
      {msg && <p className="err">{msg}</p>}

      <div className="kpis">
        <div className="card kpi"><div className="l">Pedidos</div><div className="v">{totals.bookings}</div></div>
        <div className="card kpi"><div className="l">Concluídos</div><div className="v">{totals.done}</div></div>
        <div className="card kpi"><div className="l">Cancelados ou perdidos</div><div className="v">{totals.lost}</div></div>
        <div className="card kpi"><div className="l">Valor contratado</div><div className="v">{formatBRL(totals.spent_cents)}</div><div className="s">só serviços concluídos</div></div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Dados</h2>
          <Facts rows={[
            ['Conta', ACCOUNT_STATUS_LABEL[user.status]], ['Telefone', phoneBR(user.phone)], ['E-mail', user.email], ['Termos aceitos', user.terms_version],
            ['Tipo', profile?.kind === 'company' ? 'Empresa' : 'Pessoa'], ...(profile?.kind === 'company' ? [['CNPJ', profile.cnpj_masked] as [string, string | null]] : []),
          ]} />
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Endereços</h2>
          {addresses.length === 0 ? <p className="muted">Nenhum endereço cadastrado.</p> : (
            <table><tbody>{addresses.map((a, i) => <tr key={i}><td>{a.label ?? 'Endereço'}</td><td style={{ textAlign: 'right' }}>{[a.district, `${a.city}/${a.state}`].filter(Boolean).join(' · ')}</td></tr>)}</tbody></table>
          )}
          <p className="hint">Por privacidade, a rua e o número só aparecem para o profissional depois que ele aceita o pedido.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Últimos pedidos</h2>
        {bookings.length === 0 ? <p className="muted">Nenhum pedido ainda.</p> : (
          <table><thead><tr><th>Código</th><th>Serviço</th><th>Profissional</th><th>Data</th><th>Total</th><th>Estado</th></tr></thead>
            <tbody>{bookings.map((b) => <tr key={b.id}><td><b>{b.code}</b></td><td>{categoryName(b.category)}</td><td>{b.professional_name}</td><td>{dateTimeBR(b.starts_at)}</td><td>{formatBRL(b.total_cents)}</td><td><StatusBadge status={b.status} /></td></tr>)}</tbody></table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Histórico de ações da operação</h2>
        {history.length === 0 ? <p className="muted">Nenhuma ação registrada.</p> : (
          <table><tbody>{history.map((h) => <tr key={h.id}><td>{dateTimeBR(h.created_at)}</td><td><b>{auditLabel(h.action)}</b></td><td>{h.actor_name}</td><td className="diff">{(h.after as { reason?: string } | null)?.reason ?? ''}</td></tr>)}</tbody></table>
        )}
      </div>
    </Shell>
  );
}

export default function ClientePage() {
  return <Suspense fallback={null}><Detail /></Suspense>;
}
