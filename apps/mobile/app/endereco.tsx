import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Back, Button, ErrorText, Field, Muted, Screen, Title } from '../components/ui';
import { errorMessage } from '../lib/client';
import { useSession } from '../lib/session';

export default function NovoEndereco() {
  const { api } = useSession();
  const router = useRouter();
  const [f, setF] = useState({ street: '', number: '', district: '', city: '', state: 'ES' });
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const locate = async () => {
    setMsg(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return setMsg('Precisamos da permissão de localização para marcar o endereço. Fique no local do serviço e tente de novo.');
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
  };

  const save = async () => {
    if (!pos) return;
    setBusy(true); setMsg(null);
    try {
      await api.addAddress({ street: f.street.trim(), number: f.number.trim() || undefined, district: f.district.trim() || undefined, city: f.city.trim(), state: f.state.trim().toUpperCase(), lat: pos.lat, lng: pos.lng });
      router.back();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ok = f.street.trim().length >= 2 && f.city.trim().length >= 2 && f.state.trim().length === 2 && pos;
  return (
    <Screen>
      <Back />
      <Title>Novo endereço</Title>
      <Field label="Rua" value={f.street} onChangeText={set('street')} />
      <Field label="Número" value={f.number} onChangeText={set('number')} />
      <Field label="Bairro" value={f.district} onChangeText={set('district')} />
      <Field label="Cidade" value={f.city} onChangeText={set('city')} />
      <Field label="UF" value={f.state} onChangeText={set('state')} maxLength={2} autoCapitalize="characters" />
      <Muted>{pos ? 'Localização marcada.' : 'Marque a localização do serviço: ela é usada para achar profissionais perto e confirmar a chegada.'}</Muted>
      <Button label={pos ? 'Marcar de novo' : 'Usar minha localização atual'} kind="secondary" onPress={locate} />
      <ErrorText>{msg}</ErrorText>
      <Button label="Salvar endereço" onPress={save} busy={busy} disabled={!ok} />
    </Screen>
  );
}
