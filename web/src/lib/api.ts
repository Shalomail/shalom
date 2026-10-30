import { apiMessage } from '../i18n/errors';
import { t } from '../i18n';

// Vaga da conta aberta nesta aba. Cada conta do navegador tem a sua (e o seu cookie de sessão no servidor).
const SLOT_KEY = 'shalom-slot';
let slot = (() => {
  try {
    const n = Number(localStorage.getItem(SLOT_KEY));
    return Number.isInteger(n) && n >= 0 && n < 5 ? n : 0;
  } catch { return 0; }
})();
export const currentSlot = () => slot;
export function setSlot(n: number) {
  slot = n;
  try { localStorage.setItem(SLOT_KEY, String(n)); } catch { /* sem armazenamento: vale só nesta aba */ }
}
export const authHeaders = () => ({ 'x-shalom': '1', 'x-shalom-slot': String(slot) });

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; anonymous?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method || (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', ...(init.anonymous ? { 'x-shalom': '1' } : authHeaders()) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // Pedidos anônimos (entrega com remetente lacrado, chave de contato) vão sem cookie.
      credentials: init.anonymous ? 'omit' : 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'offline', t('err.offline'));
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // Conta suspensa no meio do uso: sai como numa sessão vencida, e a tela de entrar mostra o porquê.
    if (res.status === 403 && data.error === 'suspended') {
      try { sessionStorage.setItem('shalom-notice', apiMessage(data.error, data.message)); } catch { /* sem armazenamento */ }
    }
    if ((res.status === 401 && data.error === 'no_session') || (res.status === 403 && data.error === 'suspended')) window.dispatchEvent(new Event('shalom:signed-out'));
    throw new ApiError(res.status, data.error || 'http', apiMessage(data.error, data.message));
  }
  return res.json() as Promise<T>;
}

export async function apiBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', headers: authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error || 'http', data.error ? apiMessage(data.error, data.message) : t('common.openFail'));
  }
  return new Uint8Array(await res.arrayBuffer());
}
