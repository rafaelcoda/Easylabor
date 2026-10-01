'use client';

import { useState } from 'react';
import { LEVEL_HELP, LEVEL_NAME, errorMessage, type AdminLevel, type TeamInvite, type TeamMember } from '../../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { Badge, Modal, useLoad } from '@/components/ui';
import { dateBR, dateTimeBR, phoneBR } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function Equipe() {
  const { api } = useSession();
  const t = useLoad(() => api.adminTeam(), [api]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', level: 'operator' as AdminLevel });
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [sent, setSent] = useState<{ phone: string; expires: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const owner = t.data?.me.level === 'owner';
  const myId = t.data?.me.id;
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setMsg(null);
    try { await fn(); t.reload(); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(null); }
  };

  const send = async () => {
    if (form.name.trim().length < 3) return setFormMsg('Informe o nome da pessoa.');
    if (form.phone.replace(/\D/g, '').length < 10) return setFormMsg('Informe o telefone com DDD, por exemplo (27) 99999-0000.');
    setBusy('invite'); setFormMsg(null);
    try {
      const r = await api.inviteMember({ full_name: form.name.trim(), phone: form.phone.trim(), level: form.level });
      setSent({ phone: r.phone, expires: r.expires_at }); t.reload();
    } catch (e) { setFormMsg(errorMessage(e)); } finally { setBusy(null); }
  };
  const openInvite = () => { setForm({ name: '', phone: '', level: 'operator' }); setFormMsg(null); setSent(null); setCopied(false); setInviting(true); };
  const link = typeof window === 'undefined' ? '' : window.location.origin;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } };

  const row = (m: TeamMember) => {
    const me = m.id === myId;
    return (
      <tr key={m.id}>
        <td><b>{m.full_name}</b>{me && <span className="pill-custom" style={{ background: '#e6f5fb', color: '#1f6aae' }}>você</span>}<div className="sub-line nowrap">{phoneBR(m.phone)}</div></td>
        <td><Badge tone={m.level === 'owner' ? 'done' : 'wait'}>{LEVEL_NAME[m.level]}</Badge></td>
        <td>{m.status === 'active' ? <Badge tone="ok">Ativo</Badge> : <Badge tone="bad">Desativado</Badge>}</td>
        <td>{dateBR(m.created_at)}</td>
        <td>{m.actions_30d}</td>
        <td>{m.last_action ? dateTimeBR(m.last_action) : <span className="muted">–</span>}</td>
        <td>{owner && !me && (
          <span className="row" style={{ justifyContent: 'flex-end' }}>
            {m.status === 'active' && <button className="btn sec" disabled={busy !== null} onClick={() => act(`l${m.id}`, () => api.setMemberLevel(m.id, m.level === 'owner' ? 'operator' : 'owner'))}>{m.level === 'owner' ? 'Tornar operador' : 'Tornar administrador'}</button>}
            {m.status === 'active'
              ? <button className="btn bad" disabled={busy !== null} onClick={() => { if (window.confirm(`Desativar o acesso de ${m.full_name}? A pessoa deixa de entrar no painel.`)) void act(`d${m.id}`, () => api.deactivateMember(m.id)); }}>Desativar</button>
              : <button className="btn" disabled={busy !== null} onClick={() => act(`r${m.id}`, () => api.reactivateMember(m.id))}>Reativar</button>}
          </span>
        )}</td>
      </tr>
    );
  };
  const inviteRow = (i: TeamInvite) => (
    <tr key={i.id}>
      <td><b>{i.full_name}</b><div className="sub-line nowrap">{phoneBR(i.phone)}</div></td>
      <td><Badge tone={i.level === 'owner' ? 'done' : 'wait'}>{LEVEL_NAME[i.level]}</Badge></td>
      <td>{i.invited_by_name}<div className="sub-line">em {dateBR(i.created_at)}</div></td>
      <td>{i.expired ? <Badge tone="bad">Vencido</Badge> : <>até {dateBR(i.expires_at)}</>}</td>
      <td>{owner && <span className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sec" disabled={busy !== null} onClick={() => act(`i${i.id}`, () => api.revokeInvite(i.id))}>Cancelar convite</button></span>}</td>
    </tr>
  );

  return (
    <Shell title="Equipe da operação" subtitle="Quem tem acesso a este painel e o que cada pessoa pode fazer">
      {t.error && <p className="err">{t.error}</p>}
      {msg && <p className="err">{msg}</p>}
      <div className="grid2">
        {(['owner', 'operator'] as AdminLevel[]).map((l) => (
          <div key={l} className="card"><div className="row"><Badge tone={l === 'owner' ? 'done' : 'wait'}>{LEVEL_NAME[l]}</Badge></div><p className="muted" style={{ marginBottom: 0 }}>{LEVEL_HELP[l]}</p></div>
        ))}
      </div>

      <div className="head-row">
        <h2 style={{ margin: 0 }}>Membros</h2>
        {owner ? <button className="btn" onClick={openInvite}>Convidar pessoa</button> : t.data && <span className="muted">Somente administradores convidam ou alteram acessos.</span>}
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        <table>
          <thead><tr><th>Pessoa</th><th>Nível</th><th>Acesso</th><th>Na equipe desde</th><th>Ações em 30 dias</th><th>Última ação</th><th></th></tr></thead>
          <tbody>{t.data?.members.map(row)}</tbody>
        </table>
        <p className="hint">“Ações” são as mudanças feitas no painel (verificar, suspender, alterar parâmetros…). Consultar telas não conta.</p>
      </div>

      {t.data && t.data.invites.length > 0 && (
        <>
          <h2 style={{ margin: '0 0 10px' }}>Convites em aberto</h2>
          <div className="card">
            <table>
              <thead><tr><th>Pessoa</th><th>Nível</th><th>Convidado por</th><th>Validade</th><th></th></tr></thead>
              <tbody>{t.data.invites.map(inviteRow)}</tbody>
            </table>
            <p className="hint">O acesso é criado quando a pessoa entra no painel com o telefone convidado.</p>
          </div>
        </>
      )}

      {inviting && (
        <Modal title={sent ? 'Convite criado' : 'Convidar pessoa'} onClose={() => setInviting(false)}>
          {sent ? (
            <>
              <p style={{ marginTop: 0 }}>Convite criado para <b>{phoneBR(sent.phone)}</b>, válido até <b>{dateBR(sent.expires)}</b>.</p>
              <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
                <li>Envie este endereço à pessoa: <b>{link}</b></li>
                <li>Ela entra com este telefone e o código recebido por SMS.</li>
                <li>O acesso é liberado na hora, com o nível escolhido.</li>
              </ol>
              <div className="actions"><button className="btn" onClick={copy}>{copied ? 'Endereço copiado' : 'Copiar endereço'}</button><button className="btn sec" onClick={() => setInviting(false)}>Concluir</button></div>
            </>
          ) : (
            <>
              <label className="field" htmlFor="tn">Nome completo</label>
              <input id="tn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              <label className="field" htmlFor="tp">Telefone com DDD</label>
              <input id="tp" value={form.phone} inputMode="tel" placeholder="(27) 99999-0000" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <label className="field" htmlFor="tl">Nível de acesso</label>
              <select id="tl" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as AdminLevel })}>
                <option value="operator">Operador</option><option value="owner">Administrador</option>
              </select>
              <div className="hint">{LEVEL_HELP[form.level]}</div>
              <div className="notice" style={{ marginTop: 14 }}>Use o telefone <b>real</b> da pessoa: quem receber o código por SMS desse número entra com o nível escolhido. O convite vale por 7 dias.</div>
              {formMsg && <p className="err">{formMsg}</p>}
              <div className="actions" style={{ marginTop: 8 }}><button className="btn" disabled={busy === 'invite'} onClick={send}>Criar convite</button><button className="btn sec" onClick={() => setInviting(false)}>Cancelar</button></div>
            </>
          )}
        </Modal>
      )}
    </Shell>
  );
}
