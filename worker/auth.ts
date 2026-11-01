// Conta e sessão.
//
// A senha nunca chega aqui. O aparelho roda o Argon2id com o sal da conta e tira dele duas chaves:
// authKey (vem para cá e prova que a pessoa sabe a senha) e wrapKey (fica no aparelho e abre o envelope
// com a chave privada). Aqui guardamos só o HMAC da authKey com o AUTH_PEPPER, que não mora no banco.
// Quem levar só o banco não consegue nem começar a testar senhas.
import type { Context } from 'hono';
import { Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { fromB64, toB64 } from '../shared/seal';
import { honeypotFilled, turnstileOk } from './bots';
import { boxOf } from './box';
import { serverKeys } from './keys';
import { maskEmail, newEmailToken, peekEmailToken, sendReset, spendEmailToken } from './notify';
import { checkTotp } from './totp';
import { leaveWelcome } from './welcome';
import { pickLocale } from '../shared/locale';
import { LOCALES } from '../shared/locales.gen';
import { keyAuth } from './apikeys';
import type { AppEnv, Env, User } from './env';
import { bump, canonicalOf, clear, clientIp, fail, hex, hmac, isReserved, lockEnvelope, normalizeAddress, now, peek, randomToken, sameBytes, sha256, suspended, tally, unlockEnvelope } from './util';

const DAY = 24 * 3600 * 1000;
const SESSION_MS = 30 * DAY;
const DEVICE_MS = 365 * DAY;
const FAIL_WINDOW = 15 * 60 * 1000;
// Cadastros por rede (IP, ou o /64 no IPv6) a cada 24 horas: freio contra robô criando contas em série.
const MAX_SIGNUPS_IP_DAY = 20;
// Teto de cadastros por hora no sistema todo. Passou disso, o cadastro pausa sozinho (ataque em massa).
const MAX_SIGNUPS_HOUR = 500;
// A partir desta falha no mesmo endereço, o login pede o Turnstile (menos em aparelho conhecido).
const CAPTCHA_AFTER = 3;
// Travas duras nunca são só por endereço: isso deixaria qualquer um trancar a conta de outra pessoa.
// Valem para o par endereço + rede, para a rede inteira e para cada aparelho conhecido.
const MAX_FAILS_ADDRESS_IP = 5;
const MAX_FAILS_IP = 50;
const MAX_FAILS_DEVICE = 10;
// Depois da senha, o PIN e/ou o código do autenticador: 5 minutos e 5 tentativas por login, 10 erros
// por hora por conta.
const TICKET_MS = 5 * 60 * 1000;
const MAX_TICKET_TRIES = 5;
const MAX_SECOND_FAILS = 10;
// Tempos de inatividade que a pessoa pode escolher, em minutos (5 min a 30 dias).
export const IDLE_OPTIONS = [5, 10, 30, 60, 300, 720, 1440, 10080, 43200];
// Contas abertas ao mesmo tempo no mesmo navegador. Cada uma tem o próprio cookie de sessão.
const MAX_SLOTS = 5;

// Padrão para contas novas (128 MiB). O piso aceito continua 64 MiB e 3 passadas.
export const DEFAULT_KDF = { alg: 'argon2id', m: 131072, t: 3, p: 1 } as const;
const MIN_KDF = { m: 65536, t: 3 };
type Kdf = { alg: 'argon2id'; m: number; t: number; p: number };

function validKdf(k: unknown): k is Kdf {
  const x = k as Kdf;
  return !!x && x.alg === 'argon2id' && Number.isInteger(x.m) && x.m >= MIN_KDF.m && x.m <= 1048576
    && Number.isInteger(x.t) && x.t >= MIN_KDF.t && x.t <= 20 && Number.isInteger(x.p) && x.p >= 1 && x.p <= 8;
}

function b64Len(s: unknown, len: number): Uint8Array | null {
  if (typeof s !== 'string') return null;
  try {
    const b = fromB64(s);
    return b.length === len ? b : null;
  } catch {
    return null;
  }
}

async function authHash(env: Env, authKey: Uint8Array) {
  return hex(await hmac(env.AUTH_PEPPER, authKey));
}

// Em produção os cookies levam o prefixo __Host- (só https, só este domínio, sem subdomínio).
const secure = (env: Env) => env.APP_ORIGIN.startsWith('https://');
// Uma vaga por conta aberta neste navegador. O app diz qual está usando no cabeçalho X-Shalom-Slot;
// a vaga 0 tem o nome de sempre.
// O WebSocket da caixa ao vivo não manda cabeçalho próprio: ali a vaga vem em ?slot=.
export function slotOf(c: Context<AppEnv>): number {
  const n = Number(c.req.header('x-shalom-slot') || c.req.query('slot') || 0);
  return Number.isInteger(n) && n >= 0 && n < MAX_SLOTS ? n : 0;
}
const sessionCookie = (env: Env, slot: number) => `${secure(env) ? '__Host-' : ''}shalom_sid${slot || ''}`;
const deviceCookie = (env: Env) => (secure(env) ? '__Host-shalom_dev' : 'shalom_dev');
const cookieOpts = (env: Env, maxAgeMs: number) => ({ httpOnly: true, secure: secure(env), sameSite: 'Strict' as const, path: '/', maxAge: maxAgeMs / 1000 });

async function startSession(c: Context<AppEnv>, userId: string, signup = false) {
  const token = randomToken();
  const t = now();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, user_agent, signup) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, t, t + SESSION_MS, t, (c.req.header('user-agent') || '').slice(0, 200), signup ? 1 : 0).run();
  setCookie(c, sessionCookie(c.env, slotOf(c)), token, cookieOpts(c.env, SESSION_MS));
}

// Aparelho conhecido: hash do cookie de aparelho, se ele pertence a esta conta.
async function knownDevice(c: Context<AppEnv>, userId: string | undefined): Promise<string | null> {
  const token = getCookie(c, deviceCookie(c.env));
  if (!token || !userId) return null;
  const hash = await sha256(token);
  const row = await c.env.DB.prepare('SELECT 1 FROM known_devices WHERE token_hash = ? AND user_id = ?').bind(hash, userId).first();
  return row ? hash : null;
}

async function rememberDevice(c: Context<AppEnv>, userId: string) {
  if (await knownDevice(c, userId)) return;
  const token = randomToken();
  await c.env.DB.prepare('INSERT INTO known_devices (token_hash, user_id, created_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, now()).run();
  setCookie(c, deviceCookie(c.env), token, cookieOpts(c.env, DEVICE_MS));
}

const publicUser = (u: User) => ({ id: u.id, address: u.address, name: u.name, publicKey: u.public_key });

const sameHex = (a: string, b: string) => sameBytes(new TextEncoder().encode(a), new TextEncoder().encode(b));
export const pinHash = async (env: Env, userId: string, pin: string) => hex(await hmac(env.AUTH_PEPPER, `pin:${userId}:${pin}`));
export const recoveryHash = async (env: Env, userId: string, code: string) =>
  hex(await hmac(env.AUTH_PEPPER, `rec:${userId}:${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`));

// Confirmação de senha para mexer na segurança da conta (PIN, duas etapas): a sessão sozinha não basta,
// senão quem pegasse um aparelho aberto trancaria o dono do lado de fora.
export async function passwordOk(c: Context<AppEnv>, authKeyB64: unknown): Promise<Response | null> {
  const user = c.get('user');
  // Só erro conta para o freio: quem acerta a senha não fica preso por usar várias opções de segurança.
  const limit = `password:${user.id}`;
  if ((await peek(c.env.DB, limit)) >= 10) return fail(c, 429, 'too_many', 'Muitas tentativas. Tente de novo em uma hora.');
  const key = b64Len(authKeyB64, 32);
  const row = await c.env.DB.prepare('SELECT auth_hash FROM users WHERE id = ?').bind(user.id).first<{ auth_hash: string }>();
  if (!key || !row || !sameHex(await authHash(c.env, key), row.auth_hash)) {
    await bump(c.env.DB, limit, 3600 * 1000);
    return fail(c, 401, 'wrong', 'A senha não confere.');
  }
  return null;
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  // CLI e agentes entram pela chave de API, não pelo cookie.
  const bearer = /^Bearer\s+(\S+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  if (bearer) {
    const refused = await keyAuth(c, bearer);
    if (refused) return refused;
    await next();
    return;
  }
  const cookie = sessionCookie(c.env, slotOf(c));
  const token = getCookie(c, cookie);
  if (!token) return fail(c, 401, 'no_session', 'Entre na sua conta.');
  const hash = await sha256(token);
  const t = now();
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.address, u.name, u.public_key, u.idle_minutes, u.suspended_at, s.expires_at, s.last_seen, s.confirmed_until FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(hash, t).first<User & { idle_minutes: number; suspended_at: number | null; expires_at: number; last_seen: number; confirmed_until: number }>();
  if (!row) {
    deleteCookie(c, cookie, { path: '/', secure: secure(c.env) });
    return fail(c, 401, 'no_session', 'Sua sessão acabou. Entre de novo.');
  }
  if (row.suspended_at) {
    deleteCookie(c, cookie, { path: '/', secure: secure(c.env) });
    return suspended(c);
  }
  // Parada além do tempo de inatividade escolhido: a sessão acaba aqui, mesmo com o cookie valendo.
  const idleMs = row.idle_minutes * 60 * 1000;
  if (t - row.last_seen > idleMs) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    deleteCookie(c, cookie, { path: '/', secure: secure(c.env) });
    return fail(c, 401, 'no_session', 'Você saiu por inatividade. Entre de novo.');
  }
  // Sessão em uso se renova sem escrever a cada pedido: no máximo uma vez por hora, ou mais vezes
  // quando o tempo de inatividade é curto (um quinto dele, pelo menos um minuto).
  if (t - row.last_seen > Math.min(3600 * 1000, Math.max(60 * 1000, idleMs / 5))) {
    const renew = row.expires_at - t < 15 * DAY;
    c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?')
      .bind(t, renew ? t + SESSION_MS : row.expires_at, hash).run());
    if (renew) setCookie(c, cookie, token, cookieOpts(c.env, SESSION_MS));
  }
  c.set('user', { id: row.id, address: row.address, name: row.name, public_key: row.public_key });
  c.set('session', hash);
  c.set('confirmedUntil', row.confirmed_until);
  await next();
};

const CONFIRM_MS = 10 * 60 * 1000;

// Ações perigosas (apagar de vez, trocar a senha, apagar a conta, chaves de API, conectar o terminal) pedem a
// pessoa de novo: a senha e o segundo fator ligado, de uma vez (no corpo do próprio pedido ou em
// /profile/confirm). Confirmada, a sessão fica liberada por 10 minutos. Só o cookie (roubado de um
// computador, de um backup) não basta mais. Quem vem por chave de API (agente, terminal) não tem como
// confirmar e segue as regras da própria chave.
export async function confirmedOk(c: Context<AppEnv>, body?: { authKey?: unknown; pin?: string; code?: string; recovery?: string }): Promise<Response | null> {
  if (c.get('apiKey')) return null;
  if ((c.get('confirmedUntil') ?? 0) > now()) return null;
  if (body?.authKey === undefined) return fail(c, 403, 'reauth', 'Confirme que é você para continuar.');
  const denied = (await passwordOk(c, body.authKey)) ?? (await secondOk(c, body));
  if (denied) return denied;
  const until = now() + CONFIRM_MS;
  await c.env.DB.prepare('UPDATE sessions SET confirmed_until = ? WHERE token_hash = ?').bind(until, c.get('session')).run();
  c.set('confirmedUntil', until);
  return null;
}

export const auth = new Hono<AppEnv>();

// Freio por IP em todas as rotas de conta, sem gravar no banco.
auth.use('*', async (c, next) => {
  if (c.req.method === 'POST' && !(await c.env.IP_LIMIT.limit({ key: clientIp(c) })).success) {
    return fail(c, 429, 'slow_down', 'Muitas tentativas seguidas. Espere um minuto.');
  }
  await next();
});

// Endereço com dono, ou de uma caixa de agente apagada (guardado para o mesmo dono, worker/agents.ts).
export async function addressTaken(env: Env, full: string, ownerId?: string) {
  const canonical = canonicalOf(full);
  return !!(await env.DB.prepare('SELECT 1 FROM users WHERE canonical = ?1 UNION ALL SELECT 1 FROM retired WHERE canonical = ?1 AND owner_id IS NOT ?2')
    .bind(canonical, ownerId ?? null).first());
}

auth.post('/available', async c => {
  const { address } = await c.req.json<{ address: string }>();
  const full = normalizeAddress(c.env, address);
  if (!full) return c.json({ available: false, reason: 'invalid' });
  if (isReserved(full)) return c.json({ available: false, reason: 'reserved', address: full });
  const taken = await addressTaken(c.env, full);
  return c.json({ available: !taken, reason: taken ? 'taken' : null, address: full });
});

// Login em duas etapas: o endereço existe? (Existência de conta não é segredo: o próprio e-mail revela.
// O freio por IP acima limita quem tentar varrer endereços.)
auth.post('/exists', async c => {
  const { address } = await c.req.json<{ address: string }>();
  const full = normalizeAddress(c.env, address);
  const row = full ? await c.env.DB.prepare('SELECT 1 FROM users WHERE address = ? AND owner_id IS NULL').bind(full).first() : null;
  return c.json({ exists: !!row, address: full });
});

// Sal e parâmetros do Argon2id. Endereço que não existe recebe um sal falso, sempre o mesmo, para a
// resposta ter sempre a mesma forma. (Quem tem conta não é segredo: o próprio e-mail revela.)
auth.post('/salt', async c => {
  const { address } = await c.req.json<{ address: string }>();
  const full = normalizeAddress(c.env, address);
  const row = full ? await c.env.DB.prepare('SELECT salt, kdf FROM users WHERE address = ? AND owner_id IS NULL').bind(full).first<{ salt: string; kdf: string }>() : null;
  if (row) return c.json({ salt: row.salt, kdf: JSON.parse(row.kdf) });
  const fake = (await hmac(c.env.AUTH_PEPPER, `salt:${full ?? address}`)).subarray(0, 16);
  return c.json({ salt: toB64(fake), kdf: DEFAULT_KDF });
});

const inviteOnly = (env: Env) => !!env.SIGNUP_INVITE && env.SIGNUP !== 'open';

auth.post('/signup', async c => {
  const body = await c.req.json<{ address: string; name: string; authKey: string; salt: string; kdf: unknown; publicKey: string; envelope: string; turnstile?: string; website?: string; invite?: string; lang?: string }>();
  // Robô que preencheu a isca recebe a mesma resposta de quem errou o desafio.
  if (honeypotFilled(body.website) || !(await turnstileOk(c.env, body.turnstile, clientIp(c)))) {
    return fail(c, 403, 'captcha', 'Confirme que você não é um robô e tente de novo.');
  }
  // Fase de teste: só entra quem tem convite, o do dono (SIGNUP_INVITE) ou um que alguém criou nas
  // Configurações (tabela invites, uso único). O de uma conta é reservado logo antes de criar a nova.
  let inviteHash: string | null = null;
  if (inviteOnly(c.env) && !sameHex(String(body.invite || ''), c.env.SIGNUP_INVITE ?? '')) {
    const code = String(body.invite || '');
    inviteHash = code.length >= 16 && code.length <= 64 ? await sha256(code) : null;
    const open = inviteHash && (await c.env.DB.prepare('SELECT 1 AS ok FROM invites WHERE code_hash = ? AND used_at IS NULL').bind(inviteHash).first());
    if (!open) return fail(c, 403, 'invite', 'O cadastro está fechado por enquanto. Só entra quem tem convite.');
  }
  const full = normalizeAddress(c.env, body.address);
  if (!full || isReserved(full)) return fail(c, 400, 'bad_address', 'Esse endereço não pode ser usado.');
  const authKey = b64Len(body.authKey, 32);
  const salt = b64Len(body.salt, 16);
  const publicKey = b64Len(body.publicKey, 32);
  if (!authKey || !salt || !publicKey || !validKdf(body.kdf)) return fail(c, 400, 'bad_request', 'Dados de cadastro incompletos.');
  // Envelope: nonce (12) + chave privada cifrada (32 + 16 de tag), em base64.
  if (!b64Len(body.envelope, 60)) return fail(c, 400, 'bad_request', 'Envelope da chave em formato inválido.');
  // Igual ao perfil: sem quebra de linha nem sinais que mexam em cabeçalho de e-mail.
  const name = String(body.name || '').replace(/[\r\n<>"]+/g, ' ').trim().slice(0, 60);

  const ipKey = `signup-day:${clientIp(c)}`;
  const hourKey = `signup-all:${new Date().toISOString().slice(0, 13)}`;
  if ((await peek(c.env.DB, ipKey)) >= MAX_SIGNUPS_IP_DAY) return fail(c, 429, 'too_many', 'Muitas contas criadas desta rede hoje. Tente de novo amanhã.');
  if ((await peek(c.env.DB, hourKey)) >= MAX_SIGNUPS_HOUR) {
    console.error('cadastro pausado: teto por hora atingido');
    return fail(c, 429, 'paused', 'Os cadastros estão pausados por alguns minutos. Tente de novo daqui a pouco.');
  }
  if (await addressTaken(c.env, full)) return fail(c, 409, 'taken', 'Esse endereço já tem dono.');

  // Reserva o convite agora: dois cadastros com o mesmo link não passam juntos.
  if (inviteHash) {
    const claimed = await c.env.DB.prepare('UPDATE invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL').bind(now(), inviteHash).run();
    if (!claimed.meta.changes) return fail(c, 403, 'invite', 'Esse convite acabou de ser usado.');
  }
  const id = crypto.randomUUID();
  // Idioma da conta: o do app na hora do cadastro; sem ele, o escolhido no site (cookie) ou o do
  // navegador. Boas-vindas e e-mails do sistema saem nele.
  const lang = typeof body.lang === 'string' && LOCALES.includes(body.lang) ? body.lang : pickLocale(c.req.header('accept-language') ?? null, c.req.header('cookie') ?? null);
  try {
    await c.env.DB.prepare(
      'INSERT INTO users (id, address, canonical, name, auth_hash, salt, kdf, public_key, envelope, created_at, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, full, canonicalOf(full), name, await authHash(c.env, authKey), body.salt, JSON.stringify(body.kdf), body.publicKey,
      await lockEnvelope(c.env, id, body.envelope), now(), lang).run();
  } catch (e) {
    // A conta não saiu: o convite volta a valer.
    if (inviteHash) await c.env.DB.prepare('UPDATE invites SET used_at = NULL WHERE code_hash = ?').bind(inviteHash).run();
    if (String(e).includes('UNIQUE')) return fail(c, 409, 'taken', 'Esse endereço acabou de ser escolhido por outra pessoa.');
    throw e;
  }
  await bump(c.env.DB, ipKey, DAY);
  await bump(c.env.DB, hourKey, 3600 * 1000);
  await tally(c.env.DB, 'signup');
  await boxOf(c.env, id).ensureAlarm(id);
  c.executionCtx.waitUntil(leaveWelcome(c.env, { id, address: full, name, publicKey: body.publicKey }, lang).catch(e => console.error('boas-vindas falhou', String(e))));
  await startSession(c, id, true);
  await rememberDevice(c, id);
  return c.json({ user: publicUser({ id, address: full, name, public_key: body.publicKey }) });
});

auth.post('/login', async c => {
  const body = await c.req.json<{ address: string; authKey: string; turnstile?: string }>();
  const full = normalizeAddress(c.env, body.address);
  const authKey = b64Len(body.authKey, 32);
  const wrong = () => fail(c, 401, 'wrong', 'Endereço ou senha não conferem.');
  if (!full || !authKey) return wrong();

  const row = await c.env.DB.prepare('SELECT id, address, name, public_key, auth_hash, envelope, pin_hash, totp_on, suspended_at FROM users WHERE address = ?')
    .bind(full).first<User & { auth_hash: string; envelope: string; pin_hash: string | null; totp_on: number; suspended_at: number | null }>();
  const ip = clientIp(c);
  const device = await knownDevice(c, row?.id);
  const addrKey = `login:${full}`;
  const pairKey = `login:${full}:${ip}`;
  const ipKey = `login-ip:${ip}`;
  const devKey = device ? `login-dev:${device}` : null;
  const locked = devKey
    ? (await peek(c.env.DB, devKey)) >= MAX_FAILS_DEVICE
    : (await peek(c.env.DB, pairKey)) >= MAX_FAILS_ADDRESS_IP || (await peek(c.env.DB, ipKey)) >= MAX_FAILS_IP;
  if (locked) return fail(c, 429, 'locked', 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.');
  // Endereço sob ataque pede o Turnstile; aparelho onde a pessoa já entrou não precisa.
  if (!device && (await peek(c.env.DB, addrKey)) >= CAPTCHA_AFTER && !(await turnstileOk(c.env, body.turnstile, ip))) {
    return fail(c, 403, 'captcha', 'Confirme que você não é um robô para continuar.');
  }

  const given = await authHash(c.env, authKey);
  const expected = row?.auth_hash ?? given.replace(/./g, '0');
  if (!row || !sameBytes(new TextEncoder().encode(given), new TextEncoder().encode(expected))) {
    const fails = await bump(c.env.DB, addrKey, FAIL_WINDOW);
    if (devKey) await bump(c.env.DB, devKey, FAIL_WINDOW);
    else await Promise.all([bump(c.env.DB, pairKey, FAIL_WINDOW), bump(c.env.DB, ipKey, FAIL_WINDOW)]);
    if (!device && fails >= CAPTCHA_AFTER) return fail(c, 401, 'wrong_captcha', 'Endereço ou senha não conferem. Confirme que você não é um robô na próxima tentativa.');
    return wrong();
  }
  await Promise.all([clear(c.env.DB, addrKey), clear(c.env.DB, pairKey), devKey ? clear(c.env.DB, devKey) : null]);
  // Suspensa: só depois da senha certa, para a suspensão não ficar visível a quem só tem o endereço.
  if (row.suspended_at) return suspended(c);
  // Conta com PIN e/ou duas etapas: a senha passou, mas a sessão e o envelope só saem na segunda etapa.
  if (row.pin_hash || row.totp_on) {
    const ticket = randomToken();
    await c.env.DB.prepare('INSERT INTO login_tickets (token_hash, user_id, created_at) VALUES (?, ?, ?)').bind(await sha256(ticket), row.id, now()).run();
    return c.json({ ticket, second: { pin: !!row.pin_hash, totp: !!row.totp_on } });
  }
  await boxOf(c.env, row.id).ensureAlarm(row.id);
  await startSession(c, row.id);
  await rememberDevice(c, row.id);
  return c.json({ user: publicUser(row), envelope: await unlockEnvelope(c.env, row.id, row.envelope) });
});

type FactorRow = { id: string; pin_hash: string | null; totp_on: number; totp_secret: string | null; totp_step: number; recovery: string | null };

// PIN e duas etapas que a conta tiver ligados. Devolve também o passo do TOTP aceito e a lista de
// códigos de recuperação sem o que foi usado, para gravar só se tudo der certo.
async function extraFactors(env: Env, row: FactorRow, body: { pin?: string; code?: string; recovery?: string }) {
  let ok = true;
  let step: number | null = null;
  let recovery: string[] | null = null;
  if (row.pin_hash) ok = typeof body.pin === 'string' && /^\d{6}$/.test(body.pin) && sameHex(await pinHash(env, row.id, body.pin), row.pin_hash);
  if (row.totp_on && row.totp_secret) {
    if (typeof body.recovery === 'string' && body.recovery) {
      const list: string[] = JSON.parse(row.recovery || '[]');
      const at = list.indexOf(await recoveryHash(env, row.id, body.recovery));
      if (at < 0) ok = false;
      else recovery = list.filter((_, i) => i !== at);
    } else {
      step = await checkTotp(await unlockEnvelope(env, `totp:${row.id}`, row.totp_secret), String(body.code || ''), row.totp_step);
      if (step === null) ok = false;
    }
  }
  return { ok, step, recovery };
}

// O segundo fator que a conta tiver ligado (PIN, duas etapas ou os dois), para desligar ou trocar essas
// proteções e o e-mail de recuperação. Só a senha não basta: com um cookie roubado e a senha vazada,
// dava para desligar tudo e entrar de novo só com a senha. Conta sem PIN nem duas etapas passa direto.
export async function secondOk(c: Context<AppEnv>, body: { pin?: string; code?: string; recovery?: string }): Promise<Response | null> {
  const id = c.get('user').id;
  const limit = `second:${id}`;
  if ((await peek(c.env.DB, limit)) >= 10) return fail(c, 429, 'too_many', 'Muitas tentativas. Tente de novo em uma hora.');
  const row = await c.env.DB.prepare('SELECT id, pin_hash, totp_on, totp_secret, totp_step, recovery FROM users WHERE id = ?').bind(id).first<FactorRow>();
  if (!row || (!row.pin_hash && !row.totp_on)) return null;
  const { ok, step, recovery } = await extraFactors(c.env, row, body);
  if (!ok) {
    await bump(c.env.DB, limit, 3600 * 1000);
    return fail(c, 401, 'wrong_second', row.pin_hash && row.totp_on ? 'PIN ou código errado.' : row.pin_hash ? 'PIN errado.' : 'Código errado.');
  }
  // Passo do código e código de recuperação usados não valem de novo (o D1 não aceita lote vazio).
  const spent = [
    ...(step !== null ? [c.env.DB.prepare('UPDATE users SET totp_step = ? WHERE id = ?').bind(step, id)] : []),
    ...(recovery ? [c.env.DB.prepare('UPDATE users SET recovery = ? WHERE id = ?').bind(JSON.stringify(recovery), id)] : []),
  ];
  if (spent.length) await c.env.DB.batch(spent);
  return null;
}

// Segunda etapa do login: PIN, código do autenticador (ou um código de recuperação), o que a conta tiver.
auth.post('/login/second', async c => {
  const body = await c.req.json<{ ticket: string; pin?: string; code?: string; recovery?: string }>();
  if (typeof body.ticket !== 'string' || body.ticket.length > 64) return fail(c, 400, 'bad_request', 'Pedido inválido.');
  const hash = await sha256(body.ticket);
  const t = now();
  const ticket = await c.env.DB.prepare('SELECT user_id, created_at, tries FROM login_tickets WHERE token_hash = ?').bind(hash).first<{ user_id: string; created_at: number; tries: number }>();
  if (!ticket || t - ticket.created_at > TICKET_MS || ticket.tries >= MAX_TICKET_TRIES) {
    if (ticket) await c.env.DB.prepare('DELETE FROM login_tickets WHERE token_hash = ?').bind(hash).run();
    return fail(c, 401, 'ticket', 'O tempo para confirmar acabou. Entre de novo.');
  }
  const row = await c.env.DB.prepare('SELECT id, address, name, public_key, envelope, pin_hash, totp_on, totp_secret, totp_step, recovery, suspended_at FROM users WHERE id = ?')
    .bind(ticket.user_id).first<User & { envelope: string; pin_hash: string | null; totp_on: number; totp_secret: string | null; totp_step: number; recovery: string | null; suspended_at: number | null }>();
  if (!row) return fail(c, 401, 'ticket', 'O tempo para confirmar acabou. Entre de novo.');
  if (row.suspended_at) return suspended(c);
  const failKey = `second:${row.id}`;
  if ((await peek(c.env.DB, failKey)) >= MAX_SECOND_FAILS) return fail(c, 429, 'locked', 'Muitas tentativas erradas. Espere uma hora e tente de novo.');

  const { ok, step, recovery } = await extraFactors(c.env, row, body);
  if (!ok) {
    await c.env.DB.prepare('UPDATE login_tickets SET tries = tries + 1 WHERE token_hash = ?').bind(hash).run();
    await bump(c.env.DB, failKey, 3600 * 1000);
    const what = row.pin_hash && row.totp_on ? 'PIN ou código errado.' : row.pin_hash ? 'PIN errado.' : 'Código errado.';
    return fail(c, 401, 'wrong_second', what);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM login_tickets WHERE token_hash = ?').bind(hash),
    ...(step !== null ? [c.env.DB.prepare('UPDATE users SET totp_step = ? WHERE id = ?').bind(step, row.id)] : []),
    ...(recovery ? [c.env.DB.prepare('UPDATE users SET recovery = ? WHERE id = ?').bind(JSON.stringify(recovery), row.id)] : []),
  ]);
  await clear(c.env.DB, failKey);
  await boxOf(c.env, row.id).ensureAlarm(row.id);
  await startSession(c, row.id);
  await rememberDevice(c, row.id);
  return c.json({ user: publicUser(row), envelope: await unlockEnvelope(c.env, row.id, row.envelope), recoveryLeft: recovery?.length });
});

// Esqueci a senha: manda o link para o e-mail de recuperação confirmado. A resposta é sempre a mesma
// e o envio sai depois dela, para não dizer quem tem e-mail de recuperação.
auth.post('/forgot', async c => {
  const { address } = await c.req.json<{ address: string }>();
  const full = normalizeAddress(c.env, address);
  // Freios: 3 por hora e 5 por dia para cada endereço, e 10 por dia para cada rede (o link sai do teto do
  // sistema, e pedido em massa não pode gastá-lo).
  const ip = clientIp(c);
  if (full && (await bump(c.env.DB, `forgot:${full}`, 3600 * 1000)) <= 3 && (await bump(c.env.DB, `forgot-day:${full}`, 24 * 3600 * 1000)) <= 5
    && (await bump(c.env.DB, `forgot-ip:${ip}`, 24 * 3600 * 1000)) <= 10) {
    const row = await c.env.DB.prepare('SELECT id, address, recovery_email, recovery_verified, lang FROM users WHERE address = ?').bind(full)
      .first<{ id: string; address: string; recovery_email: string | null; recovery_verified: number; lang: string }>();
    if (row?.recovery_email && row.recovery_verified) {
      const token = await newEmailToken(c.env, row.id, 'reset');
      const to = await unlockEnvelope(c.env, `rec-email:${row.id}`, row.recovery_email);
      c.executionCtx.waitUntil(sendReset(c.env, to, row.address, token, row.lang).catch(e => console.error('link de senha nova falhou', String(e))));
    }
  }
  return c.json({ ok: true });
});

const linkGone = (c: Context<AppEnv>) => fail(c, 401, 'link', 'Este link venceu ou já foi usado. Peça outro na tela de entrar.');

// Tela de senha nova: para qual conta é o link e o que mais a conta pede (PIN, duas etapas).
auth.post('/reset/info', async c => {
  const id = await peekEmailToken(c.env, (await c.req.json<{ token: string }>()).token, 'reset');
  const row = id ? await c.env.DB.prepare('SELECT address, pin_hash, totp_on FROM users WHERE id = ?').bind(id).first<{ address: string; pin_hash: string | null; totp_on: number }>() : null;
  if (!row) return linkGone(c);
  return c.json({ address: row.address, need: { pin: !!row.pin_hash, totp: !!row.totp_on } });
});

// Senha nova pelo link: o aparelho já gerou chave e envelope novos. A caixa antiga é esvaziada (o que
// estava lá foi trancado com a chave antiga e não abre mais) e todas as sessões caem. Se a conta tem PIN
// ou duas etapas, o link sozinho não basta.
auth.post('/reset', async c => {
  const body = await c.req.json<{ token: string; authKey: string; salt: string; kdf: unknown; publicKey: string; envelope: string; pin?: string; code?: string; recovery?: string }>();
  const id = await peekEmailToken(c.env, body.token, 'reset');
  if (!id) return linkGone(c);
  const authKey = b64Len(body.authKey, 32);
  if (!authKey || !b64Len(body.salt, 16) || !b64Len(body.publicKey, 32) || !validKdf(body.kdf) || !b64Len(body.envelope, 60)) {
    return fail(c, 400, 'bad_request', 'Dados da senha nova incompletos.');
  }
  const row = await c.env.DB.prepare('SELECT id, address, name, pin_hash, totp_on, totp_secret, totp_step, recovery, suspended_at FROM users WHERE id = ?').bind(id)
    .first<FactorRow & { address: string; name: string; suspended_at: number | null }>();
  if (!row) return linkGone(c);
  if (row.suspended_at) return suspended(c);
  const failKey = `reset:${id}`;
  if ((await peek(c.env.DB, failKey)) >= MAX_TICKET_TRIES) return fail(c, 429, 'locked', 'Muitas tentativas erradas. Espere uma hora e tente de novo.');
  const { ok, step, recovery } = await extraFactors(c.env, row, body);
  if (!ok) {
    await bump(c.env.DB, failKey, 3600 * 1000);
    return fail(c, 401, 'wrong_second', row.pin_hash && row.totp_on ? 'PIN ou código errado.' : row.pin_hash ? 'PIN errado.' : 'Código errado.');
  }
  await spendEmailToken(c.env, body.token);
  await boxOf(c.env, id).wipe(id);
  await boxOf(c.env, id).closeSessions();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET auth_hash = ?, salt = ?, kdf = ?, public_key = ?, envelope = ? WHERE id = ?')
      .bind(await authHash(c.env, authKey), body.salt, JSON.stringify(body.kdf), body.publicKey, await lockEnvelope(c.env, id, body.envelope), id),
    ...(step !== null ? [c.env.DB.prepare('UPDATE users SET totp_step = ? WHERE id = ?').bind(step, id)] : []),
    ...(recovery ? [c.env.DB.prepare('UPDATE users SET recovery = ? WHERE id = ?').bind(JSON.stringify(recovery), id)] : []),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM login_tickets WHERE user_id = ?').bind(id),
    c.env.DB.prepare("DELETE FROM email_tokens WHERE user_id = ? AND kind = 'reset'").bind(id),
    // Quem tomou a conta pode ter criado chaves de API e caixas de agente: elas caem junto, e o aparelho
    // dele deixa de ser conhecido (pularia a verificação contra robôs).
    c.env.DB.prepare('DELETE FROM api_keys WHERE user_id = ?1 OR user_id IN (SELECT id FROM users WHERE owner_id = ?1)').bind(id),
    c.env.DB.prepare('DELETE FROM known_devices WHERE user_id = ?').bind(id),
  ]);
  await clear(c.env.DB, failKey);
  await startSession(c, id);
  await rememberDevice(c, id);
  return c.json({ user: publicUser({ id, address: row.address, name: row.name, public_key: body.publicKey }) });
});

// Link de confirmação do e-mail de recuperação (abre sem login, no aparelho que recebeu o e-mail).
auth.post('/recovery/confirm', async c => {
  const { token } = await c.req.json<{ token: string }>();
  const id = await peekEmailToken(c.env, token, 'verify');
  if (!id) return fail(c, 401, 'link', 'Este link venceu ou já foi usado. Peça outro nas configurações.');
  await c.env.DB.prepare('UPDATE users SET recovery_verified = 1 WHERE id = ?').bind(id).run();
  await spendEmailToken(c.env, token);
  const row = await c.env.DB.prepare('SELECT recovery_hint FROM users WHERE id = ?').bind(id).first<{ recovery_hint: string | null }>();
  return c.json({ ok: true, hint: row?.recovery_hint ?? null });
});

auth.post('/logout', async c => {
  const cookie = sessionCookie(c.env, slotOf(c));
  const token = getCookie(c, cookie);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, cookie, { path: '/', secure: secure(c.env) });
  return c.json({ ok: true });
});

// Aparelhos conectados: ver e desconectar. O id mostrado é só o começo do hash do token.
auth.get('/sessions', requireUser, async c => {
  const current = c.get('session');
  const { results } = await c.env.DB.prepare('SELECT token_hash, created_at, last_seen, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC')
    .bind(c.get('user').id, now()).all<{ token_hash: string; created_at: number; last_seen: number; user_agent: string }>();
  return c.json({
    sessions: results.map(s => ({ id: s.token_hash.slice(0, 16), created_at: s.created_at, last_seen: s.last_seen, user_agent: s.user_agent, current: s.token_hash === current })),
  });
});

auth.post('/sessions/revoke', requireUser, async c => {
  const { id } = await c.req.json<{ id: string }>();
  if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return fail(c, 400, 'bad_request', 'Aparelho inválido.');
  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?`).bind(c.get('user').id, id).run();
  await boxOf(c.env, c.get('user').id).closeSessions({ prefix: id });
  return c.json({ ok: true });
});

// O que o navegador precisa saber antes de entrar: domínio e chave pública do Turnstile.
auth.get('/config', c => c.json({
  domain: c.env.MAIL_DOMAIN,
  turnstileSiteKey: c.env.TURNSTILE_SITEKEY,
  inviteOnly: inviteOnly(c.env),
  ...serverKeys(c.env),
}, 200, { 'cache-control': 'public, max-age=300' }));

auth.get('/me', requireUser, c => c.json({ user: publicUser(c.get('user')) }));
