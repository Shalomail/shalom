// Teste de ponta a ponta contra o Worker local (npm run dev:worker):
// cria duas contas, entra, recebe um e-mail de fora, lê, troca mensagem trancada entre as duas,
// manda para fora (só registra no log no dev) e confere que o banco não guarda nada aberto.
// Rodar: node scripts/run-ts.mjs scripts/smoke.ts
import PostalMime from 'postal-mime';
import type { MessageHead } from '../shared/head';
import { fromB64, open, openJson, seal, sealJson, toB64 } from '../shared/seal';
import { newAccountKeys, openEnvelope, passwordKeys, type Kdf } from '../web/src/lib/keys';
import { buildMime, newMessageId, textToHtml } from '../web/src/lib/mime';
import { deliverAnon, getToken, sealFor, sendSealed } from './sealed';
import { openFromSender, verifyCert } from '../shared/sender';
import { unpack } from '../shared/pack';
import { headOf } from '../shared/head';
import { pack } from '../shared/pack';
import { withoutAttachments } from '../web/src/lib/storage';

const BASE = process.env.SHALOM_API || 'http://127.0.0.1:8790';
const DOMAIN = 'shalomail.com';
let failures = 0;

function check(ok: unknown, label: string) {
  console.log(`${ok ? 'ok  ' : 'FALHOU'} ${label}`);
  if (!ok) failures++;
}

class Client {
  jar = new Map<string, string>();
  get cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  async call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-shalom': '1', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      if (/max-age=0/i.test(c) || v.join('=') === '') this.jar.delete(k); else this.jar.set(k, v.join('='));
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
    return { status: res.status, data: data as T };
  }
}

async function signup(local: string, password: string) {
  const c = new Client();
  const { secretKey, payload } = await newAccountKeys(password);
  const r = await c.call('POST', '/api/auth/signup', { address: local, name: local.startsWith('ana') ? 'Ana' : 'Bruno Ávila', turnstile: 'XXXX.DUMMY.TOKEN.XXXX', ...payload });
  return { c, r, secretKey, address: `${local}@${DOMAIN}` };
}

const tag = Date.now().toString(36).slice(-5);
const pass = 'cavalo-azul-' + tag;

const a = await signup(`ana${tag}`, pass);
check(a.r.status === 200, `cadastro de ${a.address}`);
const b = await signup(`bruno${tag}`, pass + 'x');
check(b.r.status === 200, `cadastro de ${b.address}`);
check((await new Client().call('POST', '/api/auth/signup', { address: 'postmaster', turnstile: 'XXXX.DUMMY.TOKEN.XXXX' })).status === 400, 'endereço reservado recusado');
check((await new Client().call('POST', '/api/auth/available', { address: 'shalom.suporte' })).data.reason === 'reserved', 'endereço com "shalom" reservado');
check((await new Client().call('POST', '/api/auth/available', { address: `ana.${tag}` })).data.reason === 'taken', 'sósia com ponto (ana.x) conta como o mesmo dono');
check((await new Client().call('POST', '/api/auth/signup', { address: 'robo' + tag })).status === 403, 'cadastro sem Turnstile recusado');
check((await new Client().call('POST', '/api/auth/signup', { address: 'robo' + tag, turnstile: 'XXXX.DUMMY.TOKEN.XXXX', website: 'http://spam' })).status === 403, 'cadastro com isca preenchida recusado');

// Sal de conta que não existe: sempre o mesmo, e com cara de verdadeiro.
const s1 = (await new Client().call('POST', '/api/auth/salt', { address: 'ninguem-' + tag })).data;
const s2 = (await new Client().call('POST', '/api/auth/salt', { address: 'ninguem-' + tag })).data;
check(s1.salt === s2.salt && fromB64(s1.salt).length === 16, 'sal falso estável para endereço inexistente');

// Login: senha errada, depois certa, e o envelope abre com a senha.
const login = new Client();
const salt = (await login.call('POST', '/api/auth/salt', { address: a.address })).data as { salt: string; kdf: Kdf };
const wrong = await passwordKeys('senha-errada', fromB64(salt.salt), salt.kdf);
check((await login.call('POST', '/api/auth/login', { address: a.address, authKey: toB64(wrong.authKey) })).status === 401, 'senha errada recusada');
const right = await passwordKeys(pass, fromB64(salt.salt), salt.kdf);
const li = await login.call('POST', '/api/auth/login', { address: a.address, authKey: toB64(right.authKey) });
check(li.status === 200, 'senha certa aceita');
const recovered = await openEnvelope(li.data.envelope, right.wrapKey);
check(toB64(recovered) === toB64(a.secretKey), 'envelope abre e devolve a mesma chave privada');
check((await new Client().call('POST', '/api/auth/logout')).status === 200, 'sair sem sessão não quebra');
check((await fetch(BASE + '/api/auth/logout', { method: 'POST' })).status === 403, 'pedido sem X-Shalom recusado (CSRF)');

// E-mail chegando de fora pelo Email Routing (simulado pelo wrangler).
const subject = `Proposta confidencial ${tag}`;
const raw = [
  'From: "Carla Souza" <carla@empresa.com.br>',
  `To: ${a.address}`,
  `Subject: =?UTF-8?B?${Buffer.from(subject + ' — revisão').toString('base64')}?=`,
  'Date: Wed, 29 Oct 2026 10:00:00 -0300',
  `Message-ID: <${tag}@empresa.com.br>`,
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/html; charset=utf-8',
  '',
  `<p>Olá Ana, segue a proposta.</p><img src="https://rastreio.exemplo.com/pixel.gif?u=${tag}">`,
  '--b1',
  'Content-Type: application/pdf; name="proposta.pdf"',
  'Content-Disposition: attachment; filename="proposta.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 teste').toString('base64'),
  '--b1--',
  '',
].join('\r\n');
const inbound = await fetch(`${BASE}/cdn-cgi/handler/email?from=carla@empresa.com.br&to=${a.address}`, { method: 'POST', body: raw });
check(inbound.ok, `e-mail de fora entregue (${inbound.status})`);
const nobody = await fetch(`${BASE}/cdn-cgi/handler/email?from=carla@empresa.com.br&to=ninguem@${DOMAIN}`, { method: 'POST', body: raw });
console.log(`     endereço inexistente: ${nobody.status} ${(await nobody.text()).slice(0, 80)}`);

const list = await a.c.call('GET', '/api/messages?folder=inbox');
// A conta nova já tem a boas-vindas da Equipe (remetente lacrado: o servidor não distingue); a de fora
// é a única cujo cabeçalho abre direto com a chave e diz carla@.
const rows: { id: string; head: string }[] = list.status === 200 ? list.data.messages : [];
const fromCarla = [];
for (const m of rows) {
  const h = await openJson<MessageHead>(a.secretKey, fromB64(m.head)).catch(() => null);
  if (h?.from?.address === 'carla@empresa.com.br') fromCarla.push(m);
}
check(rows.length === 2, 'caixa nova: boas-vindas mais a mensagem de fora');
check(fromCarla.length === 1, 'caixa de entrada com 1 mensagem de fora');
const row = fromCarla[0];
check(!String(row.head).includes('Proposta'), 'cabeçalho guardado lacrado (sem texto aberto)');
const head = await openJson<MessageHead>(a.secretKey, fromB64(row.head));
check(head.subject.startsWith(subject) && head.from?.address === 'carla@empresa.com.br' && head.attachments === 1 && !('cc' in head), `cabeçalho abre e é enxuto: "${head.subject}"`);
const blob = (await a.c.call('GET', `/api/messages/${row.id}/raw`)).data as Uint8Array;
check(!new TextDecoder().decode(blob).includes('proposta'), 'corpo guardado lacrado no R2');
const opened = await open(a.secretKey, blob, 'raw');
check(opened[0] === 0x00 && opened[1] === 0x53 && opened[2] === 0x48 && opened[8] === 0x1f && opened[9] === 0x8b && opened.length % 256 === 0, 'e-mail de fora guardado comprimido (gzip) e completado até o degrau de tamanho antes de criptografar');
const parsed = await PostalMime.parse(await unpack(opened));
check(parsed.html?.includes('segue a proposta') && parsed.attachments[0]?.filename === 'proposta.pdf', 'corpo e anexo abrem com a chave');
check((await b.c.call('GET', `/api/messages/${row.id}/raw`)).status === 404, 'outra conta não acessa a mensagem');

// Ana responde para Bruno (Shalom) e para Carla (fora).
const keyRes = await a.c.call('POST', '/api/keys', { address: b.address });
const bPub = fromB64(keyRes.data.publicKey);
const text = 'Bruno, veja a proposta da Carla.\nAbraço';
const draft = {
  from: { name: 'Ana', address: a.address },
  to: [{ name: 'Bruno Ávila', address: b.address }, { name: 'Carla Souza', address: 'carla@empresa.com.br' }],
  cc: [], bcc: [{ name: '', address: 'oculto@outro.com' }],
  subject: `Re: ${head.subject}`, text, html: textToHtml(text),
  messageId: newMessageId(DOMAIN), inReplyTo: parsed.messageId, references: parsed.messageId, date: new Date(),
};
const forB = buildMime(draft, false);
const forMe = buildMime(draft, true);
const aPub = fromB64(a.r.data.user.publicKey);
// Para fora: só a Carla vai no /send (com texto). Para o Bruno: entrega anônima com remetente lacrado.
const carla = [{ name: 'Carla Souza', address: 'carla@empresa.com.br' }];
const { cert: aCert } = await sendSealed(BASE, (m, path, body) => a.c.call(m, path, body), a.secretKey, { address: b.address, publicKey: bPub }, forB, forMe);
const ext = await a.c.call('POST', '/api/send', { to: carla, cc: [], bcc: draft.bcc, subject: draft.subject, text, html: draft.html, sentCopy: await sealFor(aPub, a.secretKey, aCert, forMe) });
check(ext.status === 200 && ext.data.external === 2, `envio para fora: ${JSON.stringify(ext.data)}`);

const cfg = await (await fetch(BASE + '/api/auth/config')).json() as { certKey: string };
const serverCert = fromB64(cfg.certKey);
const bList = await b.c.call('GET', '/api/messages?folder=inbox');
const bRow = bList.data.messages[0];
check(bRow && bRow.sender === null, 'servidor guardou a mensagem sem saber quem enviou (remetente lacrado)');
const bHead = await openFromSender(b.secretKey, fromB64(bRow.head), 'head', serverCert, bRow.received_at);
check(bHead.sender.address === a.address, 'Bruno confere no aparelho que foi a Ana quem enviou');
const bRaw = await openFromSender(b.secretKey, (await b.c.call('GET', `/api/messages/${bRow.id}/raw`)).data, 'raw', serverCert, bRow.received_at);
const bMsg = await PostalMime.parse(await unpack(bRaw.payload));
check(bMsg.text?.includes('veja a proposta') && !bMsg.bcc?.length, 'Bruno abre a mensagem e não vê o Cco');

const sentList = await a.c.call('GET', '/api/messages?folder=sent');
const sRow = sentList.data.messages.find((m: any) => true);
const sentMsg = await PostalMime.parse(await unpack((await openFromSender(a.secretKey, (await a.c.call('GET', `/api/messages/${sRow.id}/raw`)).data, 'raw', serverCert, sRow.received_at)).payload));
check(sentMsg.bcc?.[0]?.address === 'oculto@outro.com', 'cópia de Enviados guarda o Cco');

// Entrega sem ingresso, ingresso repetido e personificação com o certificado de outra pessoa.
const sealed = await sealFor(bPub, a.secretKey, aCert, forB);
check((await deliverAnon(BASE, { to: b.address, ...sealed, token: 'AAAA', sig: 'AAAA' })).status === 403, 'entrega sem ingresso válido recusada');
const t1 = await getToken(BASE, (m, path, body) => a.c.call(m, path, body));
check((await deliverAnon(BASE, { to: b.address, ...sealed, token: toB64(t1.token), sig: t1.sig })).status === 200, 'entrega com ingresso aceita');
check((await deliverAnon(BASE, { to: b.address, ...sealed, token: toB64(t1.token), sig: t1.sig })).status === 409, 'ingresso usado duas vezes recusado');
// Bruno tem o certificado da Ana (veio na mensagem) e tenta escrever "como Ana" com a chave dele.
const forged = await sealFor(aPub, b.secretKey, aCert, buildMime({ ...draft, subject: 'falso' }, false));
let forgedOk = true;
try { await openFromSender(a.secretKey, fromB64(forged.head), 'head', serverCert, Date.now()); } catch { forgedOk = false; }
check(!forgedOk, 'certificado de outra pessoa não basta para se passar por ela');
check(verifyCert(aCert, serverCert).a === a.address, 'certificado assinado pelo servidor confere');
check((await a.c.call('POST', '/api/send', { to: [{ address: b.address }], sentCopy: sealed })).status === 400, 'endereço Shalom não aceito no envio comum (só entrega lacrada)');


// Estrela, lido, lixeira, apagar de vez.
check((await a.c.call('POST', '/api/messages/update', { ids: [row.id], seen: true, starred: true })).status === 200, 'marcar lida e com estrela');
check((await a.c.call('GET', '/api/messages?folder=starred')).data.messages.length === 1, 'aparece em Com estrela');
check((await a.c.call('POST', '/api/messages/delete', { ids: [row.id] })).data.deleted === 0, 'não apaga de vez fora da lixeira');
await a.c.call('POST', '/api/messages/update', { ids: [row.id], folder: 'trash' });
check((await a.c.call('POST', '/api/messages/delete', { ids: [row.id] })).data.deleted === 1, 'apaga de vez da lixeira');
check((await a.c.call('GET', `/api/messages/${row.id}/raw`)).status === 404, 'conteúdo apagado do R2');

// Proxy de imagem: link clicado não chega, SVG e endereço interno recusados, toda resposta da API inerte.
check((await a.c.call('GET', '/api/img?u=https://www.w3.org/Icons/SVG/svg-logo-v.svg')).status === 404, 'proxy de imagem não responde a link (GET)');
check((await a.c.call('POST', '/api/img', { u: 'https://www.w3.org/Icons/SVG/svg-logo-v.svg' })).status === 502, 'proxy recusa SVG');
check((await a.c.call('POST', '/api/img', { u: 'http://127.0.0.1:8790/api/auth/config' })).status === 502, 'proxy recusa endereço interno');
const raw0 = await fetch(BASE + '/api/auth/config');
check(raw0.headers.get('content-security-policy')?.includes('sandbox') && raw0.headers.get('x-content-type-options') === 'nosniff', 'respostas da API com CSP sandbox e nosniff');

// Atacante erra a senha de Ana várias vezes: trava a rede dele, mas Ana entra do aparelho dela.
const attacker = new Client();
const fakeKey = toB64(crypto.getRandomValues(new Uint8Array(32)));
for (let i = 0; i < 6; i++) await attacker.call('POST', '/api/auth/login', { address: a.address, authKey: fakeKey, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' });
const blocked = await attacker.call('POST', '/api/auth/login', { address: a.address, authKey: fakeKey, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' });
check(blocked.status === 429, 'atacante travado depois de várias tentativas');
const back = await login.call('POST', '/api/auth/login', { address: a.address, authKey: toB64(right.authKey) });
check(back.status === 200, 'dona da conta entra do aparelho conhecido mesmo com o ataque');

// Golpe chegando de fora: vai direto para o Spam.
const scam = ['From: "Banco Alfa" <suporte@bancoalfa.com.br>', `To: ${a.address}`, 'Subject: Urgente: confirme seus dados', `Message-ID: <scam-${tag}@x.com>`,
  'Authentication-Results: mx.cloudflare.net; dkim=none; spf=fail; dmarc=fail header.from=bancoalfa.com.br',
  'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', '<p>Sua conta foi bloqueada. <a href="http://golpe.example/login">www.bancoalfa.com.br</a></p>'].join('\r\n');
await fetch(`${BASE}/cdn-cgi/handler/email?from=suporte@golpe.example&to=${a.address}`, { method: 'POST', body: scam });
check((await a.c.call('GET', '/api/messages?folder=spam')).data.messages.length === 1, 'golpe vai direto para o Spam');
check((await a.c.call('GET', '/api/messages?folder=inbox')).data.messages.every((m: any) => m.folder === 'inbox'), 'Entrada sem o golpe');

// Espaço: todas as pastas juntas, por tamanho e por data, com cursor; e a troca do corpo sem os anexos.
const fileSubject = `Fotos da obra ${tag}`;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const withFile = [
  'From: "Obra Viva" <obra@construtora.com.br>', `To: ${a.address}`, `Subject: ${fileSubject}`, 'Date: Thu, 30 Oct 2026 09:00:00 -0300',
  `Message-ID: <obra-${tag}@construtora.com.br>`, 'X-Obra: lote 7', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="m1"', '',
  '--m1', 'Content-Type: multipart/related; boundary="r1"', '',
  '--r1', 'Content-Type: multipart/alternative; boundary="a1"', '',
  '--a1', 'Content-Type: text/plain; charset=utf-8', '', 'Segue o relatório da obra, com a planta.', '',
  '--a1', 'Content-Type: text/html; charset=utf-8', '', '<html><body><p>Segue o relatório da obra.</p><img src="cid:logo@obra"></body></html>', '',
  '--a1--', '',
  '--r1', 'Content-Type: image/png', 'Content-ID: <logo@obra>', 'Content-Disposition: inline', 'Content-Transfer-Encoding: base64', '', pixel.toString('base64'), '',
  '--r1--', '',
  '--m1', 'Content-Type: application/pdf; name="planta.pdf"', 'Content-Disposition: attachment; filename="planta.pdf"', 'Content-Transfer-Encoding: base64', '',
  Buffer.from(crypto.getRandomValues(new Uint8Array(60_000))).toString('base64').replace(/.{76}/g, '$&\r\n'), '',
  '--m1--', '',
].join('\r\n');
check((await fetch(`${BASE}/cdn-cgi/handler/email?from=obra@construtora.com.br&to=${a.address}`, { method: 'POST', body: withFile })).ok, 'espaço: e-mail com anexo entregue');

const st = await a.c.call('GET', '/api/storage?sort=size&limit=100');
const folders = st.data.folders as Record<string, { count: number; bytes: number }>;
check(st.status === 200 && folders && st.data.quota === 1024 ** 3 && st.data.messages.length >= 3, `espaço: primeira página com o total de cada pasta ${JSON.stringify(folders)}`);
check(Object.values(folders).reduce((n, f) => n + f.bytes, 0) === st.data.used, 'espaço: soma das pastas igual ao espaço usado');
check(Object.values(folders).reduce((n, f) => n + f.count, 0) === st.data.messages.length, 'espaço: contagem das pastas igual à lista');
const sizes = st.data.messages.map((m: any) => m.size);
check(sizes.every((n: number, i: number) => i === 0 || sizes[i - 1] >= n), 'espaço: por tamanho, do maior para o menor');
check(new Set(st.data.messages.map((m: any) => m.folder)).size >= 3, 'espaço: junta mensagens de várias pastas');
check(st.data.messages.every((m: any) => !String(m.head).includes('obra') && !String(m.head).includes('Proposta')), 'espaço: cabeçalhos seguem lacrados');
const paged: string[] = [];
for (let after: string | null = null, guard = 0; guard < 50; guard++) {
  const p: any = await a.c.call('GET', `/api/storage?sort=size&limit=1${after ? `&after=${after}` : ''}`);
  paged.push(...p.data.messages.map((m: any) => m.id));
  if (guard > 0 && p.data.folders) { check(false, 'espaço: só a primeira página traz o resumo'); break; }
  after = p.data.next;
  if (!after) break;
}
check(paged.join() === st.data.messages.map((m: any) => m.id).join(), 'espaço: páginas pelo cursor batem com a lista inteira');
const byDate = (await a.c.call('GET', '/api/storage?sort=date&limit=100')).data.messages.map((m: any) => m.received_at);
check(byDate.every((t: number, i: number) => i === 0 || byDate[i - 1] >= t), 'espaço: por data, da mais nova para a mais antiga');
const oldest = (await a.c.call('GET', '/api/storage?sort=date&dir=asc&limit=100')).data.messages.map((m: any) => m.received_at);
check(oldest.every((t: number, i: number) => i === 0 || oldest[i - 1] <= t), 'espaço: por data, ao contrário');
check((await a.c.call('GET', '/api/storage?after=nada')).status === 400, 'espaço: cursor inválido recusado');
check((await new Client().call('GET', '/api/storage')).status === 401, 'espaço: sem sessão não lista');
const bIds = new Set((await b.c.call('GET', '/api/storage?limit=100')).data.messages.map((m: any) => m.id));
check(st.data.messages.every((m: any) => !bIds.has(m.id)), 'espaço: cada conta vê só a própria caixa');

// Anexo apagado no aparelho: monta sem o arquivo, lacra de novo e troca o corpo.
const fileRow = st.data.messages.find((m: any) => m.size === sizes[0]);
const fileHead = await openJson<MessageHead>(a.secretKey, fromB64(fileRow.head));
check(fileHead.subject === fileSubject && fileHead.attachments === 1, 'espaço: a maior é a do anexo, com 1 arquivo no cabeçalho');
await a.c.call('POST', '/api/messages/update', { ids: [fileRow.id], seen: true, starred: true });
const fileRaw = await unpack(await open(a.secretKey, (await a.c.call('GET', `/api/messages/${fileRow.id}/raw`)).data, 'raw'));
const rebuilt = await withoutAttachments(fileRaw, new Date('2026-10-30T12:00:00Z'));
const readBack = rebuilt && await PostalMime.parse(rebuilt.mime, { attachmentEncoding: 'arraybuffer' });
check(rebuilt && rebuilt.removed === 1 && rebuilt.left === 0, 'sem anexos: o PDF sai e nada conta como anexo');
check(readBack && readBack.subject === fileSubject && readBack.messageId === `<obra-${tag}@construtora.com.br>` && readBack.headers.some(h => h.key === 'x-obra'), 'sem anexos: cabeçalho original preservado');
check(readBack && readBack.html?.includes('relatório da obra') && readBack.html.includes('cid:logo@obra') && readBack.text?.includes('com a planta'), 'sem anexos: texto e HTML preservados');
check(readBack && readBack.attachments.length === 1 && readBack.attachments[0].contentId?.includes('logo@obra') && readBack.attachments[0].disposition === 'inline', 'sem anexos: imagem embutida no texto fica');
check(readBack && readBack.text?.includes('Anexo apagado em 30 de outubro de 2026 para liberar espaço: planta.pdf'), `sem anexos: nota do que saiu (${readBack?.text?.trim().split('\n').pop()})`);
check((await withoutAttachments(rebuilt!.mime)) === null, 'sem anexos: rodar de novo não acha mais nada');

const usedBefore = st.data.used as number;
const newRaw = await seal(aPub, await pack(rebuilt!.mime), 'raw');
const newHead = await sealJson(aPub, { ...fileHead, attachments: 0 });
const rep = await a.c.call('POST', '/api/storage/replace', { id: fileRow.id, head: toB64(newHead), raw: toB64(newRaw) });
check(rep.status === 200 && rep.data.id !== fileRow.id && rep.data.freed === fileRow.size - newRaw.length, `troca: corpo menor guardado (${rep.status} ${JSON.stringify(rep.data)})`);
check((await a.c.call('GET', `/api/messages/${fileRow.id}/raw`)).status === 404, 'troca: corpo antigo apagado do R2');
const swapped = (await a.c.call('GET', '/api/storage?sort=date&limit=100')).data;
const sRow2 = swapped.messages.find((m: any) => m.id === rep.data.id);
check(sRow2 && sRow2.folder === fileRow.folder && sRow2.seen === 1 && sRow2.starred === 1 && sRow2.received_at === fileRow.received_at && sRow2.size === newRaw.length, 'troca: mesma pasta, marcas e hora de chegada');
check(swapped.used === usedBefore - rep.data.freed, 'troca: espaço usado diminui');
const reopened = await PostalMime.parse(await unpack(await open(a.secretKey, (await a.c.call('GET', `/api/messages/${rep.data.id}/raw`)).data, 'raw')));
check(reopened.html?.includes('relatório da obra') && !reopened.attachments.some(x => x.filename === 'planta.pdf'), 'troca: corpo novo abre com a chave, sem o PDF');
check((await openJson<MessageHead>(a.secretKey, fromB64(sRow2.head))).attachments === 0, 'troca: cabeçalho novo sem anexos');
const bigger = await seal(aPub, new Uint8Array(sRow2.size + 100), 'raw');
check((await a.c.call('POST', '/api/storage/replace', { id: rep.data.id, head: toB64(newHead), raw: toB64(bigger) })).status === 409, 'troca: corpo maior recusado');
const mine = swapped.messages.find((m: any) => m.folder === 'sent');
check((await a.c.call('POST', '/api/storage/replace', { id: mine.id, head: toB64(newHead), raw: toB64(await seal(aPub, new Uint8Array(10), 'raw')) })).data.error === 'sealed_sender', 'troca: mensagem com remetente lacrado fica como chegou');
check((await a.c.call('POST', '/api/storage/replace', { id: rep.data.id, head: toB64(newHead), raw: toB64(new Uint8Array(80)) })).status === 400, 'troca: corpo sem lacre recusado');
check((await b.c.call('POST', '/api/storage/replace', { id: rep.data.id, head: toB64(newHead), raw: toB64(await seal(bPub, new Uint8Array(10), 'raw')) })).status === 404, 'troca: outra conta não alcança a mensagem');

// Apagar de vez pela tela de espaço: vai para a Lixeira e sai de lá (a regra do servidor continua).
const toGo = swapped.messages.filter((m: any) => m.folder !== 'trash').slice(0, 2).map((m: any) => m.id);
await a.c.call('POST', '/api/messages/update', { ids: toGo, folder: 'trash' });
check((await a.c.call('POST', '/api/messages/delete', { ids: toGo })).data.deleted === 2, 'espaço: apagar de vez de outra pasta passando pela Lixeira');
const after2 = (await a.c.call('GET', '/api/storage?limit=100')).data;
check(after2.messages.length === swapped.messages.length - 2 && after2.used < swapped.used, 'espaço: lista e espaço usado atualizados depois de apagar');

// Filtro por pasta: lista, contagem e cursor só daquela pasta; o resumo continua com todas.
const mailIn = (subject: string, extra: string[] = []) => ['From: "Loja" <ofertas@loja.com.br>', `To: ${a.address}`, `Subject: ${subject}`, `Message-ID: <${subject.replace(/\W/g, '')}-${tag}@loja.com.br>`, ...extra, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'Oi.'].join('\r\n');
await fetch(`${BASE}/cdn-cgi/handler/email?from=ofertas@loja.com.br&to=${a.address}`, { method: 'POST', body: mailIn('Pedido enviado') });
await fetch(`${BASE}/cdn-cgi/handler/email?from=golpe@golpe.example&to=${a.address}`, { method: 'POST', body: mailIn('Urgente: confirme seus dados', ['Authentication-Results: mx.cloudflare.net; dkim=none; spf=fail; dmarc=fail header.from=loja.com.br']) });
const every = (await a.c.call('GET', '/api/storage?limit=100')).data;
const sentOnly = await a.c.call('GET', '/api/storage?folder=sent&sort=size&limit=100');
check(sentOnly.status === 200 && sentOnly.data.messages.length === every.folders.sent?.count && sentOnly.data.messages.every((m: any) => m.folder === 'sent'), `filtro: só Enviados, com a contagem certa (${sentOnly.data.messages.length})`);
check(JSON.stringify(sentOnly.data.folders) === JSON.stringify(every.folders), 'filtro: o resumo continua com todas as pastas');
const sentPaged: string[] = [];
for (let after: string | null = null, guard = 0; guard < 20; guard++) {
  const p: any = await a.c.call('GET', `/api/storage?folder=sent&sort=size&limit=1${after ? `&after=${after}` : ''}`);
  sentPaged.push(...p.data.messages.map((m: any) => m.id));
  after = p.data.next;
  if (!after) break;
}
check(sentPaged.length >= 2 && sentPaged.join() === sentOnly.data.messages.map((m: any) => m.id).join(), 'filtro: páginas pelo cursor dentro da pasta');
const inboxByDate = (await a.c.call('GET', '/api/storage?folder=inbox&sort=date&dir=asc&limit=100')).data.messages;
check(inboxByDate.length === every.folders.inbox?.count && inboxByDate.every((m: any, i: number) => m.folder === 'inbox' && (i === 0 || inboxByDate[i - 1].received_at <= m.received_at)), 'filtro: por data dentro da Entrada');
check((await a.c.call('GET', '/api/storage?folder=favoritos')).status === 400, 'filtro: pasta desconhecida recusada');
const spamWipe = await a.c.call('POST', '/api/storage/wipe', { before: every.at, folder: 'spam' });
const afterSpam = (await a.c.call('GET', '/api/storage?limit=100')).data;
check(spamWipe.data.deleted === every.folders.spam?.count && !afterSpam.folders.spam && afterSpam.folders.sent?.count === every.folders.sent?.count && afterSpam.folders.inbox?.count === every.folders.inbox?.count,
  `apagar tudo de uma pasta: só o Spam saiu (${JSON.stringify(spamWipe.data)})`);
check(afterSpam.used === every.used - spamWipe.data.freed, 'apagar tudo de uma pasta: espaço usado atualizado');
check((await a.c.call('POST', '/api/storage/wipe', { before: every.at, folder: 'nada' })).status === 400, 'apagar tudo de uma pasta: pasta desconhecida recusada');

// Apagar tudo: só com a hora do resumo confirmado; o que chegou depois fica; corpos saem do R2.
check((await a.c.call('POST', '/api/storage/wipe', {})).status === 400, 'apagar tudo: sem a hora do resumo recusado');
const beforeWipe = (await a.c.call('GET', '/api/storage?sort=date&limit=100')).data;
await new Promise(r => setTimeout(r, 20));
const lateRaw = ['From: "Tarde" <tarde@exemplo.com.br>', `To: ${a.address}`, 'Subject: Chegou depois', `Message-ID: <tarde-${tag}@exemplo.com.br>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'Oi.'].join('\r\n');
await fetch(`${BASE}/cdn-cgi/handler/email?from=tarde@exemplo.com.br&to=${a.address}`, { method: 'POST', body: lateRaw });
const w1 = await a.c.call('POST', '/api/storage/wipe', { before: beforeWipe.at, limit: 1 });
check(w1.status === 200 && w1.data.deleted === 1 && w1.data.more === true, `apagar tudo: em lotes (${JSON.stringify(w1.data)})`);
const w2 = await a.c.call('POST', '/api/storage/wipe', { before: beforeWipe.at });
check(w2.status === 200 && w2.data.deleted === beforeWipe.messages.length - 1 && w2.data.more === false, 'apagar tudo: o resto num pedido só');
check(w1.data.freed + w2.data.freed === beforeWipe.used, 'apagar tudo: espaço liberado igual ao usado antes');
const afterWipe = (await a.c.call('GET', '/api/storage?limit=100')).data;
check(afterWipe.messages.length === 1 && afterWipe.folders.inbox?.count === 1 && afterWipe.used === afterWipe.messages[0].size, 'apagar tudo: a mensagem que chegou depois ficou, e o espaço bate');
check((await a.c.call('GET', `/api/messages/${beforeWipe.messages[0].id}/raw`)).status === 404, 'apagar tudo: corpos apagados do R2');
const w3 = await a.c.call('POST', '/api/storage/wipe', { before: Date.now() + 60_000 });
check(w3.data.deleted === 1 && (await a.c.call('GET', '/api/usage')).data.used === 0, 'apagar tudo: caixa vazia volta o espaço a zero');

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
