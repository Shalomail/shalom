// Contas abertas neste navegador, cada uma numa vaga com o próprio cookie de sessão no servidor.
// Aqui fica só o que a troca de conta mostra (endereço e nome); as chaves ficam no cofre (device.ts).
import { currentSlot } from './api';

export type Account = { slot: number; id: string; address: string; name: string };
const KEY = 'shalom-accounts';
export const MAX_ACCOUNTS = 5;

export function accounts(): Account[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function save(list: Account[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.sort((a, b) => a.slot - b.slot))); } catch { /* sem armazenamento */ }
}

export function keepAccount(slot: number, user: { id: string; address: string; name: string }) {
  save([...accounts().filter(a => a.slot !== slot && a.id !== user.id), { slot, id: user.id, address: user.address, name: user.name }]);
}

export function dropAccount(slot: number) {
  save(accounts().filter(a => a.slot !== slot));
}

export const currentAccount = () => accounts().find(a => a.slot === currentSlot()) ?? null;

export function freeSlot(): number | null {
  const used = new Set(accounts().map(a => a.slot));
  for (let i = 0; i < MAX_ACCOUNTS; i++) if (!used.has(i)) return i;
  return null;
}
