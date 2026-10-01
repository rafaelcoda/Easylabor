import { Redirect } from 'expo-router';
import { Button, ErrorText, Loading, Muted, Screen, Title } from '../components/ui';
import { useSession } from '../lib/session';

/** Porta de entrada: decide para onde ir conforme o estado do login. */
export default function Index() {
  const { state, refresh, signOut } = useSession();
  if (state.status === 'loading') return <Screen><Loading /></Screen>;
  if (state.status === 'out') return <Redirect href="/login" />;
  if (state.status === 'unregistered') return <Redirect href="/register" />;
  if (state.status === 'error') {
    return (
      <Screen>
        <Title>Sem conexão</Title>
        <ErrorText>{state.message}</ErrorText>
        <Muted>Não conseguimos falar com o servidor. Verifique a internet e tente de novo.</Muted>
        <Button label="Tentar de novo" onPress={refresh} />
        <Button label="Sair" kind="secondary" onPress={signOut} />
      </Screen>
    );
  }
  return <Redirect href={state.me.role === 'professional' ? '/pro' : '/cliente'} />;
}
