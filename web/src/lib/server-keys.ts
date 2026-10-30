// Chaves públicas do servidor para o remetente lacrado: a que assina certificados e a dos ingressos.
// O app fixa as duas na primeira vez. Se o servidor um dia mandar outras, algo está errado: o app
// para de confiar em vez de aceitar em silêncio.
import { publicFromWire, type RsaPublic } from '../../../shared/blind';
import { fromB64 } from '../../../shared/seal';
import { api } from './api';
import { t } from '../i18n';

type Wire = { certKey: string; tokenKey: { n: string; e: string } };
const PIN = 'shalom-server-keys';

let loaded: Promise<{ cert: Uint8Array; token: RsaPublic }> | null = null;

export class ServerKeysChanged extends Error {
  constructor() { super(t('err.server_keys')); }
}

export function serverKeys() {
  loaded ??= (async () => {
    const w = await api<Wire>('/auth/config');
    const now = JSON.stringify({ certKey: w.certKey, tokenKey: w.tokenKey });
    const pinned = localStorage.getItem(PIN);
    if (pinned && pinned !== now) { loaded = null; throw new ServerKeysChanged(); }
    if (!pinned) localStorage.setItem(PIN, now);
    return { cert: fromB64(w.certKey), token: publicFromWire(w.tokenKey) };
  })();
  return loaded;
}
