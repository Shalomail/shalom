// Teste de ponta a ponta das caixas de agente, rodando o CLI de verdade (cli/dist/shalom.mjs) contra o
// Worker local: chave de API, criar caixa, limite do plano grátis, receber de fora e de outra conta
// Shalom, ler, responder, enviar, vigiar, escopo das chaves, trocar a chave e apagar.
// Rodar: node cli/build.mjs && node scripts/run-ts.mjs scripts/smoke-agents.ts
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MessageHead } from '../shared/head';
import { fromB64, openJson } from '../shared/seal';
import { openFromSender } from '../shared/sender';
import { newAccountKeys } from '../web/src/lib/keys';
import { buildMime, newMessageId, textToHtml } from '../web/src/lib/mime';
import { deliverAnon, getToken, sealFor, sendSealed } from './sealed';
import { pack, unpack } from '../shared/pack';
import { toB64 } from '../shared/seal';

const BASE = process.env.SHALOM_API || 'http://127.0.0.1:8790';
const DOMAIN = 'shalomail.com';
const CLI = join(process.cwd(), 'cli/dist/shalom.mjs');
let failures = 0;
const check = (ok: unknown, label: string) => { console.log(`${ok ? 'ok  ' : 'FALHOU'} ${label}`); if (!ok) failures++; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

async function signup(local: string) {
  const c = new Client();
  const { secretKey, payload } = await newAccountKeys('agentes-' + local);
  const r = await c.call('POST', '/api/auth/signup', { address: local, name: local, turnstile: 'XXXX.DUMMY.TOKEN.XXXX', ...payload });
  if (r.status !== 200) throw new Error(`cadastro ${local}: ${JSON.stringify(r.data)}`);
  return { c, secretKey, authKey: payload.authKey as string, user: r.data.user as { id: string; address: string; publicKey: string } };
}

const config = mkdtempSync(join(tmpdir(), 'shalom-cli-'));
const env = { ...process.env, SHALOM_CONFIG_DIR: config, SHALOM_API_URL: BASE };
function cli(args: string[], input?: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env, input, encoding: 'utf8' });
  let json: any = null;
  try { json = JSON.parse(r.stdout); } catch { /* saída para gente */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

// Empacotamento: degrau de tamanho, volta igual, e o formato antigo (gzip puro) ainda abre.
{
  const small = await pack(new TextEncoder().encode('oi'));
  const back = new TextDecoder().decode(await unpack(small));
  const old = new Uint8Array(await new Response(new Blob([new TextEncoder().encode('formato antigo')]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  check(small.length === 256 && back === 'oi' && new TextDecoder().decode(await unpack(old)) === 'formato antigo', 'empacotamento com degrau de tamanho, e o formato antigo ainda abre');
  const big = await pack(crypto.getRandomValues(new Uint8Array(40_000)));
  check(big.length % 2048 === 0 && big.length < 40_000 * 1.07, 'degrau de tamanho custa menos de 7% numa mensagem grande');
}

const tag = Date.now().toString(36).slice(-5);
const owner = await signup(`dono${tag}`);
const friend = await signup(`amiga${tag}`);
// Chaves de API, conectar o terminal e apagar caixas pela página pedem a pessoa confirmada (10 minutos).
check((await owner.c.call('POST', '/api/profile/confirm', { authKey: owner.authKey })).status === 200, 'dono confirmou que é ele');

// Chave de API da conta, criada pela sessão do app.
const created = await owner.c.call<{ key: string }>('POST', '/api/apikeys', { name: 'teste' });
check(created.status === 200 && created.data.key.startsWith('shalom_sk_'), 'chave de API da conta criada');
const accountKey = created.data.key;
const listed = await owner.c.call<{ keys: { hint: string }[] }>('GET', '/api/apikeys');
check(listed.data.keys.length === 1 && listed.data.keys[0].hint === accountKey.slice(-4), 'lista mostra só o fim da chave');
check((await new Client(accountKey).call('POST', '/api/apikeys', { name: 'x' })).status === 403, 'chave de API não cria outra chave');

check(cli(['login', '--key', accountKey, '--json']).json?.account === owner.user.address, 'shalom login');

// Login pelo navegador: o terminal mostra o código, a pessoa aprova pela sessão do app e o terminal recebe a chave.
async function browserLogin(approve: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'shalom-browser-'));
  const child = spawn(process.execPath, [CLI, 'login', '--no-browser', '--json'], { env: { ...env, SHALOM_CONFIG_DIR: dir } });
  let err = '';
  let out = '';
  child.stderr.on('data', d => { err += d; });
  child.stdout.on('data', d => { out += d; });
  for (let i = 0; i < 50 && !/[A-Z0-9]{4}-[A-Z0-9]{4}/.test(err); i++) await sleep(100);
  const code = /([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(err)?.[1] ?? '';
  const seen = await owner.c.call<{ device: string }>('GET', `/api/cli/request?codigo=${code}`);
  const decided = await owner.c.call('POST', approve ? '/api/cli/approve' : '/api/cli/deny', { code });
  const exit = await new Promise<number | null>(r => child.on('close', r));
  return { code, seen, decided, exit, out, err, dir };
}
const ok = await browserLogin(true);
check(ok.code && ok.seen.status === 200 && ok.seen.data.device.includes('shalom'), 'shalom login mostra o código e a página vê o pedido do terminal');
check(ok.decided.status === 200 && ok.exit === 0 && JSON.parse(ok.out).account === owner.user.address, 'shalom login pelo navegador termina sozinho com a conta certa');
check((await owner.c.call('GET', `/api/cli/request?codigo=${ok.code}`)).status === 404, 'código usado não vale de novo');
check(cli(['agents', 'list', '--json'], undefined).code === 0, 'a chave recebida pelo navegador funciona');
const no = await browserLogin(false);
check(no.exit === 1 && /cancelled/.test(no.out + no.err), 'recusar no navegador cancela o login do terminal');
const start = await (await fetch(`${BASE}/api/cli/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shalom': '1' }, body: JSON.stringify({ device: 'x', publicKey: owner.user.publicKey }) })).json() as { code: string };
check((await new Client(accountKey).call('POST', '/api/cli/approve', { code: start.code })).status === 403, 'chave de API não aprova outro terminal');
check((await new Client().call('POST', '/api/cli/approve', { code: start.code })).status === 401, 'aprovar exige conta aberta');
check(cli(['whoami', '--json']).json?.account === owner.user.address, 'shalom whoami');

// Plano grátis: 2 caixas.
const bot = `bot${tag}`;
const one = cli(['agents', 'create', bot, '--name', 'Bot de Teste', '--json']);
check(one.code === 0 && one.json?.address === `${bot}@${DOMAIN}`, `shalom agents create ${bot}`);
const two = cli(['agents', 'create', `bot2${tag}`, '--json']);
check(two.code === 0, 'segunda caixa grátis');
const three = cli(['agents', 'create', `bot3${tag}`, '--json']);
check(three.code === 1 && three.json?.error === 'agent_limit', 'terceira caixa barrada pelo plano grátis');
const list = cli(['agents', 'list', '--json']).json;
check(list?.agents?.length === 2 && list.plan.limit === 2 && list.agents.every((a: any) => a.onThisMachine && !a.paused), 'shalom agents list');
check(cli(['plan', '--json']).json?.plan === 'free', 'shalom plan');
check(cli(['upgrade', '--json']).json?.url?.endsWith('/agentes-ia#ag-plans'), 'upgrade leva para a página de planos do app');
check((await new Client(accountKey).call('POST', '/api/billing/checkout', { plan: 'agents5' })).status === 403, 'chave da conta não mexe em cobrança');
check((await new Client(accountKey).call('GET', '/api/billing')).status === 200, 'chave da conta ainda vê o plano');

const address = `${bot}@${DOMAIN}`;
const as = ['--as', address];

// Caixa de agente não entra por senha.
check((await new Client().call('POST', '/api/auth/exists', { address })).data.exists === false, 'caixa de agente não aparece no login por senha');
check((await new Client().call('POST', '/api/auth/available', { address })).data.available === false, 'endereço da caixa fica ocupado');

// Recebe de fora...
const raw = [
  `From: Loja <pedidos@loja.example>`, `To: ${address}`, `Subject: Pedido 123`, `Date: ${new Date().toUTCString()}`,
  `Message-ID: <p123-${tag}@loja.example>`, 'Authentication-Results: mx.cloudflare.net; dkim=pass; spf=pass; dmarc=pass header.from=loja.example',
  'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'Seu pedido 123 saiu para entrega.',
].join('\r\n');
check((await fetch(`${BASE}/cdn-cgi/handler/email?from=pedidos@loja.example&to=${address}`, { method: 'POST', body: raw })).ok, 'e-mail de fora entregue na caixa do agente');

// ...e de outra conta Shalom, lacrado de ponta a ponta.
const agentPub = fromB64((await new Client().call('POST', '/api/keys', { address })).data.publicKey);
const draft = {
  from: { name: 'Amiga', address: friend.user.address }, to: [{ name: '', address }], cc: [], bcc: [],
  subject: 'Oi agente', text: 'Pode resumir o relatório?', html: textToHtml('Pode resumir o relatório?'), messageId: newMessageId(DOMAIN), date: new Date(),
};
const as2 = (m: string, p: string, b?: unknown) => friend.c.call(m, p, b);
await sendSealed(BASE, as2, friend.secretKey, { address, publicKey: agentPub }, buildMime(draft, false), buildMime(draft, true));

const inbox = cli(['inbox', ...as, '--json']).json as any[];
check(Array.isArray(inbox) && inbox.length === 2, 'shalom inbox mostra as 2 mensagens');
const fromFriend = inbox?.find(m => m.from?.address === friend.user.address);
const fromShop = inbox?.find(m => m.subject === 'Pedido 123');
check(fromFriend?.verifiedSender === true && fromFriend.subject === 'Oi agente', 'remetente Shalom conferido pelo certificado');
check(fromShop?.auth === 'pass' && fromShop.verifiedSender === false, 'e-mail de fora com DMARC aprovado');
check(cli(['inbox', ...as]).out.includes('Pedido 123'), 'saída para gente');

// A chave da amiga fica fixada na primeira mensagem dela. Se a chave do certificado mudar (conta tomada e
// recuperada com chave nova), a mensagem deixa de valer como conferida.
const pinnedFile = join(config, 'agents', `${address}.json`);
const keptFile = readFileSync(pinnedFile, 'utf8');
const friendPin = JSON.parse(keptFile).pins?.[friend.user.address];
check(typeof friendPin === 'string' && friendPin.length > 0, 'chave da amiga fixada ao receber');
writeFileSync(pinnedFile, JSON.stringify({ ...JSON.parse(keptFile), pins: { ...JSON.parse(keptFile).pins, [friend.user.address]: 'A'.repeat(43) + '=' } }));
const swapped = (cli(['inbox', ...as, '--json']).json as any[]).find(m => m.from?.address === friend.user.address);
check(swapped?.verifiedSender === false && swapped?.keyChanged === true, 'chave trocada: não vale como conferida');
check(/key changed/.test(cli(['read', fromFriend.id, ...as, '--keep-unread']).out), 'a leitura avisa que a chave mudou');
writeFileSync(pinnedFile, keptFile);

// E-mail de fora com sequências de escape no assunto e no corpo: na tela do terminal elas não chegam cruas.
const esc = '\u001b]52;c;ZXZpbA==\u0007\u001b[2J';
const escMail = [
  `From: Ruim <ruim@loja.example>`, `To: ${address}`, `Subject: =?utf-8?b?${Buffer.from(`Fatura${esc} paga`).toString('base64')}?=`,
  `Date: ${new Date().toUTCString()}`, `Message-ID: <esc-${tag}@loja.example>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '',
  `Corpo${esc} fim`,
].join('\r\n');
await fetch(`${BASE}/cdn-cgi/handler/email?from=ruim@loja.example&to=${address}`, { method: 'POST', body: escMail });
const escList = cli(['inbox', ...as]).out;
const evilId = (cli(['inbox', ...as, '--json']).json as any[]).find(m => m.from?.address === 'ruim@loja.example')?.id;
const escRead = cli(['read', evilId, ...as]).out;
check(escList.includes('Fatura') && !/[\u001b\u0007]/.test(escList), 'inbox: assunto sem sequência de escape');
check(escRead.includes('Corpo') && escRead.includes('fim') && !/[\u001b\u0007]/.test(escRead), 'read: assunto e corpo sem sequência de escape');

const opened = cli(['read', fromFriend.id.slice(0, 8), ...as, '--json']).json;
check(opened?.text?.includes('resumir o relatório') && opened.messageId === draft.messageId, 'shalom read abre o corpo lacrado (id curto)');
check(cli(['inbox', ...as, '--unread', '--json']).json.length === 1, 'ler marca como lida');

// Responde para a amiga (Shalom) e envia para fora.
const rep = cli(['reply', fromFriend.id, ...as, '--text', 'Resumo: tudo certo.', '--json']);
check(rep.code === 0 && rep.json?.internal === 1, 'shalom reply entrega lacrado para a conta Shalom');
const friendBox = await friend.c.call<{ messages: { head: string; received_at: number }[] }>('GET', '/api/messages?folder=inbox&limit=10');
const heads = await Promise.all(friendBox.data.messages.map(async m => {
  try {
    const cfg = await (await fetch(`${BASE}/api/auth/config`)).json() as { certKey: string };
    const { payload, sender } = await openFromSender(friend.secretKey, fromB64(m.head), 'head', fromB64(cfg.certKey), m.received_at);
    return { h: JSON.parse(new TextDecoder().decode(payload)) as MessageHead, sender: sender.address };
  } catch { return { h: await openJson<MessageHead>(friend.secretKey, fromB64(m.head)).catch(() => null), sender: null }; }
}));
check(heads.some(x => x.sender === address && x.h?.subject === 'Re: Oi agente'), 'a amiga recebe a resposta com o agente como remetente conferido');
const ext = cli(['send', ...as, '--to', 'cliente@example.com', '--subject', 'Relatório', '--json'], 'Segue o relatório.\n');
check(ext.code === 0 && ext.json?.external === 1, 'shalom send para fora, com o texto vindo do stdin');
check(cli(['inbox', ...as, '--folder', 'sent', '--json']).json.length === 2, 'Enviados guarda as 2 mensagens');
check(cli(['move', fromShop.id, ...as, '--to', 'archive', '--json']).code === 0 && cli(['inbox', ...as, '--folder', 'archive', '--json']).json.length === 1, 'shalom move');

// Vigiar: uma mensagem nova aparece como uma linha JSON e roda o comando com ela no stdin.
const watcher = spawn(process.execPath, [CLI, 'watch', ...as, '--interval', '5', '--json', '--exec', 'cat > /dev/null'], { env });
let watched = '';
watcher.stdout.on('data', d => { watched += d; });
await sleep(2500);
await fetch(`${BASE}/cdn-cgi/handler/email?from=alerta@loja.example&to=${address}`, { method: 'POST', body: raw.replace('Pedido 123', 'Alerta 9').replace(`p123-${tag}`, `a9-${tag}`) });
for (let i = 0; i < 20 && !watched.includes('Alerta 9'); i++) await sleep(500);
watcher.kill();
check(watched.includes('"subject":"Alerta 9"'), 'shalom watch mostra a mensagem nova');

// Correções do bug-hunter: nome reservado, --json com opção errada, id que não existe, nome com vírgula,
// watch --mark-read retomando as não lidas, import por cima, arquivo da caixa estragado, logout e teto de chaves.
check(cli(['agents', 'create', 'suporte', '--json']).json?.error === 'reserved', 'nome reservado volta como reserved');
const badOpt = cli(['inbox', '--bogus', '--json']);
check(badOpt.code === 1 && badOpt.json?.error === 'error', '--json com opção desconhecida devolve o erro em JSON');
const ghost = cli(['move', crypto.randomUUID(), ...as, '--to', 'archive', '--json']);
check(ghost.code === 1 && ghost.json?.error === 'not_found', 'move com id que não existe é erro');
const comma = cli(['send', ...as, '--to', '"Silva, Ana" <ana@example.com>', '--subject', 'Vírgula', '--text', 'oi', '--json']);
check(comma.code === 0 && comma.json?.external === 1, 'nome com vírgula entre aspas é uma pessoa só');
check(cli(['inbox', ...as, '--unread', '--json']).json.some((m: any) => m.subject === 'Alerta 9'), 'Alerta 9 ficou sem ler');
const resumer = spawn(process.execPath, [CLI, 'watch', ...as, '--interval', '5', '--json', '--mark-read'], { env });
let resumed = '';
resumer.stdout.on('data', d => { resumed += d; });
for (let i = 0; i < 20 && !resumed.includes('Alerta 9'); i++) await sleep(250);
await sleep(500);
resumer.kill();
check(resumed.includes('"subject":"Alerta 9"') && !resumed.includes('"subject":"Oi agente"'), 'watch --mark-read retoma só as não lidas');
check(cli(['inbox', ...as, '--unread', '--json']).json.length === 0, 'watch --mark-read marca como lida');
const token2 = cli(['agents', 'export', `bot2${tag}@${DOMAIN}`, '--json']).json?.token as string;
check(cli(['agents', 'import', token2, '--json']).code === 0, 'import do mesmo token não troca nada');
const forged = 'shalom_agent_' + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(token2.slice(13), 'base64url').toString()), k: 'shalom_ag_outra' })).toString('base64url');
check(cli(['agents', 'import', forged, '--json']).code === 1, 'import com outras chaves por cima pede --yes');
check(cli(['agents', 'export', `bot2${tag}@${DOMAIN}`, '--json']).json?.token === token2, 'a caixa salva ficou como estava');
{
  const broken = mkdtempSync(join(tmpdir(), 'shalom-broken-'));
  mkdirSync(join(broken, 'agents'));
  writeFileSync(join(broken, 'agents', `x${tag}@${DOMAIN}.json`), '{ quebrado');
  const r = spawnSync(process.execPath, [CLI, 'inbox', '--as', `x${tag}@${DOMAIN}`], { env: { ...env, SHALOM_CONFIG_DIR: broken }, encoding: 'utf8' });
  check(r.status === 1 && /could not be read/.test(r.stderr) && readFileSync(join(broken, 'agents', `x${tag}@${DOMAIN}.json`), 'utf8') === '{ quebrado', 'arquivo da caixa estragado vira erro claro e fica intacto');
  rmSync(broken, { recursive: true, force: true });
}
{
  const before = (await owner.c.call<{ keys: unknown[] }>('GET', '/api/apikeys')).data.keys.length;
  for (let i = before; i < 10; i++) await owner.c.call('POST', '/api/apikeys', { name: `enche${i}` });
  const full = await browserLogin(true);
  const after = (await owner.c.call<{ keys: { name: string }[] }>('GET', '/api/apikeys')).data.keys;
  check(full.exit === 0 && after.length === 10 && after.some(k => k.name.startsWith('CLI')), 'aprovar no teto de 10 chaves troca uma parada pela nova');
  check(cli(['agents', 'list', '--json']).code === 0, 'a chave em uso continua valendo');
  const key = JSON.parse(readFileSync(join(full.dir, 'config.json'), 'utf8')).accountKey as string;
  const out = spawnSync(process.execPath, [CLI, 'logout', '--json'], { env: { ...env, SHALOM_CONFIG_DIR: full.dir }, encoding: 'utf8' });
  check(JSON.parse(out.stdout).revoked === true && (await new Client(key).call('GET', '/api/agents')).status === 401, 'shalom logout revoga a chave no servidor');
  const stale = await fetch(`${BASE}/api/cli/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shalom': '1' }, body: JSON.stringify({ device: 'x', publicKey: owner.user.publicKey }) }).then(r => r.json()) as { code: string };
  await owner.c.call('POST', '/api/cli/approve', { code: stale.code });
  check((await owner.c.call('POST', '/api/cli/deny', { code: stale.code })).status === 404, 'cancelar depois de aprovado não finge que cancelou');
  for (const k of (await owner.c.call<{ keys: { id: string; name: string }[] }>('GET', '/api/apikeys')).data.keys) if (k.name.startsWith('enche') || k.name.startsWith('CLI')) await owner.c.call('POST', '/api/apikeys/revoke', { id: k.id });
}

// Servidor malicioso servindo o cabeçalho de uma mensagem com o corpo de outra do mesmo remetente: recusado.
{
  const certF = (await friend.c.call('POST', '/api/cert', {})).data.cert;
  const mA = buildMime({ ...draft, subject: 'Mensagem A', text: 'corpo A', html: textToHtml('corpo A'), messageId: newMessageId(DOMAIN) }, false);
  const mB = buildMime({ ...draft, subject: 'Mensagem B', text: 'corpo B', html: textToHtml('corpo B'), messageId: newMessageId(DOMAIN) }, false);
  const sA = await sealFor(agentPub, friend.secretKey, certF, mA);
  const sB = await sealFor(agentPub, friend.secretKey, certF, mB);
  const tk = await getToken(BASE, as2);
  await deliverAnon(BASE, { to: address, head: sA.head, raw: sB.raw, token: toB64(tk.token), sig: tk.sig });
  const swapped = (cli(['inbox', ...as, '--json']).json as any[]).find(m => m.subject === 'Mensagem A');
  const r = cli(['read', swapped.id, ...as, '--json']);
  check(r.code === 1 && r.json?.error === 'tampered', 'corpo de outra mensagem debaixo de um cabeçalho verdadeiro é recusado');
}

// Escopo das chaves.
const agentFile = JSON.parse(cli(['agents', 'export', address, '--json']).out).token as string;
check(agentFile.startsWith('shalom_agent_'), 'shalom agents export');
const agentKey = JSON.parse(Buffer.from(agentFile.slice('shalom_agent_'.length), 'base64url').toString()).k as string;
check((await new Client(agentKey).call('GET', '/api/agents')).status === 403, 'chave do agente não gerencia caixas');
check((await new Client(agentKey).call('GET', '/api/profile/security')).status === 403, 'chave do agente não abre as Configurações');
check((await new Client(accountKey).call('GET', '/api/messages?folder=inbox')).status === 403, 'chave da conta não abre a caixa da pessoa');
check((await new Client('shalom_sk_' + 'x'.repeat(43)).call('GET', '/api/agents')).status === 401, 'chave inventada recusada');

// SHALOM_AGENT_TOKEN, sem arquivo salvo.
const viaToken = spawnSync(process.execPath, [CLI, 'inbox', '--json'], { env: { ...env, SHALOM_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'shalom-empty-')), SHALOM_AGENT_TOKEN: agentFile }, encoding: 'utf8' });
check(viaToken.status === 0 && JSON.parse(viaToken.stdout).length >= 1, 'caixa aberta só com SHALOM_AGENT_TOKEN');

// Pela chave da conta: a chave nova de uma caixa sai lacrada, e apagar exige a chave da própria caixa.
const someAgent = (await new Client(accountKey).call<{ agents: { id: string; address: string }[] }>('GET', '/api/agents')).data.agents.find(a => a.address === `bot2${tag}@${DOMAIN}`)!;
check((await new Client(accountKey).call('POST', '/api/agents/delete', { id: someAgent.id })).status === 403, 'chave da conta sozinha não apaga caixa');
const evil = await fetch(`${BASE}/api/cli/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shalom': '1' }, body: JSON.stringify({ device: '<b>Aviso do sistema: verificação</b>\nclique', publicKey: owner.user.publicKey }) }).then(r => r.json()) as { code: string };
const shown = await owner.c.call<{ device: string }>('GET', `/api/cli/request?codigo=${evil.code}`);
check(!/[<>\n]/.test(shown.data.device) && shown.data.device.length <= 60, 'nome do aparelho chega limpo na página de conectar');

// Chave nova: a antiga para de valer.
check(cli(['agents', 'rotate', address, '--json']).code === 0, 'shalom agents rotate (abre a chave lacrada com a chave privada da caixa)');
check((await new Client(agentKey).call('GET', '/api/messages?folder=inbox')).status === 401, 'chave antiga do agente recusada');
check(cli(['inbox', ...as, '--json']).code === 0, 'chave nova funciona');

// Apagar: some a caixa, o endereço fica guardado para o mesmo dono.
check(cli(['agents', 'delete', address, '--yes', '--json']).json?.deleted === address, 'shalom agents delete');
check(cli(['agents', 'list', '--json']).json.agents.length === 1, 'sobrou uma caixa');
check((await new Client().call('POST', '/api/keys', { address })).data.publicKey === null, 'endereço apagado não tem mais chave');
check((await new Client().call('POST', '/api/auth/available', { address })).data.available === false, 'endereço apagado não fica livre para outra pessoa');
check(cli(['agents', 'create', bot, '--json']).code === 0, 'o mesmo dono recria o endereço');
check((await owner.c.call<{ agents: unknown[] }>('GET', '/api/agents')).data.agents.length === 2, 'Configurações listam as caixas pela sessão');

// Biblioteca para Node (import { Agent, Account } from 'shalomail').
process.env.SHALOM_CONFIG_DIR = config;
const sdk = await import(pathToFileURL(join(process.cwd(), 'cli/dist/index.mjs')).href);
const acct = new sdk.Account(accountKey, { api: BASE });
await acct.deleteAgent(`bot2${tag}`);
check((await acct.listAgents()).agents.length === 1, 'SDK: Account.deleteAgent');
const made = await acct.createAgent(`sdk${tag}`, { displayName: 'SDK' });
check(made.address === `sdk${tag}@${DOMAIN}` && made.token.startsWith('shalom_agent_'), 'SDK: Account.createAgent devolve o token');
const agent = sdk.Agent.fromToken(made.token);
check((await agent.inbox()).length === 0, 'SDK: Agent.inbox vazia');
await fetch(`${BASE}/cdn-cgi/handler/email?from=pedidos@loja.example&to=${made.address}`, { method: 'POST', body: raw.replace(address, made.address).replace(`p123-${tag}`, `sdk-${tag}`) });
const first = (await agent.inbox())[0];
const msg = await agent.read(first.id.slice(0, 8));
check(msg.subject === 'Pedido 123' && msg.text.includes('saiu para entrega') && msg.messageId === `<sdk-${tag}@loja.example>`, 'SDK: Agent.read abre a mensagem');
check((await agent.reply(first.id, { text: 'Obrigado!' })).external === 1, 'SDK: Agent.reply para fora');
check((await agent.send({ to: friend.user.address, subject: 'Do SDK', text: 'Oi', attachments: [{ filename: 'nota.txt', content: new TextEncoder().encode('ola') }] })).internal === 1, 'SDK: Agent.send lacrado para conta Shalom, com anexo');
const ac = new AbortController();
const next = agent.watch({ interval: 5, signal: ac.signal })[Symbol.asyncIterator]().next();
await sleep(1500);
await fetch(`${BASE}/cdn-cgi/handler/email?from=alerta@loja.example&to=${made.address}`, { method: 'POST', body: raw.replace(address, made.address).replace('Pedido 123', 'Novo pelo SDK').replace(`p123-${tag}`, `sdk2-${tag}`) });
const got = await Promise.race([next, sleep(15000).then(() => null)]);
ac.abort();
check(got && !got.done && got.value.subject === 'Novo pelo SDK', 'SDK: Agent.watch entrega a mensagem nova');

// Unlimited: sem limite de caixas, até 250 novas por dia (plano gravado direto no banco local).
const d1 = (sql: string) => spawnSync('npx', ['wrangler', 'd1', 'execute', 'shalom', '--local', '--command', sql], { encoding: 'utf8' });
d1(`INSERT INTO billing (user_id, plan, status, updated_at) VALUES ('${owner.user.id}', 'unlimited', 'active', ${Date.now()}) ON CONFLICT(user_id) DO UPDATE SET plan = 'unlimited', status = 'active'`);
const unl = await acct.listAgents();
check(unl.plan.plan === 'unlimited' && unl.plan.limit === null, 'Unlimited: plano sem limite de caixas');
const extra = [];
for (let i = 0; i < 3; i++) extra.push((await acct.createAgent(`unl${i}${tag}`)).address);
check((await acct.listAgents()).agents.length === 5 && (await acct.listAgents()).agents.every((a: any) => !a.paused), 'Unlimited: passa de 2 caixas e nenhuma fica pausada');
d1(`UPDATE counters SET count = 250 WHERE key = 'agents-new:${owner.user.id}'`);
const capped = await acct.createAgent(`unlx${tag}`).catch((e: any) => e);
check(capped?.code === 'create_limit', 'Unlimited: a 251ª caixa do dia é barrada');

rmSync(config, { recursive: true, force: true });
console.log(failures ? `${failures} falha(s)` : 'Tudo certo.');
process.exit(failures ? 1 : 0);
