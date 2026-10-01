import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check } from '../../components/Check';
import { SelectSearch } from '../../components/SelectSearch';
import { Back, Button, Card, ErrorText, Field, Muted, Screen, Title } from '../../components/ui';
import { WEEKDAYS, categoryName, errorMessage, formatBRL } from '../../lib/client';
import { reaisToCents } from '../../lib/format';
import { useSession } from '../../lib/session';
import { C } from '../../lib/theme';
import { useLoad } from '../../lib/useLoad';

interface Row { slug: string; rate: string }
const centsToText = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const H = ({ children }: { children: string }) => <Text style={{ fontSize: 20, fontWeight: '800', color: C.ink }}>{children}</Text>;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Cadastro do profissional: serviços e valores, perfil e disponibilidade da semana. Um botão salva tudo na ordem certa. */
export default function ProCadastro() {
  const { api, refresh } = useSession();
  const router = useRouter();
  const cats = useLoad(() => api.categories(), [api]);
  const setup = useLoad(() => api.professionalSetup(), [api]);

  const [offers, setOffers] = useState<Row[]>([]);
  const [saved, setSaved] = useState<string[]>([]); // serviços que já estão salvos no servidor
  const [bio, setBio] = useState('');
  const [radius, setRadius] = useState('10');
  const [pix, setPix] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [from, setFrom] = useState('06:00');
  const [to, setTo] = useState('20:00');
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState<'save' | 'loc' | null>(null);

  // Abre já preenchido com o que foi salvo antes (só na primeira carga).
  const filled = useRef(false);
  useEffect(() => {
    const d = setup.data;
    if (!d || filled.current) return;
    filled.current = true;
    setOffers(d.offers.map((o) => ({ slug: o.category, rate: centsToText(o.daily_rate_cents) })));
    setSaved(d.offers.map((o) => o.category));
    if (d.profile) {
      setBio(d.profile.bio ?? ''); setRadius(String(d.profile.radius_km)); setPix(d.profile.pix_key); setPos({ lat: d.profile.lat, lng: d.profile.lng });
    }
    setDays(d.weekly.days); setFrom(d.weekly.start_time); setTo(d.weekly.end_time);
  }, [setup.data]);

  const catOf = (slug: string) => cats.data?.find((c) => c.slug === slug);
  const touch = () => { setOk(false); setMsg(null); };
  const setRate = (slug: string, rate: string) => { touch(); setOffers((o) => o.map((r) => (r.slug === slug ? { ...r, rate } : r))); };

  const allDays = days.length === 7;
  const toggleDay = (iso: number) => { touch(); setDays((d) => (d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso].sort())); };
  const toggleAll = () => { touch(); setDays(allDays ? [] : WEEKDAYS.map((d) => d.iso)); };

  const locate = async () => {
    touch(); setBusy('loc');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') throw new Error('Precisamos da permissão de localização para marcar a região onde você atende.');
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  // O que ainda impede de salvar, em linguagem simples.
  const problems: string[] = [];
  if (offers.length === 0) problems.push('escolher pelo menos um serviço');
  for (const o of offers) {
    const c = catOf(o.slug); const cents = reaisToCents(o.rate);
    if (cents === null) problems.push(`informar o valor de ${categoryName(o.slug)}`);
    else if (c && (cents < c.min_daily_rate_cents || cents > c.max_daily_rate_cents)) problems.push(`ajustar o valor de ${categoryName(o.slug)} à faixa permitida`);
  }
  if (!pos) problems.push('marcar a sua localização');
  if (pix.trim().length < 5) problems.push('informar a chave Pix');
  if (!(Number(radius) >= 1 && Number(radius) <= 50)) problems.push('definir o raio de atuação (1 a 50 km)');
  if (days.length === 0) problems.push('marcar pelo menos um dia da semana');
  if (!HHMM.test(from) || !HHMM.test(to)) problems.push('conferir os horários (formato 06:00)');
  else if (to <= from) problems.push('o horário final deve ser depois do inicial');

  const save = async () => {
    touch(); setBusy('save');
    let step = 'o perfil';
    try {
      await api.saveProfile({ bio: bio.trim() || undefined, lat: pos!.lat, lng: pos!.lng, radius_km: Number(radius), pix_key: pix.trim() });
      for (const o of offers) { step = `o serviço ${categoryName(o.slug)}`; await api.saveOffer(o.slug, reaisToCents(o.rate)!); }
      for (const slug of saved.filter((s) => !offers.some((o) => o.slug === s))) { step = `a remoção de ${categoryName(slug)}`; await api.removeOffer(slug); }
      step = 'a disponibilidade'; await api.saveWeekly(days, from, to);
      setSaved(offers.map((o) => o.slug));
      await refresh();
      setOk(true);
    } catch (e) {
      setMsg(`Não foi possível salvar ${step}: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const options = (cats.data ?? []).map((c) => ({ value: c.slug, label: c.name, hint: `Faixa da diária: ${formatBRL(c.min_daily_rate_cents)} a ${formatBRL(c.max_daily_rate_cents)}` }));

  return (
    <Screen>
      <Back />
      <Title>Seu cadastro</Title>
      <Muted>Preencha as três partes e toque em Salvar cadastro no fim da página.</Muted>

      <Card>
        <H>1. Serviços e valor</H>
        <SelectSearch
          label="Serviço" placeholder="Buscar e escolher um serviço" options={options}
          disabledValues={offers.map((o) => o.slug)} emptyText="Nenhum serviço encontrado"
          onSelect={(slug) => { touch(); setOffers((o) => [...o, { slug, rate: '' }]); }}
        />
        {offers.length === 0 && <Muted>Escolha os serviços que você faz. Você pode adicionar mais de um.</Muted>}
        {offers.map((o) => {
          const c = catOf(o.slug); const cents = reaisToCents(o.rate);
          const out = c && cents !== null && (cents < c.min_daily_rate_cents || cents > c.max_daily_rate_cents);
          return (
            <View key={o.slug} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>{categoryName(o.slug)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${categoryName(o.slug)}`} hitSlop={12} onPress={() => { touch(); setOffers((l) => l.filter((r) => r.slug !== o.slug)); }}>
                  <Ionicons name="trash-outline" size={22} color={C.bad} />
                </Pressable>
              </View>
              <Field label="Valor da sua diária (R$)" value={o.rate} onChangeText={(t) => setRate(o.slug, t)} keyboardType="decimal-pad" placeholder="Ex.: 200,00" />
              {c && <Text style={{ fontSize: 13, color: out ? C.bad : C.muted, fontWeight: out ? '700' : '400' }}>Faixa permitida: {formatBRL(c.min_daily_rate_cents)} a {formatBRL(c.max_daily_rate_cents)}</Text>}
            </View>
          );
        })}
      </Card>

      <Card>
        <H>2. Perfil</H>
        <Field label="Sobre você (opcional)" value={bio} onChangeText={(t) => { touch(); setBio(t); }} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
        <Field label="Raio de atuação (km, de 1 a 50)" value={radius} onChangeText={(t) => { touch(); setRadius(t); }} keyboardType="number-pad" />
        <Field label="Chave Pix (CPF, celular ou e-mail)" value={pix} onChangeText={(t) => { touch(); setPix(t); }} autoCapitalize="none" />
        <Muted>{pos ? 'Localização marcada.' : 'Marque o ponto de onde você sai para trabalhar (use o local onde você está agora).'}</Muted>
        <Button label={pos ? 'Marcar de novo' : 'Usar minha localização'} kind="secondary" onPress={locate} busy={busy === 'loc'} />
      </Card>

      <Card>
        <H>3. Disponibilidade da semana</H>
        <Muted>Marque os dias em que você atende. Pode escolher um, vários ou todos.</Muted>
        <View>
          <Check label="Todos os dias" strong checked={allDays} partial={days.length > 0 && !allDays} onToggle={toggleAll} />
          {WEEKDAYS.map((d) => <Check key={d.iso} label={d.label} checked={days.includes(d.iso)} onToggle={() => toggleDay(d.iso)} />)}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Livre a partir de" value={from} onChangeText={(t) => { touch(); setFrom(t); }} keyboardType="numbers-and-punctuation" placeholder="06:00" /></View>
          <View style={{ flex: 1 }}><Field label="Livre até" value={to} onChangeText={(t) => { touch(); setTo(t); }} keyboardType="numbers-and-punctuation" placeholder="20:00" /></View>
        </View>
      </Card>

      {problems.length > 0 && <Muted>Para salvar, falta: {problems.join('; ')}.</Muted>}
      <ErrorText>{msg}</ErrorText>
      {ok && (
        <Card>
          <Text style={{ fontWeight: '800', color: C.ok }}>Cadastro salvo.</Text>
          <Muted>A operação vai verificar seus dados. Quando for aprovado, você poderá ficar disponível para receber pedidos.</Muted>
          <Button label="Voltar ao início" kind="secondary" onPress={() => router.replace('/pro')} />
        </Card>
      )}
      <Button label="Salvar cadastro" onPress={save} busy={busy === 'save'} disabled={problems.length > 0 || busy === 'loc'} />
    </Screen>
  );
}
