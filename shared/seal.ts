// Lacre de mensagem: X25519 efêmero + HKDF-SHA256 + AES-256-GCM.
// Mesmo código no Worker (tranca o e-mail que chega) e no navegador (tranca a cópia enviada,
// tranca para outra conta Shalom e abre tudo na leitura). Só a chave pública do dono entra no lacre;
// abrir exige a chave privada, que nunca sai do aparelho dele.
//
// Formato: versão (1) | chave pública efêmera (32) | nonce (12) | texto cifrado + tag (16)
import { x25519 } from '@noble/curves/ed25519.js';

const VERSION = 1;
const enc = new TextEncoder();

export type SealPurpose = 'head' | 'raw' | 'cert';

function info(purpose: SealPurpose): Uint8Array<ArrayBuffer> {
  return concat(enc.encode(`shalom/v1/${purpose}`));
}

// WebCrypto exige ArrayBuffer comum; só copia quando o buffer não é um (ex.: SharedArrayBuffer).
function plain(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return u.buffer instanceof ArrayBuffer ? u as Uint8Array<ArrayBuffer> : new Uint8Array(u);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function messageKey(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array, purpose: SealPurpose) {
  const base = await crypto.subtle.importKey('raw', concat(shared), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(ephPub, recipientPub), info: info(purpose) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function newKeyPair(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const { secretKey, publicKey } = x25519.keygen();
  return { secretKey, publicKey };
}

export function publicKeyOf(secretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secretKey);
}

export async function seal(recipientPub: Uint8Array, plaintext: Uint8Array, purpose: SealPurpose): Promise<Uint8Array> {
  const eph = x25519.keygen();
  const shared = x25519.getSharedSecret(eph.secretKey, recipientPub);
  const key = await messageKey(shared, eph.publicKey, recipientPub, purpose);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: info(purpose) }, key, plain(plaintext)));
  return concat(new Uint8Array([VERSION]), eph.publicKey, nonce, ct);
}

export async function open(secretKey: Uint8Array, sealed: Uint8Array, purpose: SealPurpose): Promise<Uint8Array> {
  if (sealed.length < 1 + 32 + 12 + 16 || sealed[0] !== VERSION) throw new Error('lacre inválido');
  const ephPub = sealed.subarray(1, 33);
  const nonce = sealed.subarray(33, 45);
  const ct = sealed.subarray(45);
  const recipientPub = x25519.getPublicKey(secretKey);
  const shared = x25519.getSharedSecret(secretKey, ephPub);
  const key = await messageKey(shared, ephPub, recipientPub, purpose);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: plain(nonce), additionalData: info(purpose) }, key, plain(ct)));
}

export async function sealJson(recipientPub: Uint8Array, value: unknown): Promise<Uint8Array> {
  return seal(recipientPub, enc.encode(JSON.stringify(value)), 'head');
}

export async function openJson<T>(secretKey: Uint8Array, sealed: Uint8Array): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await open(secretKey, sealed, 'head'))) as T;
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Lacre com remetente autenticado (versão 2): além da chave efêmera, entra o DH entre a chave fixa de
// quem envia e a de quem recebe (como o modo Auth do HPKE). Só quem tem a chave privada do remetente
// produz um lacre que abre com a chave pública dele; o servidor não consegue forjar.
const AUTH_VERSION = 2;

async function authMessageKey(dh1: Uint8Array, dh2: Uint8Array, ephPub: Uint8Array, senderPub: Uint8Array, recipientPub: Uint8Array, purpose: SealPurpose) {
  const base = await crypto.subtle.importKey('raw', concat(dh1, dh2), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(ephPub, senderPub, recipientPub), info: concat(enc.encode(`shalom/v2/${purpose}`)) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealAuth(recipientPub: Uint8Array, senderSecret: Uint8Array, plaintext: Uint8Array, purpose: SealPurpose): Promise<Uint8Array> {
  const eph = x25519.keygen();
  const senderPub = x25519.getPublicKey(senderSecret);
  const key = await authMessageKey(
    x25519.getSharedSecret(eph.secretKey, recipientPub), x25519.getSharedSecret(senderSecret, recipientPub),
    eph.publicKey, senderPub, recipientPub, purpose);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = concat(new Uint8Array([AUTH_VERSION]), enc.encode(`shalom/v2/${purpose}`));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, key, plain(plaintext)));
  return concat(new Uint8Array([AUTH_VERSION]), eph.publicKey, nonce, ct);
}

export async function openAuth(recipientSecret: Uint8Array, senderPub: Uint8Array, sealed: Uint8Array, purpose: SealPurpose): Promise<Uint8Array> {
  if (sealed.length < 1 + 32 + 12 + 16 || sealed[0] !== AUTH_VERSION) throw new Error('lacre inválido');
  const ephPub = sealed.subarray(1, 33);
  const nonce = sealed.subarray(33, 45);
  const recipientPub = x25519.getPublicKey(recipientSecret);
  const key = await authMessageKey(
    x25519.getSharedSecret(recipientSecret, ephPub), x25519.getSharedSecret(recipientSecret, senderPub),
    ephPub, senderPub, recipientPub, purpose);
  const aad = concat(new Uint8Array([AUTH_VERSION]), enc.encode(`shalom/v2/${purpose}`));
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: plain(nonce), additionalData: aad }, key, plain(sealed.subarray(45))));
}

export { concat };
