// Sugestões de contato no Para, Cc e Cco. Saem só dos cabeçalhos que este aparelho já abriu: quem
// escreveu para você e para quem você escreveu. A lista e o que se digita nunca vão para o servidor,
// e nada disso é guardado: some junto com a sessão.
import type { Person } from '../../../shared/head';
import { openedItems, type Item } from './mailbox';

export type Contact = { name: string; address: string };

type Entry = Contact & {
  score: number; last: number; nameAt: number;
  // Palavras do nome e do endereço, sem acento, para casar pelo começo de qualquer uma.
  nameWords: string[]; words: string[];
};

// Sem acento e em minúsculas: "joao" acha "João".
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

// Endereço que não recebe resposta não vira sugestão.
const NO_REPLY = /^(no-?reply|nao-?responda|naoresponda|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?)([._+-]|@)/i;

const DAY = 86_400_000;

export function buildContacts(items: Item[], me: string, now = Date.now()): Entry[] {
  const mine = me.toLowerCase();
  const map = new Map<string, Entry>();
  const add = (p: Person | null | undefined, at: number, weight: number) => {
    const address = p?.address?.trim().toLowerCase();
    if (!address || address === mine || !address.includes('@') || NO_REPLY.test(address)) return;
    let c = map.get(address);
    if (!c) map.set(address, (c = { name: '', address, score: 0, last: 0, nameAt: -1, nameWords: [], words: [] }));
    // Frequência pesada pela idade: uma mensagem de 30 dias vale metade de uma de hoje.
    c.score += weight / (1 + Math.max(0, now - at) / (30 * DAY));
    c.last = Math.max(c.last, at);
    const name = p?.name?.trim().replace(/^["']|["']$/g, '') ?? '';
    if (name && name.toLowerCase() !== address && at >= c.nameAt) { c.name = name; c.nameAt = at; }
  };
  for (const i of items) {
    // Spam e remetente falso ficam de fora: não podem virar atalho para golpe.
    if (i.folder === 'spam' || i.spoofed) continue;
    // Para quem você escreveu pesa mais do que quem escreveu para você.
    if (i.folder === 'sent' || i.h.from?.address?.toLowerCase() === mine) for (const p of i.h.to) add(p, i.received_at, 3);
    else add(i.h.from, i.received_at, 1);
  }
  for (const c of map.values()) {
    const [local, domain = ''] = fold(c.address).split('@');
    c.nameWords = fold(c.name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    c.words = [...c.nameWords, local, ...local.split(/[._+-]+/), domain.split('.')[0]].filter(Boolean);
  }
  return [...map.values()];
}

// Agenda deste aparelho, montada na hora a partir do que já foi aberto.
export const contactsFor = (me: string) => buildContacts(openedItems(), me);

// Até `limit` contatos que casam com o que foi digitado, do mais usado e recente para o menos.
export function suggest(book: Entry[], query: string, taken: Set<string>, limit = 6): Contact[] {
  const q = fold(query.trim().replace(/^["'<]+/, ''));
  if (!q) return [];
  const tokens = q.split(/\s+/);
  const ranked: [Entry, number][] = [];
  for (const c of book) {
    if (taken.has(c.address)) continue;
    let hit: boolean;
    let boost = 1;
    if (q.includes('@')) hit = fold(c.address).startsWith(q);
    else {
      hit = tokens.every(t => c.words.some(w => w.startsWith(t)) || fold(c.address).startsWith(t));
      // Quem casa pelo nome vem antes de quem casa só pelo endereço.
      if (hit && c.nameWords.some(w => w.startsWith(tokens[0]))) boost = 1.5;
    }
    if (hit) ranked.push([c, c.score * boost]);
  }
  ranked.sort((a, b) => b[1] - a[1] || b[0].last - a[0].last);
  return ranked.slice(0, limit).map(([c]) => ({ name: c.name, address: c.address }));
}

export type Book = Entry[];
