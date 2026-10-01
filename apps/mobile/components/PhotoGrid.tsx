import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { signedPhotoUrl } from '../lib/session';
import { C } from '../lib/theme';

/** Miniaturas das fotos do serviço, carregadas por endereços temporários. */
export function PhotoGrid({ keys }: { keys: string[] }) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(keys.map(async (k) => [k, await signedPhotoUrl(k)] as const)).then((pairs) => {
      if (alive) setUrls(Object.fromEntries(pairs));
    });
    return () => { alive = false; };
  }, [keys.join('|')]);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {keys.map((k) =>
        urls[k] ? (
          <Image key={k} source={{ uri: urls[k]! }} accessibilityLabel="Foto do resultado do serviço" style={{ width: 104, height: 104, borderRadius: 10, backgroundColor: C.line }} />
        ) : (
          <View key={k} style={{ width: 104, height: 104, borderRadius: 10, backgroundColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: C.muted, fontSize: 12 }}>{k in urls ? 'sem acesso' : 'carregando'}</Text>
          </View>
        ),
      )}
    </View>
  );
}
