// Meu perfil: nome, foto e troca de senha, do lado do aparelho.
import { fromB64, toB64 } from '../../../shared/seal';
import { t } from '../i18n';
import { apiMessage } from '../i18n/errors';
import { api, ApiError, authHeaders } from './api';
import { KDF, passwordKeys, sealEnvelope, type Kdf } from './keys';
import type { User } from './session';

export const avatarUrl = (address: string, v?: number | string) => `/api/avatar/${encodeURIComponent(address)}${v ? `?v=${v}` : ''}`;

export async function saveName(name: string): Promise<string> {
  return (await api<{ name: string }>('/profile/name', { body: { name } })).name;
}

// Foto recortada no aparelho (o enquadramento sai do PhotoCrop), reduzida para 256 px e comprimida em
// WebP antes de subir. O servidor só confere tipo e tamanho.
export async function cropAvatar(source: CanvasImageSource, rect: { x: number; y: number; size: number }): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.size, rect.size, 0, 0, 256, 256);
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/webp', 0.86));
  if (!blob) throw new Error(t('err.photo_prepare'));
  return blob;
}

export async function uploadAvatarBlob(blob: Blob): Promise<number> {
  const res = await fetch('/api/profile/avatar', { method: 'POST', headers: { 'content-type': 'image/webp', ...authHeaders() }, body: blob, credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error || 'avatar', data.error ? apiMessage(data.error, data.message) : t('err.photo_save'));
  }
  return (await res.json()).at as number;
}

// Sem enquadramento escolhido: corta o quadrado do centro.
export async function uploadAvatar(file: File): Promise<number> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  return uploadAvatarBlob(await cropAvatar(bitmap, { x: (bitmap.width - side) / 2, y: (bitmap.height - side) / 2, size: side }));
}

export const removeAvatar = () => api('/profile/avatar/delete', { body: {} });

// Troca de senha: prova a atual e tranca a MESMA chave privada com a senha nova. Nenhum e-mail muda.
// factors: o segundo fator ligado (PIN, código ou código de recuperação), que a troca também pede.
export async function changePassword(user: User, secretKey: Uint8Array, current: string, next: string, factors: { pin?: string; code?: string; recovery?: string } = {}) {
  const { salt, kdf } = await api<{ salt: string; kdf: Kdf }>('/auth/salt', { body: { address: user.address } });
  const old = await passwordKeys(current, fromB64(salt), kdf);
  const freshSalt = crypto.getRandomValues(new Uint8Array(16));
  const fresh = await passwordKeys(next, freshSalt, KDF);
  await api('/profile/password', {
    body: {
      oldAuthKey: toB64(old.authKey),
      salt: toB64(freshSalt),
      kdf: KDF,
      authKey: toB64(fresh.authKey),
      envelope: await sealEnvelope(secretKey, fresh.wrapKey),
      ...factors,
    },
  });
}
