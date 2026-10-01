import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Brand } from '../components/Brand';
import { Button, ErrorText, Field, Muted, Screen, Title } from '../components/ui';
import { useSession } from '../lib/session';

export default function Login() {
  const { state, sendCode, verifyCode } = useSession();
  const [phone, setPhone] = useState('+55');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status === 'ready' || state.status === 'unregistered') return <Redirect href="/" />;

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
    <Screen>
      <Brand />
      <Title>Entrar</Title>
      <Muted>Use seu celular. Enviamos um código para confirmar que o número é seu.</Muted>
      <Field label="Celular (com +55 e DDD)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" editable={!sent} />
      {sent && <Field label="Código recebido" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" />}
      <ErrorText>{msg}</ErrorText>
      {!sent ? (
        <Button label="Enviar código" onPress={send} busy={busy} disabled={phone.trim().length < 8} />
      ) : (
        <>
          <Button label="Entrar" onPress={verify} busy={busy} disabled={code.trim().length < 4} />
          <Button label="Trocar número" kind="secondary" onPress={() => { setSent(false); setCode(''); setMsg(null); }} />
        </>
      )}
    </Screen>
  );
}
