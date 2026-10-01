import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { STATUS_LABEL, type BookingStatus } from '../lib/client';
import { C } from '../lib/theme';

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const body = <View style={{ padding: 20, gap: 14 }}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right']}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export const Title = ({ children }: { children: React.ReactNode }) => <Text style={s.title} accessibilityRole="header">{children}</Text>;
export const Muted = ({ children }: { children: React.ReactNode }) => <Text style={s.muted}>{children}</Text>;
export const ErrorText = ({ children }: { children: React.ReactNode }) => (children ? <Text style={s.error} accessibilityRole="alert">{children}</Text> : null);

export function Button({ label, onPress, kind = 'primary', disabled, busy }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; busy?: boolean }) {
  const st: ViewStyle = kind === 'primary' ? { backgroundColor: C.pri } : { backgroundColor: '#fff', borderWidth: 1.5, borderColor: kind === 'danger' ? C.bad : C.pri };
  const color = kind === 'primary' ? '#fff' : kind === 'danger' ? C.bad : C.pri;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || busy} onPress={onPress} style={[s.btn, st, (disabled || busy) && { opacity: 0.5 }]}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={[s.btnText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, style, ...rest }: { label: string } & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={C.muted} {...rest} style={[s.input, style]} />
    </View>
  );
}

export const Card = ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) =>
  onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={s.card}>{children}</Pressable> : <View style={s.card}>{children}</View>;

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[s.chip, on && { backgroundColor: C.pri, borderColor: C.pri }]}>
      <Text style={{ color: on ? '#fff' : C.ink, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const TONE: Partial<Record<BookingStatus, [string, string]>> = {
  accepted: [C.okBg, C.ok], en_route: [C.okBg, C.ok], in_progress: [C.okBg, C.ok],
  completed: [C.doneBg, C.done], approved: [C.doneBg, C.done], paid: [C.doneBg, C.done],
  awaiting_payment: [C.waitBg, C.wait], requested: [C.waitBg, C.wait],
};
export function StatusBadge({ status }: { status: BookingStatus }) {
  const [bg, fg] = TONE[status] ?? [C.badBg, C.bad];
  return <Text style={{ alignSelf: 'flex-start', backgroundColor: bg, color: fg, fontWeight: '700', fontSize: 13, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, overflow: 'hidden' }}>{STATUS_LABEL[status]}</Text>;
}

export const Loading = () => <ActivityIndicator style={{ marginTop: 40 }} color={C.pri} size="large" />;

export function Back({ label = 'Voltar' }: { label?: string }) {
  const r = useRouter();
  return <Pressable accessibilityRole="button" onPress={() => r.back()}><Text style={{ color: C.pri, fontWeight: '600', fontSize: 16 }}>{'‹ '}{label}</Text></Pressable>;
}

const s = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: C.ink },
  muted: { fontSize: 15, color: C.muted },
  error: { color: C.bad, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '700', color: C.muted },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.ink },
  btn: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnText: { fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, gap: 6 },
  chip: { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
});
