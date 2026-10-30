// Verificação em duas etapas por aplicativo autenticador (RFC 6238: SHA-1, 6 dígitos, passos de 30 s).
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export const newTotpSecret = () => base32(crypto.getRandomValues(new Uint8Array(20)));

export const totpUri = (secret: string, address: string) =>
  `otpauth://totp/${encodeURIComponent(`Shalom Mail:${address}`)}?secret=${secret}&issuer=${encodeURIComponent('Shalom Mail')}&algorithm=SHA1&digits=6&period=30`;

// Aceita o passo atual e um para cada lado (relógio do celular um pouco fora). Devolve o passo usado,
// ou null. Passo igual ou anterior ao último aceito não vale: o mesmo código não entra duas vezes.
export async function checkTotp(secret: string, code: string, lastStep: number): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const key = unbase32(secret);
  const step = Math.floor(Date.now() / 30000);
  for (const s of [step, step - 1, step + 1]) {
    if (s <= lastStep) continue;
    if ((await hotp(key, s)) === code) return s;
  }
  return null;
}
