// Teste das correções das auditorias de segurança de 31/10 e 01/11, contra o Worker local:
//   - ações perigosas (apagar de vez, esvaziar, chaves de API, conectar o terminal) pedem a pessoa confirmada,
//     com senha e o segundo fator ligado, e a confirmação vale 10 minutos (antes bastava o cookie);
//   - desligar, criar ou trocar PIN e duas etapas, gerar códigos de recuperação, trocar o e-mail de
//     recuperação, trocar a senha e apagar a conta pedem o segundo fator ligado, além da senha;
//   - o primeiro e-mail de recuperação sem senha só vale na sessão do cadastro;
//   - a senha nova pelo link de recuperação derruba as chaves de API e os aparelhos conhecidos;
//   - trocar a senha esquece os aparelhos conhecidos;
//   - outra conta não toma para si o token de aviso de um aparelho.
// As contas criadas são apagadas no fim.
// Rodar: WRANGLER_LOG=<log do wrangler dev> node scripts/run-ts.mjs scripts/smoke-security.ts
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { newKeyPair, toB64 } from '../shared/seal';
import { newAccountKeys } from '../web/src/lib/keys';

const BASE = process.env.SHALOM_API || 'http://127.0.0.1:8790';
const LOG = process.env.WRANGLER_LOG ?? '';
if (!LOG) throw new Error('falta WRANGLER_LOG (o log do wrangler dev, onde saem os links de e-mail)');
let failures = 0;
const check = (ok: unknown, label: string) => { console.log(`${ok ? 'ok  ' : 'FALHOU'} ${label}`); if (!ok) failures++; };
// Mesma coisa para um pedido: na falha, mostra o que o servidor respondeu.
const expect = (r: { status: number; data: unknown }, status: number, label: string) => {
  check(r.status === status, label);
  if (r.status !== status) console.log(`       ${r.status} ${JSON.stringify(r.data)}`);
  return r;
};

class Client {
  jar = new Map<string, string>();
  constructor(private bearer = '') {}
  async call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-shalom': '1', cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); this.jar.set(k, v.join('=')); }
    return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
  }
}
const local = (sql: string) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'shalom', '--local', '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;

// Código do autenticador (RFC 6238), para o passo pedido.
function totp(secret: string, step: number): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes: number[] = [];
  let bits = 0, value = 0;
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, '0');
}

async function linkFromLog(path: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const found = readFileSync(LOG, 'utf8').slice(after).match(new RegExp(`/${path}\\?t=([A-Za-z0-9_-]+)`, 'g'));
    if (found?.length) return found.at(-1)!.split('t=')[1];
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`link /${path} não apareceu no log`);
}

async function signup(prefix: string, password: string) {
  const tag = Date.now().toString(36).slice(-5);
  const c = new Client();
  const { payload } = await newAccountKeys(password);
  const made = await c.call('POST', '/api/auth/signup', { address: `${prefix}${tag}`, name: 'Segurança', turnstile: 'XXXX.DUMMY.TOKEN.XXXX', lang: 'pt', ...payload });
  if (made.status !== 200) throw new Error(`cadastro: ${JSON.stringify(made.data)}`);
  return { c, authKey: payload.authKey as string, address: made.data.user.address as string, id: made.data.user.id as string };
}

// ---------- Confirmar que é a pessoa (10 minutos) ----------
const conf = await signup('segconf', 'senha da confirmacao ' + Date.now());
const reauth = (r: { status: number; data: any }, label: string) => check(r.status === 403 && r.data?.error === 'reauth', label);
reauth(await conf.c.call('POST', '/api/messages/delete', { ids: ['x'] }), 'apagar de vez só com o cookie pede confirmação');
reauth(await conf.c.call('POST', '/api/storage/wipe', { before: Date.now(), folder: 'trash' }), 'esvaziar a Lixeira só com o cookie pede confirmação');
reauth(await conf.c.call('POST', '/api/storage/wipe', { before: Date.now() }), 'esvaziar a conta só com o cookie pede confirmação');
reauth(await conf.c.call('POST', '/api/apikeys', { name: 'x' }), 'chave de API só com o cookie pede confirmação');
const cliStart = await new Client().call<{ code: string }>('POST', '/api/cli/start', { device: 'teste', publicKey: toB64(newKeyPair().publicKey) });
reauth(await conf.c.call('POST', '/api/cli/approve', { code: cliStart.data.code }), 'conectar o terminal só com o cookie pede confirmação');
expect(await conf.c.call('POST', '/api/profile/confirm', { authKey: toB64(new Uint8Array(32)) }), 401, 'confirmar com a senha errada é recusado');
expect(await conf.c.call('POST', '/api/profile/confirm', { authKey: conf.authKey }), 200, 'confirmou com a senha');
expect(await conf.c.call('POST', '/api/messages/delete', { ids: ['x'] }), 200, 'confirmada, apagar de vez passa');
expect(await conf.c.call('POST', '/api/storage/wipe', { before: Date.now() }), 200, 'confirmada, esvaziar passa');
expect(await conf.c.call('POST', '/api/apikeys', { name: 'x' }), 200, 'confirmada, cria chave de API');
expect(await conf.c.call('POST', '/api/cli/approve', { code: cliStart.data.code }), 200, 'confirmada, conecta o terminal');
const later = new Client();
expect(await later.call('POST', '/api/auth/login', { address: conf.address, authKey: conf.authKey }), 200, 'entrou de outro aparelho');
reauth(await later.call('POST', '/api/messages/delete', { ids: ['x'] }), 'a confirmação vale só na sessão que confirmou');
expect(await later.call('POST', '/api/messages/delete', { ids: ['x'], authKey: conf.authKey }), 200, 'a senha no próprio pedido também confirma');

// ---------- Primeiro e-mail de recuperação sem senha: só na sessão do cadastro ----------
expect(await later.call('POST', '/api/profile/recovery', { email: 'outra@exemplo.com.br' }), 401, 'outra sessão, mesmo recente, não escolhe o e-mail sem senha');
expect(await conf.c.call('POST', '/api/profile/recovery', { email: 'conf@exemplo.com.br' }), 200, 'a sessão do cadastro escolhe sem senha');

// ---------- Esvaziar a caixa ----------
const a = await signup('seg', 'uma senha de teste ' + Date.now());
const at = Date.now();
reauth(await a.c.call('POST', '/api/storage/wipe', { before: at, folder: 'inbox' }), 'esvaziar a Entrada só com o cookie é recusado');
expect(await a.c.call('POST', '/api/storage/wipe', { before: at, folder: 'inbox', authKey: a.authKey }), 200, 'com a senha, esvazia');

// ---------- PIN ----------
expect(await a.c.call('POST', '/api/profile/pin', { authKey: a.authKey, pin: '123456' }), 200, 'PIN criado com a senha');
expect(await a.c.call('POST', '/api/profile/pin/delete', { authKey: a.authKey }), 401, 'tirar o PIN só com a senha é recusado');
expect(await a.c.call('POST', '/api/profile/pin/delete', { authKey: a.authKey, pin: '000000' }), 401, 'tirar o PIN com o PIN errado é recusado');
expect(await a.c.call('POST', '/api/profile/pin', { authKey: a.authKey, pin: '654321' }), 401, 'trocar o PIN sem o atual é recusado');
expect(await a.c.call('POST', '/api/profile/pin', { authKey: a.authKey, pin: '654321', currentPin: '123456' }), 200, 'trocar o PIN com o atual');

// ---------- E-mail de recuperação ----------
expect(await a.c.call('POST', '/api/profile/recovery', { email: 'seg@exemplo.com.br' }), 200, 'primeiro e-mail de recuperação, logo depois do cadastro, sem senha');
expect(await a.c.call('POST', '/api/profile/recovery', { email: 'outro@exemplo.com.br', authKey: a.authKey }), 401, 'trocar o e-mail de recuperação só com a senha é recusado (PIN ligado)');
expect(await a.c.call('POST', '/api/profile/recovery', { email: 'outro@exemplo.com.br', authKey: a.authKey, pin: '654321' }), 200, 'trocar com a senha e o PIN');

// ---------- Duas etapas ----------
expect(await a.c.call('POST', '/api/profile/totp/start', { authKey: a.authKey }), 401, 'ligar duas etapas com PIN ligado, só com a senha, é recusado');
const started = await a.c.call<{ secret: string }>('POST', '/api/profile/totp/start', { authKey: a.authKey, pin: '654321' });
const step = Math.floor(Date.now() / 30000);
const enabled = await a.c.call<{ codes: string[] }>('POST', '/api/profile/totp/enable', { code: totp(started.data.secret, step) });
check(enabled.status === 200 && enabled.data.codes?.length === 10, 'duas etapas ligadas, com 10 códigos de recuperação');
const codes = enabled.data.codes ?? [];
expect(await a.c.call('POST', '/api/profile/totp/recovery', { authKey: a.authKey, pin: '654321' }), 401, 'gerar códigos novos sem o autenticador é recusado');
const regen = await a.c.call<{ codes: string[] }>('POST', '/api/profile/totp/recovery', { authKey: a.authKey, pin: '654321', code: totp(started.data.secret, step + 1) });
check(regen.status === 200 && regen.data.codes?.length === 10, 'gerar códigos novos com PIN e código do autenticador');
expect(await a.c.call('POST', '/api/profile/totp/disable', { authKey: a.authKey, pin: '654321' }), 401, 'desligar as duas etapas sem o código é recusado');
expect(await a.c.call('POST', '/api/profile/totp/disable', { authKey: a.authKey, pin: '654321', recovery: codes[0] }), 401, 'código de recuperação antigo (trocado) não vale');
expect(await a.c.call('POST', '/api/profile/totp/disable', { authKey: a.authKey, pin: '654321', recovery: regen.data.codes[0] }), 200, 'desligar com PIN e um código de recuperação novo');

// ---------- Trocar a senha esquece os aparelhos conhecidos ----------
check(local(`SELECT COUNT(*) AS n FROM known_devices WHERE user_id = '${a.id}'`)[0].n >= 1, 'aparelho conhecido depois do cadastro');
const next = await newAccountKeys('outra senha de teste ' + Date.now());
const pw = { oldAuthKey: a.authKey, authKey: next.payload.authKey, salt: next.payload.salt, kdf: next.payload.kdf, envelope: next.payload.envelope };
expect(await a.c.call('POST', '/api/profile/password', pw), 401, 'trocar a senha com PIN ligado, só com a senha atual, é recusado');
expect(await a.c.call('POST', '/api/profile/password', { ...pw, pin: '654321' }), 200, 'senha trocada com o PIN');
check(local(`SELECT COUNT(*) AS n FROM known_devices WHERE user_id = '${a.id}'`)[0].n === 0, 'trocar a senha esquece os aparelhos conhecidos');

// ---------- Senha nova pelo link derruba chaves de API e aparelhos ----------
const b = await signup('segb', 'mais uma senha de teste ' + Date.now());
let mark = readFileSync(LOG, 'utf8').length;
await b.c.call('POST', '/api/profile/recovery', { email: `segb${Date.now()}@exemplo.com.br` });
expect(await new Client().call('POST', '/api/auth/recovery/confirm', { token: await linkFromLog('confirmar', mark) }), 200, 'e-mail de recuperação confirmado');
const key = (await b.c.call<{ key: string }>('POST', '/api/apikeys', { name: 'teste', authKey: b.authKey })).data.key;
expect(await new Client(key).call('GET', '/api/agents'), 200, 'chave de API funciona antes');
const before = Date.now();
mark = readFileSync(LOG, 'utf8').length;
await new Client().call('POST', '/api/auth/forgot', { address: b.address });
const fresh = await newAccountKeys('senha depois do reset ' + Date.now());
const bAfter = new Client();
const reset = await bAfter.call('POST', '/api/auth/reset', { token: await linkFromLog('nova-senha', mark), ...fresh.payload });
check(reset.status === 200, 'senha nova pelo link');
expect(await new Client(key).call('GET', '/api/agents'), 401, 'a chave de API criada antes caiu');
check(local(`SELECT COUNT(*) AS n FROM known_devices WHERE user_id = '${b.id}' AND created_at < ${before}`)[0].n === 0, 'os aparelhos conhecidos de antes caíram');

// ---------- Criar PIN com duas etapas ligadas, e apagar a conta, pedem o fator ----------
const d = await signup('segd', 'senha da conta d ' + Date.now());
const dStart = await d.c.call<{ secret: string }>('POST', '/api/profile/totp/start', { authKey: d.authKey });
const dStep = Math.floor(Date.now() / 30000);
const dOn = await d.c.call<{ codes: string[] }>('POST', '/api/profile/totp/enable', { code: totp(dStart.data.secret, dStep) });
check(dOn.status === 200, 'conta com duas etapas');
expect(await d.c.call('POST', '/api/profile/pin', { authKey: d.authKey, pin: '135792' }), 401, 'criar PIN com duas etapas ligadas, só com a senha, é recusado');
expect(await d.c.call('POST', '/api/profile/pin', { authKey: d.authKey, pin: '135792', recovery: dOn.data.codes[0] }), 200, 'criar PIN com um código de recuperação');
expect(await d.c.call('POST', '/api/profile/delete', { authKey: d.authKey, confirm: d.address }), 401, 'apagar a conta com PIN e duas etapas, só com a senha, é recusado');
expect(await d.c.call('POST', '/api/profile/delete', { authKey: d.authKey, confirm: d.address, pin: '135792', recovery: dOn.data.codes[1] }), 200, 'apagar a conta com PIN e código de recuperação');

// ---------- Token de aviso por conta ----------
const token = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
expect(await a.c.call('POST', '/api/push/register', { token, env: 'sandbox' }), 200, 'aparelho registrado na conta A');
const other = await signup('segc', 'senha da conta c ' + Date.now());
expect(await other.c.call('POST', '/api/push/register', { token, env: 'sandbox' }), 200, 'o mesmo token registrado em outra conta');
check(local(`SELECT user_id FROM push_tokens WHERE token = '${token}'`).map((r: { user_id: string }) => r.user_id).sort().join() === [a.id, other.id].sort().join(), 'a conta A continua com o aparelho (uma linha por conta)');
await other.c.call('POST', '/api/push/unregister', { token });
check(local(`SELECT user_id FROM push_tokens WHERE token = '${token}'`).map((r: { user_id: string }) => r.user_id).join() === a.id, 'a outra conta só tira a própria linha');

// ---------- Limpeza: as contas criadas aqui saem ----------
for (const [who, body] of [[conf.c, { authKey: conf.authKey, confirm: conf.address }], [a.c, { authKey: next.payload.authKey, confirm: a.address, pin: '654321' }],
  [bAfter, { authKey: fresh.payload.authKey, confirm: b.address }], [other.c, { authKey: other.authKey, confirm: other.address }]] as const) {
  if ((await who.call('POST', '/api/profile/delete', body)).status !== 200) console.log('       (não apagou uma conta de teste)');
}

console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
