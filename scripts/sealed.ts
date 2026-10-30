// Ajudante dos scripts (teste e dados de demonstração): envia uma mensagem Shalom para Shalom com
// remetente lacrado, igual ao app faz (certificado, ingresso cego, entrega sem cookie).
import PostalMime from 'postal-mime';
import { b64ToBig, bigToB64, blind, modLen, newToken, publicFromWire, unblind } from '../shared/blind';
import { headOf } from '../shared/head';
import { fromB64, publicKeyOf, toB64 } from '../shared/seal';
import { bodyHash, pack } from '../shared/pack';
import { sealFromSender, type SignedCert } from '../shared/sender';

type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; data: any }>;

export async function getToken(base: string, call: Call) {
  const cfg = await (await fetch(`${base}/api/auth/config`)).json() as { tokenKey: { n: string; e: string } };
  const pub = publicFromWire(cfg.tokenKey);
  const token = newToken();
  const { blinded, r } = await blind(pub, token);
  const res = await call('POST', '/api/tokens', { blinded: [bigToB64(blinded, modLen(pub.n))] });
  if (res.status !== 200) throw new Error(`tokens: ${JSON.stringify(res.data)}`);
  return { token, sig: bigToB64(unblind(pub, b64ToBig(res.data.signed[0]), r), modLen(pub.n)) };
}

export async function sealFor(recipientPub: Uint8Array, senderSecret: Uint8Array, cert: SignedCert, mime: Uint8Array) {
  const packed = await pack(mime);
  const head = { ...headOf(await PostalMime.parse(mime), true, new Date()), b: await bodyHash(packed) };
  return {
    head: toB64(await sealFromSender(recipientPub, senderSecret, cert, new TextEncoder().encode(JSON.stringify(head)), 'head')),
    raw: toB64(await sealFromSender(recipientPub, senderSecret, cert, packed, 'raw')),
  };
}

export async function deliverAnon(base: string, body: unknown) {
  const res = await fetch(`${base}/api/deliver`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shalom': '1' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// Fluxo completo: entrega para o destinatário Shalom e guarda a cópia em Enviados.
export async function sendSealed(base: string, call: Call, senderSecret: Uint8Array, to: { address: string; publicKey: Uint8Array }, mimeForThem: Uint8Array, mimeForMe: Uint8Array) {
  const cert = (await call('POST', '/api/cert', {})).data.cert as SignedCert;
  const t = await getToken(base, call);
  const d = await deliverAnon(base, { to: to.address, ...(await sealFor(to.publicKey, senderSecret, cert, mimeForThem)), token: toB64(t.token), sig: t.sig });
  if (d.status !== 200) throw new Error(`deliver: ${JSON.stringify(d.data)}`);
  const s = await call('POST', '/api/send', { sentCopy: await sealFor(publicKeyOf(senderSecret), senderSecret, cert, mimeForMe) });
  if (s.status !== 200) throw new Error(`send: ${JSON.stringify(s.data)}`);
  return { cert, token: t };
}

export { fromB64 };
