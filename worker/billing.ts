// Cobrança do plano das caixas de agente, pelo Stripe da X Tech. A pessoa assina pelo Checkout do
// Stripe (o cartão nunca passa por aqui) e cuida da assinatura pelo portal do Stripe. O plano é gravado
// na volta do Checkout e pelo webhook, que também traz renovação, troca e cancelamento.
import { Hono, type Context } from 'hono';
import { requireUser } from './auth';
import type { AppEnv, Env } from './env';
import { agentCount, lookupKey, PAID, planOf, PRICE_USD, type Plan } from './plans';
import { bump, fail, hex, hmac, now, sameBytes } from './util';

const STRIPE_VERSION = '2025-09-30.clover';

class StripeError extends Error {}

async function stripe(env: Env, path: string, params: Record<string, string> = {}, method: 'GET' | 'POST' | 'DELETE' = 'POST'): Promise<any> {
  const qs = method === 'GET' && Object.keys(params).length ? `?${new URLSearchParams(params)}` : '';
  const res = await fetch(`https://api.stripe.com/v1/${path}${qs}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'stripe-version': STRIPE_VERSION, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? new URLSearchParams(params) : undefined,
  });
  const json = (await res.json()) as any;
  if (!res.ok) {
    console.error('[stripe]', path, json?.error?.message);
    throw new StripeError(json?.error?.message ?? 'stripe');
  }
  return json;
}

// Preço de cada plano pelo lookup_key (cadastrado por scripts/stripe-setup.mjs), guardado por instância.
const prices = new Map<string, string>();
async function priceOf(env: Env, plan: Exclude<Plan, 'free'>): Promise<string> {
  const key = lookupKey(plan);
  if (!prices.has(key)) {
    const list = await stripe(env, 'prices', { 'lookup_keys[]': key, active: 'true', limit: '1' }, 'GET');
    if (!list.data?.[0]?.id) throw new StripeError(`sem preço para ${key}`);
    prices.set(key, list.data[0].id);
  }
  return prices.get(key)!;
}

const planOfPrice = async (env: Env, price: any): Promise<Plan | null> => {
  const byLookup = PAID.find(p => lookupKey(p) === price?.lookup_key);
  if (byLookup) return byLookup;
  if (typeof price?.id !== 'string') return null;
  for (const p of PAID) if ((await priceOf(env, p).catch(() => null)) === price.id) return p;
  return null;
};

// Grava a assinatura como o Stripe mostra. Na versão da API em uso, o fim do período fica no item.
async function saveSubscription(env: Env, userId: string, customer: string | null, sub: any) {
  const item = sub?.items?.data?.[0];
  const periodEnd = (item?.current_period_end ?? sub?.current_period_end ?? 0) * 1000 || null;
  // Plano que não dá para reconhecer não rebaixa ninguém: só cancelamento de verdade volta para o grátis.
  const known = await planOfPrice(env, item?.price);
  const ended = ['canceled', 'unpaid', 'incomplete_expired'].includes(sub?.status);
  const current = await env.DB.prepare('SELECT plan FROM billing WHERE user_id = ?').bind(userId).first<string>('plan');
  const plan = known ?? (ended ? 'free' : current ?? 'free');
  await env.DB.prepare(
    `INSERT INTO billing (user_id, customer_id, subscription_id, plan, status, period_end, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET customer_id = COALESCE(excluded.customer_id, customer_id), subscription_id = excluded.subscription_id,
       plan = excluded.plan, status = excluded.status, period_end = excluded.period_end, updated_at = excluded.updated_at`,
  ).bind(userId, customer, sub?.id ?? null, plan, sub?.status ?? null, periodEnd, now()).run();
}

const off = (c: Context<AppEnv>) => fail(c, 400, 'billing_off', 'A cobrança ainda não está ligada.');
// Conta apagada: a assinatura acaba na hora, para ninguém seguir pagando por uma conta que não existe.
export async function cancelSubscription(env: Env, userId: string): Promise<void> {
  const row = await env.DB.prepare('SELECT subscription_id, status FROM billing WHERE user_id = ?').bind(userId).first<{ subscription_id: string | null; status: string | null }>();
  if (!row?.subscription_id || row.status === 'canceled') return;
  try { await stripe(env, `subscriptions/${row.subscription_id}`, {}, 'DELETE'); } catch (e) {
    // Já cancelada do lado do Stripe: segue. Qualquer outro erro para a exclusão antes de apagar algo.
    if (!/No such subscription|canceled/i.test(String((e as Error).message))) throw e;
  }
}

const stripeDown = (c: Context<AppEnv>) => fail(c, 502, 'stripe_error', 'Não conseguimos falar com o Stripe. Tente de novo em instantes.');

// Webhook do Stripe: fora do requireUser e do cabeçalho X-Shalom (worker/index.ts). Vale só com a
// assinatura do segredo do webhook, feita há menos de 5 minutos.
export async function stripeWebhook(c: Context<AppEnv>) {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !c.env.STRIPE_SECRET_KEY) return c.json({ ok: false }, 400);
  const payload = await c.req.text();
  const header = c.req.header('stripe-signature') ?? '';
  const t = /(?:^|,)t=(\d+)/.exec(header)?.[1];
  const sigs = [...header.matchAll(/(?:^|,)v1=([0-9a-f]{64})/g)].map(m => m[1]);
  const enc = new TextEncoder();
  const expected = enc.encode(hex(await hmac(secret, `${t}.${payload}`)));
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300 || !sigs.some(s => sameBytes(enc.encode(s), expected))) {
    return c.json({ ok: false }, 400);
  }
  const event = JSON.parse(payload) as { type: string; data: { object: any } };
  const obj = event.data.object;
  try {
    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription' && obj.client_reference_id && obj.subscription) {
      const sub = await stripe(c.env, `subscriptions/${obj.subscription}`, {}, 'GET');
      await saveSubscription(c.env, obj.client_reference_id, obj.customer ?? null, sub);
    } else if (event.type.startsWith('customer.subscription.')) {
      const userId = obj.metadata?.user_id
        ?? (await c.env.DB.prepare('SELECT user_id FROM billing WHERE subscription_id = ? OR customer_id = ?').bind(obj.id, obj.customer).first<string>('user_id'));
      if (userId) await saveSubscription(c.env, userId, obj.customer ?? null, obj);
    }
  } catch (e) {
    // 500 faz o Stripe tentar de novo mais tarde.
    console.error('webhook do stripe', event.type, String(e));
    return c.json({ ok: false }, 500);
  }
  return c.json({ ok: true });
}

export const billing = new Hono<AppEnv>();
billing.use('*', requireUser);
// Ver o plano vale pela chave da conta (CLI); assinar, trocar de plano e abrir o portal (cartão e
// faturas), só pela sessão do app: uma chave vazada não cobra nada nem mostra dados de pagamento.
billing.use('*', async (c, next) => (c.get('apiKey') && c.req.method !== 'GET' ? fail(c, 403, 'key_scope', 'Assine ou troque de plano pela página Agentes de IA.') : next()));
// Cada POST aqui chama o Stripe (conta dividida com outros produtos da X Tech): 5 por minuto por conta.
billing.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && (await bump(c.env.DB, `billing:${c.get('user').id}`, 60 * 1000)) > 5) {
    return fail(c, 429, 'slow_down', 'Muitos pedidos seguidos. Espere um minuto.');
  }
  await next();
});

billing.get('/', async c => {
  const user = c.get('user');
  const [plan, used] = await Promise.all([planOf(c.env, user.id), agentCount(c.env, user.id)]);
  return c.json({
    enabled: !!c.env.STRIPE_SECRET_KEY,
    plan: plan.plan, limit: plan.limit, used,
    status: plan.status, periodEnd: plan.periodEnd, subscribed: !!plan.subscription && plan.plan !== 'free',
    prices: PRICE_USD,
  });
});

// Assinar (Checkout) ou trocar de plano. Quem já assina troca na hora, pagando a diferença proporcional.
billing.post('/checkout', async c => {
  if (!c.env.STRIPE_SECRET_KEY) return off(c);
  const user = c.get('user');
  const { plan } = await c.req.json<{ plan?: string }>();
  if (!PAID.includes(plan as Exclude<Plan, 'free'>)) return fail(c, 400, 'bad_request', 'Plano desconhecido.');
  const target = plan as Exclude<Plan, 'free'>;
  const current = await planOf(c.env, user.id);
  try {
    const price = await priceOf(c.env, target);
    if (current.subscription && current.plan !== 'free') {
      if (current.plan === target) return c.json({ changed: false, plan: target });
      const sub = await stripe(c.env, `subscriptions/${current.subscription}`, {}, 'GET');
      const updated = await stripe(c.env, `subscriptions/${current.subscription}`, {
        'items[0][id]': sub.items.data[0].id,
        'items[0][price]': price,
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
      });
      if (updated.pending_update) return fail(c, 402, 'card_declined', 'O cartão recusou a diferença. Atualize o cartão no portal e tente de novo.');
      await saveSubscription(c.env, user.id, current.customer, updated);
      return c.json({ changed: true, plan: target });
    }
    const origin = c.env.APP_ORIGIN;
    const session = await stripe(c.env, 'checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      client_reference_id: user.id,
      'subscription_data[metadata][user_id]': user.id,
      'metadata[user_id]': user.id,
      allow_promotion_codes: 'true',
      success_url: `${origin}/agentes-ia?plano=ok&sessao={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/agentes-ia`,
      ...(current.customer ? { customer: current.customer } : { customer_email: user.address }),
    });
    return c.json({ url: session.url });
  } catch (e) {
    if (e instanceof StripeError) return stripeDown(c);
    throw e;
  }
});

// Volta do Checkout: grava o plano na hora, sem esperar o webhook.
billing.post('/sync', async c => {
  if (!c.env.STRIPE_SECRET_KEY) return off(c);
  const { session } = await c.req.json<{ session?: string }>();
  if (typeof session !== 'string' || !/^cs_[A-Za-z0-9_]{10,200}$/.test(session)) return fail(c, 400, 'bad_request', 'Sessão inválida.');
  try {
    const s = await stripe(c.env, `checkout/sessions/${session}`, { 'expand[]': 'subscription' }, 'GET');
    if (s.client_reference_id !== c.get('user').id || !s.subscription) return fail(c, 404, 'not_found', 'Assinatura não encontrada.');
    await saveSubscription(c.env, c.get('user').id, s.customer ?? null, s.subscription);
  } catch (e) {
    if (e instanceof StripeError) return stripeDown(c);
    throw e;
  }
  const plan = await planOf(c.env, c.get('user').id);
  return c.json({ plan: plan.plan, limit: plan.limit });
});

// Portal do Stripe: cartão, faturas, troca e cancelamento.
billing.post('/portal', async c => {
  if (!c.env.STRIPE_SECRET_KEY) return off(c);
  const plan = await planOf(c.env, c.get('user').id);
  if (!plan.customer) return fail(c, 404, 'not_found', 'Você ainda não assinou um plano.');
  try {
    const session = await stripe(c.env, 'billing_portal/sessions', {
      customer: plan.customer,
      return_url: `${c.env.APP_ORIGIN}/agentes-ia`,
      ...(c.env.STRIPE_PORTAL_CONFIG ? { configuration: c.env.STRIPE_PORTAL_CONFIG } : {}),
    });
    return c.json({ url: session.url });
  } catch (e) {
    if (e instanceof StripeError) return stripeDown(c);
    throw e;
  }
});
