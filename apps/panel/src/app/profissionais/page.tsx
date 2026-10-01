'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LEVEL_LABEL, ACCOUNT_STATUS_LABEL, categoryName, formatBRL, type KycFilter } from '../../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { Badge, Chip, Pager, useDebounced, useLoad } from '@/components/ui';
import { dateBR, phoneBR } from '@/lib/format';
import { useSession } from '@/lib/session';
import { proState } from '@/lib/status';

type View = '' | KycFilter | 'suspended';
const LIMIT = 25;

export default function Profissionais() {
  const { api } = useSession();
  const router = useRouter();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [view, setView] = useState<View>('');
  const [visible, setVisible] = useState<'' | 'true' | 'false'>('');
  const [service, setService] = useState('');
  const [offset, setOffset] = useState(0);
  const cats = useLoad(() => api.categories(), [api], 0);
  const list = useLoad(
    () => api.adminProfessionals({
      q: dq || undefined, kyc: view && view !== 'suspended' ? view : undefined, status: view === 'suspended' ? 'suspended' : undefined,
      visible: visible === '' ? undefined : visible === 'true', service: service || undefined, limit: LIMIT, offset,
    }),
    [api, dq, view, visible, service, offset],
  );
  const s = list.data?.summary;
  const pick = (v: View) => () => { setView(v); setOffset(0); };

  return (
    <Shell title="Gestão de profissionais" subtitle="Cadastro, verificação, desempenho e conta de cada profissional">
      <div className="filters">
        <Chip label="Todos" count={s?.total} on={view === ''} onClick={pick('')} />
        <Chip label="Aguardando verificação" count={s?.pending} on={view === 'pending'} onClick={pick('pending')} />
        <Chip label="Aprovados" count={s?.approved} on={view === 'approved'} onClick={pick('approved')} />
        <Chip label="Reprovados" count={s?.rejected} on={view === 'rejected'} onClick={pick('rejected')} />
        <Chip label="Cadastro incompleto" count={s?.incomplete} on={view === 'incomplete'} onClick={pick('incomplete')} />
        <Chip label="Suspensos" count={s?.suspended} on={view === 'suspended'} onClick={pick('suspended')} />
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Buscar por nome ou telefone" aria-label="Buscar por nome ou telefone" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        <select aria-label="Serviço" value={service} onChange={(e) => { setService(e.target.value); setOffset(0); }}>
          <option value="">Todos os serviços</option>
          {cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <select aria-label="Na busca dos clientes" value={visible} onChange={(e) => { setVisible(e.target.value as '' | 'true' | 'false'); setOffset(0); }}>
          <option value="">Visíveis e ocultos</option>
          <option value="true">Visíveis na busca</option>
          <option value="false">Ocultos da busca</option>
        </select>
        {s && <span className="muted">{s.visible} visíveis na busca agora</span>}
      </div>
      {list.error && <p className="err">{list.error}</p>}
      <div className="card">
        {list.data && list.data.items.length === 0 && <p className="muted">Nenhum profissional com esses filtros.</p>}
        {list.data && list.data.items.length > 0 && (
          <table>
            <thead><tr><th>Profissional</th><th>Serviços</th><th>Região</th><th>Nota</th><th>Concluídos</th><th>Estado</th><th>Na busca</th><th>Advert.</th><th>Cadastro</th></tr></thead>
            <tbody>
              {list.data.items.map((r) => {
                const st = proState(r);
                return (
                  <tr key={r.id} className="click" onClick={() => router.push(`/profissional/?id=${r.id}`)}>
                    <td><Link className="plain" href={`/profissional/?id=${r.id}`} onClick={(e) => e.stopPropagation()}>{r.full_name}</Link>{r.is_collaborator && <span className="pill-custom" style={{ background: '#e6f5fb', color: '#1f6aae' }}>colaborador</span>}<div className="sub-line nowrap">{phoneBR(r.phone)}</div></td>
                    <td><div className="tags">{r.offers.length === 0 ? <span className="muted">–</span> : r.offers.map((o) => <span key={o.category} className="tag">{categoryName(o.category)} · {formatBRL(o.rate_cents)}</span>)}</div></td>
                    <td>{r.radius_km ? `${r.radius_km} km` : '–'}{r.level && <div className="sub-line">{LEVEL_LABEL[r.level] ?? r.level}</div>}</td>
                    <td>{r.rating_count > 0 ? `★ ${r.rating_avg.toFixed(1).replace('.', ',')} (${r.rating_count})` : <span className="muted">Novo</span>}</td>
                    <td>{r.completed_count}<div className="sub-line">{r.bookings_total} pedidos</div></td>
                    <td><Badge tone={st.tone}>{st.label}</Badge>{r.status === 'deleted' && <div className="sub-line">{ACCOUNT_STATUS_LABEL.deleted}</div>}</td>
                    <td>{r.visible ? <Badge tone="ok">Visível</Badge> : <span className="muted">Oculto</span>}</td>
                    <td>{r.active_strikes > 0 ? <Badge tone="bad">{r.active_strikes}</Badge> : <span className="muted">0</span>}</td>
                    <td>{dateBR(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {list.data && <Pager total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
      </div>
    </Shell>
  );
}
