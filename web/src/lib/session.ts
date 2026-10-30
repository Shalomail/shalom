// Sessão no aparelho: quem está logado e a chave privada, que só vive em memória e no cofre do navegador.
// O navegador pode ter várias contas abertas, cada uma numa vaga (accounts.ts); esta aba usa uma por vez.
import { fromB64, publicKeyOf, toB64 } from '../../../shared/seal';
import { accounts, currentAccount, dropAccount, freeSlot, keepAccount, type Account } from './accounts';
import { api, ApiError, currentSlot, setSlot } from './api';
import { t, locale } from '../i18n';
import { forgetKey, recallKey, rememberKey } from './device';
import { newAccountKeys, openEnvelope, passwordKeys, type Kdf } from './keys';

export type User = { id: string; address: string; name: string; publicKey: string };
export type Session = { user: User; secretKey: Uint8Array };
// Senha certa numa conta com PIN e/ou duas etapas: falta a segunda etapa. A wrapKey espera aqui, em
// memória, para abrir o envelope quando o servidor liberar.
export type SecondStep = { ticket: string; need: { pin: boolean; totp: boolean }; wrapKey: CryptoKey; remember: boolean };

export const DOMAIN = 'shalomail.com';

export class KeyMismatch extends Error {
  constructor() {
    super(t('err.key_mismatch'));
  }
}

// A chave pública que o servidor diz ser minha tem que sair da minha chave privada. Se não sair,
// alguém trocou a chave no banco para ler o que chega e o que eu envio: não abre a caixa.
function checkOwnKey(user: User, secretKey: Uint8Array) {
  if (toB64(publicKeyOf(secretKey)) !== user.publicKey) throw new KeyMismatch();
}

export async function restore(): Promise<Session | null> {
  let user: User;
  try {
    user = (await api<{ user: User }>('/auth/me')).user;
  } catch (e) {
    // Sessão encerrada no servidor (saiu em outro aparelho, inatividade, desconectaram este): a chave local vai junto.
    if (e instanceof ApiError && e.status === 401) await dropCurrent();
    return null;
  }
  const secretKey = await recallKey(user.id);
  if (!secretKey) {
    // Sessão no servidor, mas sem a chave neste aparelho: pede a senha de novo.
    await api('/auth/logout', { body: {} }).catch(() => {});
    dropAccount(currentSlot());
    return null;
  }
  checkOwnKey(user, secretKey);
  keepAccount(currentSlot(), user);
  return { user, secretKey };
}

async function finish(res: { user: User; envelope: string }, wrapKey: CryptoKey, remember: boolean): Promise<Session> {
  const secretKey = await openEnvelope(res.envelope, wrapKey);
  checkOwnKey(res.user, secretKey);
  if (remember) await rememberKey(res.user.id, secretKey);
  else await forgetKey(res.user.id);
  keepAccount(currentSlot(), res.user);
  return { user: res.user, secretKey };
}

export async function signIn(address: string, password: string, remember: boolean, turnstile?: string): Promise<Session | SecondStep> {
  const { salt, kdf } = await api<{ salt: string; kdf: Kdf }>('/auth/salt', { body: { address } });
  const { authKey, wrapKey } = await passwordKeys(password, fromB64(salt), kdf);
  const res = await api<{ user: User; envelope: string } | { ticket: string; second: SecondStep['need'] }>('/auth/login', { body: { address, authKey: toB64(authKey), turnstile } });
  if ('ticket' in res) return { ticket: res.ticket, need: res.second, wrapKey, remember };
  return finish(res, wrapKey, remember);
}

export async function signInSecond(step: SecondStep, answers: { pin?: string; code?: string; recovery?: string }): Promise<Session> {
  const res = await api<{ user: User; envelope: string }>('/auth/login/second', { body: { ticket: step.ticket, ...answers } });
  return finish(res, step.wrapKey, step.remember);
}

export async function signUp(address: string, name: string, password: string, turnstile: string, website: string, invite?: string): Promise<Session> {
  const { secretKey, payload } = await newAccountKeys(password);
  // O idioma do app vai junto: a conta, a boas-vindas e os e-mails do sistema saem nele.
  const { user } = await api<{ user: User }>('/auth/signup', { body: { address, name, turnstile, website, invite, lang: locale(), ...payload } });
  checkOwnKey(user, secretKey);
  await rememberKey(user.id, secretKey);
  keepAccount(currentSlot(), user);
  return { user, secretKey };
}

// Tira a conta desta vaga do aparelho (a sessão no servidor já acabou ou vai acabar agora).
export async function dropCurrent() {
  const acc = currentAccount();
  if (acc) await forgetKey(acc.id);
  dropAccount(currentSlot());
}

// Sai da conta aberta. Com toNext e outra conta neste navegador, a aba passa para ela; sem, fica na
// mesma vaga (saída por inatividade: entrar de novo volta para cá).
export async function signOut(toNext = true): Promise<Account | null> {
  await api('/auth/logout', { body: {} }).catch(() => {});
  await dropCurrent();
  const next = toNext ? accounts()[0] ?? null : null;
  if (next) setSlot(next.slot);
  return next;
}

// Troca de conta e entrada de mais uma recarregam a página: a chave da conta anterior sai da memória.
export function switchAccount(slot: number, to = '/caixa/inbox') {
  setSlot(slot);
  location.assign(to);
}

// Abre o login numa vaga livre, lembrando de onde veio para o "Cancelar" voltar.
export function addAccount(): boolean {
  const slot = freeSlot();
  if (slot === null) return false;
  try { sessionStorage.setItem('shalom-adding', String(currentSlot())); } catch { /* sem armazenamento: sem o Cancelar */ }
  switchAccount(slot, '/entrar');
  return true;
}
