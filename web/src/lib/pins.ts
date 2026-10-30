// Chave de cada contato fixada na primeira vez que este aparelho a viu (trust on first use).
// Fica no IndexedDB, separada por conta. Se o servidor um dia entregar outra chave para o mesmo
// endereço, o envio para e mostra as impressões digitais.
const DB = 'shalom-pins';
const STORE = 'pins';

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

// confirmed: a pessoa comparou a impressão digital com o contato por fora do Shalom e marcou como conferida.
type Pin = { pub: string; firstSeen: number; confirmed?: boolean };
export const pinKey = (userId: string, address: string) => `${userId}:${address.toLowerCase()}`;

// Devolve a chave fixada. Na primeira vez, fixa a que veio e devolve ela mesma.
export async function checkPin(userId: string, address: string, pub: string): Promise<string> {
  const key = pinKey(userId, address);
  const pin = await tx<Pin | undefined>('readonly', s => s.get(key));
  if (pin) return pin.pub;
  await tx('readwrite', s => s.put({ pub, firstSeen: Date.now() } satisfies Pin, key));
  return pub;
}

// A pessoa conferiu com o contato e aceitou a chave nova.
export async function trustNewKey(userId: string, address: string, pub: string) {
  await tx('readwrite', s => s.put({ pub, firstSeen: Date.now(), confirmed: true } satisfies Pin, pinKey(userId, address)));
}

export const pinState = (userId: string, address: string) => tx<Pin | undefined>('readonly', s => s.get(pinKey(userId, address)));

// A impressão digital bateu com a do contato: a chave fixada passa a valer como conferida por você.
export async function confirmPin(userId: string, address: string, pub: string) {
  const pin = await pinState(userId, address);
  if (pin && pin.pub !== pub) return false;
  await tx('readwrite', s => s.put({ pub, firstSeen: pin?.firstSeen ?? Date.now(), confirmed: true } satisfies Pin, pinKey(userId, address)));
  return true;
}
