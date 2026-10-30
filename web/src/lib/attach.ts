// Anexos do editor. Foto é refeita no aparelho antes de trancar: no máximo 2560 px no lado maior, em
// WebP (só contas Shalom) ou JPEG (quando vai para fora, que todo leitor de e-mail abre), e sem os
// dados escondidos do arquivo (local, câmera). Se a versão nova sair maior, fica a original. GIF fica
// como está, para não perder a animação. O servidor nunca vê a foto original.
import type { Attachment } from './mime';

export const MAX_TOTAL = 3.5 * 1024 * 1024; // o envio para fora aceita 5 MiB por mensagem, já em base64
export const MAX_FILES = 30;
const SIDE = 2560;
const REDO = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/heic', 'image/heif', 'image/avif']);

export type Pending = { id: string; file: File; inline: boolean; url: string };

export const isImage = (f: File) => f.type.startsWith('image/') && f.type !== 'image/svg+xml';

export function pending(file: File, inline: boolean): Pending {
  return { id: crypto.randomUUID(), file, inline, url: isImage(file) ? URL.createObjectURL(file) : '' };
}

async function redo(file: File, type: 'image/webp' | 'image/jpeg'): Promise<Blob> {
  if (!REDO.has(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    // JPEG não tem transparência: fundo branco no lugar do vazio do PNG.
    if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    // Print de tela (PNG) tem letra miúda: qualidade um pouco maior para não borrar.
    const quality = file.type === 'image/png' ? 0.9 : type === 'image/webp' ? 0.8 : 0.82;
    const out = await canvas.convertToBlob({ type, quality });
    return out.size < file.size || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ? out : file;
  } catch {
    return file;
  }
}

const extFor: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg' };

// Prepara tudo para a mensagem: comprime as fotos e marca as do texto com um cid.
export async function finalize(list: Pending[], external: boolean): Promise<Attachment[]> {
  const target = external ? 'image/jpeg' : 'image/webp';
  return Promise.all(list.map(async p => {
    const blob = isImage(p.file) ? await redo(p.file, target) : p.file;
    const type = blob.type || p.file.type || 'application/octet-stream';
    const renamed = blob !== p.file && extFor[type] ? p.file.name.replace(/\.[^.]+$/, '') + '.' + extFor[type] : p.file.name;
    return { filename: renamed || 'anexo', type, content: new Uint8Array(await blob.arrayBuffer()), cid: p.inline ? `${p.id}@shalomail.com` : undefined };
  }));
}

export const totalSize = (list: Attachment[]) => list.reduce((n, a) => n + a.content.byteLength, 0);
