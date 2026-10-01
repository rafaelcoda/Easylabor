import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Button, Card, ErrorText, Loading, Muted, Screen, StatusBadge, Title } from '../../components/ui';
import { categoryName, errorMessage, formatBRL } from '../../lib/client';
import { dateBR, timeSP } from '../../lib/format';
import { useSession } from '../../lib/session';
import { C } from '../../lib/theme';
import { useLoad } from '../../lib/useLoad';

const NEXT: Record<string, string> = {
  complete_profile: 'Complete seu cadastro para começar a receber pedidos.',
  await_kyc: 'Cadastro enviado. A operação está verificando seus dados; você será liberado em breve.',
  add_offer: 'Cadastro aprovado. Falta escolher o serviço e o valor da sua diária.',
  add_availability: 'Cadastro aprovado. Falta marcar os dias da semana em que você atende.',
};

export default function ProInicio() {
  const { api, state, refresh } = useSession();
  const router = useRouter();
  const me = useLoad(() => api.me(), [api]);
  const list = useLoad(() => api.bookings('requested'), [api]);
  const [msg, setMsg] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { me.reload(); list.reload(); }, [me.reload, list.reload]));
  if (state.status !== 'ready') return null;
  if (me.loading && !me.data) return <Screen><Loading /></Screen>;

  const m = me.data ?? state.me;
  const prof = m.professional;
  const approved = prof?.kyc_status === 'approved';
  const step = NEXT[m.next_step];

  const toggle = async (v: boolean) => {
    setMsg(null);
    try {
      await api.setVisible(v);
      me.reload(); refresh();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };

  return (
    <Screen>
      <Title>Olá, {m.full_name?.split(' ')[0]}</Title>
      <ErrorText>{me.error ?? list.error ?? msg}</ErrorText>
      {step && (
        <Card>
          <Text style={{ fontWeight: '700' }}>{step}</Text>
          {m.next_step !== 'await_kyc' && <Button label="Completar cadastro" onPress={() => router.push('/pro/cadastro')} />}
        </Card>
      )}
      {approved && (prof?.offers ?? 0) > 0 && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', fontSize: 18 }}>Disponível para receber pedidos</Text>
              <Muted>{prof?.visible ? 'Você aparece nas buscas.' : 'Você está invisível para os clientes.'}</Muted>
            </View>
            <Switch value={!!prof?.visible} onValueChange={toggle} trackColor={{ true: C.pri }} accessibilityLabel="Disponível para receber pedidos" />
          </View>
        </Card>
      )}
      {m.next_step === 'ready' && <Button label="Editar cadastro, serviços e agenda" kind="secondary" onPress={() => router.push('/pro/cadastro')} />}

      <Text style={{ fontWeight: '800', fontSize: 18, marginTop: 8 }}>Pedidos para responder</Text>
      {list.data?.length === 0 && <Muted>Nenhum pedido novo no momento.</Muted>}
      {list.data?.map((b) => (
        <Card key={b.id} onPress={() => router.push(`/pedido/${b.id}`)}>
          <Text style={{ fontWeight: '800' }}>{categoryName(b.category)} · {b.district ?? 'bairro não informado'}</Text>
          <Muted>{dateBR(b.starts_at)} · {timeSP(b.starts_at)} às {timeSP(b.ends_at)}</Muted>
          <Text style={{ fontWeight: '800', fontSize: 18 }}>{formatBRL(b.amounts.professional_net_cents)}</Text>
          <StatusBadge status={b.status} />
          {b.accept_deadline_at && <Muted>Responder até {timeSP(b.accept_deadline_at)}</Muted>}
        </Card>
      ))}
    </Screen>
  );
}
