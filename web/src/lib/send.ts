// Envio. Para cada conta Shalom o e-mail sai lacrado aqui, com a chave pública dela.
// Para quem está fora, o texto precisa ir aberto até o servidor de envio (é como o e-mail comum funciona).
import PostalMime from 'postal-mime';
import { headOf, type Person } from '../../../shared/head';
import { fingerprint } from '../../../shared/fingerprint';
import { publicKeyOf as ownPublicKey } from '../../../shared/seal';
import { bigToB64, b64ToBig, blind, modLen, newToken, unblind, verifyToken } from '../../../shared/blind';
import { fromB64, toB64 } from '../../../shared/seal';
import { bodyHash, pack } from '../../../shared/pack';
import { sealFromSender, type SignedCert } from '../../../shared/sender';
import { t } from '../i18n';
import { api } from './api';
import { buildMime, newMessageId, richToHtml, textToHtml, type Attachment, type Draft } from './mime';
import { checkPin, pinKey } from './pins';
import { serverKeys } from './server-keys';
import { DOMAIN, type Session } from './session';

export const isShalom = (address: string) => address.toLowerCase().endsWith(`@${DOMAIN}`);

const keyCache = new Map<string, string | null>();

// Chave pública de outra conta Shalom, como o servidor informa (ainda sem conferir o pin).
export async function publicKeyOf(address: string): Promise<string | null> {
  const a = address.toLowerCase();
  if (!isShalom(a)) return null;
  // Sem cookie: o servidor não fica sabendo quem procurou a chave de quem.
  if (!keyCache.has(a)) keyCache.set(a, (await api<{ publicKey: string | null }>('/keys', { body: { address: a }, anonymous: true })).publicKey);
  return keyCache.get(a) ?? null;
}

// A chave de um contato mudou desde a primeira vez. Nesse desenho a chave de uma conta nunca muda,
// então isso é sinal de troca no servidor: o envio para até a pessoa conferir as impressões digitais.
export class KeyChanged extends Error {
  constructor(public address: string, public before: string, public after: string, public newKey: string) {
    super(t('err.key_changed', { address }));
  }
}

export { fingerprint, pinKey };

export type Outgoing = {
  to: Person[]; cc: Person[]; bcc: Person[];
  subject: string; text: string;
  quoted?: { header: string; html: string };
  inReplyTo?: string; references?: string;
  // Do editor: HTML com formatação (sem ele, o texto puro vira HTML) e anexos já comprimidos.
  html?: string;
  attachments?: Attachment[];
};

// Certificado de remetente (vale 7 dias; renova com um dia de folga).
let certCache: { signed: SignedCert; until: number } | null = null;
async function myCert(): Promise<SignedCert> {
  if (certCache && certCache.until > Date.now() + 24 * 3600 * 1000) return certCache.signed;
  const { cert } = await api<{ cert: SignedCert }>('/cert', { body: {} });
  const until = JSON.parse(new TextDecoder().decode(fromB64(cert.c))).e as number;
  certCache = { signed: cert, until };
  return cert;
}

// Ingressos de entrega: pedidos embaralhados com a conta logada, usados depois sem identificação.
const tokens: { token: Uint8Array; sig: string }[] = [];
async function takeToken() {
  if (!tokens.length) {
    const { token: pub } = await serverKeys();
    const batch = await Promise.all(Array.from({ length: 5 }, async () => {
      const token = newToken();
      return { token, ...(await blind(pub, token)) };
    }));
    const len = modLen(pub.n);
    const { signed } = await api<{ signed: string[] }>('/tokens', { body: { blinded: batch.map(b => bigToB64(b.blinded, len)) } });
    for (let i = 0; i < batch.length; i++) {
      const sig = unblind(pub, b64ToBig(signed[i]), batch[i].r);
      if (await verifyToken(pub, batch[i].token, sig)) tokens.push({ token: batch[i].token, sig: bigToB64(sig, len) });
    }
    if (!tokens.length) throw new Error(t('err.bad_tokens'));
  }
  return tokens.shift()!;
}

async function sealedCopy(mime: Uint8Array, pub: Uint8Array, secretKey: Uint8Array, cert: SignedCert) {
  const packed = await pack(mime);
  // O cabeçalho leva a impressão do corpo: quem abre confere que os dois são da mesma mensagem.
  const head = { ...headOf(await PostalMime.parse(mime), true, new Date()), b: await bodyHash(packed) };
  return {
    head: toB64(await sealFromSender(pub, secretKey, cert, new TextEncoder().encode(JSON.stringify(head)), 'head')),
    raw: toB64(await sealFromSender(pub, secretKey, cert, packed, 'raw')),
  };
}

export async function sendMessage({ user, secretKey }: Session, out: Outgoing) {
  const all = [...out.to, ...out.cc, ...out.bcc];
  const html = out.html ? richToHtml(out.html, out.quoted) : textToHtml(out.text, out.quoted);
  const text = out.quoted ? `${out.text}\n\n${out.quoted.header}\n` : out.text;
  const draft: Draft = {
    from: { name: user.name, address: user.address },
    to: out.to, cc: out.cc, bcc: out.bcc,
    subject: out.subject, text, html,
    messageId: newMessageId(DOMAIN), inReplyTo: out.inReplyTo, references: out.references, date: new Date(),
    attachments: out.attachments,
  };
  const forThem = buildMime(draft, false);
  const forMe = buildMime(draft, true);

  const internal = [...new Set(all.map(p => p.address.toLowerCase()).filter(isShalom))];
  const cert = await myCert();
  const sealedFor: { address: string; head: string; raw: string }[] = [];
  for (const address of internal) {
    const pub = await publicKeyOf(address);
    if (!pub) throw new Error(t('err.no_such_user', { address }));
    const pinned = await checkPin(user.id, address, pub);
    if (pinned !== pub) {
      throw new KeyChanged(address, await fingerprint(address, fromB64(pinned)), await fingerprint(address, fromB64(pub)), pub);
    }
    sealedFor.push({ address, ...(await sealedCopy(forThem, fromB64(pub), secretKey, cert)) });
  }

  // Primeiro o que pode falhar com mais frequência: os destinatários de fora (com o texto, porque o
  // e-mail comum não vai trancado) e a cópia de Enviados. Se isso falha, ninguém recebeu nada e tentar
  // de novo não duplica. O Message-ID vai junto para a resposta de fora achar esta conversa.
  const outside = (l: Person[]) => l.filter(p => !isShalom(p.address));
  const hasExternal = all.some(p => !isShalom(p.address));
  const sent = await api<{ ok: true; id: string; external: number }>('/send', {
    body: {
      ...(hasExternal ? {
        to: outside(out.to), cc: outside(out.cc), bcc: outside(out.bcc),
        subject: out.subject, text, html, inReplyTo: out.inReplyTo, references: out.references, messageId: draft.messageId,
        attachments: (out.attachments ?? []).map(a => ({ filename: a.filename, type: a.type, content: toB64(a.content), cid: a.cid })),
      } : {}),
      // A cópia de Enviados vai trancada com a chave calculada aqui, nunca com a que o servidor informa.
      sentCopy: await sealedCopy(forMe, ownPublicKey(secretKey), secretKey, cert),
    },
  });

  // Remetente lacrado: cada conta Shalom recebe por uma entrega sem cookie, com um ingresso que não
  // identifica quem enviou. O servidor sabe só o destino.
  for (const d of sealedFor) {
    const t = await takeToken();
    await api('/deliver', { body: { to: d.address, head: d.head, raw: d.raw, token: toB64(t.token), sig: t.sig }, anonymous: true });
  }
  return sent;
}

// Rascunho: a mensagem inteira lacrada com a própria chave (como a cópia de Enviados), no lugar da versão
// anterior (replace). O servidor guarda sem conseguir ler. A citação da resposta não entra: ao reabrir,
// o editor volta só com o que a pessoa escreveu.
export async function saveDraft({ user, secretKey }: Session, out: Outgoing, replace?: string): Promise<string> {
  const draft: Draft = {
    from: { name: user.name, address: user.address },
    to: out.to, cc: out.cc, bcc: out.bcc,
    subject: out.subject, text: out.text, html: richToHtml(out.html ?? ''),
    messageId: newMessageId(DOMAIN), inReplyTo: out.inReplyTo, references: out.references, date: new Date(),
    attachments: out.attachments,
  };
  const sealed = await sealedCopy(buildMime(draft, true), ownPublicKey(secretKey), secretKey, await myCert());
  return (await api<{ id: string }>('/drafts', { body: { ...sealed, replace } })).id;
}

export const deleteDraft = (id: string) => api('/drafts/delete', { body: { ids: [id] } }).catch(() => {});
