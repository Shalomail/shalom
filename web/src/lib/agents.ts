// Chaves de API, caixas de agente e plano (worker/agents.ts e worker/billing.ts). As caixas nascem pelo
// CLI; aqui a pessoa cria a chave, vê as caixas, apaga e cuida do plano.
import { api } from './api';

export type ApiKey = { id: string; name: string; hint: string; createdAt: number; lastUsed: number | null };
export type AgentBox = { id: string; address: string; name: string; createdAt: number; paused: boolean };
export type PaidPlan = 'agents5' | 'agents12' | 'unlimited';
export type Billing = {
  // limit null: Unlimited, sem limite de caixas.
  enabled: boolean; plan: 'free' | PaidPlan; limit: number | null; used: number;
  status: string | null; periodEnd: number | null; subscribed: boolean; prices: Record<PaidPlan, number>;
};

export const listKeys = () => api<{ keys: ApiKey[] }>('/apikeys').then(r => r.keys);
export const createKey = (name: string) => api<{ key: string; id: string }>('/apikeys', { body: { name } });
export const revokeKey = (id: string) => api('/apikeys/revoke', { body: { id } });

export const listAgents = () => api<{ agents: AgentBox[] }>('/agents').then(r => r.agents);
export const deleteAgent = (id: string) => api('/agents/delete', { body: { id } });

export const billingInfo = () => api<Billing>('/billing');
export const checkout = (plan: PaidPlan) => api<{ url?: string; changed?: boolean; plan?: PaidPlan }>('/billing/checkout', { body: { plan } });
export const billingPortal = () => api<{ url: string }>('/billing/portal', { body: {} }).then(r => r.url);
export const syncCheckout = (session: string) => api('/billing/sync', { body: { session } });

// Página com todos os comandos do CLI, no idioma do app.
export const docsHref = (locale: string) => (locale === 'pt' ? '/agentes/' : `/${locale}/agents/`);

// Login do CLI pelo navegador (worker/clilogin.ts): o pedido do terminal, aprovar ou recusar.
export type CliRequest = { code: string; device: string; createdAt: number; account: string };
export const cliRequest = (code: string) => api<CliRequest>(`/cli/request?codigo=${encodeURIComponent(code)}`);
export const approveCli = (code: string) => api('/cli/approve', { body: { code } });
export const denyCli = (code: string) => api('/cli/deny', { body: { code } });
