import { Hono } from 'hono';
import PostalMime from 'postal-mime';
import { headOf } from '../shared/head';
import { SPAM_THRESHOLD, spamScore } from '../shared/spam';
import { pack } from '../shared/pack';
import { fromB64, seal, sealJson, toB64 } from '../shared/seal';
import { requireUser } from './auth';
import { shrinkImages } from './images';
import { boxOf, FOLDERS, MAX_IDS, type Change, type Folder, type Row, type StorageSort } from './box';
import type { AppEnv, Env } from './env';
import { b64ToBig, bigToB64, modLen, signBlinded } from '../shared/blind';
import { signCert } from '../shared/sender';
import { loadKeys } from './keys';
import { bump, fail, isEmail, now, peek, sendCaps, sendsKey, tally } from './util';

const MAX_RAW = 15 * 1024 * 1024;
const MAX_SEND_BODY = 12 * 1024 * 1024;
const MAX_RECIPIENTS = 50;
// Base64 de um corpo lacrado de até 15 MB (+ 61 bytes do lacre) e de um cabeçalho de até 64 KB.
const MAX_RAW_B64 = Math.ceil((MAX_RAW + 61) / 3) * 4;
const MAX_HEAD_B64 = Math.ceil((64 * 1024) / 3) * 4;
const oneLine = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').slice(0, 1000);
const sealedOk = (x: Partial<{ head: string; raw: string }> | undefined) =>
  !!x && typeof x.head === 'string' && typeof x.raw === 'string' && x.head.length <= MAX_HEAD_B64 && x.raw.length <= MAX_RAW_B64;
const DAY = 24 * 3600 * 1000;
// Destinatários fora do Shalom por dia. Conta com menos de 7 dias envia pouco: cadastro em massa
// para spam não compensa, e cada envio para fora é cobrado.
const EXTERNAL_PER_DAY = 100;
const EXTERNAL_PER_DAY_NEW = 20;
// Entregas para outras contas Shalom por dia (cada uma ocupa espaço no R2 de quem recebe).
const INTERNAL_PER_DAY = 500;
const INTERNAL_PER_DAY_NEW = 100;

const blobKey = (userId: string, id: string) => `m/${userId}/${id}`;

// Grava o corpo no R2 e a linha na caixa. Se a caixa estiver cheia, desfaz o R2.
async function store(env: Env, userId: string, folder: Folder, raw: Uint8Array, head: Uint8Array, opts: { seen?: boolean; sender?: string | null } = {}) {
  const id = crypto.randomUUID();
  await env.BLOBS.put(blobKey(userId, id), raw);
  const ok = await boxOf(env, userId).add({ id, folder, seen: !!opts.seen, size: raw.length, sender: opts.sender ?? null, head });
  if (!ok) {
    await env.BLOBS.delete(blobKey(userId, id));
    return null;
  }
  return id;
}

// Chegada de e-mail de fora (Email Routing → este Worker). O texto aberto só existe aqui, em memória,
// durante o lacre. O que vai para a caixa e o R2 já sai trancado com a chave pública do dono.
// Endereços da equipe não são contas: o que chega neles vai encaminhado para o e-mail da operação
// (FORWARD_TO, um destino confirmado no Email Routing da conta Cloudflare). contato@ e privacidade@
// aparecem no site; abuse@ e postmaster@ são os que todo provedor de e-mail precisa atender; security@ é o
// do security.txt; shalom@ é o contato das contas do serviço (GitHub e afins).
const TEAM = new Set(['contato', 'contact', 'privacidade', 'privacy', 'dpo', 'abuse', 'postmaster', 'security', 'shalom']);

export async function receiveEmail(message: ForwardableEmailMessage, env: Env) {
  const to = message.to.toLowerCase();
  const [local, domain] = to.split('@');
  if (domain === env.MAIL_DOMAIN && TEAM.has(local.split('+')[0]) && env.FORWARD_TO) {
    try {
      await message.forward(env.FORWARD_TO);
    } catch (e) {
      console.error('encaminhamento da equipe falhou', String(e));
      message.setReject('Endereço indisponível no momento');
    }
    return;
  }
  const user = to.endsWith(`@${env.MAIL_DOMAIN}`)
    ? await env.DB.prepare('SELECT id, public_key FROM users WHERE address = ?').bind(to).first<{ id: string; public_key: string }>()
    : null;
  if (!user) return message.setReject('Endereço não existe');
  if (message.rawSize > MAX_RAW) return message.setReject('Mensagem maior que 15 MB');
  if (!(await boxOf(env, user.id).fits(message.rawSize))) return message.setReject('Caixa de entrada cheia');

  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const email = await PostalMime.parse(raw);
  const pub = fromB64(user.public_key);
  const plainHead = headOf(email, false, new Date());
  // Spam decidido agora, com o texto aberto em memória; só a pasta fica registrada.
  const folder = spamScore(email, plainHead, env.MAIL_DOMAIN).score >= SPAM_THRESHOLD ? 'spam' : 'inbox';
  const head = await sealJson(pub, plainHead);
  // Fotos grandes ficam menores (images.ts) antes de trancar.
  const stored = await shrinkImages(email, raw);
  const sealedRaw = await seal(pub, await pack(stored), 'raw');
  if (!(await store(env, user.id, folder, sealedRaw, head))) return message.setReject('Caixa de entrada cheia');
  await tally(env.DB, folder === 'spam' ? 'received_spam' : 'received');
}

export const mail = new Hono<AppEnv>();
mail.use('*', requireUser);

// Caixa ao vivo (box.ts). Só abre vindo do próprio app: o navegador sempre manda a origem num
// WebSocket, e outro site não pode abrir esta conexão com o cookie de quem visita.
mail.get('/live', async c => {
  if (c.req.header('upgrade') !== 'websocket') return fail(c, 400, 'bad_request', 'Use WebSocket.');
  if (c.req.header('origin') !== c.env.APP_ORIGIN) return fail(c, 403, 'csrf', 'Pedido recusado.');
  const res = await boxOf(c.env, c.get('user').id).fetch(c.req.raw);
  return new Response(null, { status: res.status, webSocket: res.webSocket });
});

const toJson = (r: Row) => ({ ...r, head: toB64(new Uint8Array(r.head)) });

mail.get('/messages', async c => {
  const folder = (c.req.query('folder') || 'inbox') as Folder | 'starred';
  if (folder !== 'starred' && !FOLDERS.has(folder)) return fail(c, 400, 'bad_folder', 'Pasta desconhecida.');
  const before = Number(c.req.query('before')) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 100);
  const { rows, more, counts } = await boxOf(c.env, c.get('user').id).list(folder, before, limit);
  return c.json({ messages: rows.map(toJson), more, counts });
});

mail.get('/messages/counts', async c => c.json(await boxOf(c.env, c.get('user').id).counts()));

mail.get('/usage', async c => c.json(await boxOf(c.env, c.get('user').id).usage()));

// Uma linha pelo id, em qualquer pasta (o CLI abre mensagem antiga sem varrer a pasta inteira).
mail.get('/messages/:id', async c => {
  const id = c.req.param('id');
  if (!/^[\w-]{1,64}$/.test(id)) return fail(c, 404, 'not_found', 'Mensagem não encontrada.');
  const row = await boxOf(c.env, c.get('user').id).one(id);
  return row ? c.json({ message: toJson(row) }) : fail(c, 404, 'not_found', 'Mensagem não encontrada.');
});

// O corpo lacrado. A chave do R2 já leva o id da conta, então só o dono alcança o objeto.
// Ele nunca muda: o navegador pode guardar em cache para sempre.
mail.get('/messages/:id/raw', async c => {
  const id = c.req.param('id');
  if (!/^[\w-]{1,64}$/.test(id)) return fail(c, 404, 'not_found', 'Mensagem não encontrada.');
  const obj = await c.env.BLOBS.get(blobKey(c.get('user').id, id));
  if (!obj) return fail(c, 404, 'not_found', 'Mensagem não encontrada.');
  return new Response(obj.body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable' } });
});

function idList(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
  return ids.every(x => typeof x === 'string' && x.length <= 64) ? ids as string[] : null;
}

mail.post('/messages/update', async c => {
  const body = await c.req.json<{ ids: unknown } & Change>();
  const ids = idList(body.ids);
  if (!ids) return fail(c, 400, 'bad_request', `Selecione de 1 a ${MAX_IDS} mensagens.`);
  const change: Change = {};
  if (typeof body.seen === 'boolean') change.seen = body.seen;
  if (typeof body.starred === 'boolean') change.starred = body.starred;
  if (typeof body.pinned === 'boolean') change.pinned = body.pinned;
  if (body.folder !== undefined) {
    // Rascunho só nasce pelo /drafts (lacrado no aparelho); nada é movido para lá.
    if (!FOLDERS.has(body.folder) || body.folder === 'drafts') return fail(c, 400, 'bad_folder', 'Pasta desconhecida.');
    change.folder = body.folder;
  }
  if (!Object.keys(change).length) return fail(c, 400, 'bad_request', 'Nada para mudar.');
  return c.json({ counts: await boxOf(c.env, c.get('user').id).update(ids, change) });
});

// Apagar de vez só vale para o que já está na lixeira ou no spam.
mail.post('/messages/delete', async c => {
  const user = c.get('user');
  const ids = idList((await c.req.json<{ ids: unknown }>()).ids);
  if (!ids) return fail(c, 400, 'bad_request', `Selecione de 1 a ${MAX_IDS} mensagens.`);
  const gone = await boxOf(c.env, user.id).removeFromTrash(ids);
  if (gone.length) await c.env.BLOBS.delete(gone.map(id => blobKey(user.id, id)));
  return c.json({ deleted: gone.length });
});

// Rascunhos: o aparelho lacra a mensagem com a própria chave (como a cópia de Enviados) e manda aqui a
// cada pausa da escrita. A versão nova entra e a anterior (replace) sai, então só existe uma por e-mail.
mail.post('/drafts', async c => {
  const user = c.get('user');
  const body = await c.req.json<{ replace?: string; head: string; raw: string }>();
  if (!sealedOk(body)) return fail(c, 400, 'bad_request', 'Rascunho grande demais.');
  const id = await store(c.env, user.id, 'drafts', fromB64(body.raw), fromB64(body.head), { seen: true });
  if (!id) return fail(c, 413, 'full', 'Sua caixa está cheia. Apague mensagens para salvar o rascunho.');
  if (typeof body.replace === 'string' && body.replace.length <= 64) {
    const gone = await boxOf(c.env, user.id).removeDrafts([body.replace]);
    if (gone.length) await c.env.BLOBS.delete(gone.map(g => blobKey(user.id, g)));
  }
  return c.json({ id });
});

mail.post('/drafts/delete', async c => {
  const user = c.get('user');
  const ids = idList((await c.req.json<{ ids: unknown }>()).ids);
  if (!ids) return fail(c, 400, 'bad_request', `Selecione de 1 a ${MAX_IDS} mensagens.`);
  const gone = await boxOf(c.env, user.id).removeDrafts(ids);
  if (gone.length) await c.env.BLOBS.delete(gone.map(g => blobKey(user.id, g)));
  return c.json({ deleted: gone.length });
});

// Espaço: todas as pastas juntas (ou só uma, com folder), por tamanho ou por data, com o cabeçalho ainda
// lacrado (assunto e remetente só aparecem no aparelho). A primeira página traz também quanto cada pasta ocupa.
mail.get('/storage', async c => {
  const sort: StorageSort = c.req.query('sort') === 'date' ? 'date' : 'size';
  const dir = c.req.query('dir') === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 100);
  const after = c.req.query('after');
  const cursor = after ? /^(\d{1,16})\.([\w-]{1,64})$/.exec(after) : null;
  if (after && !cursor) return fail(c, 400, 'bad_cursor', 'Página inválida.');
  const folder = c.req.query('folder') as Folder | undefined;
  if (folder && !FOLDERS.has(folder)) return fail(c, 400, 'bad_folder', 'Pasta desconhecida.');
  const { rows, ...rest } = await boxOf(c.env, c.get('user').id).storage(sort, dir, cursor ? [Number(cursor[1]), cursor[2]] : null, limit, folder);
  return c.json({ messages: rows.map(toJson), ...rest });
});

// Troca o corpo de uma mensagem por outro menor, montado e lacrado no aparelho (anexos apagados). O
// servidor não vê o conteúdo: só confere que é lacre comum, que encolheu e que a mensagem é desta conta.
mail.post('/storage/replace', async c => {
  const user = c.get('user');
  const body = await c.req.json<{ id?: unknown; head?: unknown; raw?: unknown }>();
  const id = typeof body.id === 'string' && /^[\w-]{1,64}$/.test(body.id) ? body.id : null;
  if (!id || !sealedOk(body as Partial<{ head: string; raw: string }>)) return fail(c, 400, 'bad_request', 'Falta a mensagem nova ou ela é grande demais.');
  let raw: Uint8Array, head: Uint8Array;
  try { raw = fromB64(body.raw as string); head = fromB64(body.head as string); } catch { return fail(c, 400, 'bad_request', 'Mensagem ilegível.'); }
  // Lacre comum (versão 1): versão, chave efêmera, nonce e tag somam 61 bytes.
  if (raw.length < 61 || head.length < 61 || raw[0] !== 1 || head[0] !== 1) return fail(c, 400, 'bad_seal', 'A mensagem nova não está lacrada.');
  const newId = crypto.randomUUID();
  await c.env.BLOBS.put(blobKey(user.id, newId), raw);
  const r = await boxOf(c.env, user.id).swap(id, newId, raw.length, head);
  if (!r.ok) {
    await c.env.BLOBS.delete(blobKey(user.id, newId));
    if (r.why === 'not_found') return fail(c, 404, 'not_found', 'Mensagem não encontrada.');
    return fail(c, 409, r.why, r.why === 'sealed_sender'
      ? 'Mensagem trancada por quem enviou: ela só pode ficar como chegou.'
      : 'A mensagem nova não é menor que a guardada.');
  }
  await c.env.BLOBS.delete(blobKey(user.id, id));
  return c.json({ id: newId, size: raw.length, freed: r.freed });
});

// Apagar tudo (Configurações > Espaço), pedido com o botão segurado: a conta inteira ou uma pasta (folder).
// É a única saída para apagar de vez fora da Lixeira e do Spam, e exige `before`: a hora do resumo que a
// pessoa viu (o `at` da lista). O que chegou depois disso fica. Vai em lotes (`limit`) para mostrar o progresso.
mail.post('/storage/wipe', async c => {
  const user = c.get('user');
  type WipeBody = { before?: unknown; limit?: unknown; folder?: unknown };
  const body = await c.req.json<WipeBody>().catch(() => ({} as WipeBody));
  const before = Number(body.before);
  if (!Number.isSafeInteger(before) || before <= 0) return fail(c, 400, 'bad_request', 'Falta a hora do resumo confirmado.');
  if (body.folder !== undefined && !FOLDERS.has(body.folder as Folder)) return fail(c, 400, 'bad_folder', 'Pasta desconhecida.');
  const limit = Math.min(Math.max(Math.floor(Number(body.limit)) || 500, 1), 1000);
  const folder = body.folder as Folder | undefined;
  return c.json(await boxOf(c.env, user.id).wipe(user.id, { before: Math.min(before, Date.now()), limit, folder }));
});

// Certificado de remetente da conta logada, para o remetente lacrado (shared/sender.ts). Vale 7 dias.
mail.post('/cert', async c => {
  const user = c.get('user');
  const now = Date.now();
  return c.json({ cert: signCert({ a: user.address, k: user.public_key, i: now, e: now + 7 * DAY }, loadKeys(c.env).cert) });
});

// Ingressos de entrega assinados às cegas. O limite por dia é por conta; a entrega em si é anônima.
mail.post('/tokens', async c => {
  const user = c.get('user');
  const { blinded } = await c.req.json<{ blinded: unknown }>();
  if (!Array.isArray(blinded) || blinded.length === 0 || blinded.length > 20 || !blinded.every(b => typeof b === 'string' && b.length < 1024)) {
    return fail(c, 400, 'bad_request', 'Pedido de ingressos inválido.');
  }
  const created = await c.env.DB.prepare('SELECT created_at FROM users WHERE id = ?').bind(user.id).first<number>('created_at');
  const cap = now() - (created ?? 0) < 7 * DAY ? INTERNAL_PER_DAY_NEW : INTERNAL_PER_DAY;
  const day = new Date().toISOString().slice(0, 10);
  if ((await bump(c.env.DB, `tokens:${user.id}:${day}`, DAY, blinded.length)) > cap) {
    return fail(c, 429, 'send_limit', `Você chegou no limite de ${cap} entregas por dia.`);
  }
  const key = loadKeys(c.env).token;
  const len = modLen(key.n);
  return c.json({ signed: (blinded as string[]).map(b => bigToB64(signBlinded(key, b64ToBig(b)), len)) });
});

type Recipient = { name?: string; address: string };
type Sealed = { head: string; raw: string };
type SendBody = {
  // Só destinatários de fora do Shalom. Os de dentro recebem pela entrega anônima (/api/deliver), e
  // este pedido nem fica sabendo quem são.
  to?: Recipient[]; cc?: Recipient[]; bcc?: Recipient[];
  subject?: string; text?: string; html?: string;
  inReplyTo?: string; references?: string; messageId?: string;
  attachments?: { filename?: string; type?: string; content?: string; cid?: string }[];
  sentCopy: Sealed;
};

mail.post('/send', async c => {
  const user = c.get('user');
  if (Number(c.req.header('content-length') || 0) > MAX_SEND_BODY) return fail(c, 413, 'too_big', 'Mensagem grande demais.');
  if (!(await c.env.USER_LIMIT.limit({ key: `send:${user.id}` })).success) return fail(c, 429, 'slow_down', 'Muitos envios seguidos. Espere um minuto.');
  const body = await c.req.json<SendBody>();
  if (!sealedOk(body.sentCopy)) return fail(c, 400, 'bad_request', 'Falta a cópia de Enviados ou ela é grande demais.');
  // Caixa cheia: recusa antes de mandar para fora, senão o e-mail sai, a cópia não entra e a pessoa
  // manda de novo achando que falhou.
  if (!(await boxOf(c.env, user.id).fits(Math.floor(body.sentCopy.raw.length * 3 / 4)))) {
    return fail(c, 413, 'full', 'Sua caixa está cheia. Apague mensagens para enviar.');
  }
  const external = { to: body.to || [], cc: body.cc || [], bcc: body.bcc || [] };
  const all = [...external.to, ...external.cc, ...external.bcc];
  if (all.length > MAX_RECIPIENTS) return fail(c, 400, 'too_many_recipients', `No máximo ${MAX_RECIPIENTS} destinatários por mensagem.`);
  for (const r of all) {
    r.address = String(r?.address || '').trim().toLowerCase();
    if (!isEmail(r.address)) return fail(c, 400, 'bad_recipient', `Endereço inválido: ${r.address || '(vazio)'}`);
    if (r.address.endsWith(`@${c.env.MAIL_DOMAIN}`)) return fail(c, 400, 'bad_recipient', 'Contas Shalom recebem pela entrega trancada, não por aqui.');
  }

  if (all.length) {
    if (!body.text && !body.html) return fail(c, 400, 'bad_request', 'Falta o texto para quem está fora do Shalom.');
    const created = await c.env.DB.prepare('SELECT created_at FROM users WHERE id = ?').bind(user.id).first<number>('created_at');
    // Nenhuma conta gasta mais que um quinto do teto do dia: uma só não tira o envio de todo mundo.
    const share = Math.max(5, Math.floor(sendCaps(c.env).people / 5));
    const cap = Math.min(now() - (created ?? 0) < 7 * DAY ? EXTERNAL_PER_DAY_NEW : EXTERNAL_PER_DAY, share);
    const day = new Date().toISOString().slice(0, 10);
    if ((await peek(c.env.DB, sendsKey())) + all.length > sendCaps(c.env).people) {
      console.error('envio para fora: teto geral do dia atingido');
      return fail(c, 429, 'send_limit_all', 'O envio para fora do Shalom chegou no limite de hoje. Para contas Shalom, continua normal.');
    }
    if ((await bump(c.env.DB, `send:${user.id}:${day}`, DAY, all.length)) > cap) {
      return fail(c, 429, 'send_limit', `Você chegou no limite de ${cap} destinatários fora do Shalom por dia.`);
    }
    await bump(c.env.DB, sendsKey(), DAY, all.length);
    const headers: Record<string, string> = {};
    if (body.inReplyTo) headers['In-Reply-To'] = oneLine(body.inReplyTo);
    if (body.references) headers['References'] = oneLine(body.references);
    // O Email Service gera o próprio Message-ID e recusa o envio inteiro se vier um (cabeçalho de
    // plataforma). Num e-mail novo, o Message-ID da cópia de Enviados vai em References, que é permitido:
    // quem responde mantém essa lista, e a resposta de fora cai na conversa certa.
    else if (body.messageId && /^<[^<>\s@]{1,128}@[^<>\s]{1,128}>$/.test(body.messageId)) headers['References'] = body.messageId;
    const asAddr = (r: Recipient) => (r.name ? { name: oneLine(r.name), email: r.address } : r.address);
    // Anexos para fora: o Email Service aceita até 32 e 5 MiB na mensagem inteira. Imagem do texto vai
    // como inline com o mesmo cid do HTML.
    const files = (body.attachments ?? []).slice(0, 33);
    if (files.length > 32) return fail(c, 400, 'bad_request', 'No máximo 32 anexos por mensagem.');
    let bytes = 0;
    const attachments = [];
    for (const f of files) {
      const content = typeof f.content === 'string' ? f.content : '';
      bytes += Math.floor(content.length * 3 / 4);
      const type = /^[a-z]+\/[a-z0-9.+-]{1,80}$/i.test(f.type || '') ? f.type! : 'application/octet-stream';
      const cid = f.cid && /^[a-z0-9.@-]{1,120}$/i.test(f.cid) ? f.cid : undefined;
      attachments.push({ content, filename: oneLine(f.filename || 'anexo').slice(0, 200), type, disposition: cid ? 'inline' : 'attachment', ...(cid ? { contentId: cid } : {}) });
    }
    if (bytes > 4 * 1024 * 1024) return fail(c, 413, 'too_big', 'Anexos grandes demais para quem está fora do Shalom (até 4 MB).');
    const outgoing = {
      from: { email: user.address, name: user.name || user.address.split('@')[0] },
      to: external.to.map(asAddr), cc: external.cc.map(asAddr), bcc: external.bcc.map(asAddr),
      subject: oneLine(body.subject).slice(0, 300),
      text: body.text, html: body.html,
      headers,
      ...(attachments.length ? { attachments } : {}),
    };
    if (c.env.EMAIL_SENDING === 'on') {
      try {
        await c.env.EMAIL.send(outgoing as EmailMessageBuilder);
        await tally(c.env.DB, 'sent_out', all.length);
      } catch (e) {
        console.error('envio falhou', (e as { code?: string }).code, String(e));
        return fail(c, 502, 'send_failed', 'O envio para fora falhou. Tente de novo em instantes.');
      }
    } else {
      console.log(`[envio desligado] ${all.length} destinatário(s) externo(s)`);
    }
  }

  const id = await store(c.env, user.id, 'sent', fromB64(body.sentCopy.raw), fromB64(body.sentCopy.head), { seen: true });
  if (!id) return fail(c, 413, 'full', 'Sua caixa está cheia. Apague mensagens para enviar.');
  return c.json({ ok: true, id, external: all.length });
});

// Imagens remotas passam por aqui só quando a pessoa pede "mostrar imagens": quem mandou o e-mail
// não vê o IP nem o aparelho de quem abriu. É POST com X-Shalom, então um link clicado não chega aqui,
// e a resposta é sempre uma imagem raster inerte (SVG nunca: ele roda script).
const MAX_IMG = 5 * 1024 * 1024;
const RASTER = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

function publicHttpUrl(raw: string, env: Env): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const ipLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || /^\d+$/.test(host) || /^0x/i.test(host);
  if (ipLiteral || host === 'localhost' || !host.includes('.')
    || /\.(local|localhost|internal|lan|home|arpa)$/.test(host)
    || host === env.MAIL_DOMAIN || host.endsWith(`.${env.MAIL_DOMAIN}`)) return null;
  return url;
}

mail.post('/img', async c => {
  if (!(await c.env.USER_LIMIT.limit({ key: `img:${c.get('user').id}` })).success) return fail(c, 429, 'slow_down', 'Muitas imagens seguidas.');
  const { u } = await c.req.json<{ u: string }>();
  let url = publicHttpUrl(String(u || ''), c.env);
  let res: Response | null = null;
  for (let hop = 0; url && hop <= 3; hop++) {
    res = await fetch(url.toString(), {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ShalomImageProxy/1.0)', accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res || res.status < 300 || res.status >= 400) break;
    const next = res.headers.get('location');
    url = next ? publicHttpUrl(new URL(next, url).toString(), c.env) : null;
    res = null;
  }
  const type = (res?.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!res || !res.ok || !res.body || !RASTER.has(type)) return fail(c, 502, 'img_failed', 'Imagem indisponível.');
  if (Number(res.headers.get('content-length') || 0) > MAX_IMG) return fail(c, 413, 'too_big', 'Imagem grande demais.');
  // Lê em fluxo e para no limite, sem confiar no content-length.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_IMG) { await reader.cancel(); return fail(c, 413, 'too_big', 'Imagem grande demais.'); }
    chunks.push(value);
  }
  return new Response(new Blob(chunks), {
    headers: {
      'content-type': type,
      'content-disposition': 'attachment',
      'cache-control': 'private, no-store',
    },
  });
});
