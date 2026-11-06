import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { fromB64, toB64 } from '../shared/seal';
import type { AppEnv, Env } from './env';

const enc = new TextEncoder();

export const now = () => Date.now();

export function fail(c: Context, status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 429 | 500 | 502, error: string, message: string) {
  return c.json({ error, message }, status);
}

// Conta suspensa por abuso (Termos, item 5; worker/admin.ts). Mesma resposta no login, na sessão e nas chaves.
export const suspended = (c: Context) =>
  fail(c, 403, 'suspended', 'Esta conta foi suspensa por violar os Termos de Uso. Se achar que foi engano, escreva para abuse@shalomail.com.');

export async function hmac(secret: string, data: string | Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
}

export async function sha256(data: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(data))));
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export function randomToken(bytes = 32): string {
  return toB64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Segunda tranca do envelope: AES-GCM com a ENVELOPE_KEY, presa ao id da conta.
async function envelopeKey(env: Env) {
  const raw = fromB64(env.ENVELOPE_KEY);
  if (raw.length !== 32) throw new Error('ENVELOPE_KEY precisa ter 32 bytes em base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function lockEnvelope(env: Env, userId: string, envelope: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(userId) }, await envelopeKey(env), enc.encode(envelope));
  return `v1.${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

export async function unlockEnvelope(env: Env, userId: string, locked: string): Promise<string> {
  const [v, iv, ct] = locked.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('envelope em formato desconhecido');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(userId) }, await envelopeKey(env), fromB64(ct));
  return new TextDecoder().decode(pt);
}

// A cota do Email Service é da conta Cloudflare inteira (dividida com os outros sites da mesma conta). O Shalom usa no máximo SEND_CAP por dia: o que as pessoas mandam para fora para em
// SEND_CAP_PEOPLE, e o resto fica para os e-mails do sistema (confirmar o e-mail de recuperação, senha
// nova), que assim sempre têm vaga. Quando a Cloudflare aumentar a cota, sobe os dois no wrangler.jsonc.
// Valor vazio ou inválido usa o padrão; 0 vale (SEND_CAP_PEOPLE=0 fecha o envio para fora).
const numOr = (v: string | undefined, fallback: number) => (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
export const sendCaps = (env: Env) => ({
  people: Math.max(0, numOr(env.SEND_CAP_PEOPLE, 100)),
  total: Math.max(1, numOr(env.SEND_CAP, 160)),
});
// Painel de administração: soma n na métrica do dia (tabela stats). Contagem nunca derruba o pedido.
export const tally = (db: D1Database, metric: string, n = 1) =>
  db.prepare('INSERT INTO stats (day, metric, n) VALUES (?, ?, ?) ON CONFLICT(day, metric) DO UPDATE SET n = n + excluded.n')
    .bind(new Date().toISOString().slice(0, 10), metric, n).run().then(() => undefined, () => undefined);

export const sendsKey = () => `send:all:${new Date().toISOString().slice(0, 10)}`;
// Contadores separados de pessoas e do sistema: os e-mails do sistema (que qualquer um provoca, como o link
// de senha nova) não comem a parte das pessoas, nem o contrário. send:all segue com o total do dia.
export const peopleSendsKey = () => `send:people:${new Date().toISOString().slice(0, 10)}`;
export const systemSendsKey = () => `send:system:${new Date().toISOString().slice(0, 10)}`;

// Contador com janela: soma `by` e devolve o total dentro da janela atual.
export async function bump(db: D1Database, key: string, windowMs: number, by = 1): Promise<number> {
  const t = now();
  const row = await db.prepare(
    `INSERT INTO counters (key, count, reset_at) VALUES (?1, ?4, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN reset_at <= ?3 THEN ?4 ELSE count + ?4 END,
       reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
     RETURNING count`,
  ).bind(key, t + windowMs, t, by).first<{ count: number }>();
  return row?.count ?? by;
}

export async function peek(db: D1Database, key: string): Promise<number> {
  const row = await db.prepare('SELECT count, reset_at FROM counters WHERE key = ?').bind(key).first<{ count: number; reset_at: number }>();
  return row && row.reset_at > now() ? row.count : 0;
}

// Teto de corpo lido em fluxo (vale também sem content-length). As rotas com arquivo grande usam depois do
// login; o teto pequeno de todo o resto fica em index.ts.
export const MB = 1024 * 1024;
export const bodyCap = (maxSize: number) => bodyLimit({ maxSize, onError: c => fail(c, 413, 'too_big', 'Pedido grande demais.') });

// Chave pública que já é de outra conta (ou de outra caixa de agente): recusada, para ninguém se passar pela
// autoria de mensagens de outra pessoa reaproveitando a chave dela.
export async function keyInUse(db: D1Database, publicKey: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS x FROM users WHERE public_key = ? LIMIT 1').bind(publicKey).first());
}

export async function clear(db: D1Database, key: string) {
  await db.prepare('DELETE FROM counters WHERE key = ?').bind(key).run();
}

// IPv6 conta pelo prefixo /64: qualquer servidor tem milhões de endereços dentro dele.
export function clientIp(c: Context<AppEnv>): string {
  // Em produção a Cloudflare sempre escreve este cabeçalho na borda. Sem ele, um balde próprio, que não se
  // confunde com o endereço local do desenvolvimento.
  const ip = c.req.header('cf-connecting-ip') || 'sem-ip';
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const full = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return `${full.slice(0, 4).map(x => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

const LOCAL = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/;
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'postmaster', 'hostmaster', 'webmaster', 'abuse', 'security', 'noreply', 'no-reply',
  'mailer-daemon', 'support', 'suporte', 'contato', 'contact', 'help', 'ajuda', 'info', 'billing', 'financeiro', 'shalom', 'shalomail',
  'team', 'equipe', 'oi', 'hello', 'privacy', 'privacidade', 'legal', 'juridico', 'dpo', 'ssl-admin', 'www', 'mail', 'email',
  'seguranca', 'atendimento', 'sac', 'ouvidoria', 'naoresponda', 'recuperacao', 'verificacao', 'conta', 'contas', 'cobranca',
  'pagamentos', 'sistema', 'system', 'daemon', 'mailer',
].map(r => r.replace(/[._-]/g, '')));

// Aceita "thomaz" ou "thomaz@dominio" e devolve o endereço completo, ou null se não servir.
export function normalizeAddress(env: Env, input: string): string | null {
  const s = String(input || '').trim().toLowerCase();
  const [local, domain] = s.includes('@') ? s.split('@') : [s, env.MAIL_DOMAIN];
  if (domain !== env.MAIL_DOMAIN || !local || !LOCAL.test(local) || /[._-]{2}/.test(local)) return null;
  return `${local}@${domain}`;
}

// thomaz.jr, thomaz-jr e thomazjr são o mesmo endereço para efeito de dono.
export function canonicalOf(address: string): string {
  return address.split('@')[0].replace(/[._-]/g, '');
}

export function isReserved(address: string): boolean {
  const c = canonicalOf(address);
  return RESERVED.has(c) || c.includes('shalom');
}

const EMAIL_RE = /^[^\s@<>()",;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
export const isEmail = (s: string) => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);
