import { useRouter } from 'expo-router';
import { Image, Pressable, Text, View } from 'react-native';
import { initials } from '../lib/format';
import { useSession } from '../lib/session';
import { BRAND, C } from '../lib/theme';

/** Cabeçalho das telas principais: símbolo, nome da marca e avatar com as iniciais. */
export function AppHeader({ contaHref }: { contaHref: string }) {
  const { state } = useSession();
  const router = useRouter();
  const name = state.status === 'ready' ? state.me.full_name ?? '' : '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Image source={require('../assets/simbolo.png')} style={{ width: 28, height: 36 }} resizeMode="contain" accessibilityLabel="Easylabor" />
        <Text style={{ fontSize: 24, fontWeight: '800', color: BRAND.navy, letterSpacing: -0.5 }}>Easylabor</Text>
      </View>
      <Pressable
        accessibilityRole="button" accessibilityLabel="Minha conta" onPress={() => router.push(contaHref as never)}
        style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.priSoft, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: BRAND.navy, fontWeight: '700' }}>{initials(name) || '·'}</Text>
      </Pressable>
    </View>
  );
}
