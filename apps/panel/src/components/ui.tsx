'use client';

import { useCallback, useEffect, useState } from 'react';
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
