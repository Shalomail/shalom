// Teste do aviso de mensagem nova no iPhone, contra o Worker local e uma Apple de mentira em 127.0.0.1:4498
// (APNS_TEST_HOST no .dev.vars, com uma chave de teste gerada aqui). Confere a assinatura do token JWT, os
// cabeçalhos, que o aviso não leva nada da mensagem, o agrupamento de avisos seguidos e que o aparelho que a
// Apple diz não existir mais sai da lista.
// Rodar: node scripts/run-ts.mjs scripts/smoke-push.ts
import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { newAccountKeys } from '../web/src/lib/keys';

const BASE = process.env.SHALOM_API || 'http://127.0.0.1:8790';
const vars = readFileSync('.dev.vars', 'utf8');
const KEY = /^APNS_KEY=(.+)$/m.exec(vars)?.[1]?.trim() ?? '';
if (!KEY) throw new Error('falta APNS_KEY de teste no .dev.vars');
const pub = createPublicKey(createPrivateKey({ key: Buffer.from(KEY, 'base64'), format: 'der', type: 'pkcs8' }));
let failures = 0;
const check = (ok: unknown, label: string) => { console.log(`${ok ? 'ok  ' : 'FALHOU'} ${label}`); if (!ok) failures++; };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// A Apple de mentira: o aparelho "a…" recebe, o "b…" já foi apagado (410).
const GOOD = 'a'.repeat(64), GONE = 'b'.repeat(64);
const got: { path: string; headers: IncomingHttpHeaders; body: any }[] = [];
const apple = createServer((req, res) => {
  let data = '';
  req.on('data', d => { data += d; });
  req.on('end', () => {
    got.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(data || '{}') });
    if (req.url?.endsWith(GONE)) { res.writeHead(410, { 'content-type': 'application/json' }); res.end('{"reason":"Unregistered"}'); }
    else { res.writeHead(200); res.end(); }
  });
});
await new Promise<void>(r => apple.listen(4498, '127.0.0.1', r));

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
const mail = (to: string, subject: string) => fetch(`${BASE}/cdn-cgi/handler/email?from=carla@empresa.com.br&to=${to}`, {
  method: 'POST',
  body: [`From: Carla <carla@empresa.com.br>`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: <${crypto.randomUUID()}@empresa.com.br>`, `Date: ${new Date().toUTCString()}`, 'Content-Type: text/plain; charset=utf-8', '', 'Olá, tudo bem?', ''].join('\r\n'),
});

const tag = Date.now().toString(36).slice(-5);
const c = new Client();
const { payload } = await newAccountKeys('aviso-' + tag);
const made = await c.call('POST', '/api/auth/signup', { address: `aviso${tag}`, name: 'Aviso', turnstile: 'XXXX.DUMMY.TOKEN.XXXX', lang: 'pt', ...payload });
if (made.status !== 200) throw new Error(`cadastro: ${JSON.stringify(made.data)}`);
const address = made.data.user.address as string;
const userId = made.data.user.id as string;

check((await c.call('POST', '/api/push/register', { token: 'xyz', env: 'sandbox' })).status === 400, 'token que não é de aparelho é recusado');
check((await c.call('POST', '/api/push/register', { token: GOOD, env: 'outro' })).status === 400, 'ambiente desconhecido é recusado');
const key = (await c.call<{ key: string }>('POST', '/api/apikeys', { name: 'teste' })).data.key;
check((await new Client(key).call('POST', '/api/push/register', { token: GOOD, env: 'sandbox' })).status === 403, 'chave de API não registra aparelho');
check((await c.call('POST', '/api/push/register', { token: GOOD, env: 'sandbox' })).status === 200, 'aparelho registrado (sandbox)');
check((await c.call('POST', '/api/push/register', { token: GONE, env: 'production' })).status === 200, 'segundo aparelho registrado (produção)');
check((await c.call('POST', '/api/push/register', { token: GOOD, env: 'sandbox' })).status === 200, 'registrar de novo o mesmo aparelho não dá erro');
check(local(`SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = '${userId}'`)[0].n === 2, 'dois aparelhos na lista, sem repetir');

// Chega um e-mail: um aviso para cada aparelho, assinado, sem nada da mensagem.
check((await mail(address, `Proposta secreta ${tag}`)).ok, 'e-mail de fora entregue');
for (let i = 0; i < 30 && got.length < 2; i++) await wait(200);
check(got.length === 2, `a Apple recebeu um aviso por aparelho (${got.length})`);
const first = got.find(g => g.path.endsWith(GOOD));
check(first?.path === `/3/device/${GOOD}`, 'caminho do APNs com o token do aparelho');
check(first?.headers['apns-topic'] === 'com.shalomail.app' && first?.headers['apns-push-type'] === 'alert' && first?.headers['apns-collapse-id'] === 'new-mail', 'cabeçalhos do APNs (tópico, tipo, agrupamento)');
const [head, claims, sig] = String(first?.headers.authorization ?? '').replace(/^bearer /, '').split('.');
const h = JSON.parse(Buffer.from(head ?? '', 'base64url').toString()), cl = JSON.parse(Buffer.from(claims ?? '', 'base64url').toString());
check(h.alg === 'ES256' && h.kid === 'TESTKEY000' && cl.iss === 'TESTTEAM00' && Math.abs(cl.iat - Date.now() / 1000) < 120, 'token JWT com chave, time e horário');
check(verify('sha256', Buffer.from(`${head}.${claims}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig ?? '', 'base64url')), 'assinatura ES256 confere com a chave');
const unread = (await c.call<{ counts: { inbox?: number } }>('GET', '/api/messages?folder=inbox')).data.counts?.inbox;
check(first?.body.aps?.alert?.body === 'Mensagem nova' && unread && first?.body.aps?.badge === unread, `aviso no idioma da conta, com as não lidas da Entrada (${first?.body.aps?.badge} de ${unread})`);
check(!JSON.stringify(got.map(g => g.body)).includes('Proposta') && !JSON.stringify(got.map(g => g.body)).includes('carla'), 'o aviso não leva assunto nem remetente');
check(local(`SELECT token FROM push_tokens WHERE user_id = '${userId}'`).map((r: { token: string }) => r.token).join() === GOOD, 'o aparelho que a Apple diz não existir saiu da lista');

// Outro e-mail logo em seguida vira o mesmo aviso (um a cada 20 s).
await mail(address, 'Outra');
await wait(1500);
check(got.length === 2, 'e-mails seguidos não disparam outro aviso em menos de 20 s');

// Sair do aparelho tira o token.
check((await c.call('POST', '/api/push/unregister', { token: GOOD })).status === 200, 'aparelho desregistrado ao sair');
check(local(`SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = '${userId}'`)[0].n === 0, 'lista vazia depois de sair');

// Desconectado por outro aparelho (Configurações, Aparelhos): o aviso para na hora.
await c.call('POST', '/api/push/register', { token: GOOD, env: 'sandbox' });
local("DELETE FROM counters WHERE key LIKE 'push:%'");
const other = new Client();
check((await other.call('POST', '/api/auth/login', { address, authKey: payload.authKey })).status === 200, 'entrou de outro aparelho');
const phone = (await other.call<{ sessions: { id: string; current: boolean }[] }>('GET', '/api/auth/sessions')).data.sessions.find(x => !x.current);
check((await other.call('POST', '/api/auth/sessions/revoke', { id: phone?.id })).status === 200, 'desconectou o iPhone por lá');
await mail(address, 'Depois de desconectar');
await wait(1500);
check(got.length === 2, 'iPhone desconectado não recebe mais aviso');

// Apagar a conta tira os aparelhos.
const gone = await other.call('POST', '/api/profile/delete', { authKey: payload.authKey, confirm: address.toUpperCase() });
check(gone.status === 200, 'conta apagada');
check(local(`SELECT COUNT(*) AS n FROM push_tokens WHERE token = '${GOOD}'`)[0].n === 0, 'apagar a conta tira os aparelhos');

apple.close();
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
