// Ingressos de entrega com assinatura cega (RSA com hash de domínio completo, como na assinatura cega
// de Chaum). A conta pede ingressos já "embaralhados"; o servidor assina sem ver o ingresso; na hora da
// entrega anônima o servidor confere a assinatura e que o ingresso não foi usado, mas não tem como
// ligar o ingresso a quem pediu. Serve para limitar entregas sem identificar o remetente.
//
// O ingresso leva a semana em que vale (só a atual e a anterior são aceitas), para a lista de
// ingressos gastos poder ser limpa.

export type RsaPublic = { n: bigint; e: bigint };
export type RsaPrivate = RsaPublic & { d: bigint; p: bigint; q: bigint; dp: bigint; dq: bigint; qi: bigint };

const b64urlToBytes = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};
const bytesToB64url = (u: Uint8Array) => {
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const bytesToBig = (u: Uint8Array) => u.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
export function bigToBytes(n: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}
export const bigToB64 = (n: bigint, len: number) => bytesToB64url(bigToBytes(n, len));
export const b64ToBig = (s: string) => bytesToBig(b64urlToBytes(s));
export const modLen = (n: bigint) => Math.ceil(n.toString(16).length / 2);

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

function modInv(a: bigint, m: bigint): bigint {
  let [oldR, r] = [a % m, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error('sem inverso');
  return ((oldS % m) + m) % m;
}

// Hash de domínio completo: SHA-256 em contador até cobrir o módulo com folga, reduzido mod n.
async function fdh(msg: Uint8Array, n: bigint): Promise<bigint> {
  const need = modLen(n) + 32;
  const parts: Uint8Array[] = [];
  for (let i = 0, got = 0; got < need; i++) {
    const block = new Uint8Array(msg.length + 4);
    block.set(msg);
    new DataView(block.buffer).setUint32(msg.length, i);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', block));
    parts.push(h);
    got += h.length;
  }
  const all = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return bytesToBig(all) % n;
}

export const currentWeek = (t = Date.now()) => Math.floor(t / (7 * 24 * 3600 * 1000));

// Ingresso: 4 bytes da semana + 32 aleatórios.
export function newToken(week = currentWeek()): Uint8Array {
  const t = new Uint8Array(36);
  new DataView(t.buffer).setUint32(0, week);
  t.set(crypto.getRandomValues(new Uint8Array(32)), 4);
  return t;
}
export const tokenWeek = (t: Uint8Array) => new DataView(t.buffer, t.byteOffset).getUint32(0);

export async function blind(pub: RsaPublic, token: Uint8Array): Promise<{ blinded: bigint; r: bigint }> {
  const len = modLen(pub.n);
  for (;;) {
    const r = bytesToBig(crypto.getRandomValues(new Uint8Array(len))) % pub.n;
    if (r < 2n) continue;
    try {
      modInv(r, pub.n);
    } catch { continue; }
    return { blinded: ((await fdh(token, pub.n)) * modPow(r, pub.e, pub.n)) % pub.n, r };
  }
}

export function unblind(pub: RsaPublic, signedBlinded: bigint, r: bigint): bigint {
  return (signedBlinded * modInv(r, pub.n)) % pub.n;
}

export async function verifyToken(pub: RsaPublic, token: Uint8Array, sig: bigint): Promise<boolean> {
  return sig > 0n && sig < pub.n && modPow(sig, pub.e, pub.n) === (await fdh(token, pub.n));
}

// Assinatura no servidor, com CRT (quatro vezes mais rápido que direto).
export function signBlinded(k: RsaPrivate, blinded: bigint): bigint {
  if (blinded <= 0n || blinded >= k.n) throw new Error('valor fora do módulo');
  const m1 = modPow(blinded % k.p, k.dp, k.p);
  const m2 = modPow(blinded % k.q, k.dq, k.q);
  const h = (k.qi * ((m1 - m2 + k.p) % k.p)) % k.p;
  return m2 + h * k.q;
}

export function privateFromJwk(j: JsonWebKey): RsaPrivate {
  const f = (s: string | undefined) => b64ToBig(s || '');
  return { n: f(j.n), e: f(j.e), d: f(j.d), p: f(j.p), q: f(j.q), dp: f(j.dp), dq: f(j.dq), qi: f(j.qi) };
}

export const publicToWire = (k: RsaPublic) => ({ n: bigToB64(k.n, modLen(k.n)), e: bigToB64(k.e, 3) });
export const publicFromWire = (w: { n: string; e: string }): RsaPublic => ({ n: b64ToBig(w.n), e: b64ToBig(w.e) });
