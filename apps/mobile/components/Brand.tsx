import { Image, Text, View } from 'react-native';
import { BRAND, C } from '../lib/theme';

/** Símbolo + nome da marca, para as telas de entrada. */
export function Brand({ size = 56 }: { size?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 6 }} accessible accessibilityLabel="Easylabor, plataforma de serviços">
      <Image source={require('../assets/simbolo.png')} style={{ width: size * 0.77, height: size }} resizeMode="contain" />
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 30, fontWeight: '800', color: BRAND.navy, letterSpacing: -0.5 }}>Easylabor</Text>
        <Text style={{ fontSize: 14, color: C.muted }}>Plataforma de Serviços</Text>
      </View>
    </View>
  );
}
