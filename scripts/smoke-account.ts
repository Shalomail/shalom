// Teste de ponta a ponta de apagar e suspender conta, contra o Worker local: a pessoa apaga a própria
// conta (senha e endereço digitado), o endereço fica reservado e as caixas de agente somem junto; a
// administração (ADMIN_KEY do .dev.vars) suspende, desfaz e apaga.
// Rodar: node scripts/run-ts.mjs scripts/smoke-account.ts
import { readFileSync } from 'node:fs';
import { newKeyPair, toB64 } from '../shared/seal';
import { newAccountKeys } from '../web/src/lib/keys';

const BASE = process.env.SHALOM_API || 'http://127.0.0.1:8790';
const ADMIN = /^ADMIN_KEY=(.+)$/m.exec(readFileSync('.dev.vars', 'utf8'))?.[1]?.trim() ?? '';
let failures = 0;
const check = (ok: unknown, label: string) => { console.log(`${ok ? 'ok  ' : 'FALHOU'} ${label}`); if (!ok) failures++; };

class Client {
  jar = new Map<string, string>();
  constructor(private bearer = '') {}
  async call<T = any>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-shalom': '1', cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); this.jar.set(k, v.join('=')); }
    return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
  }
}

async function signup(local: string) {
  const c = new Client();
  const { payload } = await newAccountKeys('conta-' + local);
  const r = await c.call('POST', '/api/auth/signup', { address: local, name: local, turnstile: 'XXXX.DUMMY.TOKEN.XXXX', ...payload });
  if (r.status !== 200) throw new Error(`cadastro ${local}: ${JSON.stringify(r.data)}`);
  return { c, authKey: payload.authKey, address: r.data.user.address as string };
}
const admin = (path: string, body: unknown, key = ADMIN) => new Client().call('POST', `/api/admin/${path}`, body, { 'x-admin-key': key });
const login = (address: string, authKey: string) => new Client().call('POST', '/api/auth/login', { address, authKey });

const tag = Date.now().toString(36).slice(-5);

// Administração: sem a chave certa, as rotas nem aparecem.
check((await admin('user', { address: 'ninguem' }, 'errada')).status === 404, 'admin com chave errada responde como se não existisse');

// Suspender: sai das sessões, as chaves (da conta e das caixas de agente) param, o login recusa só depois da senha certa.
const sus = await signup(`susp${tag}`);
const accountKey = (await sus.c.call<{ key: string }>('POST', '/api/apikeys', { name: 'teste', authKey: sus.authKey })).data.key;
const agentAddress = `suspbot${tag}`;
const made = await new Client(accountKey).call<{ key: string }>('POST', '/api/agents', { address: agentAddress, publicKey: toB64(newKeyPair().publicKey) });
check(made.status === 200, 'caixa de agente criada para a conta que vai ser suspensa');
const s1 = await admin('suspend', { address: sus.address, reason: 'spam em massa (teste)' });
check(s1.status === 200 && s1.data.suspended?.reason === 'spam em massa (teste)', 'admin suspende com motivo');
check((await admin('suspend', { address: sus.address })).status === 400, 'suspender sem motivo é recusado');
check((await sus.c.call('GET', '/api/auth/me')).data.error === 'no_session', 'a sessão aberta caiu na suspensão');
check((await new Client(accountKey).call('GET', '/api/agents')).data.error === 'suspended', 'chave da conta suspensa para');
check((await new Client(made.data.key).call('GET', '/api/messages?folder=inbox')).data.error === 'suspended', 'chave da caixa de agente de conta suspensa para');
check((await login(sus.address, toB64(new Uint8Array(32)))).data.error !== 'suspended', 'senha errada não revela a suspensão');
check((await login(sus.address, sus.authKey)).data.error === 'suspended', 'login com a senha certa diz que a conta está suspensa');
check((await admin('unsuspend', { address: sus.address })).data.suspended === null, 'admin desfaz a suspensão');
check((await login(sus.address, sus.authKey)).status === 200, 'depois de desfeita, o login volta');
check((await new Client(accountKey).call('GET', '/api/agents')).status === 200, 'e as chaves voltam a valer');

// Apagar pela própria pessoa.
const del = await signup(`apaga${tag}`);
const key2 = (await del.c.call<{ key: string }>('POST', '/api/apikeys', { name: 'teste', authKey: del.authKey })).data.key;
const bot = `apagabot${tag}`;
await new Client(key2).call('POST', '/api/agents', { address: bot, publicKey: toB64(newKeyPair().publicKey) });
check((await del.c.call('POST', '/api/profile/delete', { authKey: toB64(new Uint8Array(32)), confirm: del.address })).status === 401, 'apagar com senha errada é recusado');
check((await del.c.call('POST', '/api/profile/delete', { authKey: del.authKey, confirm: 'outro@shalomail.com' })).data.error === 'confirm', 'apagar sem o endereço certo é recusado');
check((await new Client(key2).call('POST', '/api/profile/delete', { authKey: del.authKey, confirm: del.address })).status === 403, 'chave de API não apaga a conta');
const gone = await del.c.call('POST', '/api/profile/delete', { authKey: del.authKey, confirm: del.address.toUpperCase() });
check(gone.status === 200, 'a pessoa apaga a própria conta');
check((await del.c.call('GET', '/api/auth/me')).status === 401, 'a sessão some junto');
check((await login(del.address, del.authKey)).status === 401, 'não dá mais para entrar');
check((await new Client(key2).call('GET', '/api/agents')).status === 401, 'a chave de API some junto');
check((await new Client().call('POST', '/api/keys', { address: `${bot}@shalomail.com` })).data.publicKey === null, 'a caixa de agente sumiu junto');
check((await new Client().call('POST', '/api/auth/available', { address: del.address })).data.available === false, 'o endereço apagado fica reservado');
check((await new Client().call('POST', '/api/auth/available', { address: `${bot}@shalomail.com` })).data.available === false, 'o endereço da caixa de agente também');
check((await admin('user', { address: del.address })).status === 404, 'a conta não existe mais para a administração');

// Apagar pela administração (pedido por e-mail ou abuso).
const other = await signup(`adm${tag}`);
const byAdmin = await admin('delete', { address: other.address });
check(byAdmin.status === 200 && byAdmin.data.deleted?.address === other.address, 'admin apaga uma conta');
check((await login(other.address, other.authKey)).status === 401, 'conta apagada pela administração não entra');

console.log(failures ? `${failures} falha(s)` : 'Tudo certo.');
process.exit(failures ? 1 : 0);
