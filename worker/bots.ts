// Proteção contra robôs: Turnstile (Cloudflare, grátis) no cadastro e no login depois de algumas
// falhas, mais campo isca no formulário. No dev, as chaves de teste do Turnstile passam sempre.
import type { Env } from './env';

export async function turnstileOk(env: Env, token: unknown, ip: string): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).catch(() => null);
  if (!res?.ok) return false;
  const data = await res.json<{ success: boolean; hostname?: string }>();
  if (data.success !== true) return false;
  // Em produção o desafio tem que ter sido resolvido no nosso domínio (as chaves de teste do dev não dizem qual).
  return !env.APP_ORIGIN.startsWith('https://') || data.hostname === new URL(env.APP_ORIGIN).hostname;
}

// Campo escondido que gente nunca preenche. Robô de formulário preenche tudo.
export const honeypotFilled = (value: unknown) => typeof value === 'string' && value.trim() !== '';
