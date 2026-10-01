import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text } from 'react-native';
import { C } from '../lib/theme';

/** Linha com caixa de marcação. `partial` mostra o estado "alguns marcados" (usado em "Todos os dias"). */
export function Check({ label, checked, partial = false, onToggle, strong = false }: { label: string; checked: boolean; partial?: boolean; onToggle: () => void; strong?: boolean }) {
  const name = checked ? 'checkbox' : partial ? 'remove-circle-outline' : 'square-outline';
  return (
    <Pressable
      accessibilityRole="checkbox" accessibilityState={{ checked: partial && !checked ? 'mixed' : checked }} accessibilityLabel={label} onPress={onToggle}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}
    >
      <Ionicons name={name as 'checkbox'} size={26} color={checked || partial ? C.pri : C.muted} />
      <Text style={{ fontSize: 16, color: C.ink, fontWeight: strong ? '800' : '500' }}>{label}</Text>
    </Pressable>
  );
}
