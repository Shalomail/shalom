// Cliente da API do Shalom para o CLI. Faz no computador do agente o mesmo que o app faz no navegador:
// abre os e-mails com a chave privada da caixa, lacra o que envia, pede os ingressos cegos e entrega
// para outras contas Shalom sem se identificar. O servidor só vê o que já chega lacrado.
import PostalMime, { type Email } from 'postal-mime';
import { b64ToBig, bigToB64, blind, modLen, newToken, publicFromWire, unblind, verifyToken, type RsaPublic } from '../../shared/blind';
import { headOf, type MessageHead, type Person } from '../../shared/head';
import { bodyHash, pack, unpack } from '../../shared/pack';
import { fromB64, open, openJson, publicKeyOf, toB64 } from '../../shared/seal';
import { isSealedSender, openFromSender, sealFromSender, type SignedCert } from '../../shared/sender';
import { buildMime, newMessageId, textToHtml, type Attachment, type Draft } from '../../web/src/lib/mime';

export const DOMAIN = 'shalomail.com';
export type Folder = 'inbox' | 'starred' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// Mensagens em inglês para os erros mais comuns; o resto mostra o texto do servidor.
const ERRORS: Record<string, string> = {
  bad_key: 'Invalid or revoked API key. For your account, run `shalom login`; for an agent mailbox, run `shalom agents rotate <address>` on the machine that has it.',
  reserved: 'That address is reserved. Pick another name, for example yourname-bot.',
  bad_recipient: 'Invalid recipient address.',
  bad_folder: 'Unknown folder.',
  too_big: 'Too large: up to 4 MB of attachments to outside addresses and 5 MB per message to Shalom addresses.',
  full: 'The mailbox is full.',
  no_such_user: 'That Shalom address does not exist.',
  not_found: 'Not found.',
  key_scope: 'This key cannot do that. Account keys manage agents; agent keys read and send mail.',
  agent_limit: 'Your plan has no free agent mailbox left. Delete one, or upgrade with `shalom upgrade`.',
  create_limit: 'You reached the daily limit of new agent mailboxes. Try again tomorrow.',
  agent_paused: "This agent mailbox is paused because the owner's plan no longer covers it. It still receives mail.",
  taken: 'That address is already taken.',
  bad_address: 'That address cannot be used. Use letters, numbers, dots, dashes or underscores.',
  send_limit: 'Daily sending limit reached for this mailbox.',
  send_limit_all: "Shalom's daily limit for mail to outside addresses was reached. Mail to Shalom addresses still works.",
  too_many: 'Too many requests. Try again later.',
  slow_down: 'Too many requests in a row. Wait a minute.',
  billing_off: 'Billing is not enabled yet.',
  no_session: 'Not logged in. Run `shalom login`.',
};

export type Creds = { api: string; key: string };

export async function call<T = any>(creds: Creds, method: string, path: string, body?: unknown, opts: { anonymous?: boolean; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-shalom': '1', 'user-agent': 'shalom-cli' };
  if (!opts.anonymous) headers.authorization = `Bearer ${creds.key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${creds.api}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(0, 'offline', `Could not reach ${creds.api} (${(e as Error).message}).`);
  }
  if (opts.raw && res.ok) return new Uint8Array(await res.arrayBuffer()) as T;
  const data = await res.json().catch(() => ({})) as { error?: string; message?: string };
  if (!res.ok) {
    const code = data.error ?? `http_${res.status}`;
    throw new ApiError(res.status, code, ERRORS[code] ?? data.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

// Chaves públicas do servidor (certificados e ingressos), fixadas na primeira vez como o app faz.
export type ServerKeys = { cert: Uint8Array; token: RsaPublic; wire: string };
// Impressão digital (SHA-256) das chaves públicas do shalomail.com, embutida no pacote: mesmo num contêiner
// novo, sem nada salvo, um servidor trocado ou uma conexão interceptada não passa por remetente conferido.
const BUILT_IN: Record<string, string> = {
  'https://shalomail.com': 'e8088912b446162136659e1674b67e8d4cd9435c1b7a89057492365d715e9004',
};
const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

export async function serverKeys(api: string, pinned: string | undefined): Promise<ServerKeys> {
  const w = await call<{ certKey: string; tokenKey: { n: string; e: string } }>({ api, key: '' }, 'GET', '/auth/config', undefined, { anonymous: true });
  const wire = JSON.stringify({ certKey: w.certKey, tokenKey: w.tokenKey });
  const builtIn = BUILT_IN[api.replace(/\/+$/, '')];
  if ((builtIn && builtIn !== (await sha256Hex(wire))) || (pinned && pinned !== wire)) {
    throw new ApiError(0, 'server_keys', "The server's signing keys are not the ones this package trusts. Stopping for safety.");
  }
  return { cert: fromB64(w.certKey), token: publicFromWire(w.tokenKey), wire };
}

export type Agent = { address: string; key: string; secretKey: Uint8Array; api: string };

export type Row = { id: string; folder: string; seen: number; starred: number; pinned?: number; received_at: number; size: number; sender: string | null; head: string };

export type Summary = {
  id: string;
  folder: string;
  from: Person | null;
  to: Person[];
  subject: string;
  date: string;
  receivedAt: number;
  snippet: string;
  attachments: number;
  unread: boolean;
  starred: boolean;
  // Shalom para Shalom: remetente conferido pelo certificado do servidor e lacre de ponta a ponta.
  verifiedSender: boolean;
  // E-mail de fora: resultado do DMARC visto na chegada.
  auth: MessageHead['auth'];
};

export class Mailbox {
  private keys: Promise<ServerKeys> | null = null;
  // Impressão do corpo que cada cabeçalho lacrado trouxe (mensagens Shalom novas), conferida na leitura.
  private bodyHashes = new Map<string, string>();
  private cert: { signed: SignedCert; until: number } | null = null;

  constructor(public agent: Agent, private pins: { server?: string; onServer: (wire: string) => void }) {}

  private get creds(): Creds { return { api: this.agent.api, key: this.agent.key }; }

  server() {
    this.keys ??= serverKeys(this.agent.api, this.pins.server).then(k => {
      if (!this.pins.server) this.pins.onServer(k.wire);
      return k;
    });
    return this.keys;
  }

  private async summarize(r: Row): Promise<Summary> {
    const blob = fromB64(r.head);
    let h: MessageHead;
    let verified = false;
    try {
      if (isSealedSender(blob)) {
        const { payload, sender } = await openFromSender(this.agent.secretKey, blob, 'head', (await this.server()).cert, r.received_at);
        h = JSON.parse(new TextDecoder().decode(payload)) as MessageHead;
        // A identidade de quem enviou vem do certificado, não do que está escrito no e-mail.
        h = { ...h, from: { name: h.from?.name ?? '', address: sender.address } };
        verified = true;
        if (h.b) this.bodyHashes.set(r.id, h.b);
      } else {
        h = await openJson<MessageHead>(this.agent.secretKey, blob);
      }
    } catch {
      h = { from: null, to: [], subject: '(unreadable)', date: new Date(r.received_at).toISOString(), snippet: '', attachments: 0, auth: 'fail', e2e: false };
    }
    return {
      id: r.id, folder: r.folder, from: h.from, to: h.to, subject: h.subject, date: h.date, receivedAt: r.received_at,
      snippet: h.snippet, attachments: h.attachments, unread: !r.seen, starred: !!r.starred, verifiedSender: verified, auth: h.auth,
    };
  }

  async list(folder: Folder = 'inbox', limit = 20, before?: number): Promise<{ messages: Summary[]; more: boolean }> {
    const q = new URLSearchParams({ folder, limit: String(Math.min(Math.max(limit, 1), 100)) });
    if (before) q.set('before', String(before));
    const { messages, more } = await call<{ messages: Row[]; more: boolean }>(this.creds, 'GET', `/messages?${q}`);
    return { messages: await Promise.all(messages.map(r => this.summarize(r))), more };
  }

  // Acha a linha de uma mensagem: pelo id completo, direto no servidor (qualquer pasta, qualquer idade); pelo
  // começo do id, nas pastas mais comuns.
  async find(id: string): Promise<Row> {
    if (/^[0-9a-f-]{36}$/i.test(id)) {
      try { return (await call<{ message: Row }>(this.creds, 'GET', `/messages/${id}`)).message; } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
        throw new ApiError(404, 'not_found', `Message ${id} not found.`);
      }
    }
    for (const folder of ['inbox', 'archive', 'sent', 'spam', 'trash'] as Folder[]) {
      let before: number | undefined;
      for (let page = 0; page < 5; page++) {
        const q = new URLSearchParams({ folder, limit: '100' });
        if (before) q.set('before', String(before));
        const { messages, more } = await call<{ messages: Row[]; more: boolean }>(this.creds, 'GET', `/messages?${q}`);
        const hit = messages.find(m => m.id === id || (id.length >= 6 && m.id.startsWith(id)));
        if (hit) return hit;
        if (!more || !messages.length) break;
        before = messages[messages.length - 1].received_at;
      }
    }
    throw new ApiError(404, 'not_found', `Message ${id} not found.`);
  }

  async read(id: string): Promise<{ summary: Summary; email: Email }> {
    const row = await this.find(id);
    const summary = await this.summarize(row);
    const blob = await call<Uint8Array>(this.creds, 'GET', `/messages/${row.id}/raw`, undefined, { raw: true });
    let raw: Uint8Array;
    if (isSealedSender(blob)) {
      const opened = await openFromSender(this.agent.secretKey, blob, 'raw', (await this.server()).cert, row.received_at);
      if (summary.verifiedSender && opened.sender.address !== summary.from?.address) throw new ApiError(0, 'tampered', 'The message body does not match its sender.');
      const want = this.bodyHashes.get(row.id);
      if (want && (await bodyHash(opened.payload)) !== want) throw new ApiError(0, 'tampered', 'The message body does not belong to this message.');
      raw = opened.payload;
    } else {
      // Cabeçalho com remetente conferido exige corpo lacrado pelo mesmo remetente.
      if (summary.verifiedSender) throw new ApiError(0, 'tampered', 'The message body is not sealed by its sender.');
      raw = await open(this.agent.secretKey, blob, 'raw');
    }
    const email = await PostalMime.parse(await unpack(raw), { attachmentEncoding: 'arraybuffer' });
    return { summary, email };
  }

  update(ids: string[], change: { seen?: boolean; starred?: boolean; folder?: Exclude<Folder, 'starred' | 'drafts'> }) {
    return call(this.creds, 'POST', '/messages/update', { ids, ...change });
  }

  // ---- envio ----

  private async myCert(): Promise<SignedCert> {
    if (this.cert && this.cert.until > Date.now() + 24 * 3600 * 1000) return this.cert.signed;
    const { cert } = await call<{ cert: SignedCert }>(this.creds, 'POST', '/cert', {});
    this.cert = { signed: cert, until: JSON.parse(new TextDecoder().decode(fromB64(cert.c))).e as number };
    return cert;
  }

  // Ingressos de entrega, todos de uma vez (até 20 por pedido), antes de qualquer envio.
  private async tokens(n: number): Promise<{ token: Uint8Array; sig: string }[]> {
    const out: { token: Uint8Array; sig: string }[] = [];
    const pub = (await this.server()).token;
    const len = modLen(pub.n);
    while (out.length < n) {
      const batch = await Promise.all(Array.from({ length: Math.min(20, n - out.length) }, async () => {
        const token = newToken();
        return { token, ...(await blind(pub, token)) };
      }));
      const { signed } = await call<{ signed: string[] }>(this.creds, 'POST', '/tokens', { blinded: batch.map(b => bigToB64(b.blinded, len)) });
      for (let i = 0; i < batch.length; i++) {
        const sig = unblind(pub, b64ToBig(signed[i]), batch[i].r);
        if (!(await verifyToken(pub, batch[i].token, sig))) throw new ApiError(0, 'bad_tokens', 'The server returned an invalid delivery ticket.');
        out.push({ token: batch[i].token, sig: bigToB64(sig, len) });
      }
    }
    return out;
  }

  // Só as não lidas, até `limit`: vai pelas páginas (até 1.000 mensagens), porque as não lidas podem estar
  // depois das 20 mais recentes.
  async unread(folder: Folder = 'inbox', limit = 20, maxPages = 10): Promise<Summary[]> {
    const found: Summary[] = [];
    let before: number | undefined;
    for (let page = 0; page < maxPages && found.length < limit; page++) {
      const { messages, more } = await this.list(folder, 100, before);
      found.push(...messages.filter(m => m.unread));
      if (!more || !messages.length) break;
      before = messages[messages.length - 1].receivedAt;
    }
    return found.slice(0, limit);
  }

  // Mensagens da Entrada que ainda não estão em `seen`, da mais antiga para a mais nova, paginando até achar
  // uma já vista (ou 1.000 mensagens): nada se perde quando chegam muitas de uma vez.
  async unseen(seen: Set<string>, maxPages = 10): Promise<Summary[]> {
    const fresh: Summary[] = [];
    let before: number | undefined;
    for (let page = 0; page < maxPages; page++) {
      const { messages, more } = await this.list('inbox', 100, before);
      const news = messages.filter(m => !seen.has(m.id));
      fresh.push(...news);
      if (news.length < messages.length || !more || !messages.length) break;
      before = messages[messages.length - 1].receivedAt;
    }
    return fresh.sort((a, b) => a.receivedAt - b.receivedAt);
  }

  private async sealed(recipientPub: Uint8Array, mime: Uint8Array, cert: SignedCert) {
    const packed = await pack(mime);
    // O cabeçalho leva a impressão do corpo: quem abre confere que os dois são da mesma mensagem.
    const head = { ...headOf(await PostalMime.parse(mime), true, new Date()), b: await bodyHash(packed) };
    return {
      head: toB64(await sealFromSender(recipientPub, this.agent.secretKey, cert, new TextEncoder().encode(JSON.stringify(head)), 'head')),
      raw: toB64(await sealFromSender(recipientPub, this.agent.secretKey, cert, packed, 'raw')),
    };
  }

  async publicKeyOf(address: string): Promise<string | null> {
    return (await call<{ publicKey: string | null }>(this.creds, 'POST', '/keys', { address }, { anonymous: true })).publicKey;
  }

  // Igual ao app: primeiro o envio para fora e a cópia de Enviados; depois a entrega lacrada e anônima
  // para cada conta Shalom. checkPin confere se a chave de um contato Shalom mudou desde a primeira vez.
  async send(out: {
    from: Person; to: Person[]; cc?: Person[]; bcc?: Person[]; subject: string; text: string; html?: string;
    inReplyTo?: string; references?: string; attachments?: Attachment[];
  }, checkPin: (address: string, publicKey: string) => void): Promise<{ id: string; external: number; internal: number }> {
    const cc = out.cc ?? [];
    const bcc = out.bcc ?? [];
    const all = [...out.to, ...cc, ...bcc];
    const isShalom = (a: string) => a.toLowerCase().endsWith(`@${DOMAIN}`);
    const html = out.html ?? textToHtml(out.text);
    const draft: Draft = {
      from: out.from, to: out.to, cc, bcc, subject: out.subject, text: out.text, html,
      messageId: newMessageId(DOMAIN), inReplyTo: out.inReplyTo, references: out.references, date: new Date(),
      attachments: out.attachments,
    };
    const forThem = buildMime(draft, false);
    const forMe = buildMime(draft, true);
    const cert = await this.myCert();

    const internal = [...new Set(all.map(p => p.address.toLowerCase()).filter(isShalom))];
    const deliveries: { address: string; head: string; raw: string }[] = [];
    for (const address of internal) {
      const pub = await this.publicKeyOf(address);
      if (!pub) throw new ApiError(404, 'no_such_user', `${address} does not exist.`);
      checkPin(address, pub);
      deliveries.push({ address, ...(await this.sealed(fromB64(pub), forThem, cert)) });
    }

    // Antes de gravar em Enviados: o que pode falhar na entrega para contas Shalom (tamanho e ingressos do dia)
    // é conferido e pego agora. Assim, ou vai para todo mundo, ou para ninguém, e repetir não duplica.
    const MAX_DELIVER_B64 = Math.ceil((5 * 1024 * 1024 + 2048) / 3) * 4;
    if (deliveries.some(d => d.raw.length > MAX_DELIVER_B64)) throw new ApiError(413, 'too_big', 'Too large for Shalom addresses: up to 5 MB per message.');
    const tickets = await this.tokens(deliveries.length);

    const outside = (l: Person[]) => l.filter(p => !isShalom(p.address));
    const external = all.filter(p => !isShalom(p.address)).length;
    const sent = await call<{ id: string; external: number }>(this.creds, 'POST', '/send', {
      ...(external ? {
        to: outside(out.to), cc: outside(cc), bcc: outside(bcc),
        subject: out.subject, text: out.text, html, inReplyTo: out.inReplyTo, references: out.references, messageId: draft.messageId,
        attachments: (out.attachments ?? []).map(a => ({ filename: a.filename, type: a.type, content: toB64(a.content), cid: a.cid })),
      } : {}),
      sentCopy: await this.sealed(publicKeyOf(this.agent.secretKey), forMe, cert),
    });
    for (const [i, d] of deliveries.entries()) {
      const t = tickets[i];
      await call(this.creds, 'POST', '/deliver', { to: d.address, head: d.head, raw: d.raw, token: toB64(t.token), sig: t.sig }, { anonymous: true });
    }
    return { id: sent.id, external, internal: deliveries.length };
  }
}
