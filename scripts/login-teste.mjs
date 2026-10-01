#!/usr/bin/env node
// Faz o login por telefone no Supabase Auth e imprime o token de acesso.
// Serve para testar a API sem o app. Funciona com os "números de teste" do Supabase (nenhum SMS é enviado).
//
// Uso:
//   SUPABASE_URL=https://<projeto>.supabase.co SUPABASE_ANON_KEY=<chave publica> \
//     node scripts/login-teste.mjs +5527999990001 123456
//
// Depois: curl https://easylabor-api.netlify.app/v1/me -H "Authorization: Bearer <token>"
const [phone, otp] = process.argv.slice(2);
const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key } = process.env;
if (!phone || !otp || !url || !key) {
  console.error('Uso: SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/login-teste.mjs <telefone com +55> <codigo>');
  process.exit(1);
}
const headers = { apikey: key, 'content-type': 'application/json' };

const send = await fetch(`${url}/auth/v1/otp`, { method: 'POST', headers, body: JSON.stringify({ phone }) });
if (!send.ok) {
  console.error('Falha ao pedir o código:', send.status, await send.text());
  process.exit(1);
}
const verify = await fetch(`${url}/auth/v1/verify`, { method: 'POST', headers, body: JSON.stringify({ phone, token: otp, type: 'sms' }) });
const body = await verify.json();
if (!verify.ok || !body.access_token) {
  console.error('Falha ao validar o código:', verify.status, JSON.stringify(body));
  process.exit(1);
}
console.log(body.access_token);
