'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/session';

export default function LoginPage() {
  const { state, sendCode, verifyCode } = useSession();
  const router = useRouter();
  const [phone, setPhone] = useState('+55');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === 'ready' || state.status === 'denied') router.replace('/');
  }, [state.status, router]);

  const send = async () => {
    setBusy(true); setMsg(null);
    const e = await sendCode(phone.trim());
    setBusy(false);
    if (e) setMsg(e); else setSent(true);
  };
  const verify = async () => {
    setBusy(true); setMsg(null);
    const e = await verifyCode(phone.trim(), code.trim());
    setBusy(false);
    if (e) setMsg(e);
  };

  return (
    <div className="login card">
      <div className="logo-head"><img src="/simbolo.svg" alt="" /><div><div className="t">Easylabor</div><div className="s">Plataforma de Serviços · Operação</div></div></div>
      <p className="muted">Entre com o telefone da sua conta de administrador.</p>
      <label htmlFor="phone">Telefone (com +55)</label>
      <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      {sent && (
        <>
          <label htmlFor="code">Código recebido</label>
          <input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" />
        </>
      )}
      {msg && <p className="err">{msg}</p>}
      <div className="row" style={{ marginTop: 16 }}>
        {!sent ? (
          <button className="btn" onClick={send} disabled={busy || phone.trim().length < 8}>Enviar código</button>
        ) : (
          <>
            <button className="btn" onClick={verify} disabled={busy || code.trim().length < 4}>Entrar</button>
            <button className="btn sec" onClick={() => { setSent(false); setCode(''); }}>Trocar número</button>
          </>
        )}
      </div>
    </div>
  );
}
