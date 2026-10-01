# Checklist de publicação do app nas lojas

Estado do app: pronto para **testes internos**; **ainda não pronto para o público**. Esta lista separa o que já foi feito, o
que só você pode abrir (contas e aprovações) e o que precisa existir antes de abrir ao público.

## 1. O que já está pronto no código
- [x] Exclusão de conta dentro do app (Conta > Excluir minha conta). Exigência da Apple (5.1.1) e do Google.
- [x] Permissões com texto explicativo em português: localização (ao registrar endereço e no check-in) e câmera (fotos do serviço).
- [x] Sem localização em segundo plano e sem rastreamento de publicidade.
- [x] Ícone, abertura e identificadores (`br.com.easylabor.app`, versão 0.1.0, build 1). **O ícone usa o símbolo da marca redesenhado em vetor a partir da imagem recebida; vale trocar pelos arquivos originais em alta resolução.**
- [x] `eas.json` com três perfis de build: `development`, `preview` (APK para testar) e `production`.
- [x] Declaração de criptografia padrão (`ITSAppUsesNonExemptEncryption = false`): evita a pergunta de exportação da Apple.

## 2. O que só você pode fazer (contas, custos e identidade)
| Item | Onde | Observação (confirme valores e regras atuais) |
| --- | --- | --- |
| Conta Expo (EAS) | expo.dev | Gratuita para começar; os builds têm cota mensal |
| Apple Developer Program | developer.apple.com | Pago, anual (cerca de US$ 99). Para empresa, pede D-U-N-S e pode levar dias |
| Google Play Console | play.google.com/console | Taxa única (cerca de US$ 25). Exige verificação de identidade |
| Número de teste para os revisores | Supabase | Apple e Google precisam entrar no app: veja a seção 4 |

## 3. O que precisa existir antes de abrir ao público
- [ ] **Provedor de SMS real.** Hoje só funcionam os números de teste. Sem isso, ninguém de fora consegue entrar.
- [ ] **Pagamento.** Sem ele os pedidos param em "aguardando pagamento" e a loja pode considerar o app incompleto.
- [ ] **Política de privacidade e termos de uso revisados por advogado**, publicados em endereços públicos (a loja pede o link). Os rascunhos estão nesta pasta.
- [ ] **Parecer sobre vínculo trabalhista** (já pendente no projeto).
- [ ] **Chat, denúncia e bloqueio de usuários**, se houver mensagens entre usuários: as lojas exigem moderação de conteúdo gerado por usuários.
- [ ] Capturas de tela, texto da loja e classificação indicativa (rascunho em `FICHA-DA-LOJA.md`).
- [ ] Registro da marca (INPI) e checagem de que o nome "Easylabor" não conflita com outro app nas lojas.

## 4. Conta de revisão (obrigatória)
Os revisores da Apple e do Google precisam logar sem receber SMS. Crie um **número de teste exclusivo** no Supabase (por
exemplo `55279XXXXXXXX=CODIGO`), cadastre uma conta de cliente e outra de profissional com ele, e informe número e código
no campo "notas para o revisor" de cada loja. Use um código que só vale para a revisão e **apague o número depois**.

## 5. Caminho recomendado
1. **Teste interno no Android** (sem custo de loja): `cd apps/mobile`, `npx eas-cli login`, `npx eas-cli build --platform android --profile preview`. Gera um APK para instalar nos celulares dos testadores.
2. **Teste interno no iPhone** (TestFlight, exige a conta Apple): `npx eas-cli build --platform ios --profile production` e `npx eas-cli submit --platform ios`.
3. **Google Play, teste fechado:** contas pessoais novas costumam precisar de um número mínimo de testadores por um período antes de liberar a produção (regra vigente até onde sei: 12 testadores por 14 dias; confirme na Play Console).
4. Só depois do piloto e dos itens da seção 3: produção nas duas lojas.

## 6. Prazos
A revisão da Apple costuma levar de 1 a 3 dias, e a do Google de poucos dias a mais de uma semana em contas novas. Um pedido
recusado exige correção e novo envio; por isso a conta de revisão e a exclusão de conta já estão prontas.
