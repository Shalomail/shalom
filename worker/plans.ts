// Planos das caixas de agente. Grátis: 2 caixas. Pagos pelo Stripe: até 5, até 12 e Unlimited (sem
// limite de caixas, até 250 novas por dia). Conta o que existe ao mesmo tempo; apagar uma caixa libera a
// vaga. Se o plano acaba, as caixas além do limite (as mais novas) ficam pausadas para enviar, mas
// continuam recebendo e podem ser lidas.
import type { Env } from './env';

// null: sem limite de caixas.
export const PLANS: Record<'free' | 'agents5' | 'agents12' | 'unlimited', number | null> = { free: 2, agents5: 5, agents12: 12, unlimited: null };
export type Plan = keyof typeof PLANS;
export const PAID: Exclude<Plan, 'free'>[] = ['agents5', 'agents12', 'unlimited'];
// Preço em centavos de dólar, para mostrar. O que vale na cobrança é o preço cadastrado no Stripe.
export const PRICE_USD: Record<Exclude<Plan, 'free'>, number> = { agents5: 499, agents12: 999, unlimited: 4990 };
// Caixas novas por dia. No Unlimited é o que segura abuso; nos outros, o limite do plano já segura.
export const CREATES_PER_DAY: Record<Plan, number> = { free: 20, agents5: 20, agents12: 20, unlimited: 250 };
export const lookupKey = (plan: Exclude<Plan, 'free'>) => `shalom_${plan}_monthly`;

// past_due ainda vale: o Stripe tenta cobrar de novo por alguns dias antes de cancelar.
const LIVE = new Set(['active', 'trialing', 'past_due']);

export type Billing = { plan: Plan; limit: number | null; status: string | null; periodEnd: number | null; customer: string | null; subscription: string | null };

export async function planOf(env: Env, userId: string): Promise<Billing> {
  const row = await env.DB.prepare('SELECT plan, status, period_end, customer_id, subscription_id FROM billing WHERE user_id = ?').bind(userId)
    .first<{ plan: string; status: string | null; period_end: number | null; customer_id: string | null; subscription_id: string | null }>();
  const paid = row && row.plan in PLANS && LIVE.has(row.status ?? '') ? (row.plan as Plan) : 'free';
  return { plan: paid, limit: PLANS[paid], status: row?.status ?? null, periodEnd: row?.period_end ?? null, customer: row?.customer_id ?? null, subscription: row?.subscription_id ?? null };
}

export const agentCount = async (env: Env, ownerId: string) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE owner_id = ?').bind(ownerId).first<number>('n')) ?? 0;

// A caixa está além do limite do plano do dono? Vale a ordem de criação: as primeiras ficam ativas.
export async function agentPaused(env: Env, ownerId: string, createdAt: number, id: string): Promise<boolean> {
  const { limit } = await planOf(env, ownerId);
  if (limit === null) return false;
  const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE owner_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))')
    .bind(ownerId, createdAt, createdAt, id).first<number>('n');
  return (before ?? 0) >= limit;
}
