import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Back, Card, ErrorText, Loading, Muted, Screen, Title } from '../components/ui';
import { formatBRL } from '../lib/client';
import { km } from '../lib/format';
import { useSession } from '../lib/session';
import { useLoad } from '../lib/useLoad';

export default function Resultados() {
  const { api } = useSession();
  const router = useRouter();
  const p = useLocalSearchParams<{ category: string; date: string; address_id: string }>();
  const list = useLoad(() => api.search({ category: p.category, date: p.date, address_id: p.address_id }), [api, p.category, p.date, p.address_id]);
  return (
    <Screen>
      <Back />
      <Title>Profissionais disponíveis</Title>
      <Muted>{p.date.split('-').reverse().join('/')}</Muted>
      <ErrorText>{list.error}</ErrorText>
      {list.loading && !list.data && <Loading />}
      {list.data?.length === 0 && <Muted>Ninguém disponível nesse dia perto do endereço. Tente outro dia.</Muted>}
      {list.data?.map((r) => (
        <Card key={r.professional_id} onPress={() => router.push({ pathname: '/solicitar', params: { professional_id: r.professional_id, name: r.name, category: p.category, date: p.date, address_id: p.address_id } })}>
          <Text style={{ fontWeight: '800', fontSize: 18 }}>{r.name}</Text>
          <Muted>{r.rating_count > 0 ? `Nota ${r.rating_avg.toFixed(1).replace('.', ',')} (${r.rating_count})` : 'Novo na plataforma'} · {r.completed_count} serviços · {km(r.distance_m)}</Muted>
          <Text style={{ fontWeight: '800', fontSize: 20 }}>{formatBRL(r.daily_rate_cents)} <Text style={{ fontWeight: '400', fontSize: 14 }}>por diária</Text></Text>
        </Card>
      ))}
    </Screen>
  );
}
