// E-mail de recuperação e senha nova pelo link. Recuperar devolve a conta com chave nova: os e-mails
// guardados até ali não voltam, porque estavam trancados pela senha antiga.
import { currentSlot, api, setSlot } from './api';
import { accounts, currentAccount, freeSlot, keepAccount } from './accounts';
import { rememberKey } from './device';
import { newAccountKeys } from './keys';
import { proof } from './security';
import type { Session, User } from './session';

export type Recovery = { hint: string | null; verified: boolean };

// O aviso que aparece no pedido, no e-mail (worker/notify.ts) e na tela de senha nova: recovery.warning
// nos dicionários (web/src/i18n).

export const getRecovery = () => api<Recovery>('/profile/recovery');
// Trocar pede a senha; só o primeiro, logo depois de entrar, vai sem ela.
export async function setRecovery(email: string, confirm?: { user: User; password: string }) {
  const authKey = confirm ? await proof(confirm.user, confirm.password) : undefined;
  return api<Recovery & { sent: boolean }>('/profile/recovery', { body: { email, authKey } });
}
export const resendRecovery = () => api<{ verified: boolean; sent?: boolean }>('/profile/recovery/resend', { body: {} });
export const confirmRecovery = (token: string) => api<{ ok: true; hint: string | null }>('/auth/recovery/confirm', { body: { token } });
export const forgotPassword = (address: string) => api<{ ok: true }>('/auth/forgot', { body: { address } });
export const resetInfo = (token: string) => api<{ address: string; need: { pin: boolean; totp: boolean } }>('/auth/reset/info', { body: { token } });

export async function resetPassword(token: string, password: string, answers: { pin?: string; code?: string; recovery?: string }, address?: string): Promise<Session> {
  // A sessão nova entra na vaga desta conta, se ela já estiver no navegador, ou numa vaga livre: nunca
  // por cima de outra conta aberta.
  const own = address ? accounts().find(a => a.address === address) : undefined;
  if (own) setSlot(own.slot);
  else if (currentAccount()) { const s = freeSlot(); if (s !== null) setSlot(s); }
  const { secretKey, payload } = await newAccountKeys(password);
  const { user } = await api<{ user: User }>('/auth/reset', { body: { token, ...payload, ...answers } });
  await rememberKey(user.id, secretKey);
  keepAccount(currentSlot(), user);
  return { user, secretKey };
}

// Link que chegou por e-mail (?t=...). Some da barra de endereço logo depois de lido.
export function tokenFromUrl(): string {
  const t = new URLSearchParams(location.search).get('t') || '';
  if (t) history.replaceState(null, '', location.pathname);
  return t;
}
