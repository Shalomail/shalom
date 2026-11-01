// O que o CLI e a biblioteca (sdk.ts) fazem igual com uma mensagem: mostrar quem é, tirar o texto do
// HTML, montar o JSON de uma mensagem aberta, reconhecer o tipo do anexo e montar a resposta.
import type { Email } from 'postal-mime';
import type { Person } from '../../shared/head';
import type { Summary } from './client';

// Texto que veio num e-mail (de qualquer remetente) antes de ir para o terminal: sem caracteres de controle nem
// sequências de escape, que mexem no terminal de quem lê (título, área de transferência, cores), e sem as
// marcas de direção do Unicode, que viram o texto ao contrário. Numa linha só, as quebras viram espaço.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
export const safeLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(CONTROL, '');
export const safeText = (s: string) => s.replace(/\r\n?/g, '\n').replace(CONTROL, '');
// JSON para a tela ou para outro programa: o JSON.stringify já escapa os controles comuns; os C1 e as marcas
// de direção do Unicode saem escapados também (\u0085, \u202e...), para nada mudar o terminal nem o texto.
export const safeJson = (v: unknown, space?: number) =>
  JSON.stringify(v, null, space).replace(/[\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

export const who = (p: Person | null) => (p ? safeLine(p.name ? `${p.name} <${p.address}>` : p.address) : '(unknown)');
export const when = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 16);

export function htmlToText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

export const bodyText = (e: Email) => (e.text?.trim() ? e.text.trim() : e.html ? htmlToText(e.html) : '');
export const addrs = (l: { name?: string; address?: string }[] | undefined): Person[] =>
  (l ?? []).filter(a => a.address).map(a => ({ name: a.name ?? '', address: a.address! }));

export function messageJson(s: Summary, e: Email) {
  return {
    ...s,
    messageId: e.messageId ?? null, inReplyTo: e.inReplyTo ?? null, references: e.references ?? null,
    replyTo: addrs(e.replyTo), cc: addrs(e.cc),
    text: bodyText(e), html: e.html ?? null,
    attachments: e.attachments.map(a => ({ filename: a.filename ?? 'attachment', mimeType: a.mimeType, size: (a.content as ArrayBuffer).byteLength })),
  };
}

const TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const typeOf = (filename: string) => TYPES[filename.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

// Separa por vírgula, menos dentro de aspas ou de <...>: "Silva, Ana" <ana@x.com> é uma pessoa só.
function splitList(s: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false, angle = false;
  for (const ch of s) {
    if (ch === '"' && !angle) quoted = !quoted;
    else if (ch === '<' && !quoted) angle = true;
    else if (ch === '>' && !quoted) angle = false;
    if (ch === ',' && !quoted && !angle) { out.push(cur); cur = ''; } else cur += ch;
  }
  return [...out, cur];
}

// "Ana <ana@x.com>, bia@y.com" ou uma lista disso.
export const people = (list: string | string[] | undefined): Person[] =>
  (Array.isArray(list) ? list : list ? [list] : []).flatMap(splitList).map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(s);
    return m ? { name: m[1].replace(/^"|"$/g, ''), address: m[2].trim().toLowerCase() } : { name: '', address: s.toLowerCase() };
  });

// Resposta na mesma conversa: para quem responder, "Re:", o fio (In-Reply-To e References) e a citação.
export function replyDraft(summary: Summary, email: Email, me: string, opts: { text: string; all?: boolean; quote?: boolean; to?: Person[]; cc?: Person[] }) {
  const back = addrs(email.replyTo).length ? addrs(email.replyTo) : summary.from ? [summary.from] : [];
  const to = opts.to?.length ? opts.to : back;
  // Responder a todos: sem a própria caixa, sem quem já está no Para e sem repetir (maiúsculas não contam).
  const taken = new Set([me, ...to.map(t => t.address)].map(a => a.toLowerCase()));
  const cc = opts.all
    ? [...addrs(email.to), ...addrs(email.cc), ...(opts.cc ?? [])].filter(p => {
      const a = p.address.toLowerCase();
      if (taken.has(a)) return false;
      taken.add(a);
      return true;
    })
    : opts.cc ?? [];
  const subject = /^\s*re\s*:/i.test(summary.subject) ? summary.subject : `Re: ${summary.subject}`;
  const quote = opts.quote === false ? '' : `\n\nOn ${email.date ?? when(summary.receivedAt)}, ${who(summary.from)} wrote:\n${bodyText(email).split('\n').map(l => `> ${l}`).join('\n')}`;
  const references = [email.references, email.messageId].filter(Boolean).join(' ') || undefined;
  return { to, cc, subject, text: opts.text + quote, inReplyTo: email.messageId, references };
}
