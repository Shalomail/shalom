// Guarda a chave privada neste aparelho entre uma visita e outra (só se a pessoa marcar "lembrar").
// Ela fica cifrada por uma CryptoKey não extraível no IndexedDB. Isso NÃO protege contra script
// rodando nesta origem (ele pode pedir para decifrar) nem contra quem copia o perfil do Chrome ou do
// Firefox; protege só contra leitura casual dos arquivos. A proteção forte vem depois, com a chave
// presa ao hardware (WebAuthn PRF). Sair da conta ou sessão encerrada no servidor apaga tudo.
const DB = 'shalom';
const STORE = 'device';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

type Saved = { userId: string; key: CryptoKey; iv: Uint8Array<ArrayBuffer>; blob: ArrayBuffer };

// Uma chave por conta (o navegador pode ter várias abertas). 'key' sozinho é o formato antigo, de uma conta só.
const slotOf = (userId: string) => `key:${userId}`;

export async function rememberKey(userId: string, secretKey: Uint8Array) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const blob = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array(secretKey));
  await tx('readwrite', s => s.put({ userId, key, iv, blob } satisfies Saved, slotOf(userId)));
}

export async function recallKey(userId: string): Promise<Uint8Array | null> {
  try {
    const saved = (await tx<Saved | undefined>('readonly', s => s.get(slotOf(userId)))) ?? (await tx<Saved | undefined>('readonly', s => s.get('key')));
    if (!saved || saved.userId !== userId) return null;
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: saved.iv }, saved.key, saved.blob));
  } catch {
    return null;
  }
}

export async function forgetKey(userId: string) {
  await tx('readwrite', s => s.delete(slotOf(userId))).catch(() => {});
  const legacy = await tx<Saved | undefined>('readonly', s => s.get('key')).catch(() => undefined);
  if (legacy?.userId === userId) await tx('readwrite', s => s.delete('key')).catch(() => {});
}
