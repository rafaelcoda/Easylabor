'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  ACCOUNT_STATUS_LABEL, KYC_LABEL, LEVEL_LABEL, STRIKE_KIND_LABEL, WEEKDAYS, auditLabel, categoryName, errorMessage, formatBRL,
} from '../../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { Badge, Facts, StatusBadge, useLoad } from '@/components/ui';
import { dateBR, dateTimeBR, phoneBR } from '@/lib/format';
import { useSession } from '@/lib/session';
import { proState } from '@/lib/status';

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);

function Detail() {
  const { api } = useSession();
  const id = useSearchParams().get('id') ?? '';
  const d = useLoad(() => api.adminProfessional(id), [api, id], 0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await fn(); d.reload(); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(false); }
  };
  const ask = (text: string) => window.prompt(text)?.trim();

  if (d.error) return <Shell title="Profissional"><Link className="back" href="/profissionais/">‹ Profissionais</Link><p className="err">{d.error}</p></Shell>;
  if (!d.data) return <Shell title="Profissional"><p className="muted">Carregando…</p></Shell>;
  const { user, profile, offers, weekly, strikes, bookings, history } = d.data;
  const st = proState({ status: user.status, has_profile: profile !== null, kyc_status: profile?.kyc_status ?? null });
  const pending = profile && (profile.kyc_status === 'pending' || profile.kyc_status === 'in_review') && user.status === 'active';

  return (
    <Shell title={user.full_name} subtitle={`${phoneBR(user.phone)} · cadastro em ${dateBR(user.created_at)}`}>
      <Link className="back" href="/profissionais/">‹ Profissionais</Link>
      <div className="head-row">
        <div className="row"><Badge tone={st.tone}>{st.label}</Badge>{profile?.visible && <Badge tone="ok">Visível na busca</Badge>}{profile && !profile.visible && user.status === 'active' && <span className="muted">Oculto da busca</span>}</div>
        <div className="actions">
          {pending && <button className="btn" disabled={busy} onClick={() => act(() => api.kycDecision(id, 'approve'))}>Aprovar cadastro</button>}
          {pending && <button className="btn bad" disabled={busy} onClick={() => { const r = ask('Motivo da reprovação (obrigatório):'); if (r) void act(() => api.kycDecision(id, 'reject', r)); }}>Reprovar</button>}
          {profile?.kyc_status === 'approved' && user.status === 'active' && (
            <button className="btn sec" disabled={busy} onClick={() => act(() => api.setProfessionalVisible(id, !profile.visible))}>{profile.visible ? 'Ocultar da busca' : 'Exibir na busca'}</button>
          )}
          {user.status === 'active' && <button className="btn bad" disabled={busy} onClick={() => { const r = ask('Motivo da suspensão (obrigatório). O profissional deixa de entrar no app e some da busca:'); if (r) void act(() => api.suspendUser(id, r)); }}>Suspender conta</button>}
          {user.status === 'suspended' && <button className="btn" disabled={busy} onClick={() => act(() => api.reactivateUser(id))}>Reativar conta</button>}
        </div>
      </div>
      {msg && <p className="err">{msg}</p>}
      {profile?.kyc_status === 'rejected' && profile.kyc_reason && <div className="notice">Motivo da reprovação: {profile.kyc_reason}</div>}

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Dados</h2>
          <Facts rows={[
            ['Conta', ACCOUNT_STATUS_LABEL[user.status]], ['Telefone', phoneBR(user.phone)], ['E-mail', user.email], ['Termos aceitos', user.terms_version],
            ['Raio de atuação', profile ? `${profile.radius_km} km` : null], ['Chave Pix', profile?.pix_key_masked],
            ['Verificação', profile ? (KYC_LABEL[profile.kyc_status] ?? profile.kyc_status) : 'Cadastro incompleto'],
          ]} />
          {profile?.bio && <p className="muted" style={{ marginBottom: 0 }}>“{profile.bio}”</p>}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Desempenho</h2>
          {profile ? (
            <Facts rows={[
              ['Nível', LEVEL_LABEL[profile.level] ?? profile.level],
              ['Nota', profile.rating_count > 0 ? `★ ${profile.rating_avg.toFixed(1).replace('.', ',')} (${profile.rating_count} avaliações)` : 'Sem avaliações'],
              ['Serviços concluídos', String(profile.completed_count)], ['Comparecimento', pct(profile.attendance_rate)], ['Aceite de pedidos', pct(profile.acceptance_rate)],
            ]} />
          ) : <p className="muted">O profissional ainda não completou o cadastro.</p>}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Serviços e valores</h2>
          {offers.length === 0 ? <p className="muted">Nenhum serviço cadastrado.</p> : (
            <table><tbody>{offers.map((o) => <tr key={o.category}><td><b>{categoryName(o.category)}</b></td><td style={{ textAlign: 'right' }}>{formatBRL(o.daily_rate_cents)} por diária</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Disponibilidade da semana</h2>
          {weekly.days.length === 0 ? <p className="muted">Não marcou nenhum dia.</p> : (
            <>
              <div className="tags">{WEEKDAYS.map((w) => <span key={w.iso} className="tag" style={weekly.days.includes(w.iso) ? { background: '#1f6aae', color: '#fff', borderColor: '#1f6aae' } : { opacity: 0.45 }}>{w.short}</span>)}</div>
              <p className="muted" style={{ marginBottom: 0 }}>Das {weekly.start_time} às {weekly.end_time}</p>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Advertências</h2>
        {strikes.length === 0 ? <p className="muted">Nenhuma advertência.</p> : (
          <table><thead><tr><th>Tipo</th><th>Pedido</th><th>Data</th><th>Vale até</th><th></th></tr></thead>
            <tbody>{strikes.map((s, i) => <tr key={i}><td>{STRIKE_KIND_LABEL[s.kind] ?? s.kind}</td><td>{s.booking_code ?? '–'}</td><td>{dateBR(s.created_at)}</td><td>{dateBR(s.expires_at)}</td><td>{s.active ? <Badge tone="bad">Ativa</Badge> : <span className="muted">Expirada</span>}</td></tr>)}</tbody></table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Últimos pedidos</h2>
        {bookings.length === 0 ? <p className="muted">Nenhum pedido ainda.</p> : (
          <table><thead><tr><th>Código</th><th>Serviço</th><th>Cliente</th><th>Data</th><th>Total</th><th>Estado</th></tr></thead>
            <tbody>{bookings.map((b) => <tr key={b.id}><td><b>{b.code}</b></td><td>{categoryName(b.category)}</td><td>{b.client_name}</td><td>{dateTimeBR(b.starts_at)}</td><td>{formatBRL(b.total_cents)}</td><td><StatusBadge status={b.status} /></td></tr>)}</tbody></table>
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

export default function ProfissionalPage() {
  return <Suspense fallback={null}><Detail /></Suspense>;
}
