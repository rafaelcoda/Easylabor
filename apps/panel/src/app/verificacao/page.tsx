'use client';

import { useState } from 'react';
import { errorMessage } from '../../../../../packages/client/src';
import { Shell } from '@/components/Shell';
import { useLoad } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Verificacao() {
  const { api } = useSession();
  const q = useLoad(() => api.kycQueue(), [api]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    let reason: string | undefined;
    if (decision === 'reject') {
      reason = window.prompt('Motivo da reprovação (obrigatório):')?.trim();
      if (!reason) return;
    }
    setBusy(id); setMsg(null);
    try {
      await api.kycDecision(id, decision, reason);
      q.reload();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell title="Verificação de profissionais" subtitle="Cadastros aguardando aprovação">
      {(q.error || msg) && <p className="err">{q.error ?? msg}</p>}
      <div className="card">
        {q.data && q.data.length === 0 ? <p className="muted">Nenhum cadastro na fila.</p> : (
          <table>
            <thead><tr><th>Nome</th><th>Telefone</th><th>Raio</th><th>Cadastro</th><th></th></tr></thead>
            <tbody>
              {q.data?.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.full_name}</b></td><td>{p.phone}</td><td>{p.radius_km} km</td>
                  <td>{new Date(p.created_at).toLocaleString('pt-BR')}</td>
                  <td className="row">
                    <button className="btn" disabled={busy === p.id} onClick={() => decide(p.id, 'approve')}>Aprovar</button>
                    <button className="btn bad" disabled={busy === p.id} onClick={() => decide(p.id, 'reject')}>Reprovar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ marginBottom: 0 }}>O envio e a conferência de documentos entram numa próxima etapa; hoje a decisão é manual.</p>
      </div>
    </Shell>
  );
}
