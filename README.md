# diária — plataforma de diárias de serviços

Marketplace de diárias: o cliente busca um profissional livre por serviço e localização, paga pela plataforma,
o profissional executa, o serviço é validado (GPS e fotos) e o repasse sai em até 48 h.

Documentação de produto: PRD, especificação técnica, protótipo e guia de estilo (links no documento
"Documentação do projeto — Plataforma de Diárias").

## Estado atual (sprint 1 concluída)

| Parte | Situação |
| --- | --- |
| `packages/core` | Regras de negócio puras em TypeScript: preço, antecipação, máquina de estados do pedido, cancelamento e no-show, check-in por GPS, ranking, ledger em partidas dobradas, prazos. **44 testes passando.** |
| `db/migrations` | Esquema PostgreSQL + PostGIS com as 27 tabelas da especificação, travas de integridade (horários sobrepostos, ledger balanceado, tabelas só de inserção). **15 testes SQL passando.** |
| Banco na nuvem | Projeto **EasyLabor** no Supabase (região São Paulo, `sa-east-1`) com o esquema, o RLS e o seed aplicados. Ver seção abaixo. |
| `packages/api` | API em TypeScript (Hono + PostgreSQL): busca, cotação, pedido completo até o repasse, cancelamento. **45 testes de integração passando** contra um PostgreSQL real (inclui a função da Netlify). |
| `netlify/` | Função que expõe a API na Netlify (`handler.ts` + `functions/api.mts`). Site `easylabor-api` ligado ao GitHub. |
| App (Expo), painel web | Ainda não iniciados (sprints 4 e 5 abaixo). |

## Banco na nuvem: Supabase (projeto EasyLabor)

| Item | Valor |
| --- | --- |
| Projeto | EasyLabor, referência `hbyzutbpkzaiuutgiaqs` |
| Região | São Paulo (`sa-east-1`), por latência e por manter os dados pessoais no Brasil (LGPD) |
| Organização | GrupoRicci/Apoio |
| Custo | US$ 10 por mês (confirmado na criação) |
| Migrações aplicadas | `init_schema` (0001) e `security_rls` (0002); o seed foi executado em seguida |
| Extensões | PostGIS e btree_gist, no schema `extensions` (fora da API pública) |

**Segurança (importante):**
- As 27 tabelas têm RLS ligado e **nenhuma política**: a chave pública (`anon`) e os usuários autenticados não leem nem
  escrevem nada. O acesso é só pela API do servidor, com a chave `service_role`.
- A chave `service_role` ignora o RLS: fica apenas em variável de ambiente do servidor, **nunca no app nem no painel web**.
- As políticas por perfil (cada usuário vê os próprios pedidos, perfil público do profissional etc.) entram com a API, na sprint 2.
- O verificador de segurança do Supabase só aponta o aviso informativo "RLS sem política", que é intencional nesta fase.

**Verificação feita no projeto:** 27 tabelas, 27 com RLS, 3 categorias e 12 parâmetros no seed; teste de integridade
(horários sobrepostos, ledger desbalanceado e histórico imutável rejeitados) com a transação revertida, sem deixar dados.

As faixas de preço das categorias no seed são **placeholders**: substituir pelos valores da cidade piloto.

## API (`packages/api`)

Hono + `postgres` + `zod`, sobre o núcleo `@diaria/core`. Roda em Node (`src/serve.ts`) ou como Edge Function do
Supabase (`src/edge.ts`). A API conecta direto ao PostgreSQL com credencial de servidor, então o RLS fechado não a afeta.

| Método e rota | Perfil | O que faz |
| --- | --- | --- |
| `GET /health`, `GET /v1/categories` | público | Saúde e categorias |
| `GET /v1/me`, `POST /v1/me/register` | login (mesmo sem cadastro) | Consulta o perfil; cadastra cliente ou profissional a partir do telefone verificado |
| `GET/POST/DELETE /v1/client/addresses` | cliente | Endereços (o app informa latitude e longitude) |
| `PUT /v1/professional/profile`, `offers/:categoria`, `availability/:dia`, `status` | profissional | Perfil e raio, serviço e valor (dentro da faixa), agenda e "disponível" |
| `GET /v1/admin/kyc/queue`, `POST /v1/admin/kyc/:id/decision` | admin | Fila e decisão de verificação, com log de auditoria |
| `GET /v1/search/professionals` | cliente | Busca por categoria, data e endereço, ordenada pelo score do PRD |
| `POST /v1/bookings/quote` | login | Cotação (diária, taxa, comissão, líquido) |
| `POST /v1/bookings` | cliente | Cria o pedido aguardando pagamento, com Pix pendente |
| `GET /v1/bookings`, `GET /v1/bookings/:id` | partes e admin | Lista e detalhe; o endereço só aparece ao profissional depois do aceite |
| `POST /v1/bookings/:id/accept`, `decline`, `en-route` | profissional | Aceite (com prazo), recusa e deslocamento |
| `POST /v1/bookings/:id/check-in`, `check-out` | profissional | GPS a até 300 m e janela de 30 min; fotos mínimas por categoria |
| `POST /v1/bookings/:id/approve` | cliente | Aprova; cria o repasse e os lançamentos do ledger |
| `POST /v1/bookings/:id/cancel` | cliente ou profissional | Regras de cancelamento, estorno, compensação e strike |
| `POST /v1/dev/bookings/:id/confirm-payment` | só com `DEV_ROUTES=true` | Simula o webhook de pagamento confirmado |

Erros seguem o formato `{ error: { code, message, details, request_id } }` da especificação.

**Variáveis de ambiente:** `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DEV_ROUTES` (só em desenvolvimento), `PORT`.

**Ainda não feito na API:** `Idempotency-Key`, reenvio automático ao próximo profissional após recusa ou prazo vencido
(depende dos jobs da sprint 3), disputa, avaliações, chat, upload de arquivos, cadastro e KYC do profissional,
antecipação, rotas de admin e webhooks reais do provedor.

**Login e cadastro:** o login é por telefone (Supabase Auth). O token vale para `/v1/me` e `/v1/me/register` mesmo sem
cadastro; as demais rotas exigem usuário cadastrado e ativo, e cada rota confere o perfil (cliente, profissional ou admin).
`users.id` é o mesmo id do Supabase Auth. Admin não se cadastra pela API: promova a conta por SQL
(`UPDATE users SET role = 'admin' WHERE phone = '+55...'`).

**Testar o login sem SMS e sem app:** habilite o login por telefone no Supabase (*Authentication > Sign In / Providers > Phone*)
e cadastre um número de teste com código fixo (*Test Phone Numbers and OTPs*, formato `5527999990001=123456`). Depois:
`SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/login-teste.mjs +5527999990001 123456` imprime o token, e
`curl https://easylabor-api.netlify.app/v1/me -H "Authorization: Bearer <token>"` consulta o perfil.

**Autenticação (detalhe técnico):** a API valida o token do Supabase Auth (`supabaseAuthenticator`) e exige que `users.id` seja o id do
usuário no Supabase Auth. O login por SMS depende de configurar um provedor de SMS no painel do Supabase. Essa parte
**não foi testada de ponta a ponta** (os testes usam um autenticador falso).

## Hospedagem: Netlify

| Item | Valor |
| --- | --- |
| Site | `easylabor-api` (equipe Apoio, plano Pro), endereço `https://easylabor-api.netlify.app` depois da publicação |
| Função | `netlify/functions/api.mts`, atendendo `/health` e `/v1/*`. A lógica fica em `netlify/handler.ts` e o build (`npm run build:functions`) a empacota com esbuild em um único arquivo, porque a Netlify não empacota pacotes do monorepo em TypeScript |
| Variáveis já definidas | `SUPABASE_URL` e `SUPABASE_ANON_KEY` (chave pública) |
| Variável que falta | `DATABASE_URL` (secreta) |

**`DATABASE_URL`:** no painel do Supabase, em *Connect*, copie a string do **Transaction pooler** (porta 6543) e troque a
senha pela senha do banco (em *Project Settings > Database* dá para redefinir). Cadastre no Netlify, em *Site configuration >
Environment variables*, como variável **secreta** com escopo *Functions*. Não cole a senha em conversas nem no código.

Enquanto `DATABASE_URL` não existir, `/health` responde `configured: false` e as demais rotas respondem `503 not_configured`.

**Publicar:** dentro da pasta do repositório, `npx -y @netlify/mcp@latest --site-id <ID_DO_SITE> --proxy-path <URL>`
(o conector da Netlify gera o comando) ou, preferível para o time, conectar o repositório Git ao site e publicar a cada commit.

Não há cabeçalhos CORS: o app em Expo não precisa deles, mas o painel web, em outro domínio, vai precisar (sprint 5).

## Como rodar

```bash
npm install
npm test            # núcleo + API (a API precisa de PostgreSQL local com PostGIS; ver abaixo)
npm run typecheck

# testes da API: criam o banco diaria_api_test com as migrações (variáveis TEST_PG_HOST e TEST_PG_USER ajustam a conexão)

# banco: precisa de PostgreSQL 15+ com PostGIS e de um banco de teste VAZIO
DATABASE_URL=postgres://usuario@localhost/diaria_test npm run db:test
```

## Estrutura

```
packages/core/src
  config.ts               parâmetros de negócio (taxas em pontos-base, prazos, raios)
  money.ts, pricing.ts    dinheiro em centavos inteiros; cotação e antecipação
  bookingStateMachine.ts  estados e transições permitidas, por ator
  cancellation.ts         cancelamento, no-show, strikes, reenvio do pedido
  checkin.ts              distância (haversine) e validação de check-in
  ranking.ts              score de relevância da busca
  ledger.ts               lançamentos em partidas dobradas
  timing.ts               prazos (aceite, Pix, no-show, aprovação automática, repasse)
db/
  migrations/0001_init.sql
  seed.sql                categorias e parâmetros (faixas de preço são placeholders)
  tests.sql, test.sh
```

## Decisões desta sprint

- **Expo (React Native)** para o app, confirmado; Flutter descartado para reaproveitar o núcleo e a linguagem.
- **API com Hono**, sem framework pesado (mudança em relação ao NestJS do plano inicial), hospedada em **função da Netlify**; o mesmo código roda em Node e em Edge Function.
- Os jobs da sprint 3 (expiração do aceite, no-show, aprovação automática, repasses) usarão **funções agendadas da Netlify**.
- **TypeScript em tudo** (núcleo, API, painel web com Next.js e app com React Native/Expo): um só idioma e o núcleo
  compartilhado entre back-end e apps, para que a regra de preço, cancelamento e estados seja a mesma em todo lugar.
- **Dinheiro em centavos inteiros e taxas em pontos-base**, sem ponto flutuante.
- **Supabase** como banco (PostgreSQL + PostGIS, login por SMS e armazenamento de arquivos), em projeto novo.
- **Regras puras e sem I/O** no núcleo: a API só orquestra (banco, provedor de pagamentos, filas).

## Desvios da especificação técnica (a refletir no documento)

1. `bookings` usa `starts_at` e `ends_at` (timestamptz) no lugar de `service_date`, `start_time` e `duration_minutes`,
   para permitir a restrição de exclusão de horários sobrepostos.
2. A máquina de estados permite `cancel_by_client` também em `awaiting_payment` e `requested` (cancelamento sem custo
   antes do aceite, RF-35), que a tabela 4.1 não listava.
3. `config_settings` tem chave composta (`key`, `scope`) para permitir valores por cidade e categoria.

## Premissas a confirmar

- Cancelamento tardio do cliente: a compensação retida vai **integralmente** ao profissional, e a taxa de serviço é
  devolvida ao cliente.
- No-show do cliente: o profissional recebe 50% da diária; o restante do total pago é devolvido.
- Todos os percentuais, prazos e raios estão em `config.ts` e em `seed.sql` como valores de partida do PRD.

## Próximas sprints

| Sprint | Entrega |
| --- | --- |
| 2 (em andamento) | API sobre o Supabase. Feito: busca, cotação, pedido e ciclo completo, função da Netlify. Falta: publicar (DATABASE_URL e deploy), login por OTP (Supabase Auth com SMS), perfis, categorias, busca por proximidade, cotação e criação de pedido, aceitar e recusar, check-in e check-out, aprovação, disputa |
| 3 | Pagamentos: integração com o provedor (Pix e cartão em modo de teste), webhooks idempotentes, ledger, repasse; filas e jobs (expiração do aceite, no-show, aprovação automática) |
| 4 | App do cliente e do profissional (Expo): cadastro, busca, pedido, pagamento, acompanhamento, aprovação, execução, carteira |
| 5 | Painel web de operação (Next.js): cadastros (KYC), pedidos ao vivo, agenda, disputas, financeiro |
| 6 | KYC, notificações push, conformidade (LGPD), testes de carga e piloto fechado |

## Antes de publicar qualquer coisa

Parecer jurídico (vínculo trabalhista), contratos com o provedor de pagamentos e de KYC, e política de privacidade.
