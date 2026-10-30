// Rotas sem login. Aqui o servidor não sabe quem está pedindo, e é de propósito:
// - /keys: a chave pública de uma conta Shalom (quem procurou quem não fica sabido);
// - /deliver: entrega de mensagem entre contas Shalom com remetente lacrado. A prova de que quem
//   entrega tem direito é um ingresso assinado às cegas, que não dá para ligar à conta que o pediu.
import { Hono } from 'hono';
import { b64ToBig, currentWeek, tokenWeek, verifyToken } from '../shared/blind';
import { fromB64, toB64 } from '../shared/seal';
import { isSealedSender } from '../shared/sender';
import { boxOf } from './box';
import type { AppEnv } from './env';
import { loadKeys } from './keys';
import { bump, clientIp, fail, normalizeAddress, peek } from './util';

// Entrega anônima não tem como provar quem mandou: o tamanho e o volume diário por caixa são o freio
// contra encher a caixa de alguém com lixo.
const MAX_RAW_B64 = Math.ceil((5 * 1024 * 1024 + 2048) / 3) * 4;
const RECV_BYTES_DAY = 100 * 1024 * 1024;
const RECV_COUNT_DAY = 500;
const MAX_HEAD_B64 = Math.ceil((64 * 1024) / 3) * 4;

export const open = new Hono<AppEnv>();

open.post('/keys', async c => {
  if (!(await c.env.USER_LIMIT.limit({ key: `keys:${clientIp(c)}` })).success) return fail(c, 429, 'slow_down', 'Muitas consultas seguidas.');
  const { address } = await c.req.json<{ address: string }>();
  const full = normalizeAddress(c.env, address || '');
  const row = full ? await c.env.DB.prepare('SELECT public_key FROM users WHERE address = ?').bind(full).first<{ public_key: string }>() : null;
  return c.json({ publicKey: row?.public_key ?? null });
});

open.post('/deliver', async c => {
  if (!(await c.env.USER_LIMIT.limit({ key: `deliver:${clientIp(c)}` })).success) return fail(c, 429, 'slow_down', 'Muitas entregas seguidas.');
  const body = await c.req.json<{ to: string; head: string; raw: string; token: string; sig: string }>();
  const to = normalizeAddress(c.env, body.to || '');
  if (!to) return fail(c, 400, 'bad_recipient', 'Destino inválido.');
  if (typeof body.head !== 'string' || typeof body.raw !== 'string' || body.head.length > MAX_HEAD_B64 || body.raw.length > MAX_RAW_B64) {
    return fail(c, 413, 'too_big', 'Mensagem grande demais.');
  }
  const head = fromB64(body.head);
  const raw = fromB64(body.raw);
  if (!isSealedSender(head) || !isSealedSender(raw)) return fail(c, 400, 'bad_request', 'Mensagem sem o lacre do remetente.');

  // Ingresso: assinatura válida, semana atual ou anterior, nunca usado.
  let token: Uint8Array;
  try { token = fromB64(body.token); } catch { return fail(c, 403, 'bad_token', 'Ingresso de entrega inválido.'); }
  const week = token.length === 36 ? tokenWeek(token) : -1;
  if (week < currentWeek() - 1 || week > currentWeek() + 1) return fail(c, 403, 'bad_token', 'Ingresso de entrega vencido.');
  if (!(await verifyToken(loadKeys(c.env).token, token, b64ToBig(String(body.sig || ''))))) return fail(c, 403, 'bad_token', 'Ingresso de entrega inválido.');
  const hash = toB64(new Uint8Array(await crypto.subtle.digest('SHA-256', token)));
  const spent = await c.env.DB.prepare('INSERT INTO spent_tokens (hash, week) VALUES (?, ?) ON CONFLICT(hash) DO NOTHING RETURNING hash')
    .bind(hash, week).first();
  if (!spent) return fail(c, 409, 'token_used', 'Esse ingresso de entrega já foi usado.');

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE address = ?').bind(to).first<{ id: string }>();
  if (!user) return fail(c, 404, 'no_such_user', `Não existe conta ${to}.`);
  const day = new Date().toISOString().slice(0, 10);
  const bytesKey = `recv-bytes:${user.id}:${day}`;
  const countKey = `recv-count:${user.id}:${day}`;
  if ((await peek(c.env.DB, bytesKey)) + raw.length > RECV_BYTES_DAY || (await peek(c.env.DB, countKey)) >= RECV_COUNT_DAY) {
    return fail(c, 429, 'recipient_busy', `A caixa de ${to} não está aceitando mais mensagens hoje.`);
  }
  await bump(c.env.DB, bytesKey, 24 * 3600 * 1000, raw.length);
  await bump(c.env.DB, countKey, 24 * 3600 * 1000);
  const id = crypto.randomUUID();
  await c.env.BLOBS.put(`m/${user.id}/${id}`, raw);
  // sender fica vazio: quem enviou só aparece dentro do lacre.
  const ok = await boxOf(c.env, user.id).add({ id, folder: 'inbox', seen: false, size: raw.length, sender: null, head });
  if (!ok) {
    await c.env.BLOBS.delete(`m/${user.id}/${id}`);
    return fail(c, 413, 'full', `A caixa de ${to} está cheia.`);
  }
  return c.json({ ok: true });
});
