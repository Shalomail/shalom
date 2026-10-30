// Cria (ou atualiza) no Stripe da X Tech os planos das caixas de agente do Shalom: produtos, preços
// mensais em dólar (com real para quem paga do Brasil), o portal do cliente e o webhook. Guarda no
// Keychain (serviço shalom-prod) a chave, o segredo do webhook e o portal, que o deploy sobe sozinho.
// A chave é a mesma da conta Stripe que o VSL PRO usa, lida do Keychain sem aparecer na tela.
// Uso: node scripts/stripe-setup.mjs           (produção, KEY=vslpro-live-STRIPE_SECRET_KEY)
//      KEY=vslpro-test-STRIPE_SECRET_KEY node scripts/stripe-setup.mjs   (modo de teste, só mostra os ids)
import { execFileSync } from 'node:child_process';

const KEY = process.env.KEY || 'vslpro-live-STRIPE_SECRET_KEY';
const SK = execFileSync('security', ['find-generic-password', '-s', KEY, '-w']).toString().trim();
const LIVE = SK.startsWith('sk_live_');
const VERSION = '2025-09-30.clover';
const ORIGIN = 'https://shalomail.com';

const call = async (method, path, params) => {
  const body = params ? new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, String(v)]]))) : undefined;
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers: { authorization: `Bearer ${SK}`, 'stripe-version': VERSION, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body });
  const j = await r.json();
  if (j.error) throw new Error(`${path}: ${j.error.message}`);
  return j;
};
const keep = (name, value) => execFileSync('security', ['add-generic-password', '-U', '-s', 'shalom-prod', '-a', name, '-w', value]);

// Os mesmos de worker/plans.ts (lookup_key shalom_<plano>_monthly). Valor em centavos.
const PLANS = [
  { key: 'agents5', name: 'Shalom Mail Agents 5', desc: 'Up to 5 end-to-end encrypted mailboxes for AI agents', usd: 499, brl: Number(process.env.BRL5 || 2490) },
  { key: 'agents12', name: 'Shalom Mail Agents 12', desc: 'Up to 12 end-to-end encrypted mailboxes for AI agents', usd: 999, brl: Number(process.env.BRL12 || 4990) },
  { key: 'unlimited', name: 'Shalom Mail Unlimited', desc: 'Unlimited end-to-end encrypted mailboxes for AI agents, up to 250 new mailboxes a day', usd: 4990, brl: Number(process.env.BRL_UNLIMITED || 24990) },
];

const out = { mode: LIVE ? 'live' : 'test' };
const lookup = p => `shalom_${p.key}_monthly`;
const existing = await call('GET', `prices?active=true&limit=20&${PLANS.map(p => `lookup_keys[]=${lookup(p)}`).join('&')}&expand[]=data.currency_options`);
for (const p of PLANS) {
  let price = existing.data.find(x => x.lookup_key === lookup(p));
  const priceParams = product => ({
    product, currency: 'usd', unit_amount: p.usd, 'currency_options[brl][unit_amount]': p.brl, 'recurring[interval]': 'month',
    lookup_key: lookup(p), transfer_lookup_key: true, nickname: `${p.name} monthly`, 'metadata[app]': 'shalom', 'metadata[plan]': p.key,
  });
  if (!price) {
    const prod = await call('POST', 'products', { name: p.name, description: p.desc, 'metadata[app]': 'shalom', 'metadata[plan]': p.key, statement_descriptor: 'SHALOM MAIL', tax_code: 'txcd_10103001' });
    price = await call('POST', 'prices', priceParams(prod.id));
    console.log(`${p.key}: produto ${prod.id}, preço ${price.id}`);
  } else if (price.unit_amount !== p.usd || price.currency_options?.brl?.unit_amount !== p.brl) {
    // Preço no Stripe não muda de valor: o novo herda o lookup_key e o antigo sai de venda (quem assina segue nele).
    const product = typeof price.product === 'string' ? price.product : price.product.id;
    const next = await call('POST', 'prices', priceParams(product));
    await call('POST', `prices/${price.id}`, { active: false });
    console.log(`${p.key}: preço novo ${next.id}; antigo ${price.id} desativado`);
    price = next;
  } else console.log(`${p.key}: preço ${price.id} já certo`);
  out[`price_${p.key}`] = price.id;
  out[`product_${p.key}`] = typeof price.product === 'string' ? price.product : price.product.id;
}

// Portal do cliente só do Shalom (a conta também tem o VSL PRO e a Rodada Final, cada um com o seu).
const portal = {
  'business_profile[headline]': 'Shalom Mail: AI agent mailboxes',
  'business_profile[privacy_policy_url]': `${ORIGIN}/privacidade/`,
  'business_profile[terms_of_service_url]': `${ORIGIN}/termos/`,
  default_return_url: `${ORIGIN}/agentes-ia`,
  'features[invoice_history][enabled]': true,
  'features[payment_method_update][enabled]': true,
  'features[subscription_cancel][enabled]': true,
  'features[subscription_cancel][mode]': 'at_period_end',
  'features[subscription_update][enabled]': true,
  'features[subscription_update][default_allowed_updates][]': ['price'],
  'features[subscription_update][proration_behavior]': 'create_prorations',
  'metadata[app]': 'shalom',
};
PLANS.forEach((p, i) => {
  portal[`features[subscription_update][products][${i}][product]`] = out[`product_${p.key}`];
  portal[`features[subscription_update][products][${i}][prices][]`] = [out[`price_${p.key}`]];
});
const portals = await call('GET', 'billing_portal/configurations?limit=50');
const mine = portals.data.find(c => c.metadata?.app === 'shalom' && c.active);
out.portal = (mine ? await call('POST', `billing_portal/configurations/${mine.id}`, portal) : await call('POST', 'billing_portal/configurations', portal)).id;

// Webhook: o segredo só aparece na criação.
const url = `${ORIGIN}/api/billing/webhook`;
const events = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];
const hooks = await call('GET', 'webhook_endpoints?limit=100');
let hook = hooks.data.find(h => h.url === url);
if (LIVE) {
  if (!hook) {
    hook = await call('POST', 'webhook_endpoints', { url, 'enabled_events[]': events, api_version: VERSION, description: 'Shalom Mail', 'metadata[app]': 'shalom' });
    keep('STRIPE_WEBHOOK_SECRET', hook.secret);
    out.webhook = `${hook.id} criado`;
  } else out.webhook = `${hook.id} já existia`;
  keep('STRIPE_SECRET_KEY', SK);
  keep('STRIPE_PORTAL_CONFIG', out.portal);
  out.keychain = 'STRIPE_SECRET_KEY, STRIPE_PORTAL_CONFIG' + (out.webhook.endsWith('criado') ? ' e STRIPE_WEBHOOK_SECRET' : '') + ' guardados em shalom-prod';
} else out.webhook = 'modo de teste: sem webhook (o plano é gravado na volta do Checkout)';
console.log(JSON.stringify(out, null, 2));
