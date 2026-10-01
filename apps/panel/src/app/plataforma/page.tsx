'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  auditLabel, categoryName, errorMessage, formatBRL, formatSetting,
  type AdminCategory, type AdminSetting, type AuditItem, type PlatformOverview,
} from '../../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { Badge, Modal, useLoad } from '@/components/ui';
import { dateTimeBR, dayShort } from '@/lib/format';
import { useSession } from '@/lib/session';

type Tab = 'geral' | 'servicos' | 'parametros' | 'auditoria';

const reaisToCents = (t: string): number | null => {
  const v = t.trim().replace(/\./g, '').replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(parseFloat(v) * 100) : null;
};
const centsToText = (c: number) => (c / 100).toFixed(2).replace('.', ',');

// ------------------------------------------------------------------ visão geral
function Bars({ points, a, b, labelA, labelB }: { points: { day: string }[]; a: (i: number) => number; b?: (i: number) => number; labelA: string; labelB?: string }) {
  const max = Math.max(1, ...points.map((_, i) => a(i)));
  const none = points.every((_, i) => a(i) === 0);
  return (
    <>
      {none ? <div className="empty-chart">Sem dados neste período.</div> : (
        <div className="chart" role="img" aria-label={labelA}>
          {points.map((p, i) => (
            <div key={p.day} className="col" title={`${dayShort(p.day)}: ${a(i)} ${labelA.toLowerCase()}${b ? `, ${b(i)} ${labelB?.toLowerCase()}` : ''}`}>
              <div className="bar-total" style={{ height: `${(a(i) / max) * 100}%`, minHeight: a(i) > 0 ? 3 : 0 }}>
                {b && a(i) > 0 && <div className="bar-done" style={{ height: `${(b(i) / a(i)) * 100}%` }} />}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="axis"><span>{points[0] ? dayShort(points[0].day) : ''}</span><span>{points.at(-1) ? dayShort(points.at(-1)!.day) : ''}</span></div>
      <div className="legend"><span><i style={{ background: '#cfe3ef' }} />{labelA}</span>{b && <span><i style={{ background: '#1f6aae' }} />{labelB}</span>}</div>
    </>
  );
}

function Geral() {
  const { api } = useSession();
  const [days, setDays] = useState(30);
  const o = useLoad<PlatformOverview>(() => api.platformOverview(days), [api, days]);
  const d = o.data;
  const q = d?.queues;
  const queue = (label: string, n: number | undefined, href: string | null, alert = false) => {
    const inner = (<><div className="l">{label}</div><div className="v">{n ?? '–'}</div></>);
    const cls = `card kpi queue ${alert && n ? 'alert' : ''}`;
    return href ? <Link href={href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
  };
  return (
    <>
      <div className="toolbar">
        <label className="row muted">Período
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option>
          </select>
        </label>
        {o.error && <span className="err">{o.error}</span>}
      </div>

      <h2 style={{ margin: '4px 0 10px' }}>O que precisa de atenção</h2>
      <div className="kpis">
        {queue('Cadastros para verificar', q?.kyc_pending, '/verificacao/')}
        {queue('Serviços sem check-in (atraso)', q?.late_without_checkin, '/pedidos/', true)}
        {queue('Contestações abertas', q?.disputes_open, null, true)}
        {queue('Estornos pendentes', q?.refunds_pending, null)}
        {queue('Repasses em aberto', q?.payouts_open, null)}
      </div>

      <h2 style={{ margin: '18px 0 10px' }}>Números do período</h2>
      <div className="kpis">
        <div className="card kpi"><div className="l">Pedidos criados</div><div className="v">{d?.bookings.total ?? '–'}</div><div className="s">{d ? `${d.bookings.done} concluídos · ${d.bookings.lost} perdidos` : ''}</div></div>
        <div className="card kpi"><div className="l">Valor contratado</div><div className="v">{d ? formatBRL(d.bookings.gmv_cents) : '–'}</div><div className="s">serviços concluídos</div></div>
        <div className="card kpi"><div className="l">Receita da plataforma</div><div className="v">{d ? formatBRL(d.bookings.revenue_cents) : '–'}</div><div className="s">taxa de serviço + comissão (estimada)</div></div>
        <div className="card kpi"><div className="l">Clientes</div><div className="v">{d?.users.clients ?? '–'}</div></div>
        <div className="card kpi"><div className="l">Profissionais</div><div className="v">{d?.users.professionals ?? '–'}</div><div className="s">{d ? `${d.professionals.approved} aprovados · ${d.professionals.visible} visíveis` : ''}</div></div>
        <div className="card kpi"><div className="l">Contas suspensas</div><div className="v">{d?.users.suspended ?? '–'}</div></div>
      </div>

      <div className="grid2">
        <div className="card"><h2 style={{ marginTop: 0 }}>Pedidos por dia</h2>{d && <Bars points={d.bookings_by_day} a={(i) => d.bookings_by_day[i]!.total} b={(i) => d.bookings_by_day[i]!.done} labelA="Pedidos" labelB="Concluídos" />}</div>
        <div className="card"><h2 style={{ marginTop: 0 }}>Novos cadastros por dia</h2>{d && <Bars points={d.signups_by_day} a={(i) => d.signups_by_day[i]!.clients + d.signups_by_day[i]!.professionals} labelA="Clientes e profissionais" />}</div>
      </div>
      <p className="hint">O pagamento online ainda não está ativo: o valor contratado e a receita contam os pedidos concluídos, mesmo sem cobrança real.</p>
    </>
  );
}

// ------------------------------------------------------------------ serviços
function Servicos() {
  const { api, state } = useSession();
  const owner = state.status === 'ready' && state.me.admin_level === 'owner';
  const list = useLoad(() => api.adminCategories(), [api], 0);
  const [edit, setEdit] = useState<AdminCategory | 'novo' | null>(null);
  const [form, setForm] = useState({ slug: '', name: '', min: '', max: '', photos: '1', active: true });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (c: AdminCategory | 'novo') => {
    setMsg(null); setEdit(c);
    setForm(c === 'novo' ? { slug: '', name: '', min: '', max: '', photos: '1', active: true }
      : { slug: c.slug, name: c.name, min: centsToText(c.min_daily_rate_cents), max: centsToText(c.max_daily_rate_cents), photos: String(c.min_photos_checkout), active: c.active });
  };
  const save = async () => {
    const min = reaisToCents(form.min); const max = reaisToCents(form.max); const photos = Number(form.photos);
    if (min === null || max === null) return setMsg('Informe os valores da diária em reais, por exemplo 150,00.');
    if (max < min) return setMsg('O valor máximo não pode ser menor que o mínimo.');
    if (!Number.isInteger(photos) || photos < 0 || photos > 10) return setMsg('As fotos mínimas devem ser de 0 a 10.');
    setBusy(true); setMsg(null);
    try {
      if (edit === 'novo') await api.createCategory({ slug: form.slug.trim(), name: form.name.trim(), min_daily_rate_cents: min, max_daily_rate_cents: max, min_photos_checkout: photos });
      else if (edit) await api.updateCategory(edit.slug, { name: form.name.trim(), min_daily_rate_cents: min, max_daily_rate_cents: max, min_photos_checkout: photos, active: form.active });
      setEdit(null); list.reload();
    } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      {owner ? <div className="toolbar"><button className="btn" onClick={() => open('novo')}>Novo serviço</button></div> : <div className="notice">Somente administradores criam ou alteram serviços. Você pode consultar.</div>}
      {list.error && <p className="err">{list.error}</p>}
      <div className="card">
        <table>
          <thead><tr><th>Serviço</th><th>Faixa da diária</th><th>Fotos mínimas</th><th>Profissionais</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {list.data?.map((c) => (
              <tr key={c.slug}>
                <td><b>{c.name}</b><div className="sub-line">{c.slug}</div></td>
                <td>{formatBRL(c.min_daily_rate_cents)} a {formatBRL(c.max_daily_rate_cents)}</td>
                <td>{c.min_photos_checkout}</td><td>{c.professionals}</td>
                <td>{c.active ? <Badge tone="ok">Ativo</Badge> : <Badge tone="bad">Desativado</Badge>}</td>
                <td>{owner && <button className="btn sec" onClick={() => open(c)}>Editar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Mudar a faixa não altera os valores que os profissionais já cadastraram; vale para os próximos cadastros. Um serviço desativado deixa de aparecer para os clientes.</p>
      </div>

      {edit && (
        <Modal title={edit === 'novo' ? 'Novo serviço' : `Editar ${edit.name}`} onClose={() => setEdit(null)}>
          {edit === 'novo' && (<><label className="field" htmlFor="slug">Código (letras minúsculas, números e hífen)</label><input id="slug" value={form.slug} placeholder="ex.: jardineiro" onChange={(e) => setForm({ ...form, slug: e.target.value })} /></>)}
          <label className="field" htmlFor="nm">Nome</label><input id="nm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}><label className="field" htmlFor="mn">Diária mínima (R$)</label><input id="mn" value={form.min} inputMode="decimal" onChange={(e) => setForm({ ...form, min: e.target.value })} style={{ width: '100%' }} /></div>
            <div style={{ flex: 1 }}><label className="field" htmlFor="mx">Diária máxima (R$)</label><input id="mx" value={form.max} inputMode="decimal" onChange={(e) => setForm({ ...form, max: e.target.value })} style={{ width: '100%' }} /></div>
          </div>
          <label className="field" htmlFor="ph">Fotos mínimas ao encerrar o serviço</label><input id="ph" value={form.photos} inputMode="numeric" onChange={(e) => setForm({ ...form, photos: e.target.value })} />
          {edit !== 'novo' && (<label className="row" style={{ marginTop: 14 }}><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Serviço ativo (aparece para os clientes)</label>)}
          {msg && <p className="err">{msg}</p>}
          <div className="actions" style={{ marginTop: 16 }}><button className="btn" disabled={busy} onClick={save}>Salvar</button><button className="btn sec" onClick={() => setEdit(null)}>Cancelar</button></div>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ parâmetros
function Parametros() {
  const { api, state } = useSession();
  const owner = state.status === 'ready' && state.me.admin_level === 'owner';
  const list = useLoad(() => api.adminConfig(), [api], 0);
  const [edit, setEdit] = useState<AdminSetting | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = (s: AdminSetting, v: number) => (s.unit === 'bps' ? String(v / 100).replace('.', ',') : String(v));
  const open = (s: AdminSetting) => { setEdit(s); setText(shown(s, s.value)); setMsg(null); };

  const save = async () => {
    if (!edit) return;
    const n = Number(text.replace(',', '.'));
    const value = edit.unit === 'bps' ? Math.round(n * 100) : n;
    if (!text.trim() || !Number.isFinite(n) || !Number.isInteger(value)) return setMsg(edit.unit === 'bps' ? 'Informe um percentual, por exemplo 5 ou 5,5.' : 'Informe um número inteiro.');
    setBusy(true); setMsg(null);
    try { await api.setConfigValue(edit.key, value); setEdit(null); list.reload(); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(false); }
  };
  const reset = async (s: AdminSetting) => {
    if (!window.confirm(`Voltar “${s.label}” ao padrão (${formatSetting(s.default, s.unit)})?`)) return;
    try { await api.resetConfigValue(s.key); list.reload(); } catch (e) { setMsg(errorMessage(e)); }
  };
  const groups = ['Taxas', 'Prazos', 'Regras'] as const;

  return (
    <>
      <div className="notice">Estas regras valem para <b>pedidos novos</b>, em até 1 minuto. Pedidos que já existem mantêm os valores combinados. Toda alteração fica registrada na aba Auditoria.{!owner && ' Somente administradores alteram os parâmetros; você pode consultar.'}</div>
      {(list.error || msg) && !edit && <p className="err">{list.error ?? msg}</p>}
      {groups.map((g) => (
        <div key={g} className="set-group">
          <h3>{g}</h3>
          <div className="card">
            <table>
              <thead><tr><th>Parâmetro</th><th>Valor atual</th><th>Padrão</th><th></th></tr></thead>
              <tbody>
                {list.data?.filter((s) => s.group === g).map((s) => (
                  <tr key={s.key}>
                    <td><b>{s.label}</b>{s.custom && <span className="pill-custom">alterado</span>}<div className="sub-line">{s.help}</div></td>
                    <td><b>{formatSetting(s.value, s.unit)}</b>{s.custom && s.updated_by_name && <div className="sub-line">por {s.updated_by_name}</div>}</td>
                    <td className="muted">{formatSetting(s.default, s.unit)}</td>
                    <td>{owner && <span className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn sec" onClick={() => open(s)}>Alterar</button>
                      {s.custom && <button className="btn warn" onClick={() => reset(s)}>Restaurar padrão</button>}
                    </span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {edit && (
        <Modal title={edit.label} onClose={() => setEdit(null)}>
          <p className="muted" style={{ marginTop: 0 }}>{edit.help}</p>
          <label className="field" htmlFor="val">{edit.unit === 'bps' ? 'Novo valor (%)' : `Novo valor (${edit.unit})`}</label>
          <input id="val" value={text} inputMode="decimal" autoFocus onChange={(e) => setText(e.target.value)} />
          <div className="hint">Permitido: de {formatSetting(edit.min, edit.unit)} a {formatSetting(edit.max, edit.unit)}. Padrão: {formatSetting(edit.default, edit.unit)}.</div>
          {msg && <p className="err">{msg}</p>}
          <div className="actions" style={{ marginTop: 16 }}><button className="btn" disabled={busy} onClick={save}>Salvar</button><button className="btn sec" onClick={() => setEdit(null)}>Cancelar</button></div>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ auditoria
function detail(a: AuditItem): string {
  const af = (a.after ?? {}) as Record<string, unknown>;
  const bf = (a.before ?? {}) as Record<string, unknown>;
  if (a.action.startsWith('config.')) return `${String(af.key)}: ${String(bf.value)} → ${String(af.value)}`;
  if (typeof af.reason === 'string' && af.reason) return af.reason;
  if (a.action === 'category.updated') {
    const ch = Object.keys(af).filter((k) => JSON.stringify(af[k]) !== JSON.stringify(bf[k]));
    return ch.map((k) => `${k}: ${String(bf[k])} → ${String(af[k])}`).join('; ');
  }
  return '';
}

function Auditoria() {
  const { api } = useSession();
  const list = useLoad(() => api.adminAudit(100), [api]);
  return (
    <>
      {list.error && <p className="err">{list.error}</p>}
      <div className="card">
        {list.data && list.data.length === 0 && <p className="muted">Nenhuma ação registrada ainda.</p>}
        {list.data && list.data.length > 0 && (
          <table>
            <thead><tr><th>Quando</th><th>Ação</th><th>Quem fez</th><th>Detalhe</th></tr></thead>
            <tbody>{list.data.map((a) => <tr key={a.id}><td>{dateTimeBR(a.created_at)}</td><td><b>{auditLabel(a.action)}</b></td><td>{a.actor_name}</td><td className="diff">{detail(a)}</td></tr>)}</tbody>
          </table>
        )}
        <p className="hint">Mostra as 100 ações mais recentes. O registro é só de leitura: ninguém consegue editar ou apagar.</p>
      </div>
    </>
  );
}

export default function Plataforma() {
  const [tab, setTab] = useState<Tab>('geral');
  const tabs: [Tab, string][] = [['geral', 'Visão geral'], ['servicos', 'Serviços'], ['parametros', 'Parâmetros'], ['auditoria', 'Auditoria']];
  return (
    <Shell title="Gestão da plataforma" subtitle="Indicadores, serviços oferecidos, regras de negócio e registro de ações">
      <div className="seg" role="tablist">{tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</div>
      {tab === 'geral' && <Geral />}
      {tab === 'servicos' && <Servicos />}
      {tab === 'parametros' && <Parametros />}
      {tab === 'auditoria' && <Auditoria />}
    </Shell>
  );
}
