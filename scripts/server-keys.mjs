// Gera as chaves do servidor para o remetente lacrado e imprime no formato do .dev.vars.
// Produção: wrangler secret put CERT_KEY e TOKEN_KEY com estes valores (gerados à parte, nunca os do dev).
import { webcrypto as crypto } from 'node:crypto';

const cert = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const { privateKey } = await crypto.subtle.generateKey(
  { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
const token = JSON.stringify({ kty: jwk.kty, n: jwk.n, e: jwk.e, d: jwk.d, p: jwk.p, q: jwk.q, dp: jwk.dp, dq: jwk.dq, qi: jwk.qi });
console.log(`CERT_KEY=${cert}`);
console.log(`TOKEN_KEY='${token}'`);
