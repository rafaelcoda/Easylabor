import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Back, Button, Card, ErrorText, Field, Muted, Screen, Title } from '../components/ui';
import { errorMessage, photoPath } from '../lib/client';
import { uploadBookingPhoto, useSession } from '../lib/session';
import { C } from '../lib/theme';
import { useLoad } from '../lib/useLoad';

/** Encerrar o serviço: fotografa o resultado, envia as fotos e registra o check-out com a localização. */
export default function Checkout() {
  const { api, state } = useSession();
  const router = useRouter();
  const { id, category } = useLocalSearchParams<{ id: string; category: string }>();
  const cats = useLoad(() => api.categories(), [api]);
  const min = cats.data?.find((c) => c.slug === category)?.min_photos_checkout ?? 1;
  const userId = state.status === 'ready' ? state.me.id : '';

  const [photos, setPhotos] = useState<{ key: string; uri: string }[]>([]);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const take = async () => {
    setMsg(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setMsg('Precisamos da câmera para fotografar o resultado do serviço. Libere a permissão nas configurações do celular.');
    const res = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset?.base64) return;
    setSending(true);
    const key = photoPath(userId, id, `${Date.now()}-${photos.length + 1}.jpg`);
    const err = await uploadBookingPhoto(key, asset.base64);
    setSending(false);
    if (err) return setMsg(`Não foi possível enviar a foto: ${err}`);
    setPhotos((p) => [...p, { key, uri: asset.uri }]);
  };

  const finish = async () => {
    setBusy(true); setMsg(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('Precisamos da sua localização para registrar o fim do serviço.');
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await api.action(id, 'check-out', { lat: p.coords.latitude, lng: p.coords.longitude, photo_keys: photos.map((x) => x.key), note: note.trim() || undefined });
      router.replace(`/pedido/${id}`);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Back />
      <Title>Encerrar o serviço</Title>
      <Muted>Fotografe o resultado. Este serviço pede pelo menos {min} {min === 1 ? 'foto' : 'fotos'}.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {photos.map((p) => <Image key={p.key} source={{ uri: p.uri }} accessibilityLabel="Foto enviada" style={{ width: 104, height: 104, borderRadius: 10 }} />)}
      </View>
      <Card><Text style={{ color: C.ink, fontWeight: '700' }}>{photos.length} de {min} {photos.length >= min ? '· pronto' : ''}</Text></Card>
      <Button label={photos.length ? 'Tirar mais uma foto' : 'Tirar foto'} kind="secondary" onPress={take} busy={sending} disabled={busy} />
      <Field label="Observações (opcional)" value={note} onChangeText={setNote} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
      <ErrorText>{msg}</ErrorText>
      <Button label="Concluir serviço" onPress={finish} busy={busy} disabled={photos.length < min || sending} />
    </Screen>
  );
}
