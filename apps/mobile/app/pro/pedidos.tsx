import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Text } from 'react-native';
import { Card, ErrorText, Loading, Muted, Screen, StatusBadge, Title } from '../../components/ui';
import { categoryName, formatBRL } from '../../lib/client';
import { dateBR, timeSP } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useLoad } from '../../lib/useLoad';

export default function ProPedidos() {
  const { api } = useSession();
  const router = useRouter();
  const list = useLoad(() => api.bookings(), [api]);
  useFocusEffect(useCallback(() => { list.reload(); }, [list.reload]));
  return (
    <Screen>
      <Title>Meus atendimentos</Title>
      <ErrorText>{list.error}</ErrorText>
      {list.loading && !list.data && <Loading />}
      {list.data?.length === 0 && <Muted>Você ainda não tem atendimentos.</Muted>}
      {list.data?.map((b) => (
        <Card key={b.id} onPress={() => router.push(`/pedido/${b.id}`)}>
          <Text style={{ fontWeight: '800', fontSize: 16 }}>{b.code} · {categoryName(b.category)}</Text>
          <Muted>{dateBR(b.starts_at)} · {timeSP(b.starts_at)} às {timeSP(b.ends_at)}</Muted>
          <Text style={{ fontWeight: '700' }}>{formatBRL(b.amounts.professional_net_cents)}</Text>
          <StatusBadge status={b.status} />
        </Card>
      ))}
    </Screen>
  );
}
