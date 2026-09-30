# EasyLabor (diária): contexto para o Claude Code

Plataforma de diárias de serviços (cliente contrata profissional livre por um dia). Leia o `README.md` para o estado atual
e o plano das sprints. Este arquivo resume como trabalhar no repositório.

## Estrutura
- `packages/core`: regras de negócio puras em TypeScript (preço, estados do pedido, cancelamento, check-in, ranking, ledger, prazos). Sem I/O.
- `packages/api`: API em Hono + `postgres` + `zod`, sobre o núcleo.
- `netlify/handler.ts` + `netlify/functions/api.mts`: a API como função da Netlify. O build gera `netlify/functions/_generated/handler.mjs` com esbuild (não versionar).
- `db/`: migrações SQL (PostgreSQL + PostGIS), seed e testes SQL.

## Comandos
- `npm install`, `npm test` (núcleo + API), `npm run typecheck`, `npm run build:functions`.
- Testes da API criam o banco `diaria_api_test` e exigem PostgreSQL local com PostGIS (`TEST_PG_HOST`, `TEST_PG_USER`, `TEST_DATABASE_URL` ajustam a conexão).
- Testes SQL: `DATABASE_URL=postgres://... npm run db:test` (banco vazio).

## Regras do projeto
- Dinheiro sempre em centavos inteiros; taxas em pontos-base. Nunca ponto flutuante.
- Regra de negócio fica em `packages/core` e é testada lá; a API só orquestra.
- Mudança de estado do pedido só pela máquina de estados (`transition`), que gera evento em `booking_events`.
- Ledger em partidas dobradas; tabelas `booking_events`, `ledger_entries` e `audit_logs` são só de inserção.
- Toda mudança de banco é uma migração nova em `db/migrations/` (nunca editar as já aplicadas) e deve ser aplicada também no Supabase.
- Toda mudança de código vem com teste. Rode `npm test` e `npm run typecheck` antes de commitar.

## Infraestrutura
- Banco: Supabase, projeto **EasyLabor** (`hbyzutbpkzaiuutgiaqs`, região São Paulo). RLS ligado em todas as tabelas, sem políticas: só o servidor acessa, com credencial de servidor.
- API: Netlify, site `easylabor-api` (`https://easylabor-api.netlify.app`). Publica sozinho a cada commit na `main`.
- Variáveis no Netlify: `DATABASE_URL` (secreta, string do Transaction pooler, porta 6543, usuário `postgres.<projeto>`), `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Diagnóstico de conexão: `GET /health?db=1` (não expõe segredos).

## Segurança (inegociável)
- Nunca commitar senhas, tokens, chaves ou `.env`. A chave `service_role` fica só no servidor, nunca em app ou painel web.
- Não colar credenciais em conversas. Se vazar, redefinir na hora.
- Jurídico: o risco de vínculo trabalhista precisa de parecer antes do lançamento; não mudar regras de preço ou penalidade sem revisar isso.

## Pendências principais
1. Confirmar que `/v1/categories` responde em produção (conexão com o banco).
2. Login por SMS (Supabase Auth) e políticas de acesso por perfil.
3. Sprint 3: provedor de pagamentos (Pix e cartão), webhooks idempotentes, repasses e funções agendadas da Netlify (expiração do aceite, no-show, aprovação automática).
4. Sprint 4: app em Expo (React Native). Sprint 5: painel web em Next.js (vai precisar de CORS na API).
5. `Idempotency-Key`, reenvio automático após recusa, disputa, avaliações, chat e upload de arquivos.
