// Chaves de API do CLI. O pedido manda "Authorization: Bearer shalom_sk_..." (chave da pessoa) ou
// "shalom_ak_..." (chave de uma caixa de agente). O banco guarda só o hash, como nas sessões.
import type { Context } from 'hono';
import type { AppEnv, Env } from './env';
import { agentPaused } from './plans';
import { fail, now, randomToken, sha256, suspended } from './util';

export type KeyKind = 'account' | 'agent';
const PREFIX: Record<KeyKind, string> = { account: 'shalom_sk_', agent: 'shalom_ak_' };
const KEY_RE = /^shalom_(sk|ak)_[A-Za-z0-9_-]{43}$/;

export async function newApiKey(env: Env, userId: string, kind: KeyKind, name: string): Promise<string> {
  const key = PREFIX[kind] + randomToken(32);
  await env.DB.prepare('INSERT INTO api_keys (key_hash, user_id, kind, name, hint, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(key), userId, kind, name.slice(0, 60), key.slice(-4), now()).run();
  return key;
}

// O que cada chave alcança. A da pessoa cuida só das caixas de agente e do plano: não abre a caixa da
// própria pessoa nem as Configurações. A de um agente lê e envia só pela caixa dele.
const ACCOUNT_PATHS = /^\/api\/(agents|billing)(\/|$)|^\/api\/auth\/me$/;
export const AGENT_PATHS = /^\/api\/(messages|send|cert|tokens|usage)(\/|$)|^\/api\/auth\/me$/;
const SENDING = /^\/api\/(send|cert|tokens)$/;

type KeyRow = { kind: KeyKind; last_used: number | null; id: string; address: string; name: string; public_key: string; owner_id: string | null; created_at: number; suspended_at: number | null };

// Devolve a resposta de erro, ou null com o usuário do pedido já definido.
export async function keyAuth(c: Context<AppEnv>, token: string): Promise<Response | null> {
  if (!KEY_RE.test(token)) return fail(c, 401, 'bad_key', 'Chave de API inválida.');
  const hash = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT k.kind, k.last_used, u.id, u.address, u.name, u.public_key, u.owner_id, u.created_at,
       COALESCE(u.suspended_at, o.suspended_at) AS suspended_at
     FROM api_keys k JOIN users u ON u.id = k.user_id LEFT JOIN users o ON o.id = u.owner_id WHERE k.key_hash = ?`,
  ).bind(hash).first<KeyRow>();
  if (!row) return fail(c, 401, 'bad_key', 'Chave de API inválida ou revogada.');
  // Conta suspensa, ou caixa de agente de uma conta suspensa: as chaves param junto.
  if (row.suspended_at) return suspended(c);
  const path = c.req.path;
  if (!(row.kind === 'account' ? ACCOUNT_PATHS : AGENT_PATHS).test(path)) {
    return fail(c, 403, 'key_scope', row.kind === 'account'
      ? 'A chave da conta só cuida das caixas de agente. Para ler e enviar, use a chave do agente.'
      : 'A chave de um agente só lê e envia pela caixa dele.');
  }
  if (row.kind === 'agent' && row.owner_id && SENDING.test(path) && (await agentPaused(c.env, row.owner_id, row.created_at, row.id))) {
    return fail(c, 402, 'agent_paused', 'Esta caixa de agente está pausada: o plano do dono não cobre mais caixas. Ela continua recebendo e pode ser lida.');
  }
  // Último uso, no máximo uma escrita por hora.
  if (!row.last_used || now() - row.last_used > 3600 * 1000) {
    c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE api_keys SET last_used = ? WHERE key_hash = ?').bind(now(), hash).run());
  }
  c.set('user', { id: row.id, address: row.address, name: row.name, public_key: row.public_key });
  c.set('apiKey', row.kind);
  c.set('apiKeyHash', hash);
  return null;
}
