// Chaves da conta, no aparelho.
//
// A chave privada é aleatória (256 bits, mais forte que 12 palavras) e nunca sai do aparelho aberta.
// Ela viaja e fica guardada dentro de um envelope trancado pela senha: Argon2id (128 MB, 3 passadas)
// gera a base, e dela saem a authKey (prova de senha para o servidor) e a wrapKey (abre o envelope).
import { argon2id } from 'hash-wasm';
import { fromB64, newKeyPair, toB64 } from '../../../shared/seal';
import { t } from '../i18n';

export type Kdf = { alg: 'argon2id'; m: number; t: number; p: number };
export const KDF: Kdf = { alg: 'argon2id', m: 131072, t: 3, p: 1 };

// Os parâmetros vêm do servidor no login. Um servidor adulterado poderia mandar parâmetros fracos
// para a authKey que volta virar um verificador barato de senha: o aparelho recusa antes de rodar.
export function checkKdf(k: Kdf, salt: Uint8Array) {
  const ok = k && k.alg === 'argon2id' && Number.isInteger(k.m) && k.m >= 65536 && k.m <= 1048576
    && Number.isInteger(k.t) && k.t >= 3 && k.t <= 20 && Number.isInteger(k.p) && k.p >= 1 && k.p <= 8 && salt.length === 16;
  if (!ok) throw new Error(t('err.bad_kdf'));
}

const enc = new TextEncoder();
const ENVELOPE_AAD = enc.encode('shalom/envelope/v1');
const NO_SALT = new Uint8Array(0);

export async function passwordKeys(password: string, salt: Uint8Array, kdf: Kdf) {
  checkKdf(kdf, salt);
  const master = await argon2id({
    password: password.normalize('NFKC'),
    salt,
    parallelism: kdf.p,
    iterations: kdf.t,
    memorySize: kdf.m,
    hashLength: 32,
    outputType: 'binary',
  });
  const base = await crypto.subtle.importKey('raw', new Uint8Array(master), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const authKey = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: NO_SALT, info: enc.encode('shalom/auth/v1') }, base, 256));
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: NO_SALT, info: enc.encode('shalom/wrap/v1') }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { authKey, wrapKey };
}

export async function sealEnvelope(secretKey: Uint8Array, wrapKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ENVELOPE_AAD }, wrapKey, new Uint8Array(secretKey)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return toB64(out);
}

export async function openEnvelope(envelope: string, wrapKey: CryptoKey): Promise<Uint8Array> {
  const b = fromB64(envelope);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12), additionalData: ENVELOPE_AAD }, wrapKey, b.subarray(12)));
}

export async function newAccountKeys(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { authKey, wrapKey } = await passwordKeys(password, salt, KDF);
  const { secretKey, publicKey } = newKeyPair();
  return {
    secretKey,
    payload: {
      salt: toB64(salt),
      kdf: KDF,
      authKey: toB64(authKey),
      publicKey: toB64(publicKey),
      envelope: await sealEnvelope(secretKey, wrapKey),
    },
  };
}
