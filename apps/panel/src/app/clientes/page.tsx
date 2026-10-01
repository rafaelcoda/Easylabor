'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ACCOUNT_STATUS_LABEL, formatBRL, type AccountStatus } from '../../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { Badge, Chip, Pager, useDebounced, useLoad } from '@/components/ui';
import { dateBR, phoneBR } from '@/lib/format';
import { useSession } from '@/lib/session';

const LIMIT = 25;

export default function Clientes() {
  const { api } = useSession();
  const router = useRouter();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [status, setStatus] = useState<'' | AccountStatus>('');
  const [offset, setOffset] = useState(0);
  const list = useLoad(() => api.adminClients({ q: dq || undefined, status: status || undefined, limit: LIMIT, offset }), [api, dq, status, offset]);
  const s = list.data?.summary;
  const pick = (v: '' | AccountStatus) => () => { setStatus(v); setOffset(0); };

  return (
    <Shell title="Gestão de clientes" subtitle="Quem contrata, quanto contratou e o estado de cada conta">
      <div className="filters">
        <Chip label="Todos" count={s?.total} on={status === ''} onClick={pick('')} />
        <Chip label="Ativos" count={s?.active} on={status === 'active'} onClick={pick('active')} />
        <Chip label="Suspensos" count={s?.suspended} on={status === 'suspended'} onClick={pick('suspended')} />
        {s && <span className="muted" style={{ alignSelf: 'center' }}>{s.companies} empresas</span>}
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Buscar por nome, telefone ou e-mail" aria-label="Buscar por nome, telefone ou e-mail" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
      </div>
      {list.error && <p className="err">{list.error}</p>}
      <div className="card">
        {list.data && list.data.items.length === 0 && <p className="muted">Nenhum cliente com esses filtros.</p>}
        {list.data && list.data.items.length > 0 && (
          <table>
            <thead><tr><th>Cliente</th><th>Tipo</th><th>Endereços</th><th>Pedidos</th><th>Concluídos</th><th>Perdidos</th><th>Valor contratado</th><th>Cadastro</th><th>Conta</th></tr></thead>
            <tbody>
              {list.data.items.map((c) => (
                <tr key={c.id} className="click" onClick={() => router.push(`/cliente/?id=${c.id}`)}>
                  <td><Link className="plain" href={`/cliente/?id=${c.id}`} onClick={(e) => e.stopPropagation()}>{c.full_name}</Link><div className="sub-line"><span className="nowrap">{phoneBR(c.phone)}</span>{c.email ? ` · ${c.email}` : ''}</div></td>
                  <td>{c.kind === 'company' ? 'Empresa' : 'Pessoa'}</td>
                  <td>{c.addresses}</td><td>{c.bookings_total}</td><td>{c.bookings_done}</td>
                  <td>{c.bookings_lost > 0 ? <Badge tone="wait">{c.bookings_lost}</Badge> : <span className="muted">0</span>}</td>
                  <td>{formatBRL(c.spent_cents)}</td><td>{dateBR(c.created_at)}</td>
                  <td>{c.status === 'active' ? <Badge tone="ok">{ACCOUNT_STATUS_LABEL.active}</Badge> : <Badge tone="bad">{ACCOUNT_STATUS_LABEL[c.status]}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.data && <Pager total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
      </div>
    </Shell>
  );
}
