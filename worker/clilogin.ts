// Login do CLI pelo navegador, como no Railway e no GitHub. O terminal pede um código (/cli/start) e
// abre shalomail.com/conectar?codigo=...; a pessoa, com a conta aberta, confere o código e clica em
// Conectar (/cli/approve). Aí nasce uma chave de API da conta, lacrada com a chave pública que o terminal
// mandou: o servidor não guarda a chave aberta, e só aquele terminal consegue abrir. O terminal busca
// (/cli/poll) e a linha some. Pedido vale 10 minutos.
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { confirmedOk, requireUser } from './auth';
import { MAX_ACCOUNT_KEYS } from './agents';
import { newApiKey } from './apikeys';
import type { AppEnv } from './env';
import { clientIp, fail, now, randomToken, sha256 } from './util';
import { fromB64, seal, toB64 } from '../shared/seal';

const TTL = 10 * 60 * 1000;
// Aprovado perto do fim do prazo: o terminal ainda tem um pouco para buscar a chave, que já foi criada.
const GRACE = 2 * 60 * 1000;
// Sem letras e números que se confundem (0/O, 1/I/L), em dois blocos de quatro: ABCD-2345.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
const cleanCode = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
// O nome do aparelho vem do terminal e aparece na página de conectar: só letras, números e pontuação simples,
// curto, para ninguém escrever ali algo que pareça aviso do sistema.
const cleanDevice = (s: unknown) => String(s ?? '').replace(/[^\p{L}\p{N} ._(),-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

type LoginRow = { poll_hash: string; code: string; device: string; public_key: string; created_at: number; status: string; user_id: string | null; sealed_key: string | null };

export const cliLogin = new Hono<AppEnv>();

// O terminal pede um código. Sem conta: o limite é por rede, 60 por minuto (cada pedido grava uma linha).
cliLogin.post('/start', async c => {
  if (!(await c.env.IP_LIMIT.limit({ key: `cli-start:${clientIp(c)}` })).success) return fail(c, 429, 'slow_down', 'Muitos pedidos seguidos. Espere um minuto.');
  const body = await c.req.json<{ device?: string; publicKey?: string }>().catch(() => ({} as { device?: string; publicKey?: string }));
  let pub: Uint8Array;
  try { pub = fromB64(String(body.publicKey ?? '')); } catch { return fail(c, 400, 'bad_request', 'Chave pública inválida.'); }
  if (pub.length !== 32) return fail(c, 400, 'bad_request', 'Chave pública inválida.');
  // Chave que não dá para lacrar (zeros, ponto de ordem baixa) seria recusada só na aprovação, com erro 500.
  try { await seal(pub, new Uint8Array(1), 'raw'); } catch { return fail(c, 400, 'bad_request', 'Chave pública inválida.'); }
  const poll = randomToken(32);
  for (let tries = 0; tries < 3; tries++) {
    const code = newCode();
    try {
      await c.env.DB.prepare('INSERT INTO cli_logins (poll_hash, code, device, public_key, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(await sha256(poll), code, cleanDevice(body.device), toB64(pub), now()).run();
      return c.json({ code, poll, url: `${c.env.APP_ORIGIN}/conectar?codigo=${code}`, interval: 2, expiresIn: TTL / 1000 });
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
    }
  }
  return fail(c, 500, 'internal', 'Não deu para criar o código. Tente de novo.');
});

// O terminal pergunta se já foi aprovado. Aprovado: leva a chave lacrada e o pedido some.
cliLogin.post('/poll', async c => {
  // O terminal pergunta a cada poucos segundos; 120 por minuto por rede sobra.
  if (!(await c.env.USER_LIMIT.limit({ key: `cli-poll:${clientIp(c)}` })).success) return fail(c, 429, 'slow_down', 'Muitos pedidos seguidos. Espere um minuto.');
  const { poll } = await c.req.json<{ poll?: string }>().catch(() => ({ poll: '' }));
  if (typeof poll !== 'string' || poll.length < 20 || poll.length > 100) return fail(c, 400, 'bad_request', 'Pedido inválido.');
  const hash = await sha256(poll);
  const row = await c.env.DB.prepare('SELECT * FROM cli_logins WHERE poll_hash = ?').bind(hash).first<LoginRow>();
  if (!row || now() - row.created_at > TTL + (row.status === 'approved' ? GRACE : 0)) {
    if (row) await c.env.DB.prepare('DELETE FROM cli_logins WHERE poll_hash = ?').bind(hash).run();
    return c.json({ status: 'expired' });
  }
  if (row.status === 'pending') return c.json({ status: 'pending' });
  await c.env.DB.prepare('DELETE FROM cli_logins WHERE poll_hash = ?').bind(hash).run();
  if (row.status !== 'approved' || !row.sealed_key || !row.user_id) return c.json({ status: 'denied' });
  const account = await c.env.DB.prepare('SELECT address FROM users WHERE id = ?').bind(row.user_id).first<string>('address');
  return c.json({ status: 'approved', sealedKey: row.sealed_key, account });
});

// Daqui para baixo, só a pessoa no app, com a sessão (uma chave de API não aprova outro terminal).
const pending = async (c: Context<AppEnv>, code: unknown) => {
  const row = await c.env.DB.prepare("SELECT * FROM cli_logins WHERE code = ? AND status = 'pending'").bind(cleanCode(code)).first<LoginRow>();
  return row && now() - row.created_at <= TTL ? row : null;
};
const sessionOnly: MiddlewareHandler<AppEnv> = async (c, next) => (c.get('apiKey') ? fail(c, 403, 'key_scope', 'Só pelo app.') : next());

cliLogin.get('/request', requireUser, sessionOnly, async c => {
  const row = await pending(c, c.req.query('codigo'));
  if (!row) return fail(c, 404, 'not_found', 'Este pedido venceu ou já foi usado.');
  return c.json({ code: row.code, device: row.device, createdAt: row.created_at, account: c.get('user').address });
});

cliLogin.post('/approve', requireUser, sessionOnly, async c => {
  const { code } = await c.req.json<{ code?: string }>();
  const row = await pending(c, code);
  if (!row) return fail(c, 404, 'not_found', 'Este pedido venceu ou já foi usado.');
  // Conectar dá ao terminal uma chave da conta: a pessoa confirmada (por /profile/confirm, porque aqui
  // "code" já é o código do terminal).
  const denied = await confirmedOk(c);
  if (denied) return denied;
  const user = c.get('user');
  // No teto de chaves (o mesmo da página de chaves), sai uma que nunca foi usada ou, sem nenhuma assim,
  // a que está há mais tempo parada.
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND kind = 'account'").bind(user.id).first<number>('n');
  if ((count ?? 0) >= MAX_ACCOUNT_KEYS) {
    await c.env.DB.prepare(
      "DELETE FROM api_keys WHERE key_hash IN (SELECT key_hash FROM api_keys WHERE user_id = ? AND kind = 'account' ORDER BY last_used IS NOT NULL, COALESCE(last_used, created_at) LIMIT ?)",
    ).bind(user.id, (count ?? 0) - MAX_ACCOUNT_KEYS + 1).run();
  }
  const key = await newApiKey(c.env, user.id, 'account', `CLI${row.device ? ` · ${row.device}` : ''}`);
  const sealed = toB64(await seal(fromB64(row.public_key), new TextEncoder().encode(key), 'raw'));
  const done = await c.env.DB.prepare("UPDATE cli_logins SET status = 'approved', user_id = ?, sealed_key = ? WHERE poll_hash = ? AND status = 'pending'")
    .bind(user.id, sealed, row.poll_hash).run();
  if (!done.meta.changes) {
    await c.env.DB.prepare('DELETE FROM api_keys WHERE key_hash = ?').bind(await sha256(key)).run();
    return fail(c, 404, 'not_found', 'Este pedido venceu ou já foi usado.');
  }
  return c.json({ ok: true });
});

cliLogin.post('/deny', requireUser, sessionOnly, async c => {
  const { code } = await c.req.json<{ code?: string }>();
  // Já aprovado (em outra aba) ou vencido: não diz "cancelado" de um pedido que não cancelou.
  const done = await c.env.DB.prepare("UPDATE cli_logins SET status = 'denied' WHERE code = ? AND status = 'pending' AND created_at >= ?").bind(cleanCode(code), now() - TTL).run();
  if (!done.meta.changes) return fail(c, 404, 'not_found', 'Este pedido venceu ou já foi usado.');
  return c.json({ ok: true });
});

