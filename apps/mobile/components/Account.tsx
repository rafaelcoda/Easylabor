import { Button, Card, Muted, Screen, Title } from './ui';
import { useSession } from '../lib/session';

/** Aba "Conta", igual para cliente e profissional. */
export function Account() {
  const { state, signOut } = useSession();
  const me = state.status === 'ready' ? state.me : null;
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
    </Screen>
  );
}
