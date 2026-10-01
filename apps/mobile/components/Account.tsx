import { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, ErrorText, Muted, Screen, Title } from './ui';
import { errorMessage } from '../lib/client';
import { useSession } from '../lib/session';

/** Aba "Conta", igual para cliente e profissional. */
export function Account() {
  const { state, api, signOut } = useSession();
  const me = state.status === 'ready' ? state.me : null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const confirmDelete = () =>
    Alert.alert(
      'Excluir minha conta',
      'Seu nome, telefone, e-mail e endereços serão apagados e você não poderá mais entrar. O histórico de pedidos é mantido sem identificar você. Isso não pode ser desfeito.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setBusy(true); setMsg(null);
            try {
              await api.deleteAccount();
              await signOut();
            } catch (e) {
              setMsg(errorMessage(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  return (
    <Screen>
      <Title>Conta</Title>
      {me && (
        <Card>
          <Muted>{me.role === 'professional' ? 'Profissional' : 'Cliente'}</Muted>
          <Title>{me.full_name}</Title>
          <Muted>{me.phone}</Muted>
        </Card>
      )}
      <Button label="Sair" kind="secondary" onPress={signOut} />
      <ErrorText>{msg}</ErrorText>
      <Button label="Excluir minha conta" kind="danger" onPress={confirmDelete} busy={busy} />
    </Screen>
  );
}
