'use client';

import { useState } from 'react';
import { Shell } from '@/components/Shell';
import { DayPicker, useLoad } from '@/components/ui';
import { dayLabel, hoursInDay, timeSP, today } from '@/lib/format';
import { toneOf } from '@/lib/format';
import { STATUS_LABEL, type ScheduleSlot } from '../../../../../packages/client/src';
import { useSession } from '@/lib/session';

const START = 6;
const END = 20;
const SPAN = END - START;

function Bar({ s, day, label }: { s: ScheduleSlot; day: string; label?: string }) {
  const from = Math.max(hoursInDay(s.starts_at, day), START);
  const to = Math.min(hoursInDay(s.ends_at, day), END);
  if (to <= from) return null;
  return (
    <div
      className={`bar ${toneOf(s.status)}`}
      style={{ left: `${((from - START) / SPAN) * 100}%`, width: `${((to - from) / SPAN) * 100}%` }}
      title={`${s.code} · ${STATUS_LABEL[s.status]} · ${timeSP(s.starts_at)}–${timeSP(s.ends_at)}`}
    >
      {s.code} · {STATUS_LABEL[s.status]}
    </div>
  );
}

export default function Agenda() {
  const { api } = useSession();
  const [day, setDay] = useState(today());
  const sc = useLoad(() => api.adminSchedule(day), [api, day]);
  const nowH = day === today() ? hoursInDay(new Date().toISOString(), day) : null;
  const hours = Array.from({ length: SPAN }, (_, i) => START + i);

  return (
    <Shell title="Agenda" subtitle={`Solicitações x atendimento · ${dayLabel(day)}`}>
      <DayPicker day={day} onChange={setDay} />
      {sc.error && <p className="err">{sc.error}</p>}
      <div className="card">
        <div className="gantt">
          <div className="head"><div className="name muted">Profissional</div>
            <div className="row" style={{ flex: 1, gap: 0 }}>{hours.map((h) => <div key={h} className="hour">{String(h).padStart(2, '0')}:00</div>)}</div>
          </div>
          {sc.data?.professionals.length === 0 && <p className="muted">Nenhum profissional disponível ou com pedidos neste dia.</p>}
          {sc.data?.professionals.map((p) => (
            <div key={p.id} className="line">
              <div className="name">{p.name}{p.bookings.length === 0 && <div className="muted" style={{ fontWeight: 400, fontSize: 12 }}>livre</div>}</div>
              <div className="track">{p.bookings.map((b) => <Bar key={b.id} s={b} day={day} />)}
                {nowH !== null && nowH >= START && nowH <= END && <div className="now" style={{ left: `${((nowH - START) / SPAN) * 100}%` }} />}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 style={{ marginTop: 0 }}>Ofertas aguardando aceite</h2>
        {sc.data && sc.data.pending.length === 0 && <p className="muted">Nenhuma oferta pendente neste dia.</p>}
        {sc.data && sc.data.pending.length > 0 && (
          <table>
            <thead><tr><th>Código</th><th>Serviço</th><th>Horário</th><th>Oferta enviada a</th><th>Tentativa</th><th>Prazo</th></tr></thead>
            <tbody>
              {sc.data.pending.map((b) => (
                <tr key={b.id}>
                  <td><b>{b.code}</b></td><td>{b.category}</td><td>{timeSP(b.starts_at)}–{timeSP(b.ends_at)}</td>
                  <td>{b.professional_name}</td><td>{b.attempt} de 3</td><td>{b.accept_deadline_at ? timeSP(b.accept_deadline_at) : 'aguarda pagamento'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
