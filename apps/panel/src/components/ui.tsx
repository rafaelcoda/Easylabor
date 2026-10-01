'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { STATUS_LABEL, errorMessage, type BookingStatus } from '../../../../packages/client/src';
import { toneOf } from '@/lib/format';

export const StatusBadge = ({ status }: { status: BookingStatus }) => (
  <span className={`badge ${toneOf(status)}`}>{STATUS_LABEL[status]}</span>
);

/** Carrega dados e recarrega sozinho (padrão: a cada 30 s). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], everyMs = 30_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const load = useCallback(() => {
    run().then((d) => { setData(d); setError(null); }, (e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, [run]);
  useEffect(() => {
    setLoading(true);
    load();
    if (!everyMs) return;
    const t = setInterval(load, everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { data, error, loading, reload: load };
}

export function DayPicker({ day, onChange, label }: { day: string; onChange: (d: string) => void; label?: string }) {
  return (
    <label className="row muted" style={{ marginBottom: 16 }}>
      {label ?? 'Dia'}
      <input type="date" value={day} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  );
}

export type Tone = 'ok' | 'wait' | 'bad' | 'done';
export const Badge = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;

/** Filtro em forma de pílula, com contagem. */
export function Chip({ label, count, on, onClick }: { label: string; count?: number; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`chip ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      {label}{count !== undefined && <span className="n">{count}</span>}
    </button>
  );
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
      <span className="muted">{from}–{to} de {total}</span>
      <span className="row">
        <button className="btn sec" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Anterior</button>
        <button className="btn sec" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Próxima</button>
      </span>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn sec" onClick={onClose} aria-label="Fechar">Fechar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Lista "campo: valor" para as telas de detalhe. */
export const Facts = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="facts">
    {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v ?? '–'}</dd></div>))}
  </dl>
);
