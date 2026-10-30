// Meu perfil: nome, foto e troca de senha. A foto é pública para quem tem o endereço (como em todo
// e-mail); o resto continua só da pessoa.
import { Hono, type Context } from 'hono';
import { LOCALES } from '../shared/locales.gen';
import { fromB64 } from '../shared/seal';
import { IDLE_OPTIONS, passwordOk, pinHash, recoveryHash, requireUser } from './auth';
import { CancelFailed, deleteAccount } from './account';
import type { AppEnv } from './env';
import { maskEmail, newEmailToken, sendConfirmRecovery } from './notify';
import { checkTotp, newTotpSecret, totpUri } from './totp';
import { bump, fail, hex, hmac, lockEnvelope, normalizeAddress, now, peek, randomToken, sameBytes, sha256, unlockEnvelope } from './util';

const MAX_AVATAR = 300 * 1024;
const avatarKey = (userId: string) => `avatar/${userId}`;

export const profile = new Hono<AppEnv>();
profile.use('*', requireUser);

profile.post('/name', async c => {
  const { name } = await c.req.json<{ name: string }>();
  const clean = String(name || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
  if (!clean) return fail(c, 400, 'bad_request', 'Escreva um nome.');
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(clean, c.get('user').id).run();
  return c.json({ name: clean });
});

// Foto já chega reduzida e comprimida pelo aparelho (WebP 256 px). Aqui só confere tipo e tamanho.
// Convites: a conta cria quantos quiser, cada um vale um cadastro. O código aparece só na criação; o
// banco guarda o hash. Um freio por hora segura script gerando convites em massa.
profile.get('/invites', async c => {
  const rows = await c.env.DB.prepare('SELECT code_hash, created_at, used_at FROM invites WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50')
    .bind(c.get('user').id).all<{ code_hash: string; created_at: number; used_at: number | null }>();
  return c.json({ invites: rows.results.map(r => ({ id: r.code_hash, createdAt: r.created_at, usedAt: r.used_at })) });
});

profile.post('/invites', async c => {
  const user = c.get('user');
  if ((await bump(c.env.DB, `invite-new:${user.id}`, 3600 * 1000)) > 30) return fail(c, 429, 'too_many', 'Muitos convites seguidos. Tente de novo em uma hora.');
  const code = randomToken(18);
  const id = await sha256(code);
  const t = now();
  await c.env.DB.prepare('INSERT INTO invites (code_hash, owner_id, created_at) VALUES (?, ?, ?)').bind(id, user.id, t).run();
  return c.json({ code, id, createdAt: t });
});

profile.post('/invites/revoke', async c => {
  const { id } = await c.req.json<{ id: string }>();
  await c.env.DB.prepare('DELETE FROM invites WHERE code_hash = ? AND owner_id = ? AND used_at IS NULL').bind(String(id || ''), c.get('user').id).run();
  return c.json({ ok: true });
});

// Idioma da conta, trocado nas Configurações: os e-mails do sistema passam a sair nele.
profile.post('/lang', async c => {
  const { lang } = await c.req.json<{ lang: string }>();
  if (typeof lang !== 'string' || !LOCALES.includes(lang)) return fail(c, 400, 'bad_lang', 'Idioma desconhecido.');
  await c.env.DB.prepare('UPDATE users SET lang = ? WHERE id = ?').bind(lang, c.get('user').id).run();
  return c.json({ lang });
});

profile.post('/avatar', async c => {
  const type = c.req.header('content-type') || '';
  if (!/^image\/(webp|jpeg|png)$/.test(type)) return fail(c, 400, 'bad_type', 'Envie uma imagem.');
  const body = new Uint8Array(await c.req.arrayBuffer());
  if (!body.length || body.length > MAX_AVATAR) return fail(c, 413, 'too_big', 'Foto grande demais.');
  await c.env.BLOBS.put(avatarKey(c.get('user').id), body, { httpMetadata: { contentType: type } });
  return c.json({ ok: true, at: Date.now() });
});

profile.post('/avatar/delete', async c => {
  await c.env.BLOBS.delete(avatarKey(c.get('user').id));
  return c.json({ ok: true });
});

// Troca de senha: o aparelho prova a senha atual (authKey antiga) e manda o envelope novo, com a mesma
// chave privada trancada pela senha nova. Nenhum e-mail precisa ser recriptografado. As outras sessões caem.
profile.post('/password', async c => {
  const user = c.get('user');
  const body = await c.req.json<{ oldAuthKey: string; salt: string; kdf: unknown; authKey: string; envelope: string }>();
  if ((await peek(c.env.DB, `password:${user.id}`)) >= 10) return fail(c, 429, 'too_many', 'Muitas tentativas. Tente de novo em uma hora.');
  const row = await c.env.DB.prepare('SELECT auth_hash FROM users WHERE id = ?').bind(user.id).first<{ auth_hash: string }>();
  let oldKey: Uint8Array, newKey: Uint8Array, salt: Uint8Array, envelope: Uint8Array;
  try {
    oldKey = fromB64(body.oldAuthKey); newKey = fromB64(body.authKey); salt = fromB64(body.salt); envelope = fromB64(body.envelope);
  } catch { return fail(c, 400, 'bad_request', 'Dados inválidos.'); }
  if (oldKey.length !== 32 || newKey.length !== 32 || salt.length !== 16 || envelope.length !== 60) return fail(c, 400, 'bad_request', 'Dados inválidos.');
  const k = body.kdf as { alg: string; m: number; t: number; p: number };
  if (!k || k.alg !== 'argon2id' || k.m < 65536 || k.m > 1048576 || k.t < 3 || k.t > 20 || k.p < 1 || k.p > 8) return fail(c, 400, 'bad_request', 'Parâmetros de senha inválidos.');
  const given = hex(await hmac(c.env.AUTH_PEPPER, oldKey));
  if (!row || !sameBytes(new TextEncoder().encode(given), new TextEncoder().encode(row.auth_hash))) {
    await bump(c.env.DB, `password:${user.id}`, 3600 * 1000);
    return fail(c, 401, 'wrong', 'A senha atual não confere.');
  }
  const current = c.get('session');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET auth_hash = ?, salt = ?, kdf = ?, envelope = ? WHERE id = ?')
      .bind(hex(await hmac(c.env.AUTH_PEPPER, newKey)), body.salt, JSON.stringify(k), await lockEnvelope(c.env, user.id, body.envelope), user.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, current),
  ]);
  return c.json({ ok: true });
});

// Segurança da conta: inatividade, PIN e duas etapas. Ligar ou desligar PIN e duas etapas pede a senha.
profile.get('/security', async c => {
  const row = await c.env.DB.prepare('SELECT idle_minutes, pin_hash, totp_on, recovery FROM users WHERE id = ?').bind(c.get('user').id)
    .first<{ idle_minutes: number; pin_hash: string | null; totp_on: number; recovery: string | null }>();
  return c.json({ idle: row?.idle_minutes ?? 43200, pin: !!row?.pin_hash, totp: !!row?.totp_on, recoveryLeft: row?.totp_on ? JSON.parse(row.recovery || '[]').length : 0 });
});

profile.post('/idle', async c => {
  const { minutes } = await c.req.json<{ minutes: number }>();
  if (!IDLE_OPTIONS.includes(minutes)) return fail(c, 400, 'bad_request', 'Tempo inválido.');
  // A sessão que fez o pedido está em uso agora: sem isso, um tempo menor que o último registro de uso
  // derrubaria a própria pessoa no pedido seguinte.
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET idle_minutes = ? WHERE id = ?').bind(minutes, c.get('user').id),
    c.env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').bind(now(), c.get('session')),
  ]);
  return c.json({ idle: minutes });
});

profile.post('/pin', async c => {
  const body = await c.req.json<{ authKey: string; pin: string }>();
  if (typeof body.pin !== 'string' || !/^\d{6}$/.test(body.pin)) return fail(c, 400, 'bad_request', 'O PIN tem 6 números.');
  const denied = await passwordOk(c, body.authKey);
  if (denied) return denied;
  const id = c.get('user').id;
  await c.env.DB.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').bind(await pinHash(c.env, id, body.pin), id).run();
  return c.json({ pin: true });
});

profile.post('/pin/delete', async c => {
  const denied = await passwordOk(c, (await c.req.json<{ authKey: string }>()).authKey);
  if (denied) return denied;
  await c.env.DB.prepare('UPDATE users SET pin_hash = NULL WHERE id = ?').bind(c.get('user').id).run();
  return c.json({ pin: false });
});

// Dez códigos de uso único para entrar sem o celular. Só aparecem uma vez, na hora de criar.
async function newRecovery(c: Context<AppEnv>, userId: string) {
  const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes = Array.from({ length: 10 }, () => {
    const r = crypto.getRandomValues(new Uint8Array(8));
    const s = Array.from(r, b => ABC[b % ABC.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  const hashes = await Promise.all(codes.map(code => recoveryHash(c.env, userId, code)));
  return { codes, stored: JSON.stringify(hashes) };
}

profile.post('/totp/start', async c => {
  const denied = await passwordOk(c, (await c.req.json<{ authKey: string }>()).authKey);
  if (denied) return denied;
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT totp_on FROM users WHERE id = ?').bind(user.id).first<{ totp_on: number }>();
  if (row?.totp_on) return fail(c, 409, 'already', 'A verificação em duas etapas já está ligada.');
  const secret = newTotpSecret();
  await c.env.DB.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').bind(await lockEnvelope(c.env, `totp:${user.id}`, secret), user.id).run();
  return c.json({ secret, uri: totpUri(secret, user.address) });
});

profile.post('/totp/enable', async c => {
  const { code } = await c.req.json<{ code: string }>();
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT totp_secret, totp_on FROM users WHERE id = ?').bind(user.id).first<{ totp_secret: string | null; totp_on: number }>();
  if (!row?.totp_secret || row.totp_on) return fail(c, 409, 'state', 'Comece a configuração de novo.');
  if ((await bump(c.env.DB, `totp-setup:${user.id}`, 3600 * 1000)) > 20) return fail(c, 429, 'too_many', 'Muitas tentativas. Tente de novo em uma hora.');
  const step = await checkTotp(await unlockEnvelope(c.env, `totp:${user.id}`, row.totp_secret), String(code || ''), 0);
  if (step === null) return fail(c, 401, 'wrong', 'Código errado. Confira o horário do celular e tente o código novo.');
  const { codes, stored } = await newRecovery(c, user.id);
  await c.env.DB.prepare('UPDATE users SET totp_on = 1, totp_step = ?, recovery = ? WHERE id = ?').bind(step, stored, user.id).run();
  return c.json({ totp: true, codes });
});

profile.post('/totp/recovery', async c => {
  const denied = await passwordOk(c, (await c.req.json<{ authKey: string }>()).authKey);
  if (denied) return denied;
  const user = c.get('user');
  const { codes, stored } = await newRecovery(c, user.id);
  const r = await c.env.DB.prepare('UPDATE users SET recovery = ? WHERE id = ? AND totp_on = 1').bind(stored, user.id).run();
  if (!r.meta.changes) return fail(c, 409, 'state', 'A verificação em duas etapas está desligada.');
  return c.json({ codes });
});

profile.post('/totp/disable', async c => {
  const denied = await passwordOk(c, (await c.req.json<{ authKey: string }>()).authKey);
  if (denied) return denied;
  await c.env.DB.prepare('UPDATE users SET totp_secret = NULL, totp_on = 0, totp_step = 0, recovery = NULL WHERE id = ?').bind(c.get('user').id).run();
  return c.json({ totp: false });
});

// E-mail de recuperação: obrigatório, de fora do Shalom. Guardado trancado; a tela só vê a versão
// mascarada. Trocar o e-mail volta para "não confirmado" e manda um link novo.
profile.get('/recovery', async c => {
  const row = await c.env.DB.prepare('SELECT recovery_hint, recovery_verified FROM users WHERE id = ?').bind(c.get('user').id)
    .first<{ recovery_hint: string | null; recovery_verified: number }>();
  return c.json({ hint: row?.recovery_hint ?? null, verified: !!row?.recovery_verified });
});

profile.post('/recovery', async c => {
  const user = c.get('user');
  const body = await c.req.json<{ email: string; authKey?: string }>();
  const email = String(body.email || '').trim().toLowerCase();
  // Trocar o e-mail de recuperação é o caminho para tomar a conta: pede a senha. Só o primeiro, na
  // sessão que acabou de entrar (até 15 minutos), vai sem ela, para a pergunta logo depois do cadastro.
  const current = await c.env.DB.prepare('SELECT u.recovery_email, u.lang, s.created_at FROM users u JOIN sessions s ON s.user_id = u.id WHERE u.id = ? AND s.token_hash = ?')
    .bind(user.id, c.get('session')).first<{ recovery_email: string | null; lang: string; created_at: number }>();
  const firstAndFresh = !!current && !current.recovery_email && now() - current.created_at < 15 * 60 * 1000;
  if (!firstAndFresh) {
    const denied = await passwordOk(c, body.authKey);
    if (denied) return denied;
  }
  if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(c, 400, 'bad_email', 'Esse e-mail não parece certo.');
  if (email.endsWith(`@${c.env.MAIL_DOMAIN}`)) return fail(c, 400, 'own_domain', 'Use um e-mail de fora do Shalom: é por ele que você volta se não conseguir entrar aqui.');
  if ((await bump(c.env.DB, `recovery-set:${user.id}`, 3600 * 1000)) > 5) return fail(c, 429, 'too_many', 'Muitas trocas seguidas. Tente de novo em uma hora.');
  const hint = maskEmail(email);
  await c.env.DB.prepare('UPDATE users SET recovery_email = ?, recovery_hint = ?, recovery_verified = 0 WHERE id = ?')
    .bind(await lockEnvelope(c.env, `rec-email:${user.id}`, email), hint, user.id).run();
  const token = await newEmailToken(c.env, user.id, 'verify');
  let sent = true;
  try { await sendConfirmRecovery(c.env, email, user.address, token, current?.lang ?? 'pt'); } catch (e) { sent = false; console.error('confirmação falhou', String(e)); }
  return c.json({ hint, verified: false, sent });
});

profile.post('/recovery/resend', async c => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT recovery_email, recovery_verified, lang FROM users WHERE id = ?').bind(user.id).first<{ recovery_email: string | null; recovery_verified: number; lang: string }>();
  if (!row?.recovery_email) return fail(c, 400, 'none', 'Escolha um e-mail de recuperação primeiro.');
  if (row.recovery_verified) return c.json({ verified: true });
  if ((await bump(c.env.DB, `recovery-set:${user.id}`, 3600 * 1000)) > 5) return fail(c, 429, 'too_many', 'Muitos envios seguidos. Tente de novo em uma hora.');
  const token = await newEmailToken(c.env, user.id, 'verify');
  const to = await unlockEnvelope(c.env, `rec-email:${user.id}`, row.recovery_email);
  // Espera o envio: a tela só diz "Reenviado" se o link saiu de verdade.
  let sent = true;
  try { await sendConfirmRecovery(c.env, to, user.address, token, row.lang); } catch (e) { sent = false; console.error('reenvio falhou', String(e)); }
  return c.json({ verified: false, sent });
});

// Foto de qualquer conta Shalom, sem login (quem procura não fica sabido).
export async function avatarOf(c: Context<AppEnv>) {
  const full = normalizeAddress(c.env, decodeURIComponent(c.req.path.split('/').pop() || ''));
  const row = full ? await c.env.DB.prepare('SELECT id FROM users WHERE address = ?').bind(full).first<{ id: string }>() : null;
  const obj = row ? await c.env.BLOBS.get(avatarKey(row.id)) : null;
  // Sem foto: 204, não 404, para o navegador não acusar erro a cada remetente sem foto.
  if (!obj) return c.body(null, 204, { 'cache-control': 'public, max-age=300' });
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/webp', 'cache-control': 'public, max-age=300' } });
}

// Apagar a conta de vez, pela própria pessoa: pede a senha e o endereço digitado, para não sair por um
// clique sem querer nem por quem achar um aparelho aberto. O que sai está em worker/account.ts.
profile.post('/delete', async c => {
  const user = c.get('user');
  const body = await c.req.json<{ authKey?: string; confirm?: string }>().catch(() => ({} as { authKey?: string; confirm?: string }));
  const refused = await passwordOk(c, body.authKey);
  if (refused) return refused;
  if (String(body.confirm ?? '').trim().toLowerCase() !== user.address) return fail(c, 400, 'confirm', 'Digite o seu endereço para confirmar.');
  try { await deleteAccount(c.env, user.id); } catch (e) {
    if (!(e instanceof CancelFailed)) throw e;
    return fail(c, 502, 'stripe_error', 'Não conseguimos cancelar a assinatura agora, então nada foi apagado. Tente de novo em instantes.');
  }
  return c.json({ ok: true });
});
