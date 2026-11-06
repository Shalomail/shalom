// Filtro de spam no aparelho (shared/spam.ts). O servidor só separa na chegada o que não pede ler o texto; o
// resto é conferido aqui, com o texto aberto só neste aparelho. Cada e-mail de fora que chega na Entrada é
// conferido uma vez, por qualquer aparelho da conta: a marca de conferido fica no servidor e não diz nada do
// conteúdo. Quem a pessoa tirou do Spam com "Não é spam" (e veio com o domínio confirmando o remetente) não é
// mais conferido neste navegador; a lista guarda só uma impressão de cada endereço, feita com a chave da conta.
import { contentScore, SPAM_THRESHOLD } from '../../../shared/spam';
import { toB64 } from '../../../shared/seal';
import { readMessage, updateMessages, type Item } from './mailbox';

// Corpo acima disso não é baixado só para conferir: vale o assunto e a prévia.
const BODY_MAX = 4 * 1024 * 1024;
const running = new Set<string>();
const okKey = (me: string) => `shalom:spam-ok:${me}`;
// Conferência que começou e não terminou (aba fechada no meio): a próxima não abre o corpo dela de novo.
const busyKey = (me: string) => `shalom:spam-busy:${me}`;

let mac: { secret: Uint8Array; key: CryptoKey } | null = null;
async function macKey(secret: Uint8Array) {
  if (mac?.secret !== secret) {
    const seed = new Uint8Array([...new TextEncoder().encode('shalom-spam-ok'), ...secret]);
    const raw = await crypto.subtle.digest('SHA-256', seed);
    mac = { secret, key: await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) };
  }
  return mac.key;
}
const tagOf = async (key: CryptoKey, address: string) =>
  toB64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address.toLowerCase())))).slice(0, 22);

function trusted(me: string): string[] {
  try { return JSON.parse(localStorage.getItem(okKey(me)) || '[]') as string[]; } catch { return []; }
}

// Só "Não é spam" (do Spam para a Entrada) e só remetente que o domínio confirmou (DMARC aprovado).
export async function trustSenders(me: string, secret: Uint8Array | null, items: Item[]) {
  const from = items.filter(i => i.folder === 'spam' && !i.spoofed && i.h.auth === 'pass').map(i => i.h.from?.address ?? '').filter(Boolean);
  if (!me || !secret || !from.length) return;
  const key = await macKey(secret);
  const tags = await Promise.all(from.map(a => tagOf(key, a)));
  const list = [...new Set([...tags, ...trusted(me)])].slice(0, 500);
  try { localStorage.setItem(okKey(me), JSON.stringify(list)); } catch { /* cheio ou bloqueado: só não lembra */ }
}

export async function checkSpam(items: Item[], secret: Uint8Array, me: string) {
  const todo = items.filter(i => i.checked === 0 && i.folder === 'inbox' && !i.sealedEnd && !running.has(i.id));
  if (!todo.length) return;
  for (const i of todo) running.add(i.id);
  const key = await macKey(secret);
  const ok = new Set(trusted(me));
  const stuck = localStorage.getItem(busyKey(me));
  const spam: string[] = [];
  const clean: string[] = [];
  try {
    for (const i of todo) {
      // Uma de cada vez, devolvendo a vez à tela entre elas.
      await new Promise(r => setTimeout(r, 0));
      const from = i.h.from?.address?.toLowerCase() ?? '';
      if (from && i.h.auth === 'pass' && ok.has(await tagOf(key, from))) { clean.push(i.id); continue; }
      try {
        let score = contentScore({ subject: i.h.subject, text: i.h.snippet, from }).score;
        if (score < SPAM_THRESHOLD && i.size <= BODY_MAX && stuck !== i.id) {
          // A marca cobre só abrir e conferir, não o download (download lento não é conferência travada).
          const email = await readMessage(i.id, secret, i, false, () => localStorage.setItem(busyKey(me), i.id));
          score = contentScore({ subject: email.subject ?? i.h.subject, text: email.text, html: email.html, from }).score;
          localStorage.removeItem(busyKey(me));
        }
        (score >= SPAM_THRESHOLD ? spam : clean).push(i.id);
      } catch {
        // Não abriu (corpo corrompido ou fora do lugar): fica como está, sem conferir de novo a cada lista.
        localStorage.removeItem(busyKey(me));
        clean.push(i.id);
      }
    }
    if (spam.length) await updateMessages(spam, { folder: 'spam' });
    if (clean.length) await updateMessages(clean, { checked: true });
  } catch { /* sem rede: a próxima lista tenta de novo */ } finally {
    for (const i of todo) running.delete(i.id);
  }
}
