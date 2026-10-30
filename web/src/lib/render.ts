// Prepara o corpo do e-mail para o iframe de leitura.
//
// Três camadas: DOMPurify limpa o HTML; o iframe não roda script (sandbox sem allow-scripts; NUNCA
// juntar allow-scripts com allow-same-origin, isso desfaz o sandbox); e o documento leva CSP própria
// que só aceita imagem embutida (data:). Imagem remota fica em data-src até a pessoa pedir; aí vem
// pelo nosso proxy e entra como data:, então quem enviou não vê o IP de quem abriu.
import DOMPurify from 'dompurify';
import type { Email } from 'postal-mime';

const HEAD = `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'">
<meta http-equiv="x-dns-prefetch-control" content="off">
<meta name="referrer" content="no-referrer">`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function bytesToDataUrl(content: ArrayBuffer | Uint8Array | string, type: string): string {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(s)}`;
}

function textBody(text: string): string {
  const linked = esc(text).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}">${u}</a>`);
  return `<div class="shalom-text">${linked}</div>`;
}

const REMOTE = /^(https?:)?\/\//i;
const RASTER = /^image\/(png|jpe?g|gif|webp|avif)$/i;

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (REMOTE.test(src)) {
        node.setAttribute('data-src', src.startsWith('//') ? `https:${src}` : src);
        node.removeAttribute('src');
      }
    }
  });
}

export type Prepared = { doc: Document; remoteImages: string[] };

export function prepare(email: Email): Prepared {
  hook();
  const clean = DOMPurify.sanitize(email.html || textBody(email.text || ''), {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ['meta', 'base', 'link', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'frame', 'object', 'embed', 'portal', 'script'],
    FORBID_ATTR: ['srcset', 'ping', 'action', 'formaction', 'background', 'poster'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|cid:|#)/i,
    ADD_ATTR: ['target'],
  });
  const doc = new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${clean}</body></html>`, 'text/html');

  // Imagens embutidas no próprio e-mail (cid:) viram data:, só se forem raster.
  const cids = new Map<string, string>();
  for (const att of email.attachments) {
    if (att.contentId && RASTER.test(att.mimeType)) cids.set(att.contentId.replace(/^<|>$/g, ''), bytesToDataUrl(att.content, att.mimeType));
  }
  const remote = new Set<string>();
  doc.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('cid:')) {
      const data = cids.get(src.slice(4));
      if (data) img.setAttribute('src', data);
      else img.removeAttribute('src');
    }
    const later = img.getAttribute('data-src');
    if (later) remote.add(later);
  });
  return { doc, remoteImages: [...remote] };
}

// Baixa as imagens remotas pelo proxy (POST, nunca por link) e troca por data: dentro do documento.
export async function loadRemoteImages(p: Prepared, limit = 40): Promise<number> {
  const urls = p.remoteImages.slice(0, limit);
  const loaded = new Map<string, string>();
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        const res = await fetch('/api/img', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-shalom': '1' },
          body: JSON.stringify({ u: url }),
          credentials: 'same-origin',
        });
        const type = (res.headers.get('content-type') || '').split(';')[0];
        if (!res.ok || !RASTER.test(type)) continue;
        loaded.set(url, bytesToDataUrl(await res.arrayBuffer(), type));
      } catch { /* imagem que falhar fica de fora */ }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  p.doc.querySelectorAll('img[data-src]').forEach(img => {
    const data = loaded.get(img.getAttribute('data-src') || '');
    if (data) img.setAttribute('src', data);
  });
  return loaded.size;
}

// Sem folha branca: a mensagem fica direto sobre o vidro, nas cores do tema. O color-scheme do
// documento tem que ser o mesmo da página, senão o navegador pinta um fundo branco atrás do iframe.
// No escuro, e-mail em HTML (feito para fundo branco) tem as cores invertidas e as imagens
// desinvertidas, como o modo escuro dos apps de e-mail; texto puro só troca a cor.
export function srcdoc(p: Prepared, opts: { dark: boolean; rich: boolean; noLinks?: boolean }): string {
  const invert = opts.dark && opts.rich;
  const text = opts.dark && !invert ? '#f5f5f7' : '#1d1e21';
  const quote = opts.dark && !invert ? '#86868b' : '#5b5b60';
  return `<!doctype html><html><head>${HEAD}
<meta name="color-scheme" content="${opts.dark ? 'dark' : 'light'}">
<style>
  :root{color-scheme:${opts.dark ? 'dark' : 'light'}}
  html,body{margin:0;padding:0;background:transparent}
  body{padding:4px 0 24px;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:${text};word-wrap:break-word;overflow-wrap:anywhere}
  a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px}
  img{max-width:100%;height:auto}
  img:not([src]){display:none}
  table{max-width:100%}
  blockquote{margin:0 0 0 .8ex;border-left:2px solid ${quote};padding-left:1ex;color:${quote}}
  .shalom-text{white-space:pre-wrap}
  ${opts.noLinks ? 'a{pointer-events:none;cursor:default;text-decoration:line-through}' : ''}
  ${invert ? `html{filter:invert(1) hue-rotate(180deg)}
  img,video,picture,svg,canvas,[style*="background-image"],[background]{filter:invert(1) hue-rotate(180deg)}` : ''}
</style></head><body>${p.doc.body.innerHTML}</body></html>`;
}

export function attachmentsOf(email: Email) {
  return email.attachments.filter(a => !(a.contentId && a.disposition === 'inline') && !a.related);
}

// Tipo de imagem pelo começo do arquivo, não pelo que o anexo diz ser: só PNG, JPEG, GIF, WebP e AVIF
// viram prévia (SVG nunca). Devolve null para o resto.
export function imageTypeOf(att: Email['attachments'][number]): string | null {
  if (typeof att.content === 'string') return null;
  const b = (att.content instanceof Uint8Array ? att.content : new Uint8Array(att.content)).subarray(0, 16);
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return 'image/avif';
  return null;
}

// Anexo sempre baixa como arquivo, nunca abre aqui dentro: HTML, SVG ou PDF aberto por blob: rodaria
// com a origem do Shalom.
export function downloadAttachment(att: Email['attachments'][number]) {
  const bytes = typeof att.content === 'string' ? new TextEncoder().encode(att.content) : new Uint8Array(att.content);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = att.filename || 'anexo';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
