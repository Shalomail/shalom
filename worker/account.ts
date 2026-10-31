// Apagar uma conta de vez: pela própria pessoa (Configurações) ou pela administração (pedido por e-mail ou
// abuso). Sai tudo: a caixa e os corpos no R2, a foto, as caixas de agente dela, as chaves, as sessões, os
// convites e o plano (a assinatura no Stripe é cancelada antes, e se o Stripe falhar nada é apagado).
// O endereço, e os das caixas de agente, ficam em `retired` sem dono: ninguém mais registra o mesmo nome e
// recebe o que os contatos ainda mandarem para ele.
import { cancelSubscription } from './billing';
import { boxOf } from './box';
import type { Env } from './env';
import { canonicalOf, now, tally } from './util';

// Dono de endereço aposentado que não é ninguém: addressTaken() trata como ocupado para todo mundo.
export const NO_OWNER = '!gone';

// O Stripe não cancelou a assinatura: nada foi apagado ainda.
export class CancelFailed extends Error {}

export async function deleteAccount(env: Env, userId: string): Promise<{ address: string; agents: number } | null> {
  const user = await env.DB.prepare('SELECT id, address FROM users WHERE id = ?').bind(userId).first<{ id: string; address: string }>();
  if (!user) return null;
  const agents = (await env.DB.prepare('SELECT id, address FROM users WHERE owner_id = ?').bind(userId).all<{ id: string; address: string }>()).results;
  try { await cancelSubscription(env, userId); } catch (e) { throw new CancelFailed(String((e as Error).message)); }
  for (const a of agents) await boxOf(env, a.id).destroy(a.id);
  await boxOf(env, userId).destroy(userId);
  await env.BLOBS.delete(`avatar/${userId}`);
  const ids = [userId, ...agents.map(a => a.id)];
  const marks = ids.map(() => '?').join(', ');
  const t = now();
  const retire = env.DB.prepare('INSERT INTO retired (canonical, owner_id, at) VALUES (?, ?, ?) ON CONFLICT(canonical) DO UPDATE SET owner_id = excluded.owner_id, at = excluded.at');
  await env.DB.batch([
    ...[user, ...agents].map(u => retire.bind(canonicalOf(u.address), NO_OWNER, t)),
    env.DB.prepare('UPDATE retired SET owner_id = ? WHERE owner_id = ?').bind(NO_OWNER, userId),
    ...['sessions', 'known_devices', 'email_tokens', 'login_tickets', 'api_keys', 'billing', 'cli_logins', 'push_tokens'].map(table =>
      env.DB.prepare(`DELETE FROM ${table} WHERE user_id IN (${marks})`).bind(...ids)),
    env.DB.prepare('DELETE FROM invites WHERE owner_id = ?').bind(userId),
    env.DB.prepare(`DELETE FROM users WHERE id IN (${marks})`).bind(...ids),
  ]);
  await tally(env.DB, 'deleted');
  return { address: user.address, agents: agents.length };
}
