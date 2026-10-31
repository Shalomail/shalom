// Vetores de teste para o app de iOS: o código do site (shared/*, web/src/lib/keys.ts) gera lacres,
// certificados, ingressos e pacotes, e os testes do Xcode (ios/ShalomMailTests) provam que o Swift abre e
// confere tudo igual. Rodar de novo sempre que a criptografia do site mudar.
// Rodar: node scripts/run-ts.mjs scripts/ios-vectors.ts
import { writeFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bigToB64, blind, modLen, newToken, privateFromJwk, publicToWire, signBlinded, unblind } from '../shared/blind';
import { fingerprint } from '../shared/fingerprint';
import { bodyHash, pack } from '../shared/pack';
import { publicKeyOf, seal, sealAuth, toB64 } from '../shared/seal';
import { sealFromSender, signCert } from '../shared/sender';
import { threadKey } from '../shared/head';
import { passwordKeys, sealEnvelope } from '../web/src/lib/keys';

const fixed = (seed: number, n = 32) => Uint8Array.from({ length: n }, (_, i) => (seed * 31 + i * 7) & 0xff);
const enc = new TextEncoder();

const recipientSecret = fixed(1);
const senderSecret = fixed(2);
const serverEd = fixed(3);
const recipientPub = publicKeyOf(recipientSecret);
const senderPub = publicKeyOf(senderSecret);

// Senha e envelope (Argon2id de verdade, 128 MiB).
const password = 'Paz e silêncio, café às 7h';
const salt = fixed(4, 16);
const kdf = { alg: 'argon2id' as const, m: 131072, t: 3, p: 1 };
const { authKey, wrapKey } = await passwordKeys(password, salt, kdf);
const envelope = await sealEnvelope(recipientSecret, wrapKey);

// Lacres.
const text = enc.encode('Olá, Shalom! Mensagem de teste com acentuação: ção, ü, 漢字.');
const seals = await Promise.all((['head', 'raw', 'cert'] as const).map(async p => ({ purpose: p, sealed: toB64(await seal(recipientPub, text, p)) })));
const authSeal = toB64(await sealAuth(recipientPub, senderSecret, text, 'raw'));

// Remetente lacrado: certificado assinado pelo "servidor".
const now = Date.UTC(2026, 9, 30, 12, 0, 0);
const cert = signCert({ a: 'Ana@shalomail.com', k: toB64(senderPub), i: now - 3600_000, e: now + 7 * 24 * 3600_000 }, serverEd);
const sealedSender = toB64(await sealFromSender(recipientPub, senderSecret, cert, text, 'head'));

// Pacote (gzip com moldura) e impressão do corpo.
const mime = enc.encode(`From: Ana <ana@shalomail.com>\r\nSubject: Teste\r\n\r\n${'Linha de texto que comprime bem. '.repeat(40)}`);
const packed = await pack(mime);

// Ingresso de entrega: chave RSA nova, assinatura cega completa pelo código do site.
const rsa = await crypto.subtle.generateKey({ name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const priv = privateFromJwk(await crypto.subtle.exportKey('jwk', rsa.privateKey));
const token = newToken(2900);
const b = await blind(priv, token);
const sig = unblind(priv, signBlinded(priv, b.blinded), b.r);

const vectors = {
  recipientSecret: toB64(recipientSecret), recipientPub: toB64(recipientPub), senderPub: toB64(senderPub),
  serverPub: toB64(ed25519.getPublicKey(serverEd)),
  password, salt: toB64(salt), kdf, authKey: toB64(authKey), envelope,
  text: toB64(text), seals, authSeal,
  sealedSender, sealedSenderReceivedAt: now, sealedSenderAddress: 'ana@shalomail.com',
  mime: toB64(mime), packed: toB64(packed), bodyHash: await bodyHash(packed),
  fingerprint: { address: 'Ana@shalomail.com', publicKey: toB64(senderPub), value: await fingerprint('Ana@shalomail.com', senderPub) },
  blind: { pub: publicToWire(priv), token: toB64(token), signature: bigToB64(sig, modLen(priv.n)) },
  threads: [
    { references: '<a1@shalomail.com> <b2@x.com>', inReplyTo: '<b2@x.com>', messageId: '<c3@shalomail.com>' },
    { references: '', inReplyTo: '<RE-1@Gmail.com>', messageId: '<z@x>' },
    { references: '', inReplyTo: '', messageId: '<ação-çõ@shalomail.com>' },
    { references: 'sem-colchetes@x.com outra@y', inReplyTo: '', messageId: '' },
  ].map(e => ({ ...e, key: threadKey(e) })),
};
writeFileSync('ios/ShalomMailTests/Fixtures/vectors.json', JSON.stringify(vectors, null, 2) + '\n');
console.log('vetores gravados em ios/ShalomMailTests/Fixtures/vectors.json');
