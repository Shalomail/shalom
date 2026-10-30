// Resumo diário para o e-mail da operação (FORWARD_TO). Vai para um destino confirmado no Email Routing,
// então não gasta a cota de envio. Só números: nenhum endereço, nenhum conteúdo.
import type { Env } from './env';
import { sendCaps } from './util';

const DAY = 24 * 3600 * 1000;
const count = async (env: Env, sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).first<number>('n')) ?? 0;

export async function dailyReport(env: Env) {
  if (!env.FORWARD_TO) return;
  const since = Date.now() - DAY;
  const yesterday = new Date(since).toISOString().slice(0, 10);
  const [people, peopleNew, agents, agentsNew, sends] = await Promise.all([
    count(env, 'SELECT COUNT(*) AS n FROM users WHERE owner_id IS NULL'),
    count(env, 'SELECT COUNT(*) AS n FROM users WHERE owner_id IS NULL AND created_at > ?', since),
    count(env, 'SELECT COUNT(*) AS n FROM users WHERE owner_id IS NOT NULL'),
    count(env, 'SELECT COUNT(*) AS n FROM users WHERE owner_id IS NOT NULL AND created_at > ?', since),
    count(env, 'SELECT count AS n FROM counters WHERE key = ?', `send:all:${yesterday}`),
  ]);
  const plans = await env.DB.prepare("SELECT plan, COUNT(*) AS n FROM billing WHERE status IN ('active', 'trialing', 'past_due') GROUP BY plan").all<{ plan: string; n: number }>();
  const paid = Object.fromEntries(plans.results.map(r => [r.plan, r.n]));
  const caps = sendCaps(env);
  const pct = Math.round((sends / caps.total) * 100);
  const lines = [
    `Cadastros nas últimas 24 horas: ${peopleNew} (contas no total: ${people})`,
    `Caixas de agente novas: ${agentsNew} (no total: ${agents})`,
    `Assinaturas ativas: Agents 5 ${paid.agents5 ?? 0}, Agents 12 ${paid.agents12 ?? 0}, Unlimited ${paid.unlimited ?? 0}`,
    `Envios pelo Email Service ontem (${yesterday}): ${sends} de ${caps.total} (${pct}% do teto do Shalom; pessoas até ${caps.people})`,
    '',
    pct >= 80
      ? 'Atenção: o teto de envio está quase no fim. Peça mais cota à Cloudflare e suba SEND_CAP e SEND_CAP_PEOPLE no wrangler.jsonc.'
      : 'Tudo dentro dos limites.',
  ];
  const subject = `Shalom: ${peopleNew} cadastros, ${sends} envios (${pct}% do teto)`;
  if (env.EMAIL_SENDING !== 'on') {
    console.log(`[resumo diário] ${subject}\n${lines.join('\n')}`);
    return;
  }
  await env.EMAIL.send({ from: { email: `nao-responda@${env.MAIL_DOMAIN}`, name: 'Shalom Mail' }, to: env.FORWARD_TO, subject, text: lines.join('\n') } as unknown as EmailMessageBuilder);
}
