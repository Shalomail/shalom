// Monta o e-mail (MIME) no aparelho. É ele que vai lacrado para outra conta Shalom e para Enviados.
import type { Person } from '../../../shared/head';

export type Draft = {
  from: Person;
  to: Person[];
  cc: Person[];
  bcc: Person[];
  subject: string;
  text: string;
  html: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  date: Date;
  // Arquivos anexados e imagens dentro do texto (cid: no HTML). Já chegam comprimidos (lib/attach.ts).
  attachments?: Attachment[];
};

export type Attachment = { filename: string; type: string; content: Uint8Array; cid?: string };

const enc = new TextEncoder();
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Palavra codificada (RFC 2047), em pedaços de até 45 bytes sem cortar caractere no meio.
export function encodeWord(s: string): string {
  if (ascii(s)) return s;
  const words: string[] = [];
  let chunk = '';
  for (const ch of s) {
    if (enc.encode(chunk + ch).length > 45) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map(w => `=?UTF-8?B?${b64(enc.encode(w))}?=`).join('\r\n ');
}

export function formatPerson(p: Person): string {
  if (!p.name) return p.address;
  const name = ascii(p.name) ? `"${p.name.replace(/["\\]/g, '\\$&')}"` : encodeWord(p.name);
  return `${name} <${p.address}>`;
}

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');

function body(type: string, content: string): string {
  const wrapped = b64(enc.encode(content)).replace(/.{1,76}/g, '$&\r\n');
  return `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapped}`;
}

function binary(a: Attachment): string {
  const name = encodeWord(clean(a.filename)).replace(/"/g, '');
  const disp = a.cid ? 'inline' : 'attachment';
  const head = [
    `Content-Type: ${a.type}; name="${name}"`,
    `Content-Disposition: ${disp}; filename="${name}"`,
    'Content-Transfer-Encoding: base64',
    a.cid ? `Content-ID: <${a.cid}>` : '',
  ].filter(Boolean).join('\r\n');
  return `${head}\r\n\r\n${b64(a.content).replace(/.{1,76}/g, '$&\r\n')}`;
}

// Partes aninhadas como os leitores de e-mail esperam: mixed (anexos) > related (imagens do texto) >
// alternative (texto puro e HTML). Sem anexo nenhum, fica só o alternative de sempre.
function parts(d: Draft): { type: string; content: string } {
  const alt = `alt-${crypto.randomUUID()}`;
  let node = {
    type: `multipart/alternative; boundary="${alt}"`,
    content: `--${alt}\r\n${body('text/plain', d.text)}--${alt}\r\n${body('text/html', d.html)}--${alt}--\r\n`,
  };
  const inline = (d.attachments ?? []).filter(a => a.cid);
  const files = (d.attachments ?? []).filter(a => !a.cid);
  if (inline.length) {
    const rel = `rel-${crypto.randomUUID()}`;
    node = {
      type: `multipart/related; boundary="${rel}"`,
      content: `--${rel}\r\nContent-Type: ${node.type}\r\n\r\n${node.content}${inline.map(a => `--${rel}\r\n${binary(a)}`).join('')}--${rel}--\r\n`,
    };
  }
  if (files.length) {
    const mix = `mix-${crypto.randomUUID()}`;
    node = {
      type: `multipart/mixed; boundary="${mix}"`,
      content: `--${mix}\r\nContent-Type: ${node.type}\r\n\r\n${node.content}${files.map(a => `--${mix}\r\n${binary(a)}`).join('')}--${mix}--\r\n`,
    };
  }
  return node;
}

// includeBcc: só a cópia de Enviados mostra o Cco; a cópia de quem recebe nunca leva.
export function buildMime(d: Draft, includeBcc: boolean): Uint8Array {
  const h = [
    `From: ${formatPerson(d.from)}`,
    d.to.length ? `To: ${d.to.map(formatPerson).join(', ')}` : '',
    d.cc.length ? `Cc: ${d.cc.map(formatPerson).join(', ')}` : '',
    includeBcc && d.bcc.length ? `Bcc: ${d.bcc.map(formatPerson).join(', ')}` : '',
    `Subject: ${encodeWord(clean(d.subject))}`,
    `Date: ${d.date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${d.messageId}`,
    d.inReplyTo ? `In-Reply-To: ${clean(d.inReplyTo)}` : '',
    d.references ? `References: ${clean(d.references)}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean);
  const top = parts(d);
  return enc.encode(`${h.join('\r\n')}\r\nContent-Type: ${top.type}\r\n\r\n${top.content}`);
}

export function newMessageId(domain: string): string {
  return `<${crypto.randomUUID()}@${domain}>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Texto digitado vira HTML simples: parágrafos, quebras e links clicáveis.
// HTML do editor (já limpo pelo Composer) com a citação embaixo, na mesma moldura do texto puro.
export function richToHtml(html: string, quoted?: { header: string; html: string }): string {
  const quote = quoted
    ? `<br><div>${esc(quoted.header)}</div><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex">${quoted.html}</blockquote>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${html}${quote}</div>`;
}

export function textToHtml(text: string, quoted?: { header: string; html: string }): string {
  const linked = esc(text).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>');
  const quote = quoted
    ? `<br><div>${esc(quoted.header)}</div><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex">${quoted.html}</blockquote>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${linked}${quote}</div>`;
}
