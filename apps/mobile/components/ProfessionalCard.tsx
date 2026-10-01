import { Image, Pressable, Text, View } from 'react-native';
import { categoryName, formatBRL, type ProfessionalResult } from '../lib/client';
import { DEMO_AVATARES } from '../lib/config';
import { initials, km } from '../lib/format';
import { BRAND, C } from '../lib/theme';

const A = [
  require('../assets/avatares/a1.png'), require('../assets/avatares/a2.png'), require('../assets/avatares/a3.png'),
  require('../assets/avatares/a4.png'), require('../assets/avatares/a5.png'), require('../assets/avatares/a6.png'),
];
const hash = (id: string) => [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0);

// Só para a demonstração: combina o desenho com o primeiro nome, para o rosto não destoar do nome.
const FEMININOS = new Set(['beatriz', 'raquel', 'isabel', 'alice', 'ruth', 'denise', 'simone', 'ines']);
const feminino = (name: string) => {
  const first = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/)[0]!.toLowerCase();
  return first.endsWith('a') || FEMININOS.has(first);
};
const poolDe = (name: string) => (feminino(name) ? [A[0], A[2], A[3]] : [A[1], A[4], A[5], A[3]]);

/** Distribui os desenhos pela lista sem repetir (enquanto houver desenhos livres no grupo do nome). */
export function distribuirAvatares(lista: { professional_id: string; name: string }[]): Record<string, number> {
  const usados = new Set<number>();
  const out: Record<string, number> = {};
  for (const p of lista) {
    const pool = poolDe(p.name);
    const start = hash(p.professional_id) % pool.length;
    let escolhido = pool[start];
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[(start + i) % pool.length];
      if (!usados.has(A.indexOf(cand))) { escolhido = cand; break; }
    }
    usados.add(A.indexOf(escolhido));
    out[`${p.professional_id}`] = A.indexOf(escolhido);
  }
  return out;
}

const TONES: [string, string][] = [[BRAND.navy, '#FFFFFF'], ['#1F6AAE', '#FFFFFF'], [BRAND.sky, BRAND.navy], [BRAND.green, BRAND.navy]];
const toneOf = (id: string): [string, string] => TONES[hash(id) % TONES.length]!;

/** Cartão de vitrine: bloco com as iniciais (até haver foto de perfil), selo de disponibilidade, nota, distância e valor. */
export function ProfessionalCard({ r, dayText, onPress, avatar }: { r: ProfessionalResult; dayText: string; onPress: () => void; avatar?: number }) {
  const [bg, fg] = toneOf(r.professional_id);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${r.name}, ${categoryName(r.category)}, ${formatBRL(r.daily_rate_cents)} por diária`} onPress={onPress}
      style={{ backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: 'hidden' }}>
      <View style={{ height: 150, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        {r.photo_url ? (
          <Image source={{ uri: r.photo_url }} accessibilityLabel={`Foto de ${r.name}`} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />
        ) : DEMO_AVATARES ? (
          <Image source={A[avatar ?? (hash(r.professional_id) % A.length)]} accessibilityLabel="Ilustração de demonstração" style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <Text style={{ color: fg, fontSize: 44, fontWeight: '800', letterSpacing: -1 }}>{initials(r.name)}</Text>
        )}
        <View style={{ position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#5E9A1E' }} />
          <Text style={{ color: BRAND.navy, fontWeight: '700', fontSize: 13 }}>Livre {dayText.toLowerCase()}</Text>
        </View>
      </View>
      <View style={{ padding: 14, gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: C.ink }}>{r.name}</Text>
          <Text style={{ fontWeight: '700', color: C.ink }}>{r.rating_count > 0 ? `★ ${r.rating_avg.toFixed(1).replace('.', ',')}` : 'Novo'}</Text>
        </View>
        <Text style={{ color: C.muted, fontSize: 15 }}>{categoryName(r.category)}</Text>
        <View style={{ height: 1, backgroundColor: C.line, marginVertical: 8 }} />
        <Text style={{ color: C.muted, fontSize: 13 }}>
          {r.rating_count > 0 ? `${r.rating_count} avaliações` : 'Sem avaliações'}  ·  {km(r.distance_m)}  ·  {r.completed_count} serviços
        </Text>
        <View style={{ height: 1, backgroundColor: C.line, marginVertical: 8 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ color: C.muted, fontSize: 12 }}>a partir de</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink }}>{formatBRL(r.daily_rate_cents)}</Text>
          </View>
          <View style={{ backgroundColor: C.priSoft, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 }}>
            <Text style={{ color: C.pri, fontWeight: '700' }}>Solicitar  →</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
