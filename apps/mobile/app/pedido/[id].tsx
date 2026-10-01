import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { PhotoGrid } from '../../components/PhotoGrid';
import { Back, Button, Card, ErrorText, Loading, Muted, Screen, StatusBadge, Title } from '../../components/ui';
import { errorMessage, formatBRL, type ActionName, type Booking } from '../../lib/client';
import { dateBR, timeSP } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useLoad } from '../../lib/useLoad';

const ACTIONS: { key: string; route: ActionName; label: string; kind: 'primary' | 'secondary' | 'danger' }[] = [
  { key: 'accept', route: 'accept', label: 'Aceitar pedido', kind: 'primary' },
  { key: 'decline', route: 'decline', label: 'Recusar', kind: 'secondary' },
  { key: 'en_route', route: 'en-route', label: 'Estou a caminho', kind: 'primary' },
  { key: 'check_in', route: 'check-in', label: 'Fazer check-in no local', kind: 'primary' },
  { key: 'check_out', route: 'check-out', label: 'Encerrar serviço (enviar fotos)', kind: 'primary' },
  { key: 'approve', route: 'approve', label: 'Aprovar serviço', kind: 'primary' },
  { key: 'no_show_client', route: 'report-client-no-show', label: 'Cliente ausente', kind: 'danger' },
  { key: 'cancel_by_client', route: 'cancel', label: 'Cancelar pedido', kind: 'danger' },
  { key: 'cancel_by_professional', route: 'cancel', label: 'Cancelar pedido', kind: 'danger' },
];

export default function PedidoDetalhe() {
  const { api, state } = useSession();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const b = useLoad(() => api.booking(id), [api, id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const isPro = state.status === 'ready' && state.me.role === 'professional';

  const run = async (a: (typeof ACTIONS)[number], booking: Booking) => {
    if (a.route === 'check-out') return router.push({ pathname: '/checkout', params: { id: booking.id, category: booking.category } });
    setBusy(a.key); setMsg(null);
    try {
      let body: Record<string, unknown> = {};
      if (a.route === 'check-in') {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') throw new Error('Precisamos da sua localização para confirmar que você chegou ao endereço.');
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        body = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy ?? 0) };
      }
      if (a.route === 'cancel') body = { reason: 'Cancelado pelo app' };
      await api.action(booking.id, a.route, body);
      b.reload();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (b.loading && !b.data) return <Screen><Back /><Loading /></Screen>;
  const x = b.data;
  if (!x) return <Screen><Back /><ErrorText>{b.error ?? 'Pedido não encontrado.'}</ErrorText></Screen>;

  const buttons = ACTIONS.filter((a) => x.available_actions.includes(a.key));
  return (
    <Screen>
      <Back />
      <Title>{x.code}</Title>
      <StatusBadge status={x.status} />
      <Card>
        <Text style={{ fontWeight: '700' }}>{x.category}</Text>
        <Muted>{dateBR(x.starts_at)} · {timeSP(x.starts_at)} às {timeSP(x.ends_at)}</Muted>
        <Text>{x.description}</Text>
      </Card>
      <Card>
        <Text style={{ fontWeight: '700' }}>Local</Text>
        {x.address ? (
          <Text>{x.address.street}{x.address.number ? `, ${x.address.number}` : ''} · {[x.address.district, x.address.city].filter(Boolean).join(' · ')}</Text>
        ) : (
          <Muted>O endereço completo aparece depois que você aceitar.{x.district ? ` Bairro: ${x.district}.` : ''}</Muted>
        )}
      </Card>
      <Card>
        {isPro ? (
          <Text style={{ fontWeight: '800', fontSize: 18 }}>Você recebe {formatBRL(x.amounts.professional_net_cents)}</Text>
        ) : (
          <Text style={{ fontWeight: '800', fontSize: 18 }}>Total {formatBRL(x.amounts.total_cents)}</Text>
        )}
        {x.payment && !isPro && <Muted>Pagamento: {x.payment.status === 'pending' ? 'ainda não disponível nesta versão' : x.payment.status}</Muted>}
      </Card>
      {x.photos.length > 0 && (
        <Card>
          <Text style={{ fontWeight: '700' }}>Fotos do resultado</Text>
          <PhotoGrid keys={x.photos.map((p) => p.key)} />
        </Card>
      )}
      <ErrorText>{msg}</ErrorText>
      {buttons.map((a) => <Button key={a.key} label={a.label} kind={a.kind} busy={busy === a.key} disabled={busy !== null} onPress={() => run(a, x)} />)}
      <Text style={{ fontWeight: '700', marginTop: 8 }}>Histórico</Text>
      <View style={{ gap: 4 }}>
        {x.timeline.map((t, i) => <Muted key={i}>{dateBR(t.at)} {timeSP(t.at)} · {t.type.replace('booking.', '')}</Muted>)}
      </View>
    </Screen>
  );
}
