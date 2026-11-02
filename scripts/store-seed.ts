// Caixa de demonstração para as capturas da App Store, no ambiente local, em inglês ou português.
// Tudo fictício: pessoas, bancos e lojas. Duas etapas, porque o servidor grava a hora de chegada e
// de madrugada a caixa mostraria tudo às 2h:
//   1. com o Worker local ligado:   node scripts/run-ts.mjs scripts/store-seed.ts en   (ou pt)
//   2. com o Worker local DESLIGADO: node scripts/run-ts.mjs scripts/store-seed.ts fix en
// A segunda acerta, direto no SQLite local das caixas, a hora (manhã de hoje, relógio em 9:41), o lido
// e o favorito de cada mensagem. Depois: ligar o Worker de novo e rodar StoreShots no simulador.
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fromB64, toB64 } from '../shared/seal';
import { newAccountKeys, openEnvelope, passwordKeys } from '../web/src/lib/keys';
import { buildMime, newMessageId, textToHtml } from '../web/src/lib/mime';
import { sendSealed } from './sealed';

const BASE = 'http://127.0.0.1:8790';
const DOMAIN = 'shalomail.com';
const BOXES = '.wrangler/state/v3/do/shalom-Mailbox';
// A senha das contas locais é a mesma do seed (não repete aqui, para a cópia pública não levar).
const PASSWORD = readFileSync('scripts/seed.ts', 'utf8').match(/DEMO_PASSWORD = '([^']+)'/)![1];

const args = process.argv.slice(2);
const fixing = args[0] === 'fix';
const lang = (fixing ? args[1] : args[0]) === 'pt' ? 'pt' : 'en';
const planFile = `.tmp/store-plan-${lang}.json`;

type Plan = { id: string; at: number; seen: boolean; starred: boolean; folder?: string }[];

if (fixing) {
  const plan = JSON.parse(readFileSync(planFile, 'utf8')) as Plan;
  const file = readdirSync(BOXES).filter(f => f.endsWith('.sqlite')).find(f => {
    const db = new DatabaseSync(`${BOXES}/${f}`, { readOnly: true });
    try { return !!db.prepare('SELECT 1 FROM messages WHERE id = ?').get(plan[0].id); } catch { return false; } finally { db.close(); }
  });
  if (!file) throw new Error('caixa não encontrada: rodou a etapa 1 e desligou o Worker?');
  const db = new DatabaseSync(`${BOXES}/${file}`);
  const set = db.prepare('UPDATE messages SET received_at = ?, seen = ?, starred = ?, folder = COALESCE(?, folder), trashed_at = ? WHERE id = ?');
  for (const p of plan) set.run(p.at, p.seen ? 1 : 0, p.starred ? 1 : 0, p.folder ?? null, p.folder === 'trash' ? Date.now() : null, p.id);
  db.close();
  console.log(`Pronto: ${plan.length} mensagens acertadas em ${file}.`);
  process.exit(0);
}

async function call(method: string, path: string, body: unknown, cookie = '') {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-shalom': '1', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const got = res.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => c.startsWith('shalom_sid=')).join('; ');
  return { status: res.status, cookie: got, data: await res.json().catch(() => ({})) as any };
}

async function account(local: string, name: string) {
  const { payload, secretKey } = await newAccountKeys(PASSWORD);
  const r = await call('POST', '/api/auth/signup', { address: local, name, lang, turnstile: 'XXXX.DUMMY.TOKEN.XXXX', ...payload });
  if (r.status === 409 || r.data.error === 'taken') {
    const salt = (await call('POST', '/api/auth/salt', { address: local })).data;
    const { authKey, wrapKey } = await passwordKeys(PASSWORD, fromB64(salt.salt), salt.kdf);
    const li = await call('POST', '/api/auth/login', { address: local, authKey: toB64(authKey) });
    if (li.status !== 200) throw new Error(`${local}: ${JSON.stringify(li.data)}`);
    return { local, name, cookie: li.cookie, user: li.data.user, secretKey: await openEnvelope(li.data.envelope, wrapKey) };
  }
  if (r.status !== 200) throw new Error(`${local}: ${JSON.stringify(r.data)}`);
  return { local, name, cookie: r.cookie, user: r.data.user, secretKey };
}
type Account = Awaited<ReturnType<typeof account>>;

// Hora de exibição: minutos antes das 9:41 de hoje (hora do Mac, a mesma do simulador), ou dias atrás. Mensagem
// de outra conta Shalom só abre se a chegada cair na validade do certificado do remetente (1 dia a partir do
// envio): essas ficam sempre de hoje, depois da hora em que o script rodou.
const today = new Date(); today.setHours(9, 41, 0, 0);
const at = (hhmm: string, daysAgo = 0) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(today); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0);
  return d;
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
const rfc = (d: Date) => {
  const off = -d.getTimezoneOffset();
  const zone = `${off >= 0 ? '+' : '-'}${p2(Math.floor(Math.abs(off) / 60))}${p2(Math.abs(off) % 60)}`;
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:00 ${zone}`;
};
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n');
const subj = (s: string) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
const PDF = Buffer.from('%PDF-1.4\n');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const fakeFile = (head: Buffer, kb: number) => Buffer.concat([head, randomBytes(kb * 1024)]);

type Outside = { kind: 'out'; when: Date; from: string; name: string; subject: string; text?: string; html?: string; spam?: boolean; seen?: boolean; starred?: boolean; file?: [string, string, Buffer] };
type Shalom = { kind: 'shalom'; when: Date; from: string; subject: string; text: string; reply?: string; seen?: boolean; file?: [string, string, Buffer] };
type Event = Outside | Shalom;

const people = lang === 'en'
  ? { me: ['emma', 'Emma Hart'], contract: ['noah', 'Noah Bennett'], photos: ['sofia', 'Sofia Reyes'], plan: ['olivia', 'Olivia Park'] }
  : { me: ['ana', 'Ana Ribeiro'], contract: ['lia', 'Lia Moraes'], photos: ['pedro', 'Pedro Alves'], plan: ['helena', 'Helena Prado'] };

const en: Event[] = [
  { kind: 'out', when: at('18:20', 2), from: 'trips@lumenair.com', name: 'Lumen Airlines', subject: 'Your boarding pass: JFK → LIS', seen: true,
    text: 'Hi Emma,\n\nYou are checked in for flight LM 204 on November 3, seat 14A.\nYour boarding pass is attached. Boarding closes 20 minutes before departure.\n\nHave a great trip,\nLumen Airlines', file: ['boarding-pass.pdf', 'application/pdf', fakeFile(PDF, 96)] },
  { kind: 'out', when: at('20:05', 2), from: 'e.collins@lawchambers-intl.org', name: 'Edward Collins, Esq.', subject: 'Inheritance claim: $4.5M awaiting you', spam: true,
    text: 'Dear beneficiary, a late client of our chambers named you in his will. Reply with your bank details to release the funds.' },
  { kind: 'shalom', when: at('06:44'), from: 'plan', subject: 'Quarterly plan, final draft', seen: true,
    text: 'Hi Emma,\n\nHere is the final draft of the quarterly plan. I added the budget notes you asked for in section 3.\nShall we go over it on Monday?\n\nOlivia', file: ['quarterly-plan.pdf', 'application/pdf', fakeFile(PDF, 240)] },
  { kind: 'out', when: at('13:40', 1), from: 'notice@express-parcel-track.net', name: 'Express Delivery', subject: 'Your package is on hold: update payment', spam: true,
    text: 'We could not deliver your package. Pay a $1.99 fee within 24 hours or it will be returned.' },
  { kind: 'out', when: at('19:22', 1), from: 'daniel@kimfamily.net', name: 'Daniel Kim', subject: 'Barbecue on Saturday? 🍔', seen: true, starred: true,
    text: 'Hey Emma! Saturday at our place, from 1 pm. Just bring ice 🧊\n\nDaniel' },
  { kind: 'out', when: at('23:10', 1), from: 'invest@cryptowealth-pro.io', name: 'Crypto Wealth', subject: 'Double your bitcoin in 7 days', spam: true,
    text: 'Our trading robot doubles any bitcoin deposit in one week. Spots are limited, act now.' },
  { kind: 'out', when: at('06:58'), from: 'win@gift-center-rewards.biz', name: 'Gift Center', subject: "Congratulations! You've won a $500 gift card!!!", spam: true,
    text: 'You were selected! Claim your $500 gift card before midnight.' },
  { kind: 'out', when: at('07:30'), from: 'hello@morningbrief.news', name: 'The Morning Brief', subject: '5 stories to start your day', seen: true,
    html: '<div style="font-family:Georgia,serif;max-width:600px"><p style="font-size:22px">Good morning, Emma.</p><p>Markets hold steady, rain returns to the coast, and three more stories worth your coffee.</p><p>Read them in under five minutes.</p></div>' },
  { kind: 'out', when: at('08:05'), from: 'statements@northwindbank.com', name: 'Northwind Bank', subject: 'Your November statement is ready', seen: true,
    html: '<div style="font-family:Arial,sans-serif;max-width:560px"><p>Hi Emma, your November statement is closed.</p><p>Balance: <b>$1,284.90</b>. Due date: November 10.</p><p>Pay in the app or set up autopay.</p></div>' },
  { kind: 'out', when: at('08:12'), from: 'statements@northwindbank.com', name: 'Northwind Bank', subject: 'Urgent: verify your account within 24 hours', spam: true,
    html: '<p>We detected unusual activity. <a href="http://northwind-secure-login.com/verify">northwindbank.com/verify</a></p>' },
  { kind: 'shalom', when: at('08:31'), from: 'contract', subject: 'Contract reviewed', seen: true,
    text: 'Emma, I went through the supplier contract. The numbers are within what we agreed.\nOnly your signature on page 4 is missing.\n\nNoah',
    reply: 'Thanks, Noah. I will sign it this afternoon and send it back scanned.\nCan you confirm the delivery date with them?' },
  { kind: 'out', when: at('08:47'), from: 'maya@northstudio.design', name: 'Maya Collins', subject: 'Logo: two versions',
    text: 'Hi Emma,\n\nAttached are both versions of the seal. I prefer the second one, with the thinner stroke.\nLet me know which one we go with and I will finish the files by Friday.\n\nBest,\nMaya', file: ['logo-v2.pdf', 'application/pdf', fakeFile(PDF, 180)] },
  { kind: 'shalom', when: at('09:14'), from: 'photos', subject: 'Photos from Lisbon 📸',
    text: 'Emma! Here are the best ones from the trip 😍\nThe sunset at the miradouro is my favorite 🌅\n\nMiss you already,\nSofia', file: ['lisbon-sunset.jpg', 'image/jpeg', fakeFile(JPEG, 412)] },
  { kind: 'shalom', when: at('09:32'), from: 'contract', subject: 'Re: Contract reviewed',
    text: 'Confirmed: delivery on the 12th. I will wait for the signed page 👍' },
];

const pt: Event[] = [
  { kind: 'out', when: at('18:20', 2), from: 'viagens@aerealume.com.br', name: 'Aérea Lume', subject: 'Seu cartão de embarque: GRU → LIS', seen: true,
    text: 'Olá, Ana,\n\nSeu check-in no voo LM 204, de 3 de novembro, está feito. Assento 14A.\nO cartão de embarque vai em anexo. O embarque fecha 20 minutos antes da partida.\n\nBoa viagem,\nAérea Lume', file: ['cartao-de-embarque.pdf', 'application/pdf', fakeFile(PDF, 96)] },
  { kind: 'out', when: at('20:05', 2), from: 'e.collins@escritorio-intl.org', name: 'Dr. Eduardo Collins', subject: 'Herança de US$ 4,5 milhões aguardando você', spam: true,
    text: 'Prezada beneficiária, um cliente falecido do nosso escritório deixou uma herança em seu nome. Responda com seus dados bancários para liberar o valor.' },
  { kind: 'shalom', when: at('06:44'), from: 'plan', subject: 'Planejamento do trimestre, versão final', seen: true,
    text: 'Oi, Ana,\n\nSegue a versão final do planejamento do trimestre. Coloquei as notas de orçamento que você pediu na seção 3.\nRepassamos juntas na segunda?\n\nHelena', file: ['planejamento-trimestre.pdf', 'application/pdf', fakeFile(PDF, 240)] },
  { kind: 'out', when: at('13:40', 1), from: 'aviso@correio-expresso-rastreio.net', name: 'Correio Expresso', subject: 'Sua encomenda está retida: atualize o pagamento', spam: true,
    text: 'Não conseguimos entregar sua encomenda. Pague a taxa de R$ 9,90 em 24 horas ou ela volta ao remetente.' },
  { kind: 'out', when: at('19:22', 1), from: 'rafael@limafamilia.com.br', name: 'Rafael Lima', subject: 'Churrasco no sábado? 🍖', seen: true, starred: true,
    text: 'Fala, Ana! Sábado lá em casa, a partir das 13h. Leva só o gelo 🧊\n\nRafael' },
  { kind: 'out', when: at('23:10', 1), from: 'contato@rendaextra-ja.io', name: 'Renda Extra Já', subject: 'Ganhe dinheiro com bitcoin em 7 dias', spam: true,
    text: 'Nosso robô dobra qualquer depósito em uma semana. Vagas limitadas, garanta a sua agora.' },
  { kind: 'out', when: at('06:58'), from: 'premios@central-premios.biz', name: 'Central de Prêmios', subject: 'Parabéns! Você ganhou um vale de R$ 500!!!', spam: true,
    text: 'Você foi selecionada! Resgate seu vale de R$ 500 até a meia-noite.' },
  { kind: 'out', when: at('07:30'), from: 'noticias@jornaldodia.com.br', name: 'Jornal do Dia', subject: 'As 5 notícias da manhã', seen: true,
    html: '<div style="font-family:Georgia,serif;max-width:600px"><p style="font-size:22px">Bom dia, Ana.</p><p>Mercado estável, a chuva volta ao litoral e mais três destaques para ler com o café.</p><p>Tudo em menos de cinco minutos.</p></div>' },
  { kind: 'out', when: at('08:05'), from: 'contas@bancoalfa.com.br', name: 'Banco Alfa', subject: 'Sua fatura de novembro fechou', seen: true,
    html: '<div style="font-family:Arial,sans-serif;max-width:560px"><p>Oi, Ana, sua fatura de novembro fechou.</p><p>Valor: <b>R$ 1.284,90</b>. Vencimento: 10/11.</p><p>Pague pelo app ou pelo débito automático.</p></div>' },
  { kind: 'out', when: at('08:12'), from: 'contas@bancoalfa.com.br', name: 'Banco Alfa', subject: 'Urgente: confirme seus dados em 24 horas', spam: true,
    html: '<p>Detectamos um acesso incomum. <a href="http://bancoalfa-seguranca.com/login">bancoalfa.com.br/confirmar</a></p>' },
  { kind: 'shalom', when: at('08:31'), from: 'contract', subject: 'Contrato revisado', seen: true,
    text: 'Ana, revisei o contrato com o fornecedor. Os valores ficaram dentro do combinado.\nSó falta a sua assinatura na página 4.\n\nLia',
    reply: 'Obrigada, Lia. Assino hoje à tarde e te mando escaneado.\nPode confirmar a data de entrega com eles?' },
  { kind: 'out', when: at('08:47'), from: 'carla@estudio.design', name: 'Carla Souza', subject: 'Logo: duas versões',
    text: 'Oi, Ana,\n\nSeguem as duas versões do lacre. Gostei mais da segunda, com o traço mais fino.\nMe diz qual seguimos que eu fecho os arquivos até sexta.\n\nAbraço,\nCarla', file: ['logo-v2.pdf', 'application/pdf', fakeFile(PDF, 180)] },
  { kind: 'shalom', when: at('09:14'), from: 'photos', subject: 'Fotos de Lisboa 📸',
    text: 'Ana! Separei as melhores da viagem 😍\nO pôr do sol no miradouro é a minha favorita 🌅\n\nJá com saudade,\nPedro', file: ['por-do-sol-lisboa.jpg', 'image/jpeg', fakeFile(JPEG, 412)] },
  { kind: 'shalom', when: at('09:32'), from: 'contract', subject: 'Re: Contrato revisado',
    text: 'Confirmado: entrega no dia 12. Fico no aguardo da página assinada 👍' },
];

const me = await account(people.me[0], people.me[1]);
const contacts: Record<string, Account> = {
  contract: await account(people.contract[0], people.contract[1]),
  photos: await account(people.photos[0], people.photos[1]),
  plan: await account(people.plan[0], people.plan[1]),
};
const myAddr = `${me.local}@${DOMAIN}`;
const mePerson = { name: me.name, address: myAddr };
const personOf = (a: Account) => ({ name: a.name, address: `${a.local}@${DOMAIN}` });
const callAs = (a: Account) => (m: string, path: string, body?: unknown) => call(m, path, body, a.cookie);
const pause = () => new Promise(r => setTimeout(r, 40));

// O que entra na caixa da pessoa, em ordem de chegada, por pasta (a etapa 2 casa com os ids nessa ordem).
const want: Record<'inbox' | 'spam' | 'sent', { at: number; seen: boolean; starred: boolean; folder?: string }[]> = { inbox: [], spam: [], sent: [] };
const threads: Record<string, string[]> = {};

for (const e of lang === 'en' ? en : pt) {
  if (e.kind === 'out') {
    const parts = [
      `From: ${subj(e.name)} <${e.from}>`, `To: ${myAddr}`, `Subject: ${subj(e.subject)}`, `Date: ${rfc(e.when)}`, `Message-ID: <store-${e.when.getTime()}@${e.from.split('@')[1]}>`,
      `Authentication-Results: mx.cloudflare.net; ${e.spam ? 'dkim=none; spf=fail; dmarc=fail' : 'dkim=pass; spf=pass; dmarc=pass'} header.from=${e.from.split('@')[1]}`,
      'MIME-Version: 1.0',
    ];
    const body = e.html ? ['Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(e.html)]
      : ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(e.text!)];
    const raw = e.file
      ? [...parts, 'Content-Type: multipart/mixed; boundary="b"', '', '--b', ...body, '--b',
          `Content-Type: ${e.file[1]}; name="${e.file[0]}"`, `Content-Disposition: attachment; filename="${e.file[0]}"`, 'Content-Transfer-Encoding: base64', '',
          b64(e.file[2]), '--b--', ''].join('\r\n')
      : [...parts, ...body].join('\r\n');
    const res = await fetch(`${BASE}/cdn-cgi/handler/email?from=${e.from}&to=${myAddr}`, { method: 'POST', body: raw });
    if (!res.ok) throw new Error(await res.text());
    want[e.spam ? 'spam' : 'inbox'].push({ at: e.when.getTime(), seen: !!e.seen, starred: !!e.starred });
  } else {
    const who = contacts[e.from];
    const refs = threads[e.from] ?? [];
    const d = {
      from: personOf(who), to: [mePerson], cc: [], bcc: [], subject: e.subject, text: e.text, html: textToHtml(e.text), messageId: newMessageId(DOMAIN), date: e.when,
      ...(refs.length ? { inReplyTo: refs[refs.length - 1], references: refs.join(' ') } : {}),
      attachments: e.file ? [{ filename: e.file[0], type: e.file[1], content: new Uint8Array(e.file[2]) }] : [],
    };
    await sendSealed(BASE, callAs(who), who.secretKey, { address: myAddr, publicKey: fromB64(me.user.publicKey) }, buildMime(d, false), buildMime(d, true));
    want.inbox.push({ at: e.when.getTime(), seen: !!e.seen, starred: false });
    threads[e.from] = [...refs, d.messageId];
    if (e.reply) {
      await pause();
      const when = new Date(e.when.getTime() + 13 * 60_000);
      const all = threads[e.from];
      const r = {
        from: mePerson, to: [personOf(who)], cc: [], bcc: [], subject: `Re: ${e.subject}`, text: e.reply, html: textToHtml(e.reply), messageId: newMessageId(DOMAIN), date: when,
        inReplyTo: all[all.length - 1], references: all.join(' '),
      };
      await sendSealed(BASE, callAs(me), me.secretKey, { address: personOf(who).address, publicKey: fromB64(who.user.publicKey) }, buildMime(r, false), buildMime(r, true));
      want.sent.push({ at: when.getTime(), seen: true, starred: false });
      threads[e.from] = [...all, r.messageId];
    }
  }
  await pause();
}

// Ids na ordem de chegada, pasta por pasta.
// As boas-vindas do cadastro chegam antes de tudo. Vão para a Lixeira: são lacradas pelo sistema com
// certificado de 1 dia e não podem ir para a hora de demonstração.
want.inbox.unshift({ at: Date.now(), seen: true, starred: false, folder: 'trash' });
const plan: Plan = [];
for (const folder of ['inbox', 'spam', 'sent'] as const) {
  const rows = (await call('GET', `/api/messages?folder=${folder}&limit=100`, undefined, me.cookie)).data.messages as { id: string; received_at: number }[];
  const ids = rows.sort((a, b) => a.received_at - b.received_at).map(r => r.id);
  if (ids.length !== want[folder].length) throw new Error(`${folder}: esperava ${want[folder].length}, veio ${ids.length} (a conta precisa ser nova: só as boas-vindas antes)`);
  ids.forEach((id, i) => plan.push({ id, ...want[folder][i] }));
}
writeFileSync(planFile, JSON.stringify(plan));
console.log(`Etapa 1 pronta: ${myAddr}, ${plan.length} mensagens. Agora desligue o Worker e rode: node scripts/run-ts.mjs scripts/store-seed.ts fix ${lang}`);
