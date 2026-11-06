// Chaves públicas do servidor para o remetente lacrado: a que assina certificados e a dos ingressos.
// O app fixa as duas na primeira vez. Se o servidor um dia mandar outras, algo está errado: o app
// para de confiar em vez de aceitar em silêncio.
import { publicFromWire, type RsaPublic } from '../../../shared/blind';
import { fromB64 } from '../../../shared/seal';
import { api } from './api';
import { t } from '../i18n';

type Wire = { certKey: string; tokenKey: { n: string; e: string } };
const PIN = 'shalom-server-keys';
// Impressão (SHA-256) das chaves do shalomail.com, a mesma embutida no CLI e no app: num navegador novo, sem
// nada fixado, uma API trocada (sem o site trocado junto) também é pega.
const BUILT_IN: Record<string, string> = { 'https://shalomail.com': 'e8088912b446162136659e1674b67e8d4cd9435c1b7a89057492365d715e9004' };
const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

let loaded: Promise<{ cert: Uint8Array; token: RsaPublic }> | null = null;

export class ServerKeysChanged extends Error {
  constructor() { super(t('err.server_keys')); }
}

export function serverKeys() {
  loaded ??= (async () => {
    const w = await api<Wire>('/auth/config');
    // Montado aqui, campo por campo: a impressão não depende da ordem em que o servidor manda os campos.
    const now = JSON.stringify({ certKey: w.certKey, tokenKey: { n: w.tokenKey.n, e: w.tokenKey.e } });
    const pinned = localStorage.getItem(PIN);
    const builtIn = BUILT_IN[location.origin];
    if ((builtIn && builtIn !== (await sha256Hex(now))) || (pinned && pinned !== now)) { loaded = null; throw new ServerKeysChanged(); }
    if (!pinned) localStorage.setItem(PIN, now);
    return { cert: fromB64(w.certKey), token: publicFromWire(w.tokenKey) };
  })();
  return loaded;
}
