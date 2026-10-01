import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Brand } from '../components/Brand';
import { Button, Chip, ErrorText, Field, Muted, Screen, Title } from '../components/ui';
import { errorMessage } from '../lib/client';
import { TERMS_VERSION } from '../lib/config';
import { useSession } from '../lib/session';
import { C } from '../lib/theme';

export default function Register() {
  const { state, api, refresh, signOut } = useSession();
  const [role, setRole] = useState<'client' | 'professional'>('client');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (state.status === 'out') return <Redirect href="/login" />;
  if (state.status === 'ready') return <Redirect href="/" />;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.register({ role, full_name: name.trim(), accepted_terms_version: TERMS_VERSION, email: email.trim() || undefined });
      await refresh();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Brand />
      <Title>Criar conta</Title>
      <Muted>Como você vai usar o EasyLabor?</Muted>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Chip label="Quero contratar" on={role === 'client'} onPress={() => setRole('client')} />
        <Chip label="Sou profissional" on={role === 'professional'} onPress={() => setRole('professional')} />
      </View>
      <Field label="Nome completo" value={name} onChangeText={setName} autoComplete="name" />
      <Field label="E-mail (opcional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Switch value={terms} onValueChange={setTerms} trackColor={{ true: C.pri }} accessibilityLabel="Aceito os termos de uso e a política de privacidade" />
        <Text style={{ flex: 1, color: C.ink }}>Li e aceito os Termos de uso e a Política de privacidade.</Text>
      </View>
      <ErrorText>{msg}</ErrorText>
      <Button label="Criar conta" onPress={save} busy={busy} disabled={name.trim().length < 3 || !terms} />
      <Button label="Sair" kind="secondary" onPress={signOut} />
    </Screen>
  );
}
