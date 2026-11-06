// Spam em duas partes. O servidor separa na chegada só o que não pede ler o texto: o remetente reprovado na
// verificação do domínio (DMARC) e quem é de fora fingindo ser do Shalom. O resto (frases de golpe, link que mostra
// um site e leva a outro, assunto gritado) é conferido no aparelho, onde o texto já está aberto: no site
// (web/src/lib/spamcheck.ts), no iPhone (ios/ShalomMail/Core/Mail/SpamCheck.swift, com esta regra empacotada
// em Resources/spam.js) e no CLI. Passou de SPAM_THRESHOLD, vai para Spam. A pessoa corrige com "Não é spam".
import type { MessageHead } from './head';

export const SPAM_THRESHOLD = 5;

export function serverSpam(head: MessageHead, mailDomain: string): boolean {
  return head.auth === 'fail' || (head.from?.address ?? '').endsWith(`@${mailDomain}`);
}

const PHRASES = [
  /confirme (seus|os seus) dados/i, /atualize (seus|os seus) dados/i, /sua conta (foi|será) (bloqueada|suspensa|encerrada)/i,
  /acesso (incomum|suspeito) detectado/i, /clique aqui/i, /você (foi selecionad|ganhou)/i, /parab[eé]ns[,!]? você/i,
  /pr[eê]mio/i, /promo[cç][aã]o imperd[ií]vel/i, /ganhe dinheiro/i, /renda extra/i, /bitcoin|cripto(moeda)?s? gr[aá]tis/i,
  /verify your account/i, /account (suspended|locked)/i, /urgent(e)?:/i, /[uú]ltima chance/i, /oferta exclusiva/i,
  /sem consulta ao spc|empr[eé]stimo aprovado/i, /viagra|cialis/i, /herança|heranca|inheritance/i,
];

export type Readable = { subject?: string; text?: string; html?: string; from?: string };

// Só o começo do texto e do HTML entra na conta, e as regras são lineares: o aparelho confere o que chega de fora
// sem clique de ninguém, então um HTML montado para isso não pode travá-lo.
const CAP = 256 * 1024;
const tags = (s: string) => s.replace(/<[^<>]*>/g, ' ');

// O href de verdade: atributos lidos um a um, valendo o primeiro chamado href (como no navegador), sem confundir com
// data-href nem com "href=" escrito dentro de outro atributo. Tab e quebra de linha saem, como o navegador faz.
function hrefOf(attrs: string): string | undefined {
  for (const a of attrs.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    if (a[1].toLowerCase() !== 'href') continue;
    const v = (a[2] ?? a[3] ?? a[4] ?? '').replace(/[\t\n\r]/g, '').trim();
    return /^https?:\/\//i.test(v) ? v : undefined;
  }
}

export function contentScore(email: Readable): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => { score += n; reasons.push(why); };

  if (!email.from) add(2, 'sem remetente');

  const html = (email.html || '').slice(0, CAP);
  const text = `${email.subject || ''}\n${(email.text || '').slice(0, CAP)}\n${tags(html)}`;
  const hits = PHRASES.filter(r => r.test(text)).length;
  if (hits) add(Math.min(hits * 2, 6), `${hits} frase(s) típica(s) de golpe ou propaganda`);

  // Link cujo texto mostra um endereço e o destino é outro domínio. A tag de abertura é lida sozinha, o href sai
  // dela com uma regra sem ambiguidade e o </a> é achado por posição: nenhuma regra disputa os mesmos caracteres.
  let mismatch = 0;
  const lower = html.replace(/[A-Z]+/g, x => x.toLowerCase());
  const closes: number[] = [];
  for (let k = lower.indexOf('</a>'); k >= 0; k = lower.indexOf('</a>', k + 4)) closes.push(k);
  let c = 0;
  for (const m of html.matchAll(/<a\b([^<>]*)>/gi)) {
    const start = m.index! + m[0].length;
    while (c < closes.length && closes[c] < start) c++;
    if (c === closes.length) break;
    const end = closes[c];
    if (end - start > 6300) continue;
    c++;
    const href = hrefOf(m[1]);
    if (!href) continue;
    const shown = tags(html.slice(start, end)).trim().slice(0, 300).match(/([a-z0-9-]+\.)+[a-z]{2,}/i)?.[0]?.toLowerCase();
    // Sem URL(), que o JavaScriptCore do app não tem: o host fica depois de "//" e de um "usuário@" opcional.
    const real = /^https?:\/\/(?:[^\/\\?#@]*@)?([^\/\\?#:]+)/i.exec(href)?.[1]?.toLowerCase() ?? '';
    // O mesmo domínio ou um subdomínio dele; "xbanco.com.br" não é "banco.com.br".
    const host = shown?.replace(/^www\./, '');
    if (host && real && real !== host && !real.endsWith(`.${host}`)) mismatch++;
  }
  if (mismatch) add(4, 'link que mostra um site e leva para outro');

  const links = (html.match(/<a\b/gi) || []).length;
  if (links > 25) add(1, 'excesso de links');
  const subject = email.subject || '';
  if (subject.length > 8 && subject === subject.toUpperCase() && /[A-Z]/.test(subject)) add(2, 'assunto todo em maiúsculas');
  if ((subject.match(/!/g) || []).length >= 3) add(1, 'muitas exclamações no assunto');
  return { score, reasons };
}
