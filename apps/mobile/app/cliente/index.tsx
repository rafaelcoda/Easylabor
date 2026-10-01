import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, ErrorText, Field, Loading, Muted, Screen, Title } from '../../components/ui';
import { useSession } from '../../lib/session';
import { addDays, todaySP } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { Text } from 'react-native';
import { C } from '../../lib/theme';

export default function Inicio() {
  const { api } = useSession();
  const router = useRouter();
  const cats = useLoad(() => api.categories(), [api]);
  const addrs = useLoad(() => api.addresses(), [api]);
  const [category, setCategory] = useState<string | null>(null);
  const [day, setDay] = useState(addDays(todaySP(), 1));
  const [addressId, setAddressId] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { addrs.reload(); }, [addrs.reload]));

  if (cats.loading && !cats.data) return <Screen><Loading /></Screen>;
  const addressList = addrs.data ?? [];
  const chosenAddress = addressId ?? addressList[0]?.id ?? null;

  return (
    <Screen>
      <Title>Que serviço você precisa?</Title>
      <ErrorText>{cats.error ?? addrs.error}</ErrorText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {cats.data?.map((c) => <Chip key={c.slug} label={c.name} on={category === c.slug} onPress={() => setCategory(c.slug)} />)}
      </View>

      <Field label="Dia (AAAA-MM-DD)" value={day} onChangeText={setDay} keyboardType="numbers-and-punctuation" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button label="Dia anterior" kind="secondary" onPress={() => setDay(addDays(day, -1))} /></View>
        <View style={{ flex: 1 }}><Button label="Próximo dia" kind="secondary" onPress={() => setDay(addDays(day, 1))} /></View>
      </View>

      <Text style={{ fontWeight: '700', color: C.muted, marginTop: 6 }}>Onde será o serviço</Text>
      {addressList.length === 0 && <Muted>Cadastre o endereço do serviço para buscar profissionais perto.</Muted>}
      {addressList.map((a) => (
        <Card key={a.id} onPress={() => setAddressId(a.id)}>
          <Text style={{ fontWeight: '700', color: chosenAddress === a.id ? C.pri : C.ink }}>{chosenAddress === a.id ? '● ' : '○ '}{a.street}{a.number ? `, ${a.number}` : ''}</Text>
          <Muted>{[a.district, a.city].filter(Boolean).join(' · ')}</Muted>
        </Card>
      ))}
      <Button label={addressList.length ? 'Adicionar outro endereço' : 'Adicionar endereço'} kind="secondary" onPress={() => router.push('/endereco')} />

      <Button
        label="Buscar profissionais"
        disabled={!category || !chosenAddress || !/^\d{4}-\d{2}-\d{2}$/.test(day)}
        onPress={() => router.push({ pathname: '/resultados', params: { category: category!, date: day, address_id: chosenAddress! } })}
      />
    </Screen>
  );
}
