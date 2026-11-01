// Caixas de e-mail para agentes de IA, criadas pelo CLI (cli/). A pessoa cria uma chave de API nas
// Configurações; o CLI gera o par de chaves da caixa na máquina do agente e manda só a pública. Cada
// caixa recebe a própria chave de API, que lê e envia só por ela. A criptografia é a mesma das contas
// de pessoas: o servidor guarda tudo lacrado e não consegue ler.
import { Hono, type Context } from 'hono';
import { addressTaken, confirmedOk, requireUser } from './auth';
import { newApiKey } from './apikeys';
import { boxOf } from './box';
import type { AppEnv } from './env';
import { agentCount, CREATES_PER_DAY, planOf } from './plans';
import { bump, canonicalOf, fail, isReserved, normalizeAddress, now, randomToken, sha256, tally } from './util';
import { fromB64, seal, toB64 } from '../shared/seal';

const DAY = 24 * 3600 * 1000;
export const MAX_ACCOUNT_KEYS = 10;

const cleanName = (s: unknown) => String(s ?? '').replace(/[\r\n<>"]+/g, ' ').trim().slice(0, 60);
const validKey = (b64: unknown) => {
  try { return typeof b64 === 'string' && fromB64(b64).length === 32; } catch { return false; }
};

// Chaves de API da pessoa. Só pela sessão do app: uma chave não cria outra.
export const apiKeys = new Hono<AppEnv>();
apiKeys.use('*', requireUser);
apiKeys.use('*', async (c, next) => (c.get('apiKey') ? fail(c, 403, 'key_scope', 'Chaves de API só pelas Configurações.') : next()));

apiKeys.get('/', async c => {
  const rows = await c.env.DB.prepare("SELECT key_hash, name, hint, created_at, last_used FROM api_keys WHERE user_id = ? AND kind = 'account' ORDER BY created_at DESC")
    .bind(c.get('user').id).all<{ key_hash: string; name: string; hint: string; created_at: number; last_used: number | null }>();
  return c.json({ keys: rows.results.map(r => ({ id: r.key_hash.slice(0, 16), name: r.name, hint: r.hint, createdAt: r.created_at, lastUsed: r.last_used })) });
});

apiKeys.post('/', async c => {
  const user = c.get('user');
  type Body = { name?: string; authKey?: unknown; pin?: string; code?: string; recovery?: string };
  const body = await c.req.json<Body>().catch((): Body => ({ name: '' }));
  const { name } = body;
  // Chave nova cria e troca caixas de agente: a pessoa confirmada.
  const denied = await confirmedOk(c, body);
  if (denied) return denied;
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND kind = 'account'").bind(user.id).first<number>('n');
  if ((count ?? 0) >= MAX_ACCOUNT_KEYS) return fail(c, 400, 'too_many_keys', `No máximo ${MAX_ACCOUNT_KEYS} chaves. Revogue uma para criar outra.`);
  const key = await newApiKey(c.env, user.id, 'account', cleanName(name) || 'CLI');
  return c.json({ key, id: (await sha256(key)).slice(0, 16) });
});

apiKeys.post('/revoke', async c => {
  const { id } = await c.req.json<{ id?: string }>();
  if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return fail(c, 400, 'bad_request', 'Chave desconhecida.');
  await c.env.DB.prepare("DELETE FROM api_keys WHERE user_id = ? AND kind = 'account' AND substr(key_hash, 1, 16) = ?").bind(c.get('user').id, id).run();
  return c.json({ ok: true });
});

// Caixas de agente. Listar e apagar: pela sessão do app ou pela chave da conta. Criar e trocar a chave
// de uma caixa: só pela chave da conta (o CLI), porque a chave privada nasce na máquina do agente.
export const agents = new Hono<AppEnv>();
agents.use('*', requireUser);

type AgentRow = { id: string; address: string; name: string; created_at: number; public_key: string };

agents.get('/', async c => {
  const owner = c.get('user').id;
  const [rows, plan] = await Promise.all([
    c.env.DB.prepare('SELECT id, address, name, created_at FROM users WHERE owner_id = ? ORDER BY created_at, id').bind(owner).all<AgentRow>(),
    planOf(c.env, owner),
  ]);
  return c.json({
    agents: rows.results.map((r, i) => ({ id: r.id, address: r.address, name: r.name, createdAt: r.created_at, paused: plan.limit !== null && i >= plan.limit })),
    plan: { plan: plan.plan, limit: plan.limit, used: rows.results.length },
  });
});

agents.post('/', async c => {
  if (c.get('apiKey') !== 'account') return fail(c, 403, 'key_scope', 'Caixas de agente são criadas pelo CLI, com a chave da conta.');
  const owner = c.get('user');
  const body = await c.req.json<{ address?: string; name?: string; publicKey?: string }>();
  const full = normalizeAddress(c.env, String(body.address ?? ''));
  if (!full) return fail(c, 400, 'bad_address', 'Esse endereço não pode ser usado.');
  if (isReserved(full)) return fail(c, 400, 'reserved', 'Esse endereço é reservado. Escolha outro nome, por exemplo seunome-bot.');
  if (!validKey(body.publicKey)) return fail(c, 400, 'bad_request', 'Chave pública inválida.');
  const plan = await planOf(c.env, owner.id);
  if (plan.limit !== null && (await agentCount(c.env, owner.id)) >= plan.limit) {
    return fail(c, 402, 'agent_limit', `Seu plano permite ${plan.limit} caixas de agente. Apague uma ou mude de plano.`);
  }
  if (await addressTaken(c.env, full, owner.id)) return fail(c, 409, 'taken', 'Esse endereço já tem dono.');
  const perDay = CREATES_PER_DAY[plan.plan];
  if ((await bump(c.env.DB, `agents-new:${owner.id}`, DAY)) > perDay) {
    return fail(c, 429, 'create_limit', `Você chegou no limite de ${perDay} caixas novas por dia. Tente de novo amanhã.`);
  }
  const id = crypto.randomUUID();
  const name = cleanName(body.name) || full.split('@')[0];
  const lang = (await c.env.DB.prepare('SELECT lang FROM users WHERE id = ?').bind(owner.id).first<string>('lang')) ?? 'en';
  const t = now();
  // Sem senha: auth_hash '!' nunca confere e o envelope fica vazio (a chave privada não passa por aqui).
  // A contagem e a criação vão juntas numa instrução só: dois pedidos ao mesmo tempo não passam do limite.
  let created = 0;
  try {
    const [ins] = await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO users (id, address, canonical, name, auth_hash, salt, kdf, public_key, envelope, created_at, lang, owner_id) SELECT ?, ?, ?, ?, '!', ?, '{}', ?, '', ?, ?, ? WHERE (SELECT COUNT(*) FROM users WHERE owner_id = ?) < ?",
      ).bind(id, full, canonicalOf(full), name, randomToken(16), body.publicKey, t, lang, owner.id, owner.id, plan.limit ?? 1_000_000_000),
      c.env.DB.prepare('DELETE FROM retired WHERE canonical = ? AND EXISTS (SELECT 1 FROM users WHERE id = ?)').bind(canonicalOf(full), id),
    ]);
    created = ins.meta.changes ?? 0;
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(c, 409, 'taken', 'Esse endereço acabou de ser escolhido por outra pessoa.');
    throw e;
  }
  if (!created) return fail(c, 402, 'agent_limit', `Seu plano permite ${plan.limit} caixas de agente. Apague uma ou mude de plano.`);
  await tally(c.env.DB, 'agent_new');
  await boxOf(c.env, id).ensureAlarm(id);
  const key = await newApiKey(c.env, id, 'agent', name);
  return c.json({ agent: { id, address: full, name, createdAt: t }, key });
});

async function ownAgent(c: Context<AppEnv>, id: unknown): Promise<AgentRow | null> {
  if (typeof id !== 'string' || id.length > 64) return null;
  return c.env.DB.prepare('SELECT id, address, name, created_at, public_key FROM users WHERE id = ? AND owner_id = ?').bind(id, c.get('user').id).first<AgentRow>();
}

// Apaga a caixa e tudo dentro dela. O endereço fica guardado para o mesmo dono. Pela sessão do app basta
// a conta; pela chave da conta (CLI) precisa também da chave da própria caixa, para uma chave da conta
// vazada não bastar para destruir caixas.
// `shalom logout`: a chave da conta que fez o pedido deixa de valer.
agents.post('/logout', async c => {
  if (c.get('apiKey') !== 'account') return fail(c, 403, 'key_scope', 'Use o CLI, com a chave da conta.');
  await c.env.DB.prepare("DELETE FROM api_keys WHERE key_hash = ? AND user_id = ? AND kind = 'account'").bind(c.get('apiKeyHash') ?? '', c.get('user').id).run();
  return c.json({ ok: true });
});

agents.post('/delete', async c => {
  const body = await c.req.json<{ id?: string; agentKey?: string; authKey?: unknown; pin?: string; code?: string; recovery?: string }>();
  const { id, agentKey } = body;
  const agent = await ownAgent(c, id);
  if (!agent) return fail(c, 404, 'not_found', 'Caixa de agente não encontrada.');
  if (c.get('apiKey')) {
    const proof = typeof agentKey === 'string' && agentKey.length < 100
      ? await c.env.DB.prepare("SELECT 1 FROM api_keys WHERE key_hash = ? AND user_id = ? AND kind = 'agent'").bind(await sha256(agentKey), agent.id).first()
      : null;
    if (!proof) return fail(c, 403, 'key_scope', 'Para apagar pelo terminal, a chave da própria caixa precisa estar nesta máquina. Ou apague pela página Agentes de IA.');
  } else {
    // Pela página: a pessoa confirmada (apagar a caixa leva os e-mails dela junto, de vez).
    const denied = await confirmedOk(c, body);
    if (denied) return denied;
  }
  await boxOf(c.env, agent.id).destroy(agent.id);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO retired (canonical, owner_id, at) VALUES (?, ?, ?) ON CONFLICT(canonical) DO UPDATE SET owner_id = excluded.owner_id, at = excluded.at')
      .bind(canonicalOf(agent.address), c.get('user').id, now()),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(agent.id),
  ]);
  return c.json({ ok: true });
});

// Chave nova para uma caixa (a antiga para de valer na hora). A chave privada da caixa não muda.
agents.post('/rotate', async c => {
  if (c.get('apiKey') !== 'account') return fail(c, 403, 'key_scope', 'Use o CLI, com a chave da conta.');
  const { id } = await c.req.json<{ id?: string }>();
  const agent = await ownAgent(c, id);
  if (!agent) return fail(c, 404, 'not_found', 'Caixa de agente não encontrada.');
  await c.env.DB.prepare('DELETE FROM api_keys WHERE user_id = ?').bind(agent.id).run();
  // A chave nova vai lacrada com a chave pública da caixa: só quem tem a chave privada dela (a máquina do
  // agente) abre. Uma chave da conta vazada não vira, assim, permissão para ler ou enviar pela caixa.
  const key = await newApiKey(c.env, agent.id, 'agent', agent.name);
  return c.json({ sealedKey: toB64(await seal(fromB64(agent.public_key), new TextEncoder().encode(key), 'raw')) });
});
