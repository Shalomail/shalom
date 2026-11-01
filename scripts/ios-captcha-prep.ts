// Prepara o teste da verificação contra robôs no login do app (FlowTests/testLoginCaptcha): cria uma conta
// nova no Worker local, que este iPhone ainda não conhece, e grava endereço e senha num arquivo.
//   node scripts/run-ts.mjs scripts/ios-captcha-prep.ts <arquivo>
// (depois: xcodebuild test ... -only-testing:ShalomMailUITests/FlowTests/testLoginCaptcha, com
//  TEST_RUNNER_CAPTCHA_ADDRESS e TEST_RUNNER_CAPTCHA_PASSWORD do arquivo)
import { writeFileSync } from 'node:fs';
import { newAccountKeys } from '../web/src/lib/keys';

const BASE = process.env.SHALOM_API || 'http://127.0.0.1:8790';
const file = process.argv[2];
if (!file) throw new Error('uso: ios-captcha-prep.ts <arquivo>');
const tag = Date.now().toString(36).slice(-5);
const password = `senha-do-robo-${tag}`;
const { payload } = await newAccountKeys(password);
const res = await fetch(`${BASE}/api/auth/signup`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-shalom': '1' },
  body: JSON.stringify({ address: `robo${tag}`, name: 'Robô', turnstile: 'XXXX.DUMMY.TOKEN.XXXX', lang: 'pt', ...payload }),
});
const made = await res.json() as { user?: { address: string } };
if (!res.ok || !made.user) throw new Error(`cadastro: ${JSON.stringify(made)}`);
// Recuperação já respondida, para a caixa abrir direto depois de entrar.
const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
await fetch(`${BASE}/api/profile/recovery`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shalom': '1', cookie }, body: JSON.stringify({ email: `robo${tag}@exemplo.com.br` }) });
writeFileSync(file, JSON.stringify({ address: made.user.address, password }));
console.log(`conta ${made.user.address} pronta em ${file}`);
