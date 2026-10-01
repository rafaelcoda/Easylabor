import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, PHOTO_BUCKET, STATUS_LABEL, categoryName, createClient, eventLabel, PAYMENT_STATUS_LABEL, WEEKDAYS, errorMessage, formatBRL, photoPath } from '../src';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const make = (impl: (url: string, init: RequestInit) => Response | Promise<Response>, token: string | null = 'tok') => {
  const f = vi.fn(async (url: string, init: RequestInit) => impl(url, init));
  return { f, api: createClient({ baseUrl: 'https://api.test/', getToken: () => token, fetch: f as unknown as typeof fetch }) };
};

describe('cliente da API', () => {
  it('envia o token e monta a URL sem barra duplicada', async () => {
    const { f, api } = make(() => json(200, { registered: false, id: 'u', phone: null, next_step: 'register' }));
    await api.me();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/me');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('não envia Authorization sem token', async () => {
    const { f, api } = make(() => json(200, { items: [] }), null);
    await api.categories();
    expect((f.mock.calls[0]![1].headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('desembrulha listas e monta a busca com parâmetros', async () => {
    const { f, api } = make(() => json(200, { items: [{ professional_id: 'p1' }] }));
    const r = await api.search({ category: 'pintor', date: '2026-10-20', address_id: 'a1' });
    expect(r).toEqual([{ professional_id: 'p1' }]);
    expect(f.mock.calls[0]![0]).toBe('https://api.test/v1/search/professionals?category=pintor&date=2026-10-20&address_id=a1');
  });

  it('ignora parâmetros vazios e codifica os demais', async () => {
    const { f, api } = make(() => json(200, { items: [] }));
    await api.adminBookings({ date: '2026-10-20', status: undefined, limit: 10 });
    expect(f.mock.calls[0]![0]).toBe('https://api.test/v1/admin/bookings?date=2026-10-20&limit=10');
  });

  it('manda JSON no corpo e o método certo', async () => {
    const { f, api } = make(() => json(200, { visible: true }));
    await api.setVisible(true);
    const [, init] = f.mock.calls[0]!;
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"visible":true}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('transforma o erro da API em ApiClientError com código, detalhes e id da requisição', async () => {
    const { api } = make(() => json(422, { error: { code: 'rate_out_of_range', message: 'Valor fora da faixa', details: { min_cents: 15000 }, request_id: 'req_1' } }));
    const err = await api.saveOffer('pintor', 100).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 422, code: 'rate_out_of_range', message: 'Valor fora da faixa', details: { min_cents: 15000 }, requestId: 'req_1' });
    expect(errorMessage(err)).toBe('Valor fora da faixa');
  });

  it('trata falha de rede e resposta sem JSON', async () => {
    const down = createClient({ baseUrl: 'https://x', getToken: () => null, fetch: (async () => { throw new TypeError('x'); }) as unknown as typeof fetch });
    expect(await down.categories().catch((e) => e)).toMatchObject({ code: 'network_error', status: 0 });
    const html = make(() => new Response('<html>erro</html>', { status: 502 }));
    expect(await html.api.me().catch((e) => e)).toMatchObject({ status: 502, code: 'http_error' });
  });

  it('DELETE com 204 não tenta ler corpo', async () => {
    const { api } = make(() => new Response(null, { status: 204 }));
    expect(await api.deleteAddress('a1')).toBeUndefined();
  });

  it('formata reais e traduz todos os estados', () => {
    expect(formatBRL(21000)).toBe('R$ 210,00');
    expect(formatBRL(17072)).toBe('R$ 170,72');
    expect(Object.keys(STATUS_LABEL)).toHaveLength(16);
    expect(errorMessage('x')).toBe('Algo deu errado. Tente novamente.');
  });

  it('monta o caminho da foto no formato exigido pela API e limpa o nome do arquivo', () => {
    expect(PHOTO_BUCKET).toBe('booking-photos');
    expect(photoPath('u1', 'b1', 'foto 1.jpg')).toBe('u1/b1/foto-1.jpg');
    expect(photoPath('u1', 'b1', '../x.jpg')).toBe('u1/b1/..-x.jpg');
    expect(photoPath('u1', 'b1', 'a/b.jpg')).not.toContain('a/b');
  });

  it('traduz serviço, pagamento e histórico para exibição', () => {
    expect(categoryName('pintor')).toBe('Pintor');
    expect(categoryName('ajudante-geral')).toBe('Ajudante geral');
    expect(PAYMENT_STATUS_LABEL.paid).toBe('pago');
    expect(eventLabel('booking.check_in')).toBe('Chegada confirmada');
    expect(eventLabel('booking.created')).toBe('Pedido criado');
    expect(eventLabel('booking.algo_novo')).toBe('algo novo'); // tipo desconhecido não quebra
  });

  it('disponibilidade semanal: chama as rotas certas e usa 1 a 7 (segunda a domingo)', async () => {
    const { f, api } = make(() => json(200, { days: [1, 3], start_time: '06:00', end_time: '20:00' }));
    await api.saveWeekly([1, 3], '06:00', '20:00');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/professional/availability/weekly');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ days: [1, 3], start_time: '06:00', end_time: '20:00' });
    expect(WEEKDAYS.map((d) => d.iso)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(WEEKDAYS[0]!.label).toBe('Segunda-feira');
    expect(WEEKDAYS[6]!.label).toBe('Domingo');
    const setup = make(() => json(200, { profile: null, offers: [], weekly: { days: [], start_time: '06:00', end_time: '20:00' } }));
    expect((await setup.api.professionalSetup()).offers).toEqual([]);
    expect(setup.f.mock.calls[0]![0]).toBe('https://api.test/v1/professional/setup');
    const del = make(() => new Response(null, { status: 204 }));
    await del.api.removeOffer('pintor');
    expect(del.f.mock.calls[0]![1].method).toBe('DELETE');
  });
});
