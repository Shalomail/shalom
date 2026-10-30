// Filtro de spam na chegada. É o único momento em que o servidor vê o e-mail aberto (antes de
// criptografar), então a decisão acontece aqui e só a pasta fica guardada. Pontuação simples e
// explicável; passou de SPAM_THRESHOLD, vai para Spam. A pessoa corrige com "Não é spam".
import type { Email } from 'postal-mime';
import type { MessageHead } from './head';

export const SPAM_THRESHOLD = 5;

const PHRASES = [
  /confirme (seus|os seus) dados/i, /atualize (seus|os seus) dados/i, /sua conta (foi|será) (bloqueada|suspensa|encerrada)/i,
  /acesso (incomum|suspeito) detectado/i, /clique aqui/i, /você (foi selecionad|ganhou)/i, /parab[eé]ns[,!]? você/i,
  /pr[eê]mio/i, /promo[cç][aã]o imperd[ií]vel/i, /ganhe dinheiro/i, /renda extra/i, /bitcoin|cripto(moeda)?s? gr[aá]tis/i,
  /verify your account/i, /account (suspended|locked)/i, /urgent(e)?:/i, /[uú]ltima chance/i, /oferta exclusiva/i,
  /sem consulta ao spc|empr[eé]stimo aprovado/i, /viagra|cialis/i, /herança|heranca|inheritance/i,
];

export function spamScore(email: Email, head: MessageHead, mailDomain: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => { score += n; reasons.push(why); };

  if (head.auth === 'fail') add(5, 'remetente não passou na verificação (DMARC)');
  const from = head.from?.address ?? '';
  if (from.endsWith(`@${mailDomain}`)) add(6, 'de fora fingindo ser do Shalom');
  if (!from) add(2, 'sem remetente');

  const text = `${email.subject || ''}\n${email.text || ''}\n${(email.html || '').replace(/<[^>]+>/g, ' ')}`;
  const hits = PHRASES.filter(r => r.test(text)).length;
  if (hits) add(Math.min(hits * 2, 6), `${hits} frase(s) típica(s) de golpe ou propaganda`);

  // Link cujo texto mostra um endereço e o destino é outro domínio.
  const html = email.html || '';
  let mismatch = 0;
  for (const m of html.matchAll(/<a\b[^>]*href=["']?(https?:\/\/[^"' >]+)[^>]*>([\s\S]*?)<\/a>/gi)) {
    const shown = m[2].replace(/<[^>]+>/g, '').trim().match(/([a-z0-9-]+\.)+[a-z]{2,}/i)?.[0]?.toLowerCase();
    const real = (() => { try { return new URL(m[1]).hostname.toLowerCase(); } catch { return ''; } })();
    if (shown && real && !real.endsWith(shown.replace(/^www\./, ''))) mismatch++;
  }
  if (mismatch) add(4, 'link que mostra um site e leva para outro');

  const links = (html.match(/<a\b/gi) || []).length;
  if (links > 25) add(1, 'excesso de links');
  const subject = email.subject || '';
  if (subject.length > 8 && subject === subject.toUpperCase() && /[A-Z]/.test(subject)) add(2, 'assunto todo em maiúsculas');
  if ((subject.match(/!/g) || []).length >= 3) add(1, 'muitas exclamações no assunto');
  return { score, reasons };
}
