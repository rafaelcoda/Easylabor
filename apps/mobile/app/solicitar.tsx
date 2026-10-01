import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Back, Button, Card, Chip, ErrorText, Field, Muted, Screen, Title } from '../components/ui';
import { errorMessage, formatBRL } from '../lib/client';
import { useSession } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { C } from '../lib/theme';

export default function Solicitar() {
  const { api } = useSession();
  const router = useRouter();
  const p = useLocalSearchParams<{ professional_id: string; name: string; category: string; date: string; address_id: string }>();
  const quote = useLoad(() => api.quote(p.professional_id, p.category), [api, p.professional_id, p.category]);
  const [start, setStart] = useState('08:00');
  const [hours, setHours] = useState(8);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const b = await api.createBooking({
        professional_id: p.professional_id, category: p.category, address_id: p.address_id, date: p.date,
        start_time: start, duration_minutes: hours * 60, description: desc.trim(),
      });
      router.replace(`/pedido/${b.id}`);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const q = quote.data;
  return (
    <Screen>
      <Back />
      <Title>Solicitar {p.name}</Title>
      <Muted>{p.date.split('-').reverse().join('/')}</Muted>
      <Field label="Horário de início (HH:MM)" value={start} onChangeText={setStart} keyboardType="numbers-and-punctuation" />
      <Text style={{ fontWeight: '700', color: C.muted }}>Duração</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[4, 6, 8].map((h) => <Chip key={h} label={`${h} horas`} on={hours === h} onPress={() => setHours(h)} />)}
      </View>
      <Field label="O que precisa ser feito" value={desc} onChangeText={setDesc} multiline numberOfLines={4} style={{ minHeight: 100, textAlignVertical: 'top' }} />
      {q && (
        <Card>
          <Text>Diária: {formatBRL(q.dailyRateCents)}</Text>
          <Text>Taxa de serviço: {formatBRL(q.clientFeeCents)}</Text>
          <Text style={{ fontWeight: '800', fontSize: 18 }}>Total: {formatBRL(q.totalCents)}</Text>
        </Card>
      )}
      <Muted>O pagamento online ainda não está disponível nesta versão. Seu pedido fica registrado como "aguardando pagamento".</Muted>
      <ErrorText>{msg ?? quote.error}</ErrorText>
      <Button label="Solicitar diária" onPress={send} busy={busy} disabled={!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || desc.trim().length < 5} />
    </Screen>
  );
}
