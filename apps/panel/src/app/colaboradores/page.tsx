'use client';

import { useState } from 'react';
import {
  COLLABORATOR_STATUS_LABEL, SYNC_STATUS_LABEL, errorMessage,
  type CollaboratorRow, type CollaboratorView, type SyncRun,
} from '../../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { Badge, Chip, Modal, Pager, useDebounced, useLoad, type Tone } from '@/components/ui';
import { dateOnlyBR, dateTimeBR, phoneBR } from '@/lib/format';
import { useSession } from '@/lib/session';

const LIMIT = 25;
const statusTone = (s: string): Tone => (s === 'ACTIVE' ? 'ok' : s === 'FIRED' || s === 'INACTIVE' ? 'bad' : 'wait');
const runTone = (s: SyncRun['status']): Tone => (s === 'ok' ? 'ok' : s === 'error' ? 'bad' : 'wait');

function SyncCard({ configured, last, owner, onChanged }: { configured: boolean; last: SyncRun | null; owner: boolean; onChanged: () => void }) {
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

export default function Colaboradores() {
  const { api, state } = useSession();
  const owner = state.status === 'ready' && state.me.admin_level === 'owner';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [view, setView] = useState<'' | CollaboratorView>('');
  const [status, setStatus] = useState('');
  const [contract, setContract] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useLoad(
    () => api.adminCollaborators({ q: dq || undefined, view: view || undefined, status: status || undefined, contract: contract || undefined, limit: LIMIT, offset }),
    [api, dq, view, status, contract, offset],
  );
  const s = list.data?.summary;
  const pick = (v: '' | CollaboratorView) => () => { setView(v); setOffset(0); };

  const [linking, setLinking] = useState<CollaboratorRow | null>(null);
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (c: CollaboratorRow) => { setLinking(c); setPhone(''); setMsg(null); };
  const save = async () => {
    if (!linking) return;
    if (phone.replace(/\D/g, '').length < 10) return setMsg('Informe o celular com DDD, por exemplo (27) 99999-0000.');
    setBusy(true); setMsg(null);
    try { await api.linkCollaborator(linking.id, phone.trim()); setLinking(null); list.reload(); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(false); }
  };
  const unlink = async (c: CollaboratorRow) => {
    if (!window.confirm(`Remover o vínculo de ${c.name}? ${c.link.state === 'linked' ? 'A conta de profissional continua existindo, mas deixa de ser ligada a este colaborador.' : 'O celular reservado fica livre.'}`)) return;
    try { await api.unlinkCollaborator(c.id); list.reload(); } catch (e) { setMsg(errorMessage(e)); }
  };

  return (
    <Shell title="Colaboradores" subtitle="Quem vem do Protheus (Easy365) e quem já virou profissional na plataforma">
      {list.data && <SyncCard configured={list.data.sync.configured} last={list.data.sync.last} owner={owner} onChanged={list.reload} />}

      <div className="filters">
        <Chip label="Todos" count={s?.total} on={view === ''} onClick={pick('')} />
        <Chip label="Sem vínculo" count={s ? s.total - s.linked - s.waiting : undefined} on={view === 'unlinked'} onClick={pick('unlinked')} />
        <Chip label="Aguardando cadastro" count={s?.waiting} on={view === 'waiting'} onClick={pick('waiting')} />
        <Chip label="Vinculados" count={s?.linked} on={view === 'linked'} onClick={pick('linked')} />
        <Chip label="Saíram da base" count={s?.missing} on={view === 'missing'} onClick={pick('missing')} />
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Nome ou matrícula" aria-label="Buscar por nome ou matrícula" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        <select aria-label="Situação" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">Todas as situações</option>
          {list.data?.statuses.map((x) => <option key={x.status} value={x.status}>{COLLABORATOR_STATUS_LABEL[x.status] ?? x.status} ({x.count})</option>)}
        </select>
        <select aria-label="Contrato" value={contract} onChange={(e) => { setContract(e.target.value); setOffset(0); }}>
          <option value="">Todos os contratos</option>
          {list.data?.contracts.map((x) => <option key={x.id} value={x.id}>{x.name ?? x.id} ({x.count})</option>)}
        </select>
      </div>
      {(list.error || (msg && !linking)) && <p className="err">{list.error ?? msg}</p>}

      <div className="card">
        {list.data && list.data.items.length === 0 && <p className="muted">{list.data.summary.total === 0 ? 'Nenhum colaborador carregado ainda. A primeira carga cria a lista.' : 'Nenhum colaborador com esses filtros.'}</p>}
        {list.data && list.data.items.length > 0 && (
          <table>
            <thead><tr><th>Colaborador</th><th>Contrato</th><th>Cargo</th><th>Turno</th><th>Admissão</th><th>Situação</th><th>Vínculo</th><th></th></tr></thead>
            <tbody>
              {list.data.items.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b><div className="sub-line nowrap">Matrícula {c.register ?? '–'}</div></td>
                  <td>{c.contract.name ?? c.contract.id ?? '–'}{c.contract.branch && <div className="sub-line">filial {c.contract.branch}</div>}</td>
                  <td>{c.role_title ?? '–'}{c.position_title && <div className="sub-line">{c.position_title}</div>}</td>
                  <td>{c.work_shift.label ?? '–'}{c.work_shift.notation_rule && <div className="sub-line">{c.work_shift.notation_rule}</div>}</td>
                  <td>{c.hired_on ? dateOnlyBR(c.hired_on) : c.hired_at ?? '–'}</td>
                  <td><Badge tone={statusTone(c.status)}>{COLLABORATOR_STATUS_LABEL[c.status] ?? c.status}</Badge>{c.missing_since && <div className="sub-line">saiu da base em {dateOnlyBR(c.missing_since)}</div>}</td>
                  <td>
                    {c.link.state === 'linked' && <><Badge tone="ok">Vinculado</Badge><div className="sub-line">{c.link.user_name}</div></>}
                    {c.link.state === 'waiting' && <><Badge tone="wait">Aguardando cadastro</Badge><div className="sub-line nowrap">{c.link.phone ? phoneBR(c.link.phone) : ''}</div></>}
                    {c.link.state === 'none' && <span className="muted">Sem vínculo</span>}
                  </td>
                  <td>{owner && (
                    <span className="row" style={{ justifyContent: 'flex-end' }}>
                      {c.link.state === 'none' && (c.status === 'FIRED' || c.status === 'INACTIVE' || c.missing_since ? <span className="muted">Não pode vincular</span> : <button className="btn sec" onClick={() => open(c)}>Vincular celular</button>)}
                      {c.link.state === 'waiting' && <button className="btn sec" onClick={() => open(c)}>Trocar celular</button>}
                      {c.link.state !== 'none' && <button className="btn warn" onClick={() => unlink(c)}>Desvincular</button>}
                    </span>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.data && <Pager total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
        <p className="hint">Salário e ficha médica vêm do Protheus, mas ficam guardados à parte e não aparecem em nenhuma tela.</p>
      </div>

      {linking && (
        <Modal title={`Vincular ${linking.name}`} onClose={() => setLinking(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Informe o celular da pessoa. Quando ela se cadastrar como <b>profissional</b> no app com este número, o vínculo é feito sozinho. Se ela já tem conta de profissional, o vínculo é imediato.</p>
          <label className="field" htmlFor="cp">Celular com DDD</label>
          <input id="cp" value={phone} inputMode="tel" placeholder="(27) 99999-0000" autoFocus onChange={(e) => setPhone(e.target.value)} />
          <div className="notice" style={{ marginTop: 14 }}>Use o celular <b>real</b> da pessoa: quem receber o código por SMS desse número entra como este colaborador.</div>
          {msg && <p className="err">{msg}</p>}
          <div className="actions" style={{ marginTop: 8 }}><button className="btn" disabled={busy} onClick={save}>Vincular</button><button className="btn sec" onClick={() => setLinking(null)}>Cancelar</button></div>
        </Modal>
      )}
    </Shell>
  );
}
