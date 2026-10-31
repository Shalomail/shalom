// Links que abrem no app do iPhone, de ponta a ponta contra o Worker local: senha nova pelo e-mail de
// recuperação e conectar o terminal (shalom login). Com o envio de e-mail desligado no dev, os links saem no
// log do wrangler.
//   node scripts/run-ts.mjs scripts/ios-links-check.ts prep <arquivo>    cria a conta e os dois pedidos
//   (xcodebuild test ... -only-testing:ShalomMailUITests/FlowTests/testLinks, com TEST_RUNNER_RESET_URL e
//    TEST_RUNNER_CONNECT_URL do arquivo)
//   node scripts/run-ts.mjs scripts/ios-links-check.ts verify <arquivo>  confere o que o iPhone fez
import { readFileSync, writeFileSync } from 'node:fs';
import { fromB64, newKeyPair, open, toB64 } from '../shared/seal';
import { newAccountKeys } from '../web/src/lib/keys';

const BASE = process.env.SHALOM_API || 'http://127.0.0.1:8790';
const LOG = process.env.WRANGLER_LOG ?? '';
const [mode, file] = process.argv.slice(2);
let failures = 0;
const check = (ok: unknown, label: string) => { console.log(`${ok ? 'ok  ' : 'FALHOU'} ${label}`); if (!ok) failures++; };

class Client {
  jar = new Map<string, string>();
  async call<T = any>(method: string, path: string, body?: unknown, bearer = ''): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-shalom': '1', cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); this.jar.set(k, v.join('=')); }
    return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
  }
}

// O último link "/<caminho>?t=..." que o Worker escreveu no log.
async function linkFromLog(path: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const found = readFileSync(LOG, 'utf8').slice(after).match(new RegExp(`/${path}\\?t=([A-Za-z0-9_-]+)`, 'g'));
    if (found?.length) return found.at(-1)!.split('t=')[1];
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`link /${path} não apareceu no log`);
}

if (mode === 'prep') {
  if (!LOG) throw new Error('falta WRANGLER_LOG (o log do wrangler dev)');
  const tag = Date.now().toString(36).slice(-5);
  const c = new Client();
  const { payload } = await newAccountKeys('senha-antiga-' + tag);
  const made = await c.call('POST', '/api/auth/signup', { address: `links${tag}`, name: 'Links', turnstile: 'XXXX.DUMMY.TOKEN.XXXX', lang: 'pt', ...payload });
  if (made.status !== 200) throw new Error(`cadastro: ${JSON.stringify(made.data)}`);
  const address = made.data.user.address as string;

  let at = readFileSync(LOG, 'utf8').length;
  await c.call('POST', '/api/profile/recovery', { email: `links${tag}@exemplo.com.br` });
  const confirm = await linkFromLog('confirmar', at);
  check((await c.call('POST', '/api/auth/recovery/confirm', { token: confirm })).status === 200, 'e-mail de recuperação confirmado');

  at = readFileSync(LOG, 'utf8').length;
  await new Client().call('POST', '/api/auth/forgot', { address });
  const reset = await linkFromLog('nova-senha', at);

  const cli = newKeyPair();
  const started = await new Client().call<{ code: string; poll: string }>('POST', '/api/cli/start', { device: 'Teste do iPhone', publicKey: toB64(cli.publicKey) });
  const salt = (await new Client().call<{ salt: string }>('POST', '/api/auth/salt', { address })).data.salt;
  writeFileSync(file, JSON.stringify({
    address, salt, oldPublicKey: made.data.user.public_key ?? null,
    reset: `shalommail://nova-senha?t=${reset}`, connect: `shalommail://conectar?codigo=${started.data.code}`,
    poll: started.data.poll, cliSecret: toB64(cli.secretKey),
  }, null, 2));
  console.log(`conta ${address}, links prontos em ${file}`);
} else if (mode === 'verify') {
  const s = JSON.parse(readFileSync(file, 'utf8'));
  const salt = (await new Client().call<{ salt: string }>('POST', '/api/auth/salt', { address: s.address })).data.salt;
  check(salt && salt !== s.salt, 'senha nova criada no iPhone (o sal da conta mudou)');
  const r = await new Client().call<{ status: string; sealedKey?: string; account?: string }>('POST', '/api/cli/poll', { poll: s.poll });
  check(r.data.status === 'approved' && r.data.account === s.address, `terminal aprovado no iPhone para ${s.address} (${r.data.status})`);
  if (r.data.sealedKey) {
    const key = new TextDecoder().decode(await open(fromB64(s.cliSecret), fromB64(r.data.sealedKey), 'raw'));
    check((await new Client().call('GET', '/api/agents', undefined, key)).status === 200, 'a chave que o iPhone lacrou para o terminal funciona');
  }
} else throw new Error('uso: prep|verify <arquivo>');

console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
