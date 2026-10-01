import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AppHeader } from '../../components/AppHeader';
import { ProfessionalCard, distribuirAvatares } from '../../components/ProfessionalCard';
import { Button, ErrorText, Loading, Muted, Screen } from '../../components/ui';
import { categoryName, type ProfessionalResult } from '../../lib/client';
import { addDays, dayLabel, dayName, plain, todaySP } from '../../lib/format';
import { useSession } from '../../lib/session';
import { BRAND, C } from '../../lib/theme';
import { useLoad } from '../../lib/useLoad';

const CAT_STYLE: Record<string, { icon: keyof typeof Ionicons.glyphMap; bg: string; fg: string; sub: string }> = {
  todos: { icon: 'grid-outline', bg: BRAND.navy, fg: '#fff', sub: 'Explorar' },
  diarista: { icon: 'home-outline', bg: '#E6F5FB', fg: '#1F6AAE', sub: 'Casa e escritório' },
  'ajudante-geral': { icon: 'cube-outline', bg: '#EAF4D8', fg: '#3E5F10', sub: 'Carga e mudança' },
  pintor: { icon: 'color-palette-outline', bg: '#FDF1D3', fg: '#7A4A00', sub: 'Paredes e teto' },
};
const styleOf = (slug: string) => CAT_STYLE[slug] ?? { icon: 'construct-outline' as const, bg: C.priSoft, fg: C.pri, sub: 'Ver opções' };

export default function Explorar() {
  const { api } = useSession();
  const router = useRouter();
  const today = todaySP();
  const cats = useLoad(() => api.categories(), [api]);
  const addrs = useLoad(() => api.addresses(), [api]);
  const [category, setCategory] = useState<string>('todos');
  const [text, setText] = useState('');
  const [day, setDay] = useState(addDays(today, 1));
  const [addressId, setAddressId] = useState<string | null>(null);
  const [pickAddress, setPickAddress] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { addrs.reload(); }, [addrs.reload]));

  const addressList = addrs.data ?? [];
  const address = addressList.find((a) => a.id === addressId) ?? addressList[0] ?? null;
  const slugs = useMemo(() => (category === 'todos' ? (cats.data ?? []).map((c) => c.slug) : [category]), [category, cats.data]);

  const results = useLoad(async (): Promise<ProfessionalResult[]> => {
    if (!address || slugs.length === 0) return [];
    const lists = await Promise.all(slugs.map((s) => api.search({ category: s, date: day, address_id: address.id })));
    return lists.flat().sort((a, b) => b.score - a.score);
  }, [api, address?.id, slugs.join('|'), day]);

  const applyText = () => {
    setNote(null);
    const q = plain(text);
    if (!q) return setCategory('todos');
    const hit = (cats.data ?? []).find((c) => plain(c.name).includes(q) || plain(c.slug).includes(q));
    if (hit) setCategory(hit.slug);
    else setNote('Não encontramos esse serviço. Escolha uma das categorias abaixo.');
    results.reload();
  };

  const list = results.data ?? [];
  const avatares = useMemo(() => distribuirAvatares(list), [results.data]);

  if (cats.loading && !cats.data) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <AppHeader contaHref="/cliente/conta" />

      <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 14, gap: 10, borderWidth: 1, borderColor: C.line, marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 }}>
          <Ionicons name="search-outline" size={20} color={C.pri} />
          <TextInput
            accessibilityLabel="Qual serviço você precisa?" placeholder="Qual serviço você precisa?" placeholderTextColor={C.muted}
            value={text} onChangeText={setText} onSubmitEditing={applyText} returnKeyType="search"
            style={{ flex: 1, fontSize: 17, color: C.ink, paddingVertical: 10 }}
          />
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="Escolher o endereço do serviço" onPress={() => setPickAddress((v) => !v)}
          style={{ backgroundColor: '#EEF5F9', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="location-outline" size={22} color={C.pri} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: C.muted, fontWeight: '700', letterSpacing: 0.6 }}>LOCALIZAÇÃO</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }} numberOfLines={1}>
              {address ? `${address.street}${address.number ? `, ${address.number}` : ''} · ${address.district ?? address.city}` : 'Adicione um endereço'}
            </Text>
          </View>
          <Ionicons name={pickAddress ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
        </Pressable>
        {pickAddress && (
          <View style={{ gap: 8 }}>
            {addressList.map((a) => (
              <Pressable key={a.id} accessibilityRole="button" onPress={() => { setAddressId(a.id); setPickAddress(false); }}
                style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: a.id === address?.id ? C.pri : C.line }}>
                <Text style={{ fontWeight: '700', color: C.ink }}>{a.street}{a.number ? `, ${a.number}` : ''}</Text>
                <Muted>{[a.district, a.city].filter(Boolean).join(' · ')}</Muted>
              </Pressable>
            ))}
            <Button label="Adicionar endereço" kind="secondary" onPress={() => router.push('/endereco')} />
          </View>
        )}

        <View style={{ backgroundColor: '#EEF5F9', borderRadius: 14, padding: 8, flexDirection: 'row', alignItems: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Dia anterior" disabled={day <= today} onPress={() => setDay(addDays(day, -1))} style={{ padding: 8, opacity: day <= today ? 0.3 : 1 }}>
            <Ionicons name="chevron-back" size={20} color={C.pri} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: C.muted, fontWeight: '700', letterSpacing: 0.6 }}>DIA</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }}>{dayName(day, today)} · {dayLabel(day)}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Próximo dia" onPress={() => setDay(addDays(day, 1))} style={{ padding: 8 }}>
            <Ionicons name="chevron-forward" size={20} color={C.pri} />
          </Pressable>
        </View>

        <Button label="Buscar" onPress={applyText} />
      </View>

      <View style={{ marginTop: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: C.muted, letterSpacing: 1 }}>CATEGORIAS</Text>
        <Text style={{ fontSize: 26, fontWeight: '800', color: C.ink, letterSpacing: -0.5, marginBottom: 10 }}>O que você precisa?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 20 }}>
          {[{ slug: 'todos', name: 'Todos' }, ...(cats.data ?? [])].map((c) => {
            const st = styleOf(c.slug); const on = category === c.slug;
            return (
              <Pressable key={c.slug} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { setCategory(c.slug); setNote(null); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 16, borderWidth: on ? 1.5 : 1, borderColor: on ? BRAND.navy : C.line, padding: 12, minWidth: 170 }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: st.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={st.icon} size={22} color={st.fg} />
                </View>
                <View>
                  <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink }}>{c.slug === 'todos' ? 'Todos' : categoryName(c.slug)}</Text>
                  <Text style={{ color: C.muted, fontSize: 13 }}>{st.sub}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <ErrorText>{note ?? cats.error ?? addrs.error ?? results.error}</ErrorText>

      <View style={{ marginTop: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: C.muted, letterSpacing: 1 }}>RECOMENDADOS PARA VOCÊ</Text>
        <Text style={{ fontSize: 26, fontWeight: '800', color: C.ink, letterSpacing: -0.5 }}>Profissionais disponíveis</Text>
        {address && !results.loading && <Muted>{list.length === 1 ? '1 profissional encontrado' : `${list.length} profissionais encontrados`}</Muted>}
      </View>

      {!address && <Muted>Cadastre o endereço do serviço para ver quem atende perto de você.</Muted>}
      {address && results.loading && !results.data && <Loading />}
      {address && !results.loading && list.length === 0 && <Muted>Ninguém livre nesse dia perto do endereço. Tente outro dia.</Muted>}
      {list.map((r) => (
        <ProfessionalCard key={`${r.professional_id}-${r.category}`} r={r} dayText={dayName(day, today)} avatar={avatares[r.professional_id]}
          onPress={() => router.push({ pathname: '/solicitar', params: { professional_id: r.professional_id, name: r.name, category: r.category, date: day, address_id: address!.id } })} />
      ))}
    </Screen>
  );
}
