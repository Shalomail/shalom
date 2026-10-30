// Chaves do servidor para o remetente lacrado. As públicas vão no /api/auth/config (e o app fixa).
import { privateFromJwk, publicToWire, type RsaPrivate } from '../shared/blind';
import { fromB64, toB64 } from '../shared/seal';
import { serverCertPublicKey } from '../shared/sender';
import type { Env } from './env';

let cached: { raw: string; cert: Uint8Array; token: RsaPrivate } | null = null;

export function loadKeys(env: Env) {
  const raw = env.CERT_KEY + env.TOKEN_KEY;
  if (cached?.raw !== raw) {
    const cert = fromB64(env.CERT_KEY);
    if (cert.length !== 32) throw new Error('CERT_KEY precisa ter 32 bytes em base64');
    cached = { raw, cert, token: privateFromJwk(JSON.parse(env.TOKEN_KEY)) };
  }
  return cached;
}

export function serverKeys(env: Env) {
  const k = loadKeys(env);
  return { certKey: toB64(serverCertPublicKey(k.cert)), tokenKey: publicToWire(k.token) };
}
