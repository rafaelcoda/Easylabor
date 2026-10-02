'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  LEVEL_LABEL, ACCOUNT_STATUS_LABEL, COLLABORATOR_STATUS_LABEL, categoryName, errorMessage, formatBRL,
  type AdminProfessionalRow, type KycFilter,
} from '../../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { Badge, Chip, Modal, Pager, useDebounced, useLoad } from '@/components/ui';
import { dateBR, dateOnlyBR, phoneBR } from '@/lib/format';
import { useSession } from '@/lib/session';
import { proState } from '@/lib/status';

type View = '' | KycFilter | 'suspended' | 'prereg' | 'base';
const LIMIT = 25;

export default function Profissionais() {
  const { api, state } = useSession();
  const router = useRouter();
  const owner = state.status === 'ready' && state.me.admin_level === 'owner';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [view, setView] = useState<View>('');
  const [visible, setVisible] = useState<'' | 'true' | 'false'>('');
  const [service, setService] = useState('');
  const [origin, setOrigin] = useState<'' | 'protheus' | 'direct'>('');
  const [offset, setOffset] = useState(0);
  const cats = useLoad(() => api.categories(), [api], 0);
  const list = useLoad(
    () => api.adminProfessionals({
      q: dq || undefined,
      kyc: view && view !== 'suspended' && view !== 'prereg' && view !== 'base' ? view : undefined,
      status: view === 'suspended' ? 'suspended' : undefined,
      view: view === 'prereg' || view === 'base' ? view : undefined,
      visible: visible === '' ? undefined : visible === 'true',
      service: service || undefined, origin: origin || undefined, limit: LIMIT, offset,
    }),
    [api, dq, view, visible, service, origin, offset],
  );
  const s = list.data?.summary;
  const pick = (v: View) => () => { setView(v); setOffset(0); };
  const onlyCollaborators = view === 'prereg' || view === 'base';

  const [inviting, setInviting] = useState<AdminProfessionalRow | null>(null);
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openInvite = (r: AdminProfessionalRow) => { setInviting(r); setPhone(r.collaborator?.link_phone ?? ''); setMsg(null); };
  const invite = async () => {
    if (!inviting) return;
    if (phone.replace(/\D/g, '').length < 10) return setMsg('Informe o celular com DDD, por exemplo (27) 99999-0000.');
    setBusy(true); setMsg(null);
    try { await api.linkCollaborator(inviting.id, phone.trim()); setInviting(null); list.reload(); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(false); }
  };
  const cancel = async (r: AdminProfessionalRow) => {
    if (!window.confirm(`Cancelar o convite de ${r.full_name}? O celular reservado fica livre.`)) return;
    try { await api.unlinkCollaborator(r.id); list.reload(); } catch (e) { setMsg(errorMessage(e)); }
  };

  const stateOf = (r: AdminProfessionalRow) => {
    if (r.kind === 'professional') return proState(r);
    return r.collaborator?.link_state === 'waiting' ? { tone: 'wait' as const, label: 'Aguardando 1º acesso' } : { tone: 'done' as const, label: 'Na base Protheus' };
  };

  return (
    <Shell title="Profissionais" subtitle="Quem atende na plataforma: cadastro, verificação, desempenho, conta e dados do Protheus">
      <div className="filters">
        <Chip label="Todos" count={s?.total} on={view === ''} onClick={pick('')} />
        <Chip label="Aguardando verificação" count={s?.pending} on={view === 'pending'} onClick={pick('pending')} />
        <Chip label="Aprovados" count={s?.approved} on={view === 'approved'} onClick={pick('approved')} />
        <Chip label="Reprovados" count={s?.rejected} on={view === 'rejected'} onClick={pick('rejected')} />
        <Chip label="Cadastro incompleto" count={s?.incomplete} on={view === 'incomplete'} onClick={pick('incomplete')} />
        <Chip label="Suspensos" count={s?.suspended} on={view === 'suspended'} onClick={pick('suspended')} />
        <Chip label="Aguardando 1º acesso" count={s?.prereg} on={view === 'prereg'} onClick={pick('prereg')} />
        <Chip label="Base Protheus" count={s?.base} on={view === 'base'} onClick={pick('base')} />
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Nome, telefone ou matrícula" aria-label="Buscar por nome, telefone ou matrícula" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        <select aria-label="Origem" value={origin} onChange={(e) => { setOrigin(e.target.value as '' | 'protheus' | 'direct'); setOffset(0); }} disabled={onlyCollaborators}>
          <option value="">Todas as origens</option><option value="protheus">Colaboradores (Protheus)</option><option value="direct">Cadastro direto</option>
        </select>
        <select aria-label="Serviço" value={service} onChange={(e) => { setService(e.target.value); setOffset(0); }} disabled={onlyCollaborators}>
          <option value="">Todos os serviços</option>
          {cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <select aria-label="Na busca dos clientes" value={visible} onChange={(e) => { setVisible(e.target.value as '' | 'true' | 'false'); setOffset(0); }} disabled={onlyCollaborators}>
          <option value="">Visíveis e ocultos</option><option value="true">Visíveis na busca</option><option value="false">Ocultos da busca</option>
        </select>
        {s && <span className="muted">{s.visible} visíveis na busca agora · {s.from_protheus} vêm do Protheus</span>}
      </div>
      {view === 'base' && <div className="notice">Colaboradores do Protheus que ainda não foram convidados. Convide quem deve atuar na plataforma: ao entrar no app com o celular informado, a pessoa vira profissional com os dados do Protheus já ligados.</div>}
      {(list.error || (msg && !inviting)) && <p className="err">{list.error ?? msg}</p>}

      <div className="card scroll">
        {list.data && list.data.items.length === 0 && <p className="muted">{view === 'base' ? 'Nenhum colaborador disponível para convite.' : 'Nenhum profissional com esses filtros.'}</p>}
        {list.data && list.data.items.length > 0 && (
          <table>
            <thead><tr><th>Profissional</th><th>Protheus</th>{!onlyCollaborators && <><th>Serviços</th><th>Nota</th><th>Concluídos</th></>}<th>Estado</th><th>{onlyCollaborators ? 'Na base desde' : 'Cadastro'}</th><th></th></tr></thead>
            <tbody>
              {list.data.items.map((r) => {
                const st = stateOf(r);
                const isPro = r.kind === 'professional';
                return (
                  <tr key={`${r.kind}-${r.id}`} className={isPro ? 'click' : ''} onClick={isPro ? () => router.push(`/profissional/?id=${r.id}`) : undefined}>
                    <td>
                      {isPro ? <Link className="plain" href={`/profissional/?id=${r.id}`} onClick={(e) => e.stopPropagation()}>{r.full_name}</Link> : <b>{r.full_name}</b>}
                      {r.phone ? <div className="sub-line nowrap">{phoneBR(r.phone)}</div> : <div className="sub-line">sem celular informado</div>}
                    </td>
                    <td>
                      {r.collaborator ? (
                        <>
                          <div>{r.collaborator.role ?? '–'}</div>
                          <div className="sub-line">{[r.collaborator.contract, r.collaborator.register && `mat. ${r.collaborator.register}`].filter(Boolean).join(' · ')}</div>
                          {r.collaborator.status !== 'ACTIVE' && <div className="sub-line">{COLLABORATOR_STATUS_LABEL[r.collaborator.status] ?? r.collaborator.status}</div>}
                          {r.collaborator.hired_on && !isPro && <div className="sub-line">admitido em {dateOnlyBR(r.collaborator.hired_on)}</div>}
                        </>
                      ) : <span className="muted">Cadastro direto</span>}
                    </td>
                    {!onlyCollaborators && (<>
                    <td>{isPro ? <div className="tags">{r.offers.length === 0 ? <span className="muted">–</span> : r.offers.map((o) => <span key={o.category} className="tag">{categoryName(o.category)} · {formatBRL(o.rate_cents)}</span>)}</div> : <span className="muted">–</span>}</td>
                    <td>{!isPro ? <span className="muted">–</span> : r.rating_count > 0 ? <>★ {r.rating_avg.toFixed(1).replace('.', ',')} ({r.rating_count})<div className="sub-line">{r.level ? LEVEL_LABEL[r.level] ?? r.level : ''}</div></> : <span className="muted">Novo</span>}</td>
                    <td>{isPro ? <>{r.completed_count}<div className="sub-line">{r.bookings_total} pedidos</div></> : <span className="muted">–</span>}</td>
                    </>)}
                    <td>
                      <Badge tone={st.tone}>{st.label}</Badge>{r.status === 'deleted' && <div className="sub-line">{ACCOUNT_STATUS_LABEL.deleted}</div>}
                      {isPro && (r.visible ? <div className="sub-line">Visível na busca</div> : <div className="sub-line">Oculto da busca</div>)}
                      {isPro && r.active_strikes > 0 && <div style={{ marginTop: 4 }}><Badge tone="bad">{r.active_strikes} {r.active_strikes === 1 ? 'advertência' : 'advertências'}</Badge></div>}
                    </td>
                    <td>{dateBR(r.created_at)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {owner && !isPro && r.collaborator?.link_state === 'none' && <button className="btn sm" onClick={() => openInvite(r)}>Convidar</button>}
                      {owner && !isPro && r.collaborator?.link_state === 'waiting' && (
                        <span className="row" style={{ justifyContent: 'flex-end', flexDirection: 'column', alignItems: 'stretch' }}>
                          <button className="btn sec sm" onClick={() => openInvite(r)}>Trocar celular</button>
                          <button className="btn warn sm" onClick={() => cancel(r)}>Cancelar convite</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {list.data && <Pager total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
      </div>

      {inviting && (
        <Modal title={`Convidar ${inviting.full_name}`} onClose={() => setInviting(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Informe o celular da pessoa. Quando ela se cadastrar como <b>profissional</b> no app com este número, ela já entra ligada ao registro do Protheus. Se já tiver conta de profissional, o vínculo é imediato.</p>
          <label className="field" htmlFor="cp">Celular com DDD</label>
          <input id="cp" value={phone} inputMode="tel" placeholder="(27) 99999-0000" autoFocus onChange={(e) => setPhone(e.target.value)} />
          <div className="notice" style={{ marginTop: 14 }}>Use o celular <b>real</b> da pessoa: quem receber o código por SMS desse número entra como este colaborador.</div>
          {msg && <p className="err">{msg}</p>}
          <div className="actions" style={{ marginTop: 8 }}><button className="btn" disabled={busy} onClick={invite}>Convidar</button><button className="btn sec" onClick={() => setInviting(null)}>Cancelar</button></div>
        </Modal>
      )}
    </Shell>
  );
}
