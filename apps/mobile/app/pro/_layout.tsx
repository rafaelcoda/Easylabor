import { Redirect, Tabs } from 'expo-router';
import { useSession } from '../../lib/session';
import { C } from '../../lib/theme';

export default function ProTabs() {
  const { state } = useSession();
  if (state.status === 'out') return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: C.pri, tabBarLabelStyle: { fontWeight: '600' } }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen name="pedidos" options={{ title: 'Pedidos' }} />
      <Tabs.Screen name="conta" options={{ title: 'Conta' }} />
      <Tabs.Screen name="cadastro" options={{ href: null }} />
    </Tabs>
  );
}
