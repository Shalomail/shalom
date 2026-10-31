import { Hono } from 'hono';
import { currentWeek } from '../shared/blind';
import { pickLocale } from '../shared/locale';
import { admin } from './admin';
import { agents, apiKeys } from './agents';
import { auth } from './auth';
import { billing, stripeWebhook } from './billing';
import { cliLogin } from './clilogin';
import type { AppEnv, Env } from './env';
import { mail, receiveEmail } from './mail';
import { open } from './open';
import { dailyReport } from './report';
import { avatarOf, profile } from './profile';
import { push } from './push';

export { Mailbox } from './box';

const app = new Hono<AppEnv>().basePath('/api');

// Todo pedido que muda algo precisa do cabeçalho X-Shalom. Outro site não consegue mandar esse
// cabeçalho sem passar pelo CORS, que aqui não existe; somado ao cookie SameSite=Strict, fecha o CSRF.
// O webhook do Stripe fica de fora: vale pela assinatura (worker/billing.ts), não por cookie.
app.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-shalom') !== '1' && c.req.path !== '/api/billing/webhook') {
    return c.json({ error: 'csrf', message: 'Pedido recusado.' }, 403);
  }
  await next();
  // Qualquer resposta da API, mesmo aberta como página, fica inerte: sem script, sem moldura, sem farejar tipo.
  const h = c.res.headers;
  if (!h.has('cache-control')) h.set('cache-control', 'no-store');
  h.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
  h.set('x-content-type-options', 'nosniff');
  h.set('cross-origin-resource-policy', 'same-origin');
  h.set('referrer-policy', 'no-referrer');
});

// Janela da migração de conta (docs/migracao.md): só a administração e a configuração respondem.
app.use('*', async (c, next) => {
  if (c.env.MAINTENANCE === 'on' && !c.req.path.startsWith('/api/admin/') && c.req.path !== '/api/auth/config') {
    return c.json({ error: 'maintenance', message: 'O Shalom Mail está em manutenção por alguns minutos. Seus e-mails continuam chegando e nada se perde.' }, 503);
  }
  await next();
});

app.route('/auth', auth);
// Administração pelo terminal (scripts/admin.mjs), com a ADMIN_KEY.
app.route('/admin', admin);
// Rotas sem login (entrega anônima e chaves públicas) antes das que exigem sessão.
app.route('/', open);
app.get('/avatar/:address', avatarOf);
app.route('/profile', profile);
// CLI e agentes de IA (chaves de API, caixas de agente e plano), antes das rotas da caixa.
app.post('/billing/webhook', stripeWebhook);
app.route('/apikeys', apiKeys);
app.route('/agents', agents);
app.route('/billing', billing);
app.route('/cli', cliLogin);
app.route('/push', push);
app.route('/', mail);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal', message: 'Algo deu errado do nosso lado. Tente de novo.' }, 500);
});

// Limpeza diária: contadores vencidos, sessões expiradas e os avisos de iPhone dessas sessões.
async function cleanup(env: Env) {
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM counters WHERE reset_at <= ?').bind(t),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(t),
    env.DB.prepare('DELETE FROM known_devices WHERE created_at <= ?').bind(t - 365 * 24 * 3600 * 1000),
    env.DB.prepare('DELETE FROM login_tickets WHERE created_at <= ?').bind(t - 3600 * 1000),
    env.DB.prepare('DELETE FROM email_tokens WHERE created_at <= ?').bind(t - 24 * 3600 * 1000),
    env.DB.prepare('DELETE FROM spent_tokens WHERE week < ?').bind(currentWeek(t) - 1),
    env.DB.prepare('DELETE FROM cli_logins WHERE created_at <= ?').bind(t - 3600 * 1000),
    env.DB.prepare('DELETE FROM push_tokens WHERE session NOT IN (SELECT token_hash FROM sessions)'),
  ]);
}

// A landing é a raiz (index.html, servida direto da borda). As rotas do app passam por aqui e recebem o
// app.html, com os mesmos cabeçalhos de segurança do _headers.
const APP_ROUTES = /^\/(entrar|criar-conta|caixa|perfil|confirmar|nova-senha|conectar|agentes-ia)(\/|$)/;
const PAGE_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'cross-origin-opener-policy': 'same-origin',
  'cache-control': 'no-cache',
  // Telas do app não entram no Google; quem ranqueia é a landing.
  'x-robots-tag': 'noindex',
};

async function appShell(req: Request, env: Env) {
  const res = await env.ASSETS.fetch(new Request(new URL('/app', req.url), req));
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(PAGE_HEADERS)) out.headers.set(k, v);
  return out;
}

// Raiz: português fica aqui; os outros idiomas vão para /<idioma>/ (escolha guardada no cookie ou a
// língua do navegador). A resposta varia por esses cabeçalhos e não fica em cache compartilhado.
async function home(req: Request, env: Env) {
  const lang = pickLocale(req.headers.get('accept-language'), req.headers.get('cookie'));
  const vary = { vary: 'Accept-Language, Cookie', 'cache-control': 'private, no-cache' };
  if (lang !== 'pt') return new Response(null, { status: 302, headers: { location: `/${lang}/`, ...vary } });
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(vary)) out.headers.set(k, v);
  return out;
}

export default {
  fetch(req, env, ctx) {
    const path = new URL(req.url).pathname;
    // HEAD recebe o mesmo que GET (robôs e monitores conferem a página assim).
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (read && path === '/') return home(req, env);
    if (read && APP_ROUTES.test(path)) return appShell(req, env);
    return app.fetch(req, env, ctx);
  },
  email: receiveEmail,
  // Uma vez por dia: o resumo para a operação (antes de a limpeza apagar os contadores de ontem) e a limpeza.
  scheduled: (_event, env, ctx) => ctx.waitUntil(dailyReport(env).catch(e => console.error('resumo diário falhou', String(e))).then(() => cleanup(env))),
} satisfies ExportedHandler<Env>;
