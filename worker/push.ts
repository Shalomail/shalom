// Aviso de mensagem nova no iPhone, pelo APNs da Apple. Sem conteúdo nenhum: nem remetente, nem assunto,
// só "Mensagem nova" no idioma da conta e o número de não lidas da Entrada (a Apple vê que houve um aviso,
// e quando). Assinado com a chave de APNs do time (APNS_KEY, .p8), token JWT ES256 renovado a cada 50 minutos.
import { Hono } from 'hono';
import { requireUser } from './auth';
import { boxOf } from './box';
import type { AppEnv, Env } from './env';
import { bump, fail, now } from './util';

const TOPIC = 'com.shalomail.app';
const TEXT: Record<string, string> = {
  pt: 'Mensagem nova', en: 'New message', es: 'Mensaje nuevo', fr: 'Nouveau message', de: 'Neue Nachricht', it: 'Nuovo messaggio',
  ru: 'Новое сообщение', uk: 'Нове повідомлення', tr: 'Yeni ileti', he: 'הודעה חדשה', ar: 'رسالة جديدة', hi: 'नया संदेश',
  zh: '新邮件', ja: '新着メッセージ', ko: '새 메시지',
};

export const push = new Hono<AppEnv>();
push.use('*', requireUser);

// O app manda o token do aparelho depois de entrar (e a cada abertura, porque a Apple pode trocar).
push.post('/register', async c => {
  if (c.get('apiKey')) return fail(c, 403, 'key_scope', 'Só pelo app.');
  const { token, env } = await c.req.json<{ token?: string; env?: string }>().catch(() => ({} as { token?: string; env?: string }));
  if (typeof token !== 'string' || !/^[0-9a-f]{64,200}$/.test(token) || (env !== 'sandbox' && env !== 'production')) return fail(c, 400, 'bad_request', 'Aparelho inválido.');
  // Um aparelho com várias contas tem uma linha por conta: registrar numa não tira o aparelho de outra
  // (antes, outra conta que soubesse o token o tomava para si).
  await c.env.DB.prepare(`INSERT INTO push_tokens (token, user_id, session, env, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(token, user_id) DO UPDATE SET session = excluded.session, env = excluded.env, created_at = excluded.created_at`)
    .bind(token, c.get('user').id, c.get('session'), env, now()).run();
  return c.json({ ok: true });
});

push.post('/unregister', async c => {
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({} as { token?: string }));
  await c.env.DB.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?').bind(String(token ?? ''), c.get('user').id).run();
  return c.json({ ok: true });
});

let jwt: { value: string; at: number } | null = null;

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function token(env: Env): Promise<string | null> {
  if (!env.APNS_KEY || !env.APNS_KEY_ID || !env.APNS_TEAM) return null;
  if (jwt && Date.now() - jwt.at < 50 * 60 * 1000) return jwt.value;
  const pem = env.APNS_KEY.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), ch => ch.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({ iss: env.APNS_TEAM, iat: Math.floor(Date.now() / 1000) })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${claims}`));
  jwt = { value: `${head}.${claims}.${b64url(sig)}`, at: Date.now() };
  return jwt.value;
}

// Chamado quando chega mensagem na Entrada. Vários e-mails seguidos viram um aviso só (um a cada 20 s).
export async function notifyNewMail(env: Env, userId: string): Promise<void> {
  // Só aparelhos com a sessão ainda aberta: desconectado por outro aparelho, para de receber na hora.
  const rows = (await env.DB.prepare(`SELECT p.token, p.env FROM push_tokens p JOIN sessions s ON s.token_hash = p.session
    WHERE p.user_id = ? AND s.expires_at > ?`).bind(userId, now()).all<{ token: string; env: string }>()).results;
  if (!rows.length) return;
  if ((await bump(env.DB, `push:${userId}`, 20_000)) > 1) return;
  const bearer = await token(env);
  if (!bearer) return;
  const lang = (await env.DB.prepare('SELECT lang FROM users WHERE id = ?').bind(userId).first<string>('lang')) ?? 'en';
  const badge = (await boxOf(env, userId).counts()).inbox ?? 0;
  const payload = JSON.stringify({ aps: { alert: { body: TEXT[lang] ?? TEXT.en }, sound: 'default', badge, 'thread-id': 'inbox' } });
  await Promise.all(rows.map(async r => {
    // APNS_TEST_HOST só existe no .dev.vars: uma Apple de mentira em 127.0.0.1 para o teste local.
    const base = env.APNS_TEST_HOST?.startsWith('http://127.0.0.1:') ? env.APNS_TEST_HOST
      : r.env === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    try {
      const res = await fetch(`${base}/3/device/${r.token}`, {
        method: 'POST',
        headers: { authorization: `bearer ${bearer}`, 'apns-topic': TOPIC, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-collapse-id': 'new-mail', 'content-type': 'application/json' },
        body: payload,
      });
      // Aparelho que não existe mais (app apagado, token trocado): sai da lista.
      if (res.status === 410 || res.status === 400) {
        const why = await res.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
        if (res.status === 410 || why.reason === 'BadDeviceToken' || why.reason === 'DeviceTokenNotForTopic') {
          await env.DB.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?').bind(r.token, userId).run();
        }
      } else if (!res.ok) console.error('apns', res.status, await res.text().catch(() => ''));
    } catch (e) { console.error('apns', String(e)); }
  }));
}
