import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { plain } from '../lib/format';
import { C } from '../lib/theme';

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Seletor com busca: um campo que, ao tocar, abre uma lista em tela cheia com caixa de pesquisa.
 * Digitar filtra a lista (sem diferenciar maiúsculas nem acentos).
 */
export function SelectSearch({ label, placeholder, options, onSelect, disabledValues = [], emptyText = 'Nenhum resultado' }: {
  label: string;
  placeholder: string;
  options: Option[];
  onSelect: (value: string) => void;
  disabledValues?: string[];
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const shown = options.filter((o) => plain(`${o.label} ${o.hint ?? ''}`).includes(plain(q)));
  const close = () => { setOpen(false); setQ(''); };

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: C.muted }}>{label}</Text>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${label}: ${placeholder}`} onPress={() => setOpen(true)}
        style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <Ionicons name="search-outline" size={18} color={C.muted} />
        <Text style={{ flex: 1, fontSize: 16, color: C.muted }}>{placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={C.muted} />
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
          <View style={{ padding: 16, gap: 12, flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink }}>{label}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={close} hitSlop={12}>
                <Ionicons name="close" size={26} color={C.ink} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12 }}>
              <Ionicons name="search-outline" size={18} color={C.pri} />
              <TextInput
                accessibilityLabel="Buscar" autoFocus placeholder="Digite para buscar" placeholderTextColor={C.muted}
                value={q} onChangeText={setQ} autoCorrect={false}
                style={{ flex: 1, fontSize: 17, color: C.ink, paddingVertical: 12 }}
              />
              {q.length > 0 && (
                <Pressable accessibilityRole="button" accessibilityLabel="Limpar busca" onPress={() => setQ('')} hitSlop={10}>
                  <Ionicons name="close-circle" size={18} color={C.muted} />
                </Pressable>
              )}
            </View>
            <FlatList
              data={shown} keyExtractor={(o) => o.value} keyboardShouldPersistTaps="handled"
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              ListEmptyComponent={<Text style={{ color: C.muted, fontSize: 15, paddingVertical: 20 }}>{emptyText}</Text>}
              renderItem={({ item }) => {
                const off = disabledValues.includes(item.value);
                return (
                  <Pressable
                    accessibilityRole="button" accessibilityState={{ disabled: off }} disabled={off}
                    onPress={() => { onSelect(item.value); close(); }}
                    style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', opacity: off ? 0.5 : 1 }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink }}>{item.label}</Text>
                      {item.hint ? <Text style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{item.hint}</Text> : null}
                    </View>
                    {off ? <Text style={{ color: C.muted, fontSize: 13 }}>já adicionado</Text> : <Ionicons name="add-circle-outline" size={22} color={C.pri} />}
                  </Pressable>
                );
              }}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
