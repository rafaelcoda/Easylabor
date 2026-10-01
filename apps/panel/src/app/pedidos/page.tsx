'use client';

import { useState } from 'react';
import { STATUS_LABEL, formatBRL, type BookingStatus } from '../../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { StatusBadge, useLoad } from '@/components/ui';
import { timeSP } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function Pedidos() {
  const { api } = useSession();
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const list = useLoad(() => api.adminBookings({ date: date || undefined, status: status || undefined, limit: 200 }), [api, date, status]);
  return (
    <Shell title="Pedidos" subtitle="Todos os pedidos, do mais recente ao mais antigo">
      <div className="row" style={{ marginBottom: 16 }}>
        <label className="row muted">Dia <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="row muted">Estado
          <select value={status} onChange={(e) => setStatus(e.target.value as BookingStatus | '')}>
            <option value="">Todos</option>
            {(Object.keys(STATUS_LABEL) as BookingStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        {date && <button className="btn sec" onClick={() => setDate('')}>Limpar dia</button>}
      </div>
      {list.error && <p className="err">{list.error}</p>}
      <div className="card">
        {list.data && list.data.length === 0 ? <p className="muted">Nenhum pedido com esses filtros.</p> : (
          <table>
            <thead><tr><th>Código</th><th>Data</th><th>Serviço</th><th>Profissional</th><th>Cliente</th><th>Total</th><th>Estado</th></tr></thead>
            <tbody>
              {list.data?.map((b) => (
                <tr key={b.id}>
                  <td><b>{b.code}</b></td>
                  <td>{new Date(Date.parse(b.starts_at) - 3 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('/')} {timeSP(b.starts_at)}</td>
                  <td>{b.category}</td><td>{b.professional_name}</td><td>{b.client_name}</td><td>{formatBRL(b.total_cents)}</td><td><StatusBadge status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
