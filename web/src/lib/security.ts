// Segurança da conta: sair por inatividade, PIN de entrada e verificação em duas etapas.
// Ligar ou desligar PIN e duas etapas pede a senha de novo (a prova sai do Argon2id, como no login).
import { fromB64, toB64 } from '../../../shared/seal';
import { api } from './api';
import { durationLabel } from './format';
import { passwordKeys, type Kdf } from './keys';
import type { User } from './session';

export type Security = { idle: number; pin: boolean; totp: boolean; recoveryLeft: number };

// Em minutos, com o texto de cada um no idioma do app (durationLabel, em format.ts).
export const IDLE_MINUTES = [5, 10, 30, 60, 300, 720, 1440, 10080, 43200];
export const idleChoices = (): [number, string][] => IDLE_MINUTES.map(m => [m, durationLabel(m)]);

export async function proof(user: User, password: string) {
  const { salt, kdf } = await api<{ salt: string; kdf: Kdf }>('/auth/salt', { body: { address: user.address } });
  return toB64((await passwordKeys(password, fromB64(salt), kdf)).authKey);
}

export const getSecurity = () => api<Security>('/profile/security');
export const setIdle = (minutes: number) => api<{ idle: number }>('/profile/idle', { body: { minutes } });
export const setPin = async (user: User, password: string, pin: string) => api('/profile/pin', { body: { authKey: await proof(user, password), pin } });
export const removePin = async (user: User, password: string) => api('/profile/pin/delete', { body: { authKey: await proof(user, password) } });
export const startTotp = async (user: User, password: string) => api<{ secret: string; uri: string }>('/profile/totp/start', { body: { authKey: await proof(user, password) } });
export const enableTotp = (code: string) => api<{ codes: string[] }>('/profile/totp/enable', { body: { code } });
export const disableTotp = async (user: User, password: string) => api('/profile/totp/disable', { body: { authKey: await proof(user, password) } });
export const newRecoveryCodes = async (user: User, password: string) => api<{ codes: string[] }>('/profile/totp/recovery', { body: { authKey: await proof(user, password) } });

// QR do otpauth:// desenhado aqui no aparelho; o segredo não passa por nenhum serviço de terceiros.
export async function qrSvg(text: string): Promise<string> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// Apagar a conta de vez: a senha de novo e o endereço digitado (worker/account.ts diz o que sai).
export const deleteAccount = async (user: User, password: string, confirm: string) =>
  api('/profile/delete', { body: { authKey: await proof(user, password), confirm } });
