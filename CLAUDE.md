# EasyLabor (diária): contexto para o Claude Code

Plataforma de diárias de serviços (cliente contrata profissional livre por um dia). Leia o `README.md` para o estado atual
e o plano das sprints. Este arquivo resume como trabalhar no repositório.

## Estrutura
- `packages/core`: regras de negócio puras em TypeScript (preço, estados do pedido, cancelamento, check-in, ranking, ledger, prazos). Sem I/O.
- `packages/api`: API em Hono + `postgres` + `zod`, sobre o núcleo.
- `netlify/handler.ts` + `netlify/functions/api.mts`: a API como função da Netlify. O build gera `netlify/functions/_generated/handler.mjs` com esbuild (não versionar).
- `packages/client`: cliente tipado da API, usado pelo app e pelo painel (importado por caminho relativo).
- `apps/panel`: painel web da operação (Next.js, exportação estática). `apps/mobile`: app em Expo. Ficam FORA dos workspaces do npm de propósito (cada um tem seu `package.json` e `package-lock.json`), para o build da API no Netlify não instalar Expo nem Next.
- `db/`: migrações SQL (PostgreSQL + PostGIS), seed e testes SQL.

## Comandos
- **Primeira vez em um ambiente novo (nuvem ou máquina nova):** `bash scripts/setup-testdb.sh` instala e liga o PostgreSQL com PostGIS e cria o papel de teste; siga as linhas `export` que ele imprimir.
- `npm install`, `npm test` (núcleo, API e cliente), `npm run typecheck`, `npm run build:functions`.
- Testes da API criam o banco `diaria_api_test` e exigem PostgreSQL local com PostGIS (`TEST_PG_HOST`, `TEST_PG_USER`, `TEST_DATABASE_URL` ajustam a conexão).
- Testes SQL: `DATABASE_URL=postgres://... npm run db:test` (banco vazio).

## Como trabalhar aqui (fluxo com o Claude Code)
1. Rode `bash scripts/setup-testdb.sh` (uma vez por ambiente) e `npm install`.
2. Faça a mudança com testes. Antes de commitar rode `npm test` e `npm run typecheck`; nos apps rode também `npx tsc --noEmit` dentro de `apps/panel` e `apps/mobile`.
3. Commit pequeno e claro, em português, e `push` na `main`: o Netlify publica a API sozinho. Mudança de banco = nova migração em `db/migrations/` e avisar para aplicá-la no Supabase.
4. Nunca colocar senha, token ou chave secreta no código. Os endereços e a chave **pública** do Supabase em `apps/*/lib/config.ts` não são segredo.

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

## Fotos (Supabase Storage)
- Bucket privado `booking-photos`; caminho obrigatório `<usuário>/<pedido>/<arquivo>` (função `photoPath` em `packages/client`).
- O app envia direto ao Supabase com o login do usuário; as políticas em `storage.objects` (migração 0004) decidem quem envia e quem vê. A API só confere, no check-out, que as fotos existem (`verifyPhotoUploads`, ligado em produção).

## Lojas de aplicativos
- Documentos em `docs/lojas/`. Contas Apple/Google, SMS real, pagamento e revisão jurídica ainda são pré-requisitos para o público.

## Antes de abrir ao público
- Apagar `public/teste-interno.html` (página de teste) e os números de teste com código fixo do Supabase Auth.
- Proteger ou remover o diagnóstico `GET /health?db=1`.
- Desligar `DEMO_AVATARES` em `apps/mobile/lib/config.ts` (ilustrações de demonstração nos cartões) quando houver foto de perfil de verdade.

## Pendências principais
1. Confirmar que `/v1/categories` responde em produção (conexão com o banco).
2. Login por telefone: a API já cadastra e controla acesso por perfil (testado com identidade simulada). Falta habilitar o login por telefone no Supabase (números de teste, depois provedor de SMS) e testar de ponta a ponta com `scripts/login-teste.mjs`. Envio de documentos do KYC ainda não existe.
3. Pagamentos reais: ADIADO por decisão do projeto. Pronto: interface `PaymentProvider` + simulado, webhook idempotente, repasses (desligados), rotinas agendadas (aceite vencido com reenvio, ausência, aprovação automática, estornos). Falta escolher o provedor e escrever o adaptador; hoje o Pix gerado é simulado e nenhum pedido sai de "aguardando pagamento" em produção.
4. App (`apps/mobile`) e painel (`apps/panel`) existem em versão inicial. Fotos do check-out (Supabase Storage) e exclusão de conta já existem. Falta: notificações push, avaliações, chat, disputas no painel, publicar o painel no Netlify (site `easylabor-painel`, base `apps/panel`) e gerar o app nas lojas (EAS).
5. `Idempotency-Key`, reenvio automático após recusa, disputa, avaliações, chat e upload de arquivos.
