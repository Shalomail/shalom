// Administração, só pelo terminal do Thomaz (scripts/admin.mjs) com a ADMIN_KEY: ver o básico de uma conta,
// suspender por abuso, desfazer e apagar (pedido por e-mail ou abuso). Nada aqui lê e-mail: o conteúdo
// continua criptografado. Sem ADMIN_KEY configurada, as rotas respondem como se não existissem. Endereços
// vão no corpo do pedido, nunca na URL, para não ficarem em registro de acesso.
import { Hono } from 'hono';
import { CancelFailed, deleteAccount } from './account';
import { boxOf, FOLDERS, type MigrationRow } from './box';
import type { AppEnv } from './env';
import { planOf } from './plans';
import { fromB64, toB64 } from '../shared/seal';
import { bump, clientIp, fail, normalizeAddress, now, peek, sameBytes, sendCaps, sendsKey, sha256 } from './util';

export const admin = new Hono<AppEnv>();

admin.use('*', async (c, next) => {
  if (!c.env.ADMIN_KEY) return c.json({ error: 'not_found', message: 'Não encontrado.' }, 404);
  const failKey = `admin-fail:${clientIp(c)}`;
  // Na conta nova da migração o D1 ainda está vazio (sem a tabela de contadores) durante a pré-cópia dos
  // corpos: sem contador, a trava fica só na chave.
  const fails = await peek(c.env.DB, failKey).catch(() => 0);
  if (fails >= 5) return fail(c, 429, 'locked', 'Muitas tentativas. Espere uma hora.');
  // Compara os hashes: mesmo tamanho sempre, sem vazar pelo tempo quanto da chave bateu.
  const given = await sha256(c.req.header('x-admin-key') ?? '');
  if (!sameBytes(new TextEncoder().encode(given), new TextEncoder().encode(await sha256(c.env.ADMIN_KEY)))) {
    await bump(c.env.DB, failKey, 3600 * 1000).catch(() => {});
    return c.json({ error: 'not_found', message: 'Não encontrado.' }, 404);
  }
  await next();
});

type Row = { id: string; address: string; name: string; created_at: number; owner_id: string | null; suspended_at: number | null; suspended_reason: string | null };

async function find(c: { env: AppEnv['Bindings'] }, address: unknown): Promise<Row | null> {
  const full = normalizeAddress(c.env, String(address ?? ''));
  if (!full) return null;
  return c.env.DB.prepare('SELECT id, address, name, created_at, owner_id, suspended_at, suspended_reason FROM users WHERE address = ?').bind(full).first<Row>();
}

async function info(c: { env: AppEnv['Bindings'] }, row: Row) {
  const [agents, plan] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE owner_id = ?').bind(row.id).first<number>('n'),
    planOf(c.env, row.owner_id ?? row.id),
  ]);
  const owner = row.owner_id ? await c.env.DB.prepare('SELECT address FROM users WHERE id = ?').bind(row.owner_id).first<string>('address') : null;
  return {
    address: row.address, name: row.name, createdAt: row.created_at, agentOf: owner, agents: agents ?? 0, plan: plan.plan,
    suspended: row.suspended_at ? { at: row.suspended_at, reason: row.suspended_reason ?? '' } : null,
  };
}

admin.post('/user', async c => {
  const row = await find(c, (await c.req.json<{ address?: string }>().catch(() => ({} as { address?: string }))).address);
  if (!row) return fail(c, 404, 'not_found', 'Conta não encontrada.');
  return c.json(await info(c, row));
});

// Suspender: a conta sai de todas as sessões na hora e as chaves dela (e das caixas de agente dela) param.
admin.post('/suspend', async c => {
  const body = await c.req.json<{ address?: string; reason?: string }>().catch(() => ({} as { address?: string; reason?: string }));
  const row = await find(c, body.address);
  if (!row) return fail(c, 404, 'not_found', 'Conta não encontrada.');
  const reason = String(body.reason ?? '').trim().slice(0, 300);
  if (!reason) return fail(c, 400, 'bad_request', 'Diga o motivo da suspensão.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET suspended_at = ?, suspended_reason = ? WHERE id = ?').bind(now(), reason, row.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id),
    c.env.DB.prepare('DELETE FROM login_tickets WHERE user_id = ?').bind(row.id),
  ]);
  return c.json(await info(c, { ...row, suspended_at: now(), suspended_reason: reason }));
});

admin.post('/unsuspend', async c => {
  const row = await find(c, (await c.req.json<{ address?: string }>().catch(() => ({} as { address?: string }))).address);
  if (!row) return fail(c, 404, 'not_found', 'Conta não encontrada.');
  await c.env.DB.prepare('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?').bind(row.id).run();
  return c.json(await info(c, { ...row, suspended_at: null, suspended_reason: null }));
});

// Apagar de vez (o mesmo da exclusão pela própria pessoa). Caixa de agente: apague pelo dono ou aqui mesmo.
admin.post('/delete', async c => {
  const row = await find(c, (await c.req.json<{ address?: string }>().catch(() => ({} as { address?: string }))).address);
  if (!row) return fail(c, 404, 'not_found', 'Conta não encontrada.');
  try {
    return c.json({ deleted: await deleteAccount(c.env, row.id) });
  } catch (e) {
    if (!(e instanceof CancelFailed)) throw e;
    return fail(c, 502, 'stripe_error', `O Stripe não cancelou a assinatura (${e.message}); nada foi apagado.`);
  }
});

// Números do painel (scripts/painel.mjs): só contagens, de contas e de eventos por dia. Nada de endereço,
// nome ou conteúdo sai daqui.
admin.post('/stats', async c => {
  const db = c.env.DB;
  const t = now();
  const DAY = 24 * 3600 * 1000;
  const since = t - 90 * DAY;
  const one = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).first<number>('n').then(n => n ?? 0);
  const [people, agents, suspended, recovery, totp, pin, active1, active7, active30, signups, agentDays, events, plans, langs, sentToday] = await Promise.all([
    one('SELECT COUNT(*) AS n FROM users WHERE owner_id IS NULL'),
    one('SELECT COUNT(*) AS n FROM users WHERE owner_id IS NOT NULL'),
    one('SELECT COUNT(*) AS n FROM users WHERE suspended_at IS NOT NULL'),
    one('SELECT COUNT(*) AS n FROM users WHERE owner_id IS NULL AND recovery_verified = 1'),
    one('SELECT COUNT(*) AS n FROM users WHERE owner_id IS NULL AND totp_on = 1'),
    one('SELECT COUNT(*) AS n FROM users WHERE owner_id IS NULL AND pin_hash IS NOT NULL'),
    one('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen > ?', t - DAY),
    one('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen > ?', t - 7 * DAY),
    one('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen > ?', t - 30 * DAY),
    db.prepare("SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE owner_id IS NULL AND created_at > ? GROUP BY day").bind(since).all<{ day: string; n: number }>(),
    db.prepare("SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE owner_id IS NOT NULL AND created_at > ? GROUP BY day").bind(since).all<{ day: string; n: number }>(),
    db.prepare('SELECT day, metric, n FROM stats WHERE day >= ? ORDER BY day').bind(new Date(since).toISOString().slice(0, 10)).all<{ day: string; metric: string; n: number }>(),
    db.prepare('SELECT plan, status, COUNT(*) AS n FROM billing GROUP BY plan, status').all<{ plan: string; status: string | null; n: number }>(),
    db.prepare('SELECT lang, COUNT(*) AS n FROM users WHERE owner_id IS NULL GROUP BY lang ORDER BY n DESC').all<{ lang: string; n: number }>(),
    peek(db, sendsKey()),
  ]);
  return c.json({
    at: t,
    accounts: { people, agents, suspended, recovery, totp, pin, active: { day: active1, week: active7, month: active30 } },
    signups: signups.results, agentsCreated: agentDays.results, events: events.results,
    plans: plans.results, langs: langs.results,
    sending: { today: sentToday, caps: sendCaps(c.env) },
  });
});

// ---- Migração para outra conta Cloudflare (scripts/migrate.mjs; passo a passo em docs/migracao.md) ----
// A origem entrega as contas, as linhas de cada caixa e os corpos do R2; o destino grava. O banco D1 vai
// pelo wrangler (export e execute). Nada é aberto no caminho: cabeçalhos e corpos seguem lacrados.

const PAGE = 200;
const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
// Corpo de mensagem (m/<conta>/<id>) e foto (avatar/<conta>): as únicas chaves que o Shalom grava no R2.
const okKey = (v: unknown): v is string => typeof v === 'string' && v.length <= 200 && /^(m\/[\w-]+\/[\w-]+|avatar\/[\w-]+)$/.test(v);

admin.post('/export/users', async c => {
  const { after } = await c.req.json<{ after?: string }>().catch(() => ({} as { after?: string }));
  const rows = await c.env.DB.prepare('SELECT id FROM users WHERE id > ? ORDER BY id LIMIT 500').bind(after ?? '').all<{ id: string }>();
  return c.json({ ids: rows.results.map(r => r.id), done: rows.results.length < 500 });
});

admin.post('/export/box', async c => {
  const { id, after } = await c.req.json<{ id?: string; after?: string }>().catch(() => ({} as { id?: string; after?: string }));
  if (!okId(id)) return fail(c, 400, 'bad_request', 'Conta inválida.');
  const rows = await boxOf(c.env, id).exportRows(after ?? '', PAGE);
  return c.json({ rows: rows.map(r => ({ ...r, head: toB64(new Uint8Array(r.head)) })), done: rows.length < PAGE });
});

admin.post('/tally/box', async c => {
  const { id } = await c.req.json<{ id?: string }>().catch(() => ({} as { id?: string }));
  if (!okId(id)) return fail(c, 400, 'bad_request', 'Conta inválida.');
  return c.json(await boxOf(c.env, id).tally());
});

admin.post('/import/box', async c => {
  const body = await c.req.json<{ id?: string; rows?: (Omit<MigrationRow, 'head'> & { head: string })[]; mode?: string; first?: boolean }>()
    .catch(() => ({} as { id?: string }));
  const { id, rows, mode, first } = body as { id?: string; rows?: (Omit<MigrationRow, 'head'> & { head: string })[]; mode?: string; first?: boolean };
  if (!okId(id) || !Array.isArray(rows) || rows.length > PAGE || (mode !== 'replace' && mode !== 'merge')) return fail(c, 400, 'bad_request', 'Pedido inválido.');
  let parsed: MigrationRow[];
  try {
    parsed = rows.map(r => {
      if (!okId(r.id) || !FOLDERS.has(r.folder) || !Number.isFinite(r.received_at) || !Number.isFinite(r.size)) throw new Error('linha');
      const head = fromB64(r.head);
      return { ...r, head: head.buffer.slice(head.byteOffset, head.byteOffset + head.byteLength) as ArrayBuffer };
    });
  } catch { return fail(c, 400, 'bad_request', 'Linha inválida.'); }
  return c.json({ messages: await boxOf(c.env, id).importRows(id, parsed, mode, !!first) });
});

admin.post('/export/blobs', async c => {
  const { cursor } = await c.req.json<{ cursor?: string }>().catch(() => ({} as { cursor?: string }));
  const list = await c.env.BLOBS.list({ cursor: cursor || undefined, limit: 1000, include: ['httpMetadata'] });
  return c.json({
    blobs: list.objects.map(o => ({ key: o.key, size: o.size, type: o.httpMetadata?.contentType ?? null })),
    cursor: list.truncated ? list.cursor : null,
  });
});

admin.post('/export/blob', async c => {
  const { key } = await c.req.json<{ key?: string }>().catch(() => ({} as { key?: string }));
  if (!okKey(key)) return fail(c, 400, 'bad_request', 'Chave inválida.');
  const obj = await c.env.BLOBS.get(key);
  if (!obj) return fail(c, 404, 'not_found', 'Não encontrado.');
  return new Response(obj.body, { headers: { 'content-type': 'application/octet-stream', 'x-blob-type': obj.httpMetadata?.contentType ?? '' } });
});

// Quais destas chaves o destino já tem (para copiar só o que falta).
admin.post('/import/has', async c => {
  const { keys } = await c.req.json<{ keys?: string[] }>().catch(() => ({} as { keys?: string[] }));
  if (!Array.isArray(keys) || keys.length > 100 || !keys.every(okKey)) return fail(c, 400, 'bad_request', 'Chaves inválidas.');
  const found = await Promise.all(keys.map(async k => ((await c.env.BLOBS.head(k)) ? k : null)));
  return c.json({ have: found.filter(Boolean) });
});

admin.post('/import/blob', async c => {
  const key = c.req.header('x-blob-key');
  if (!okKey(key) || !c.req.raw.body) return fail(c, 400, 'bad_request', 'Chave inválida.');
  const type = c.req.header('x-blob-type');
  await c.env.BLOBS.put(key, await c.req.arrayBuffer(), type ? { httpMetadata: { contentType: type } } : undefined);
  return c.json({ ok: true });
});
