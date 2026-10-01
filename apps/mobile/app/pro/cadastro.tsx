import * as Location from 'expo-location';
import { useState } from 'react';
import { View } from 'react-native';
import { Back, Button, Card, Chip, ErrorText, Field, Muted, Screen, Title } from '../../components/ui';
import { errorMessage, formatBRL } from '../../lib/client';
import { addDays, reaisToCents, todaySP } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useLoad } from '../../lib/useLoad';

/** Cadastro do profissional em três blocos: perfil, serviço e agenda. Cada bloco salva sozinho. */
export default function ProCadastro() {
  const { api, refresh } = useSession();
  const cats = useLoad(() => api.categories(), [api]);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [bio, setBio] = useState('');
  const [radius, setRadius] = useState('10');
  const [pix, setPix] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);

  const [cat, setCat] = useState<string | null>(null);
  const [rate, setRate] = useState('');

  const [day, setDay] = useState(addDays(todaySP(), 1));
  const [from, setFrom] = useState('06:00');
  const [to, setTo] = useState('20:00');

  const guard = async (key: string, fn: () => Promise<void>, done: string) => {
    setBusy(key); setMsg(null); setOk(null);
    try { await fn(); setOk(done); await refresh(); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(null); }
  };

  const locate = () => guard('loc', async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') throw new Error('Precisamos da permissão de localização para marcar a região onde você atende.');
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
  }, 'Localização marcada.');

  const cents = reaisToCents(rate);
  const category = cats.data?.find((c) => c.slug === cat);

  return (
    <Screen>
      <Back />
      <Title>Seu cadastro</Title>
      <ErrorText>{msg}</ErrorText>
      {ok && <Muted>{ok}</Muted>}

      <Card>
        <Title>1. Perfil</Title>
        <Field label="Sobre você (opcional)" value={bio} onChangeText={setBio} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
        <Field label="Raio de atuação (km, de 1 a 50)" value={radius} onChangeText={setRadius} keyboardType="number-pad" />
        <Field label="Chave Pix (CPF, celular ou e-mail)" value={pix} onChangeText={setPix} autoCapitalize="none" />
        <Muted>{pos ? 'Localização marcada.' : 'Marque o ponto de onde você sai para trabalhar (use o local onde você está agora).'}</Muted>
        <Button label={pos ? 'Marcar de novo' : 'Usar minha localização'} kind="secondary" onPress={locate} busy={busy === 'loc'} />
        <Button
          label="Salvar perfil" busy={busy === 'perfil'}
          disabled={!pos || pix.trim().length < 5 || !(Number(radius) >= 1 && Number(radius) <= 50)}
          onPress={() => guard('perfil', async () => { await api.saveProfile({ bio: bio.trim() || undefined, lat: pos!.lat, lng: pos!.lng, radius_km: Number(radius), pix_key: pix.trim() }); }, 'Perfil salvo. A operação vai verificar seu cadastro.')}
        />
      </Card>

      <Card>
        <Title>2. Serviço e valor</Title>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {cats.data?.map((c) => <Chip key={c.slug} label={c.name} on={cat === c.slug} onPress={() => setCat(c.slug)} />)}
        </View>
        <Field label="Valor da sua diária (R$)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
        {category && <Muted>Faixa permitida: {formatBRL(category.min_daily_rate_cents)} a {formatBRL(category.max_daily_rate_cents)}.</Muted>}
        <Button label="Salvar serviço" busy={busy === 'oferta'} disabled={!cat || cents === null}
          onPress={() => guard('oferta', async () => { await api.saveOffer(cat!, cents!); }, 'Serviço salvo.')} />
      </Card>

      <Card>
        <Title>3. Agenda</Title>
        <Field label="Dia (AAAA-MM-DD)" value={day} onChangeText={setDay} keyboardType="numbers-and-punctuation" />
        <Field label="Livre a partir de (HH:MM)" value={from} onChangeText={setFrom} keyboardType="numbers-and-punctuation" />
        <Field label="Livre até (HH:MM)" value={to} onChangeText={setTo} keyboardType="numbers-and-punctuation" />
        <Button label="Salvar disponibilidade" busy={busy === 'agenda'}
          disabled={!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)}
          onPress={() => guard('agenda', async () => { await api.saveAvailability(day, from, to); }, 'Disponibilidade salva.')} />
      </Card>
    </Screen>
  );
}
