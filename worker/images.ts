// Fotos que chegam de fora ficam menores antes de trancar: refeitas em WebP (qualidade 80, lado maior até
// 2560 px) aqui mesmo no Worker, com os codecs do Squoosh em WebAssembly (jSquash). Nada vai para serviço
// de fora; os dados escondidos da foto (local, câmera) somem na recodificação. Só troca quando a versão
// nova sai bem menor; se algo falhar, fica a original. Um limite de tempo segura e-mail com muitas fotos.
import type { Email } from 'postal-mime';
import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode';
import decodePng, { init as initPng } from '@jsquash/png/decode';
import encodeWebp, { init as initWebp } from '@jsquash/webp/encode';
import resize, { initResize } from '@jsquash/resize';
import JPEG_DEC from '../node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
// Estes dois trazem um .wasm.d.ts próprio (sem default); no Worker o import vem compilado mesmo.
// @ts-ignore
import PNG_DEC from '../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import WEBP_ENC from '../node_modules/@jsquash/webp/codec/enc/webp_enc_simd.wasm';
// @ts-ignore
import RESIZE from '../node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm';
import { buildMime, textToHtml, type Attachment } from '../web/src/lib/mime';
import { people } from '../shared/head';

const MIN_BYTES = 200 * 1024;
const MAX_BYTES = 20 * 1024 * 1024;
// O Worker tem 128 MB de memória: decodificar uma foto de 50 MP sozinha passa disso e derruba a entrega.
const MAX_PIXELS = 20_000_000;
const SIDE = 2560;
const BUDGET_MS = 8000;

// O Workers não tem ImageData; os codecs só precisam dos três campos.
if (!('ImageData' in globalThis)) {
  (globalThis as Record<string, unknown>).ImageData = class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  };
}

let ready: Promise<unknown> | null = null;
const boot = () => (ready ??= Promise.all([initJpeg(JPEG_DEC), initPng(PNG_DEC), initWebp(WEBP_ENC), initResize(RESIZE)]));

const bytesOf = (a: Email['attachments'][number]) => (typeof a.content === 'string' ? new TextEncoder().encode(a.content) : new Uint8Array(a.content));

function kind(b: Uint8Array): 'jpeg' | 'png' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}

// Largura e altura lidas do cabeçalho, sem decodificar: PNG no IHDR, JPEG no primeiro marcador SOF.
function sizeOf(b: Uint8Array, k: 'jpeg' | 'png'): { w: number; h: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (k === 'png') return b.length >= 24 ? { w: v.getUint32(16), h: v.getUint32(20) } : null;
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: v.getUint16(i + 5), w: v.getUint16(i + 7) };
    i += 2 + v.getUint16(i + 2);
  }
  return null;
}

async function toWebp(bytes: Uint8Array): Promise<Uint8Array | null> {
  const k = kind(bytes);
  if (!k) return null;
  // Foto grande demais fica como veio, antes de decodificar (decodificada, ela não caberia na memória).
  const dims = sizeOf(bytes, k);
  if (!dims || dims.w * dims.h > MAX_PIXELS) return null;
  const buf = bytes.slice().buffer;
  let img = (k === 'jpeg' ? await decodeJpeg(buf) : await decodePng(buf)) as unknown as Parameters<typeof encodeWebp>[0];
  if (img.width * img.height > MAX_PIXELS) return null;
  const scale = Math.min(1, SIDE / Math.max(img.width, img.height));
  if (scale < 1) img = await resize(img, { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  return new Uint8Array(await encodeWebp(img, { quality: 80 }));
}

// Devolve o e-mail com as fotos grandes trocadas por WebP, ou o original quando não há o que ganhar.
export async function shrinkImages(email: Email, raw: Uint8Array): Promise<Uint8Array> {
  const big = email.attachments.filter(a => {
    const n = typeof a.content === 'string' ? a.content.length : a.content.byteLength;
    return n >= MIN_BYTES && n <= MAX_BYTES && /^image\/(jpe?g|png)$/i.test(a.mimeType || '');
  });
  if (!big.length) return raw;
  const started = Date.now();
  try { await boot(); } catch (e) { console.error('codecs de imagem não carregaram', String(e)); return raw; }

  let changed = false;
  const out: Attachment[] = [];
  for (const a of email.attachments) {
    let content = bytesOf(a);
    let type = a.mimeType || 'application/octet-stream';
    let filename = a.filename || 'anexo';
    if (big.includes(a) && Date.now() - started < BUDGET_MS) {
      try {
        const smaller = await toWebp(content);
        if (smaller && smaller.length < content.length * 0.9) {
          content = smaller;
          type = 'image/webp';
          filename = filename.replace(/\.(jpe?g|png)$/i, '') + '.webp';
          changed = true;
        }
      } catch (e) { console.error('imagem ficou como veio', String(e)); }
    }
    const cid = a.contentId?.replace(/^<|>$/g, '');
    out.push({ filename, type, content, cid: cid && (a.related || a.disposition === 'inline') ? cid : undefined });
  }
  if (!changed) return raw;

  // Remonta a mensagem com o mesmo remetente, destino, assunto, data e fio; o resultado da autenticação
  // já foi lido antes (fica no cabeçalho lacrado).
  const from = people(email.from ? [email.from] : [])[0] ?? { name: '', address: '' };
  return buildMime({
    from, to: people(email.to), cc: people(email.cc), bcc: [],
    subject: email.subject || '', text: email.text || '', html: email.html || textToHtml(email.text || ''),
    messageId: email.messageId || `<${crypto.randomUUID()}@shalomail.com>`,
    inReplyTo: email.inReplyTo, references: email.references,
    date: email.date && !Number.isNaN(Date.parse(email.date)) ? new Date(email.date) : new Date(),
    attachments: out,
  }, false);
}
