'use client';

import { useState } from 'react';
import { categoryName, formatBRL } from '../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { DayPicker, StatusBadge, useLoad } from '@/components/ui';
import { dayLabel, timeSP, today } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function Dashboard() {
  const { api } = useSession();
  const [day, setDay] = useState(today());
  const ov = useLoad(() => api.adminOverview(day), [api, day]);
  const list = useLoad(() => api.adminBookings({ date: day, limit: 100 }), [api, day]);

  const by = ov.data?.by_status ?? {};
  const count = (...s: (keyof typeof by)[]) => s.reduce((n, k) => n + (by[k] ?? 0), 0);
  return (
    <Shell title="Painel ao vivo" subtitle={dayLabel(day)}>
      <DayPicker day={day} onChange={setDay} />
      {(ov.error || list.error) && <p className="err">{ov.error ?? list.error}</p>}
      <div className="kpis">
        <div className="card kpi"><div className="l">Pedidos no dia</div><div className="v">{ov.data?.total ?? '–'}</div></div>
        <div className="card kpi"><div className="l">Aguardando aceite</div><div className="v">{ov.data ? count('requested') : '–'}</div></div>
        <div className="card kpi"><div className="l">Aceitos ou em andamento</div><div className="v">{ov.data ? count('accepted', 'en_route', 'in_progress') : '–'}</div></div>
        <div className={`card kpi ${ov.data?.late_without_checkin ? 'bad' : ''}`}><div className="l">Sem check-in (atraso)</div><div className="v">{ov.data?.late_without_checkin ?? '–'}</div></div>
        <div className="card kpi"><div className="l">Cadastros para verificar</div><div className="v">{ov.data?.kyc_pending ?? '–'}</div></div>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Pedidos do dia</h2>
        {list.data && list.data.length === 0 && <p className="muted">Nenhum pedido neste dia.</p>}
        {list.data && list.data.length > 0 && (
          <table>
            <thead><tr><th>Código</th><th>Serviço</th><th>Profissional</th><th>Cliente</th><th>Horário</th><th>Total</th><th>Estado</th></tr></thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id}>
                  <td><b>{b.code}</b></td><td>{categoryName(b.category)}</td><td>{b.professional_name}{b.attempt > 1 ? ` · tentativa ${b.attempt}` : ''}</td>
                  <td>{b.client_name}</td><td>{timeSP(b.starts_at)}–{timeSP(b.ends_at)}</td><td>{formatBRL(b.total_cents)}</td><td><StatusBadge status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
