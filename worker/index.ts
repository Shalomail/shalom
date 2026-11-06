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
import { AGENT_PATHS } from './apikeys';
import { push } from './push';
import { bodyCap, clientIp, fail, MB } from './util';

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

// Teto largo por rede para qualquer pedido à API (600 por minuto): uma rede sozinha não inunda o Worker,
// o banco nem as caixas. Ataque grande e espalhado a borda da Cloudflare segura antes de chegar aqui.
app.use('*', async (c, next) => {
  if (!(await c.env.API_LIMIT.limit({ key: clientIp(c) })).success) {
    // Muitos agentes de IA num servidor só (plano Unlimited) passam do teto da rede: pedido com chave de
    // agente ganha uma folga própria por rede (6000 por minuto). A chave é conferida adiante e o teto por conta
    // vale para cada caixa.
    // Só nas rotas que a chave de agente alcança (lá a chave é conferida antes de qualquer trabalho) e só com
    // a chave no formato certo: um cabeçalho inventado não compra folga na entrega anônima nem no admin.
    const agent = AGENT_PATHS.test(c.req.path) && /^Bearer\s+shalom_ak_[A-Za-z0-9_-]{43}$/.test(c.req.header('authorization') ?? '');
    if (!agent || !(await c.env.AGENTS_LIMIT.limit({ key: clientIp(c) })).success) return fail(c, 429, 'slow_down', 'Muitos pedidos seguidos. Espere um minuto.');
  }
  await next();
});

// Tamanho máximo do corpo, lido em fluxo (vale também sem content-length): quase tudo é JSON pequeno. As rotas
// com arquivo grande (mensagem, rascunho, troca de corpo, importação da migração) têm o teto delas depois do
// login (mail.ts, admin.ts): um corpo mandado em pedaços não é lido para a memória por quem nem se identificou.
// Aqui ficam o teto pequeno e o da foto de perfil.
const BODY_MAX: [RegExp, number][] = [[/^\/api\/profile\/avatar$/, 320 * 1024]];
// Estas têm o teto no próprio roteador: depois do login, da chave do admin ou, na entrega anônima, do freio por rede.
const AFTER_LOGIN = /^\/api\/(drafts|storage\/replace|send|deliver|admin\/import\/(blob|box))$/;
app.use('*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || AFTER_LOGIN.test(c.req.path)) return next();
  return bodyCap(BODY_MAX.find(([re]) => re.test(c.req.path))?.[1] ?? 256 * 1024)(c, next);
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
  // JSON ou base64 quebrado é erro de quem pediu, não nosso: 400, e no log só a rota (sem o corpo).
  if (err instanceof SyntaxError || (err as Error)?.name === 'InvalidCharacterError') {
    console.warn('pedido inválido', c.req.method, c.req.path);
    return fail(c, 400, 'bad_request', 'Pedido inválido.');
  }
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
