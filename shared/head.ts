// Cabeçalho da mensagem (remetente, assunto, prévia). Vai lacrado junto da linha da lista, para a
// caixa de entrada abrir sem baixar cada e-mail inteiro. O servidor nunca guarda isso aberto.
// Fica pequeno de propósito: é o que mais ocupa espaço no banco de cada caixa.
import type { Address, Email, Header } from 'postal-mime';

export type Person = { name: string; address: string };

export type MessageHead = {
  from: Person | null;
  // Só para a pasta Enviados mostrar para quem foi. Cc, Message-ID e afins são lidos do corpo ao abrir.
  to: Person[];
  subject: string;
  date: string;
  snippet: string;
  attachments: number;
  // Marca da conversa: hash da primeira mensagem do fio (References, senão In-Reply-To, senão a própria).
  // Fica lacrada aqui dentro, então o servidor não sabe quais mensagens são da mesma conversa.
  t?: string;
  // Resultado do DMARC visto pela Cloudflare na chegada. "unknown" quando não veio o cabeçalho dela.
  auth: 'pass' | 'fail' | 'unknown';
  // Lacrado no aparelho de quem enviou (Shalom para Shalom): fechado de ponta a ponta.
  e2e: boolean;
  // Impressão do corpo empacotado (shared/pack.ts bodyHash), nas mensagens Shalom para Shalom novas.
  b?: string;
};

export function people(list: Address[] | Address | undefined): Person[] {
  if (!list) return [];
  const out: Person[] = [];
  for (const a of Array.isArray(list) ? list : [list]) {
    if (a.group) for (const m of a.group) out.push({ name: m.name || '', address: (m.address || '').toLowerCase() });
    else if (a.address) out.push({ name: a.name || '', address: a.address.toLowerCase() });
  }
  return out;
}

// Tira <style>, <script> e <head> com o conteúdo, numa passada só (com [\s\S]*? até o fechamento, um HTML sem
// fechamento repetido deixaria a conta quadrática). Sem fechamento, o resto fica de fora.
function dropBlocks(html: string): string {
  // Só as letras ASCII em minúscula, para as posições valerem também no texto original.
  const lower = html.replace(/[A-Z]+/g, x => x.toLowerCase());
  const open = /<(style|script|head)\b/g;
  let out = '';
  let i = 0;
  for (;;) {
    open.lastIndex = i;
    const hit = open.exec(lower);
    if (!hit) return out + html.slice(i);
    out += html.slice(i, hit.index) + ' ';
    const end = lower.indexOf(`</${hit[1]}>`, hit.index);
    if (end < 0) return out;
    i = end + hit[1].length + 3;
  }
}

export function snippetOf(text: string | undefined, html: string | undefined): string {
  let s = text || '';
  if (!s && html) {
    // Só o começo do HTML e regras lineares: a prévia não pode travar com HTML montado para isso.
    s = dropBlocks(html.slice(0, 256 * 1024))
      .replace(/<[^<>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, 110);
}

// Só vale o primeiro ARC-Authentication-Results, e só se o carimbo for do mx.cloudflare.net (ele fica
// no topo). Se o da Cloudflare faltar, um cabeçalho igual escrito pelo remetente não é aceito no lugar.
export function authOf(headers: Header[]): MessageHead['auth'] {
  const h = headers.find(x => x.key === 'arc-authentication-results' || x.key === 'authentication-results');
  if (!h || !/^\s*(i=1;\s*)?mx\.cloudflare\.net\s*;/i.test(h.value)) return 'unknown';
  const dmarc = /\bdmarc=(\w+)/i.exec(h.value)?.[1]?.toLowerCase();
  if (dmarc === 'pass') return 'pass';
  if (dmarc === 'fail') return 'fail';
  return 'unknown';
}

// Hash curto (53 bits), só para agrupar; não é segurança.
function shortHash(str: string): string {
  let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const firstId = (s: string | undefined) => (s || '').match(/<[^<>\s]+>/)?.[0] ?? (s || '').trim().split(/\s+/)[0] ?? '';

export function threadKey(email: Pick<Email, 'references' | 'inReplyTo' | 'messageId'>): string {
  const root = firstId(email.references) || firstId(email.inReplyTo) || firstId(email.messageId);
  return root ? shortHash(root.toLowerCase()) : '';
}

export function headOf(email: Email, e2e: boolean, receivedAt: Date): MessageHead {
  const date = email.date && !Number.isNaN(Date.parse(email.date)) ? new Date(email.date) : receivedAt;
  return {
    from: people(email.from)[0] ?? null,
    to: people(email.to).slice(0, 5),
    subject: (email.subject || '').trim().slice(0, 200),
    date: date.toISOString(),
    snippet: snippetOf(email.text, email.html),
    attachments: email.attachments.filter(a => a.disposition !== 'inline' || !a.contentId).length,
    t: threadKey(email) || undefined,
    auth: e2e ? 'pass' : authOf(email.headers),
    e2e,
  };
}
