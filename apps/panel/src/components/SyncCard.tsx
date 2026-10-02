'use client';

import { useState } from 'react';
import { SYNC_STATUS_LABEL, errorMessage, type SyncRun } from '../../../../packages/client/src';
import { dateTimeBR } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, useLoad, type Tone } from './ui';

const runTone = (s: SyncRun['status']): Tone => (s === 'ok' ? 'ok' : s === 'error' ? 'bad' : 'wait');

export function SyncCard({ configured, last, owner, onChanged }: { configured: boolean; last: SyncRun | null; owner: boolean; onChanged: () => void }) {
  const { api } = useSession();
  const runs = useLoad(() => api.collaboratorSyncRuns(), [api]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const active = last && (last.status === 'queued' || last.status === 'running' || last.status === 'partial');

  const ask = async () => {
    setBusy(true); setMsg(null);
    try { await api.requestCollaboratorSync(); setMsg('Carga na fila. Ela começa na próxima rodada automática (até 5 minutos).'); runs.reload(); onChanged(); }
    catch (e) { setMsg(errorMessage(e)); } finally { setBusy(false); }
  };

  if (!configured) {
    return (
      <div className="notice">
        <b>Integração com a Easy365 ainda não configurada.</b> No Netlify (site da API), cadastre as variáveis secretas <code>EASY365_CLIENT_ID</code> e <code>EASY365_CLIENT_SECRET</code> e publique de novo. A carga diária começa sozinha depois disso.
      </div>
    );
  }
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="head-row" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Carga do Protheus</h2>
          <div className="muted">Automática, todos os dias a partir das 03h (horário de São Paulo).</div>
        </div>
        <div className="actions">
          <button className="btn sec" onClick={() => setOpen((v) => !v)}>{open ? 'Esconder histórico' : 'Ver histórico'}</button>
          {owner && <button className="btn" disabled={busy || Boolean(active)} onClick={ask}>{active ? 'Carga em andamento' : 'Sincronizar agora'}</button>}
        </div>
      </div>
      {msg && <p className="hint" style={{ marginTop: 0 }}>{msg}</p>}
      {!last ? <p className="muted">Nenhuma carga feita ainda.</p> : (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
            <Badge tone={runTone(last.status)}>{SYNC_STATUS_LABEL[last.status]}</Badge>
            <span className="muted">{last.finished_at ? `terminou em ${dateTimeBR(last.finished_at)}` : `pedida em ${dateTimeBR(last.created_at)}`} · {last.trigger === 'manual' ? `manual${last.requested_by_name ? `, por ${last.requested_by_name}` : ''}` : 'automática'}</span>
          </div>
          <div className="kpis" style={{ marginTop: 12, marginBottom: 0 }}>
            {([['Lidos', last.fetched], ['Novos', last.created], ['Atualizados', last.updated], ['Sem mudança', last.unchanged], ['Saíram da base', last.missing]] as const).map(([l, v]) => (
              <div key={l} className="card kpi"><div className="l">{l}</div><div className="v">{v}</div></div>
            ))}
          </div>
          {last.status === 'error' && last.error && <div className="notice" style={{ marginTop: 12, marginBottom: 0, background: '#fdebe8', borderColor: '#f3c1b8' }}><b>Erro na última carga:</b> {last.error}</div>}
        </>
      )}
      {open && (
        <table style={{ marginTop: 14 }}>
          <thead><tr><th>Quando</th><th>Origem</th><th>Resultado</th><th>Lidos</th><th>Novos</th><th>Atual.</th><th>Saíram</th><th>Detalhe</th></tr></thead>
          <tbody>
            {runs.data?.map((r) => (
              <tr key={r.id}>
                <td>{dateTimeBR(r.created_at)}</td><td>{r.trigger === 'manual' ? 'Manual' : 'Automática'}</td>
                <td><Badge tone={runTone(r.status)}>{SYNC_STATUS_LABEL[r.status].split(' (')[0]}</Badge></td>
                <td>{r.fetched}</td><td>{r.created}</td><td>{r.updated}</td><td>{r.missing}</td>
                <td className="diff">{r.error ?? (r.pagination ? `paginação: ${r.pagination}` : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

