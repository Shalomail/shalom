// Lista e leitura. Tudo chega lacrado do servidor e é aberto aqui, com a chave do aparelho.
import { checkPin, confirmPin, pinState } from './pins';
import { fingerprint } from '../../../shared/fingerprint';
import PostalMime, { type Email } from 'postal-mime';
import type { MessageHead } from '../../../shared/head';
import { fromB64, open, openJson, publicKeyOf, toB64 } from '../../../shared/seal';
import { bodyHash, unpack } from '../../../shared/pack';
import { isSealedSender, openFromSender } from '../../../shared/sender';
import { serverKeys } from './server-keys';
import { api, apiBytes } from './api';
import { t } from '../i18n';

export type Folder = 'inbox' | 'starred' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash';

export type Row = {
  id: string; folder: Exclude<Folder, 'starred'>; seen: number; starred: number; pinned: number;
  received_at: number; size: number; sender: string | null; head: string;
};

export type Item = Row & {
  h: MessageHead;
  // Fechado de ponta a ponta: veio de outra conta Shalom, lacrado no aparelho de quem enviou, ou é a sua
  // cópia de algo que foi só para contas Shalom.
  sealedEnd: boolean;
  // A sua própria cópia (Enviados), lacrada por você neste ou em outro aparelho seu.
  own?: boolean;
  // A chave do remetente mudou desde a fixada neste aparelho: não vale como confirmado.
  keyChanged?: boolean;
  // Chave pública do remetente Shalom (do certificado), para conferir a impressão digital no leitor.
  senderKey?: string;
  // O remetente escrito no e-mail não confere com quem enviou de fato.
  spoofed: boolean;
};

type Opened = { h: MessageHead; sender: string | null; verified: boolean; keyChanged?: boolean; key?: string };

// Dono das chaves fixadas de contato (as fixações são separadas por conta). O Mailbox informa ao abrir.
let pinOwner = '';
let ownAddress = '';
// Chave pública da conta aberta, calculada uma vez a partir da privada.
let ownKey: { secret: Uint8Array; pub: string } | null = null;
const ownKeyOf = (secret: Uint8Array) => {
  if (ownKey?.secret !== secret) ownKey = { secret, pub: toB64(publicKeyOf(secret)) };
  return ownKey.pub;
};
export function setPinOwner(userId: string, address: string) { pinOwner = userId; ownAddress = address.toLowerCase(); }

// Remetente lacrado só vale como confirmado se a chave do certificado for a fixada para aquele endereço
// neste aparelho (na primeira mensagem, fixa). O certificado sozinho é palavra do servidor.
export async function senderKeyOk(address: string, publicKey: string): Promise<boolean> {
  if (!pinOwner) return false;
  return (await checkPin(pinOwner, address, publicKey)) === publicKey;
}

// Identidade de um contato Shalom: a impressão digital da chave dele e se você já conferiu com ele. No
// primeiro contato a chave é a que o servidor certificou; só a conferência por fora do Shalom (ligação,
// pessoalmente) garante que ninguém, nem o servidor, se passou por ele.
export async function identityOf(address: string, publicKey: string) {
  const pin = pinOwner ? await pinState(pinOwner, address) : undefined;
  return { fingerprint: await fingerprint(address, fromB64(publicKey)), confirmed: !!pin?.confirmed && pin.pub === publicKey };
}
export const confirmIdentity = (address: string, publicKey: string) => (pinOwner ? confirmPin(pinOwner, address, publicKey) : Promise.resolve(false));
const heads = new Map<string, Opened>();

// Linhas já abertas nesta sessão, com a pasta. Servem só para as sugestões de contato (contacts.ts),
// que ficam neste aparelho.
const openedRows = new Map<string, Item>();
export const openedItems = (): Item[] => [...openedRows.values()];

// Abre o cabeçalho. Mensagem com remetente lacrado: confere certificado e lacre autenticado aqui no
// aparelho, e é daí (não do servidor) que vem quem enviou.
async function headFor(row: Row, key: Uint8Array): Promise<Opened> {
  const cached = heads.get(row.id);
  if (cached) return cached;
  const blob = fromB64(row.head);
  let out: Opened;
  try {
    if (isSealedSender(blob)) {
      const { cert } = await serverKeys();
      const { payload, sender } = await openFromSender(key, blob, 'head', cert, row.received_at);
      const h = JSON.parse(new TextDecoder().decode(payload)) as MessageHead;
      // A própria conta: a chave tem que ser a deste aparelho (a pública sai da privada aqui). Sem isso, num
      // aparelho novo, sem nada fixado, o servidor poderia certificar outra chave com o seu endereço e
      // forjar uma cópia "sua" com o selo de ponta a ponta.
      const ok = sender.address === ownAddress ? sender.publicKey === ownKeyOf(key) : await senderKeyOk(sender.address, sender.publicKey);
      out = ok ? { h, sender: sender.address, verified: true, key: sender.publicKey } : { h, sender: null, verified: false, keyChanged: true };
    } else {
      // Lacre comum: quem enviou não é confirmado no aparelho. A coluna sender é palavra do servidor e não
      // liga o selo de ponta a ponta.
      out = { h: await openJson<MessageHead>(key, blob), sender: null, verified: false };
    }
  } catch {
    out = {
      h: { from: null, to: [], subject: t('mailbox.unreadable'), date: new Date(row.received_at).toISOString(), snippet: '', attachments: 0, auth: 'fail', e2e: false },
      sender: null, verified: false,
    };
  }
  heads.set(row.id, out);
  return out;
}

export async function listFolder(folder: Folder, key: Uint8Array, before?: number) {
  const q = new URLSearchParams({ folder, limit: '50' });
  if (before) q.set('before', String(before));
  const { messages, more, counts } = await api<{ messages: Row[]; more: boolean; counts: Counts }>(`/messages?${q}`);
  const items = await Promise.all(messages.map(async (r): Promise<Item> => {
    const { h, sender, keyChanged, key: senderKey } = await headFor(r, key);
    // O selo de ponta a ponta vem do remetente conferido no aparelho, nunca de algo que o remetente
    // escreveu. E-mail de fora dizendo ser @shalomail.com é falso por definição: conta Shalom sempre envia
    // trancado.
    const verified = !!sender;
    // A sua cópia de Enviados também chega lacrada por você, mas só é de ponta a ponta se foi apenas para
    // contas Shalom (e2e, gravado no envio). Cópias antigas marcavam e2e sempre: nelas vale a lista Para.
    const own = verified && sender === ownAddress;
    // De outra conta: só com e2e (a mensagem foi só para contas Shalom; com alguém de fora o texto saiu aberto).
    const sealedEnd = verified && h.e2e && (!own || h.to.every(p => p.address.toLowerCase().endsWith('@shalomail.com')));
    const from = h.from?.address?.toLowerCase() ?? '';
    const spoofed = verified ? from !== sender : h.auth === 'fail' || from.endsWith('@shalomail.com');
    // Em mensagem Shalom, a identidade mostrada é sempre o remetente conferido, com o endereço à vista.
    const shown = verified ? { ...h, from: { name: h.from?.name ?? '', address: sender! } } : h;
    return { ...r, sender, h: shown, sealedEnd, own, spoofed: spoofed || !!keyChanged, keyChanged, senderKey };
  }));
  for (const i of items) openedRows.set(i.id, i);
  return { items, more, counts };
}

export type Counts = Partial<Record<Folder, number>>;
export const unreadCounts = () => api<Counts>('/messages/counts');

const bodies = new Map<string, Email>();

export async function readMessage(id: string, key: Uint8Array, item?: Pick<Item, 'received_at' | 'sender'> & { h?: Pick<MessageHead, 'b'> }): Promise<Email> {
  const cached = bodies.get(id);
  if (cached) return cached;
  const blob = await apiBytes(`/messages/${id}/raw`);
  let raw: Uint8Array;
  if (isSealedSender(blob)) {
    const { cert } = await serverKeys();
    const opened = await openFromSender(key, blob, 'raw', cert, item?.received_at ?? Date.now());
    if (item?.sender && opened.sender.address !== item.sender) throw new Error(t('reader.bodySender'));
    const keyOk = opened.sender.address === ownAddress ? opened.sender.publicKey === ownKeyOf(key) : await senderKeyOk(opened.sender.address, opened.sender.publicKey);
    if (item?.sender && !keyOk) throw new Error(t('reader.senderKey'));
    // Mensagem nova traz no cabeçalho a impressão do corpo: corpo de outra mensagem não passa.
    if (item?.h?.b && (await bodyHash(opened.payload)) !== item.h.b) throw new Error(t('reader.bodySender'));
    raw = opened.payload;
  } else {
    // Cabeçalho com remetente confirmado exige corpo lacrado pelo mesmo remetente. Lacre comum qualquer
    // um faz com a chave pública: aceitar aqui deixaria trocar o texto debaixo de um remetente verdadeiro.
    if (item?.sender) throw new Error(t('reader.notSealed'));
    raw = await open(key, blob, 'raw');
  }
  const email = await PostalMime.parse(await unpack(raw), { attachmentEncoding: 'arraybuffer' });
  bodies.set(id, email);
  return email;
}

// O servidor aceita até 90 mensagens por pedido (worker/box.ts): listas maiores vão em lotes, um depois
// do outro, e a ação só conta como feita quando todos voltam.
const BATCH = 90;
const batches = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, (i + 1) * BATCH));

// Devolve as não lidas já atualizadas, sem outra ida ao servidor.
export async function updateMessages(ids: string[], change: { seen?: boolean; starred?: boolean; pinned?: boolean; folder?: Exclude<Folder, 'starred'> }) {
  let counts: Counts = {};
  for (const part of batches(ids)) counts = (await api<{ counts: Counts }>('/messages/update', { body: { ids: part, ...change } })).counts;
  return counts;
}

export async function deleteForever(ids: string[]) {
  let deleted = 0;
  for (const part of batches(ids)) deleted += (await api<{ deleted: number }>('/messages/delete', { body: { ids: part } })).deleted;
  return { deleted };
}

export function forgetCache() {
  heads.clear();
  bodies.clear();
  openedRows.clear();
}

// Conversas. Agrupa pela marca lacrada no cabeçalho (h.t), juntando as mensagens da pasta aberta com
// as da outra pasta carregada (Enviados, ou a Entrada quando a pasta é Enviados). A ordem usa a hora
// em que o servidor recebeu, não a data escrita pelo remetente.
export type Thread = {
  key: string;
  items: Item[];
  inFolder: Item[];
  latest: Item;
  unread: boolean;
  starred: boolean;
  pinned: boolean;
};

const threadKeyOf = (i: Item) => i.h.t || `id:${i.id}`;

export function threadsOf(folderItems: Item[], extra: Item[]): Thread[] {
  const map = new Map<string, Thread>();
  for (const i of folderItems) {
    const k = threadKeyOf(i);
    const t = map.get(k);
    if (t) { t.items.push(i); t.inFolder.push(i); } else map.set(k, { key: k, items: [i], inFolder: [i], latest: i, unread: false, starred: false, pinned: false });
  }
  for (const i of extra) {
    const t = map.get(threadKeyOf(i));
    if (t && !t.items.some(x => x.id === i.id)) t.items.push(i);
  }
  // Resposta que não achou a conversa pela referência (o serviço de envio pode trocar o Message-ID, e
  // quem responde de fora aponta para o dele): junta pela pessoa e pelo assunto sem o "Re:".
  const isReply = (s: string) => cleanSubject(s) !== s.trim();
  const other = (i: Item) => ((i.folder === 'sent' ? i.h.to[0]?.address : i.h.from?.address) ?? '').toLowerCase();
  const subjectKey = (i: Item) => `${cleanSubject(i.h.subject).toLowerCase()}|${other(i)}`;
  const roots = new Map<string, Thread>();
  for (const t of map.values()) {
    const first = [...t.items].sort((a, b) => a.received_at - b.received_at)[0];
    if (!isReply(first.h.subject) && cleanSubject(first.h.subject)) roots.set(subjectKey(first), t);
  }
  for (const [k, t] of [...map]) {
    const first = [...t.items].sort((a, b) => a.received_at - b.received_at)[0];
    if (!isReply(first.h.subject)) continue;
    const home = roots.get(subjectKey(first));
    if (!home || home === t) continue;
    for (const i of t.items) if (!home.items.some(x => x.id === i.id)) home.items.push(i);
    home.inFolder.push(...t.inFolder.filter(i => !home.inFolder.some(x => x.id === i.id)));
    map.delete(k);
  }
  for (const t of map.values()) {
    t.items.sort((a, b) => a.received_at - b.received_at);
    t.latest = t.items[t.items.length - 1];
    t.unread = t.inFolder.some(i => !i.seen);
    t.starred = t.inFolder.some(i => !!i.starred);
    t.pinned = t.inFolder.some(i => !!i.pinned);
  }
  // Fixadas primeiro; dentro de cada grupo, a mais recente em cima.
  return [...map.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.latest.received_at - a.latest.received_at);
}

export const cleanSubject = (s: string) => s.replace(/^\s*((re|res|enc|fw|fwd|rv)\s*:\s*)+/i, '').trim();
