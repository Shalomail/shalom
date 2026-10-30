// Remetente lacrado (como o "sealed sender" do Signal).
//
// O servidor emite para cada conta um certificado curto, assinado com a chave dele (Ed25519): "este
// endereço tem esta chave pública, até tal data". Quem envia coloca o certificado dentro de um lacre
// anônimo e tranca a mensagem com o lacre autenticado (seal.ts, versão 2). Assim:
// - o servidor guarda e entrega a mensagem sem saber de quem ela é;
// - quem recebe confere o certificado e prova, pelo DH com a chave do certificado, que a mensagem foi
//   trancada por quem tem a chave privada certificada. Ter o certificado de alguém não basta para se
//   passar por ele.
// Limite: quem certifica é o servidor. Um servidor comprometido pode certificar uma chave própria para o
// endereço de alguém. Isso é pego quando a chave muda em relação à fixada no aparelho (pins.ts) e quando
// a pessoa compara a impressão digital com o contato (leitor, "Conferir identidade"); no primeiro contato
// sem essa conferência, a identidade é a palavra do servidor.
//
// Formato: 3 | tamanho do certificado lacrado (2 bytes) | certificado lacrado (anônimo) | mensagem (lacre v2)
import { ed25519 } from '@noble/curves/ed25519.js';
import { concat, fromB64, open, openAuth, seal, sealAuth, toB64, type SealPurpose } from './seal';

export const SEALED_SENDER = 3;
const enc = new TextEncoder();
const dec = new TextDecoder();

// a: endereço, k: chave pública X25519 (base64), i: emitido em, e: vale até (ms)
export type Cert = { a: string; k: string; i: number; e: number };
export type SignedCert = { c: string; s: string };

export function signCert(cert: Cert, serverSecret: Uint8Array): SignedCert {
  const bytes = enc.encode(JSON.stringify(cert));
  return { c: toB64(bytes), s: toB64(ed25519.sign(bytes, serverSecret)) };
}

export function verifyCert(signed: SignedCert, serverPub: Uint8Array): Cert {
  const bytes = fromB64(signed.c);
  if (!ed25519.verify(fromB64(signed.s), bytes, serverPub)) throw new Error('certificado do remetente com assinatura inválida');
  const cert = JSON.parse(dec.decode(bytes)) as Cert;
  if (typeof cert.a !== 'string' || typeof cert.k !== 'string' || typeof cert.i !== 'number' || typeof cert.e !== 'number') throw new Error('certificado do remetente malformado');
  return cert;
}

export const serverCertPublicKey = (serverSecret: Uint8Array) => ed25519.getPublicKey(serverSecret);

export async function sealFromSender(recipientPub: Uint8Array, senderSecret: Uint8Array, cert: SignedCert, payload: Uint8Array, purpose: Exclude<SealPurpose, 'cert'>) {
  const outer = await seal(recipientPub, enc.encode(JSON.stringify(cert)), 'cert');
  const inner = await sealAuth(recipientPub, senderSecret, payload, purpose);
  return concat(new Uint8Array([SEALED_SENDER, outer.length >> 8, outer.length & 0xff]), outer, inner);
}

export const isSealedSender = (blob: Uint8Array) => blob[0] === SEALED_SENDER;

// Abre e confere: assinatura do servidor no certificado, validade na hora em que a mensagem chegou,
// e o lacre autenticado com a chave do certificado.
export async function openFromSender(recipientSecret: Uint8Array, blob: Uint8Array, purpose: Exclude<SealPurpose, 'cert'>, serverPub: Uint8Array, receivedAt: number) {
  if (blob.length < 4 || blob[0] !== SEALED_SENDER) throw new Error('não é uma mensagem com remetente lacrado');
  const len = (blob[1] << 8) | blob[2];
  const outer = blob.subarray(3, 3 + len);
  const inner = blob.subarray(3 + len);
  const signed = JSON.parse(dec.decode(await open(recipientSecret, outer, 'cert'))) as SignedCert;
  const cert = verifyCert(signed, serverPub);
  if (receivedAt > cert.e + 5 * 60 * 1000 || receivedAt < cert.i - 5 * 60 * 1000) throw new Error('certificado do remetente fora da validade');
  const payload = await openAuth(recipientSecret, fromB64(cert.k), inner, purpose);
  return { payload, sender: { address: cert.a.toLowerCase(), publicKey: cert.k } };
}
