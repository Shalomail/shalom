// Espaço: quanto cada pasta ocupa, a lista de tudo por tamanho, data ou nome, e apagar em massa.
// O servidor sabe só pasta, tamanho e hora de chegada de cada mensagem. Assunto e remetente saem do
// cabeçalho lacrado, aberto aqui no aparelho, e não voltam para o servidor.
import PostalMime, { type Attachment } from 'postal-mime';
import type { MessageHead } from '../../../shared/head';
import { pack, unpack } from '../../../shared/pack';
import { fromB64, open, openJson, publicKeyOf, seal, sealJson, toB64 } from '../../../shared/seal';
import { isSealedSender, openFromSender } from '../../../shared/sender';
import { api, apiBytes, ApiError } from './api';
import { t } from '../i18n';
import { displayName, longDay, size as sizeText } from './format';
import { cleanSubject, deleteForever, updateMessages, type Row, senderKeyOk } from './mailbox';
import { serverKeys } from './server-keys';

export type BoxFolder = Row['folder'];

// Ordem da barra e da legenda: a mesma da lista de pastas.
export const STORAGE_FOLDERS: { id: BoxFolder }[] = [{ id: 'inbox' }, { id: 'sent' }, { id: 'drafts' }, { id: 'archive' }, { id: 'spam' }, { id: 'trash' }];
export const folderLabel = (f: BoxFolder) => t(`mailbox.folders.${f}`);
// "da Entrada", "de Enviados", "do Arquivo": para os textos que falam de uma pasta só.
export const ofFolder = (f: BoxFolder) => t(`storage.of.${f}`);
// As duas formas, para cada idioma usar a que a frase pede ({of} ou {folder}).
export const folderVars = (f: BoxFolder) => ({ of: ofFolder(f), folder: folderLabel(f) });

export type Totals = Partial<Record<BoxFolder, { count: number; bytes: number }>>;
// at: hora do servidor em que o resumo foi feito (limite do "apagar tudo").
export type Summary = { folders: Totals; used: number; quota: number; at: number };
// Tamanho para a tela de espaço: de 1000 MB para cima já fala em GB ("1 GB", não "1024 MB"). O espaço
// antes da unidade não quebra linha ("47,5 MB" fica junto).
export const space = (bytes: number) => (bytes >= 1000 * 1024 * 1024 && bytes < 1024 ** 3 ? sizeText(1024 ** 3) : sizeText(bytes)).replace(' ', '\u00a0');
export const countOf = (s: Summary) => STORAGE_FOLDERS.reduce((n, f) => n + (s.folders[f.id]?.count ?? 0), 0);

export type StoredItem = {
  id: string;
  folder: BoxFolder;
  size: number;
  receivedAt: number;
  // Cabeçalho como foi guardado, aberto no aparelho. null quando não abriu.
  head: MessageHead | null;
  subject: string;
  who: string;
  date: string;
  attachments: number;
  // Trancada por quem enviou (outra conta Shalom, ou a sua cópia de Enviados): fica como chegou.
  locked: boolean;
};

const enc = new TextEncoder();

type Wire = { messages: Row[]; next: string | null; folders?: Totals; used?: number; quota?: number; at?: number };

// O mesmo critério do leitor (render.ts): arquivo é o que aparece na lista de anexos, não a imagem
// embutida no texto.
const isFile = (a: Attachment) => !(a.contentId && a.disposition === 'inline') && !a.related;
const contentOf = (a: Attachment) => (typeof a.content === 'string' ? enc.encode(a.content) : a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content));

async function itemOf(row: Row, key: Uint8Array): Promise<StoredItem> {
  const blob = fromB64(row.head);
  const locked = isSealedSender(blob);
  let head: MessageHead | null = null;
  let sender: string | null = null;
  try {
    if (locked) {
      const { cert } = await serverKeys();
      const opened = await openFromSender(key, blob, 'head', cert, row.received_at);
      head = JSON.parse(new TextDecoder().decode(opened.payload)) as MessageHead;
      sender = (await senderKeyOk(opened.sender.address, opened.sender.publicKey)) ? opened.sender.address : null;
    } else {
      head = await openJson<MessageHead>(key, blob);
    }
  } catch { /* fica sem nome: a linha mostra o aviso */ }
  // Remetente de mensagem Shalom: o conferido no aparelho, nunca o escrito no e-mail.
  const from = head && sender ? { name: head.from?.name ?? '', address: sender } : head?.from ?? null;
  const who = !head ? t('storage.cannotOpen')
    : row.folder === 'sent' ? t('common.toNames', { names: head.to.map(p => displayName(p)).join(', ') || t('common.nobody') })
    : displayName(from);
  return {
    id: row.id, folder: row.folder, size: row.size, receivedAt: row.received_at, head,
    subject: head ? cleanSubject(head.subject) : '',
    who,
    // Data de chegada: é por ela que o servidor ordena (a escrita pelo remetente fica lacrada).
    date: new Date(row.received_at).toISOString(),
    attachments: head?.attachments ?? 0,
    locked,
  };
}

const summaryOf = (w: Wire): Summary | undefined => (w.folders ? { folders: w.folders, used: w.used ?? 0, quota: w.quota ?? 0, at: w.at ?? 0 } : undefined);

export type ServerSort = 'size' | 'date';
export type Dir = 'desc' | 'asc';

// Avisa o resto do app (barra lateral: espaço e não lidas) que algo saiu da caixa.
export const storageChanged = () => window.dispatchEvent(new Event('shalom:storage'));

// Uma página da lista: todas as pastas juntas, ou só uma (folder). A primeira traz também o resumo do
// espaço, sempre com todas as pastas.
export async function storagePage(key: Uint8Array, q: { sort: ServerSort; dir?: Dir; after?: string | null; limit?: number; folder?: BoxFolder | null }) {
  const p = new URLSearchParams({ sort: q.sort, dir: q.dir ?? 'desc', limit: String(q.limit ?? 100) });
  if (q.after) p.set('after', q.after);
  if (q.folder) p.set('folder', q.folder);
  const w = await api<Wire>(`/storage?${p}`);
  const items = await Promise.all(w.messages.map(r => itemOf(r, key)));
  return { items, next: w.next, summary: summaryOf(w) };
}

export async function storageSummary(): Promise<Summary> {
  return summaryOf(await api<Wire>('/storage?limit=1'))!;
}

// Tudo (ou uma pasta inteira), em páginas de 100. Necessário para ordenar por nome ou pasta (o servidor
// não conhece os nomes) e para achar os anexos. Cada página é aberta no aparelho; a lista inteira fica só
// na memória da tela.
export async function loadEverything(key: Uint8Array, folder: BoxFolder | null, onProgress: (done: number, total: number) => void, stopped: () => boolean) {
  const items: StoredItem[] = [];
  let after: string | null = null;
  let total = 0;
  let summary: Summary | undefined;
  do {
    const page = await retry(() => storagePage(key, { sort: 'size', after, limit: 100, folder }));
    if (page.summary) { summary = page.summary; total = folder ? page.summary.folders[folder]?.count ?? 0 : countOf(page.summary); }
    items.push(...page.items);
    onProgress(items.length, Math.max(total, items.length));
    after = page.next;
  } while (after && !stopped());
  return { items, summary, complete: !after };
}

// Falha de rede ou do servidor ganha mais uma tentativa; recusa (4xx) não.
async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      const transient = !(e instanceof ApiError) || e.status === 0 || e.status >= 500;
      if (!transient || i >= tries) throw e;
      await new Promise(r => setTimeout(r, 500 * i));
    }
  }
}

// Lote máximo por pedido no servidor (MAX_IDS).
const BATCH = 90;

// Apagar de vez de qualquer pasta sem abrir exceção no servidor, que só apaga de vez o que está na
// Lixeira ou no Spam: cada lote vai para a Lixeira e sai de lá logo em seguida. Se o segundo passo
// falhar, o lote fica na Lixeira, não se perde.
export async function deleteForeverAnywhere(ids: string[], onProgress?: (done: number) => void, stopped?: () => boolean) {
  const gone: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    if (stopped?.()) { failed.push(...ids.slice(i)); break; }
    try {
      await retry(() => updateMessages(batch, { folder: 'trash' }));
      await retry(() => deleteForever(batch));
      gone.push(...batch);
    } catch {
      failed.push(...batch);
    }
    onProgress?.(gone.length + failed.length);
  }
  storageChanged();
  return { gone, failed };
}

// Esvazia a conta (ou uma pasta): tudo o que tinha chegado até a hora do resumo que a pessoa confirmou (o
// que chegar depois fica). O servidor apaga em lotes de 500, e cada lote mostra o progresso. Fora da Lixeira
// e do Spam vai a prova da senha (authKey).
export async function deleteEverything(before: number, folder: BoxFolder | null, onProgress: (done: number) => void, stopped: () => boolean, authKey?: string) {
  let done = 0;
  for (;;) {
    const body = { before, limit: 500, ...(folder ? { folder } : {}), ...(authKey ? { authKey } : {}) };
    const r = await retry(() => api<{ deleted: number; freed: number; more: boolean }>('/storage/wipe', { body }));
    done += r.deleted;
    onProgress(done);
    if (!r.more || !r.deleted || stopped()) break;
  }
  storageChanged();
  return { done };
}

// ---------- Anexos ----------

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Bytes viram texto um caractere por byte e voltam iguais, até com acento cru no cabeçalho.
function binary(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}
const bytesOf = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));
const b64Lines = (bytes: Uint8Array) => toB64(bytes).replace(/.{1,76}/g, '$&\r\n');

// Campos que descrevem a estrutura do corpo; o resto do cabeçalho original fica como chegou.
const STRUCTURE = /^(content-(type|transfer-encoding|disposition|id|description|length|md5)|mime-version)\s*:/i;

function keptHeaders(raw: Uint8Array): string[] {
  const text = binary(raw.subarray(0, Math.min(raw.length, 512 * 1024)));
  const crlf = text.indexOf('\r\n\r\n');
  const lf = text.indexOf('\n\n');
  const end = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf >= 0 ? lf : text.length;
  const fields: string[] = [];
  for (const line of text.slice(0, end).split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && fields.length) fields[fields.length - 1] += `\r\n${line}`;
    else if (line) fields.push(line);
  }
  return fields.filter(f => !STRUCTURE.test(f));
}

const textPart = (type: 'text/plain' | 'text/html', content: string) =>
  `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64Lines(enc.encode(content))}`;

function fileName(name: string) {
  return /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '\\$&')}"` : null;
}

// Imagem embutida que fica (o texto aponta para ela pelo Content-ID).
function inlinePart(a: Attachment) {
  const bytes = contentOf(a);
  const name = a.filename ? fileName(a.filename) : null;
  const star = a.filename && !name ? `; filename*=UTF-8''${encodeURIComponent(a.filename)}` : '';
  const lines = [
    `Content-Type: ${a.mimeType || 'application/octet-stream'}`,
    'Content-Transfer-Encoding: base64',
    a.contentId ? `Content-ID: <${a.contentId.replace(/^<|>$/g, '')}>` : '',
    `Content-Disposition: inline${name ? `; filename=${name}` : star}`,
  ].filter(Boolean);
  return `${lines.join('\r\n')}\r\n\r\n${b64Lines(bytes)}`;
}

function multipart(type: string, parts: string[]) {
  const b = `shalom-${crypto.randomUUID()}`;
  return `Content-Type: ${type}; boundary="${b}"\r\n\r\n${parts.map(p => `--${b}\r\n${p}\r\n`).join('')}--${b}--\r\n`;
}

function noteFor(files: Attachment[], when: Date) {
  const list = files.slice(0, 5).map(a => `${a.filename || t('storage.unnamedFile')} (${sizeText(contentOf(a).length)})`).join(', ');
  const names = files.length > 5 ? t('common.andMore', { names: list, n: files.length - 5 }) : list;
  return t(files.length === 1 ? 'storage.stripNoteOne' : 'storage.stripNoteMany', { date: longDay(when), names });
}

// Monta a mesma mensagem sem os arquivos anexados: cabeçalho original, texto e HTML, imagens embutidas
// e uma nota dizendo o que saiu. Confere lendo de volta antes de devolver; null se não há o que tirar.
export async function withoutAttachments(raw: Uint8Array, when = new Date()) {
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
  const files = email.attachments.filter(isFile);
  if (!files.length) return null;
  const kept = email.attachments.filter(a => !isFile(a));
  const note = noteFor(files, when);

  const bodies: string[] = [];
  if (email.text || !email.html) bodies.push(textPart('text/plain', `${(email.text || '').replace(/\s+$/, '')}${email.text ? '\n\n' : ''}${note}\n`));
  if (email.html) {
    const p = `<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #d9d9d9;color:#6b6b6b;font:13px/1.5 Arial,Helvetica,sans-serif">${escHtml(note)}</p>`;
    const at = email.html.toLowerCase().lastIndexOf('</body');
    bodies.push(textPart('text/html', at >= 0 ? email.html.slice(0, at) + p + email.html.slice(at) : email.html + p));
  }
  let root = bodies.length > 1 ? multipart('multipart/alternative', bodies) : bodies[0];
  if (kept.length) root = multipart('multipart/related', [root, ...kept.map(inlinePart)]);
  const mime = bytesOf(`${keptHeaders(raw).join('\r\n')}\r\nMIME-Version: 1.0\r\n${root}`);

  // Leitura de volta: mesmo assunto, remetente e Message-ID, texto presente e nenhum arquivo sobrando.
  const back = await PostalMime.parse(mime, { attachmentEncoding: 'arraybuffer' });
  const ok = back.subject === email.subject && back.messageId === email.messageId
    && back.from?.address === email.from?.address
    && (!email.html || !!back.html?.includes(escHtml(note))) && (!email.text || !!back.text?.includes(note))
    && back.attachments.length === kept.length && !back.attachments.some(isFile);
  if (!ok) throw new Error(t('storage.stripVerify'));
  // Contagem do cabeçalho, no mesmo critério de shared/head.ts.
  const left = back.attachments.filter(a => a.disposition !== 'inline' || !a.contentId).length;
  return { mime, removed: files.length, left };
}

export type StripResult = { status: 'done'; freed: number; id: string } | { status: 'skipped'; why: 'locked' | 'nothing' };

// Uma mensagem: baixa o corpo lacrado, abre, monta sem os anexos, lacra de novo com a chave pública
// calculada aqui e troca no servidor. O id muda; pasta, marcas e hora de chegada ficam.
export async function stripOne(item: StoredItem, key: Uint8Array): Promise<StripResult> {
  if (item.locked || !item.head) return { status: 'skipped', why: 'locked' };
  const blob = await retry(() => apiBytes(`/messages/${item.id}/raw`));
  if (isSealedSender(blob)) return { status: 'skipped', why: 'locked' };
  const raw = await unpack(await open(key, blob, 'raw'));
  const rebuilt = await withoutAttachments(raw);
  if (!rebuilt) return { status: 'skipped', why: 'nothing' };
  const pub = publicKeyOf(key);
  const sealedRaw = await seal(pub, await pack(rebuilt.mime), 'raw');
  if (sealedRaw.length >= item.size) return { status: 'skipped', why: 'nothing' };
  const sealedHead = await sealJson(pub, { ...item.head, attachments: rebuilt.left });
  const r = await retry(() => api<{ id: string; size: number; freed: number }>('/storage/replace', {
    body: { id: item.id, head: toB64(sealedHead), raw: toB64(sealedRaw) },
  }));
  return { status: 'done', freed: r.freed, id: r.id };
}

export type StripProgress = { done: number; total: number; freed: number; failed: number };

// Todas, três de cada vez. Erro numa mensagem não para as outras: vai para a lista de falhas.
export async function stripAll(items: StoredItem[], key: Uint8Array, onProgress: (p: StripProgress) => void, stopped: () => boolean) {
  const p: StripProgress = { done: 0, total: items.length, freed: 0, failed: 0 };
  const failed: { item: StoredItem; why: string }[] = [];
  let changed = 0;
  let skipped = 0;
  let next = 0;
  async function worker() {
    while (next < items.length && !stopped()) {
      const item = items[next++];
      try {
        const r = await stripOne(item, key);
        if (r.status === 'done') { changed++; p.freed += r.freed; } else skipped++;
      } catch (e) {
        failed.push({ item, why: e instanceof Error ? e.message : t('common.unknownError') });
        p.failed++;
      }
      p.done++;
      onProgress({ ...p });
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  storageChanged();
  return { changed, skipped, failed, freed: p.freed, stopped: p.done < items.length };
}
