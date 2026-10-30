// E-mails que o próprio Shalom manda (confirmar o e-mail de recuperação, criar senha nova). Saem de
// nao-responda@ pelo Email Service. Com o envio desligado (dev), o link vai para o log.
import type { Env } from './env';
import { NOTIFY, notifyTexts, type NotifyTexts } from './notify-texts';
import { bump, now, randomToken, sendCaps, sendsKey, sha256, tally } from './util';

export type TokenKind = 'verify' | 'reset';
export const TOKEN_MS: Record<TokenKind, number> = { verify: 24 * 3600 * 1000, reset: 3600 * 1000 };

export async function newEmailToken(env: Env, userId: string, kind: TokenKind): Promise<string> {
  const token = randomToken();
  // Um link vivo por tipo: pedir de novo invalida o anterior.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?').bind(userId, kind),
    env.DB.prepare('INSERT INTO email_tokens (token_hash, user_id, kind, created_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), userId, kind, now()),
  ]);
  return token;
}

// Confere o link sem gastar. Devolve o dono, ou null se não existe, venceu ou é de outro tipo.
export async function peekEmailToken(env: Env, token: unknown, kind: TokenKind): Promise<string | null> {
  if (typeof token !== 'string' || token.length > 64) return null;
  const row = await env.DB.prepare('SELECT user_id, kind, created_at FROM email_tokens WHERE token_hash = ?').bind(await sha256(token))
    .first<{ user_id: string; kind: string; created_at: number }>();
  if (!row || row.kind !== kind || now() - row.created_at > TOKEN_MS[kind]) return null;
  return row.user_id;
}

export async function spendEmailToken(env: Env, token: string) {
  await env.DB.prepare('DELETE FROM email_tokens WHERE token_hash = ?').bind(await sha256(token)).run();
}

export const maskEmail = (email: string) => {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
};

const fill = (s: string, account: string) => s.replaceAll('{account}', account);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Mail = {
  origin: string;
  lang: string;
  t: NotifyTexts;
  preheader: string;       // a frase que aparece ao lado do assunto na lista de e-mails
  title: string;
  intro: string[];
  button: { label: string; href: string };
  warning?: string;        // caixa âmbar (senha nova: os e-mails guardados não voltam)
  after: string[];         // validade do link e "se não foi você"
  account: string;
};

// Modelo dos e-mails do Shalom: tabelas e estilo na linha (Gmail, Outlook, Apple Mail), botão que não
// quebra, link escrito por extenso de reserva e modo escuro onde o leitor suporta.
function page(m: Mail) {
  const dir = m.t.dir ?? 'ltr';
  const end = dir === 'rtl' ? 'left' : 'right';
  const p = (t: string, extra = '') => `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#3f3f46${extra}" class="t2">${esc(t)}</p>`;
  return `<!doctype html>
<html lang="${m.lang === 'pt' ? 'pt-BR' : m.lang}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(m.title)}</title>
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  a { color:#0a0a0a; }
  @media (prefers-color-scheme: dark) {
    .bg { background:#0a0a0b !important; }
    .card { background:#0a0a0b !important; }
    .t1 { color:#f5f5f7 !important; }
    .t2 { color:#c7c7cc !important; }
    .t3 { color:#8e8e93 !important; }
    .btn { background:#f5f5f7 !important; }
    .btn a { color:#0a0a0a !important; }
    .warn { background:#2a2110 !important; color:#f0b45a !important; }
    .rule { border-color:#2a2a2d !important; }
  }
  @media (max-width: 560px) { .card-pad { padding-left:24px !important; padding-right:24px !important; } }
</style>
</head>
<body class="bg" dir="${dir}" style="margin:0;padding:0;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(m.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:#ffffff">
<tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
  <tr><td class="card-pad" style="padding:0 40px 28px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="32" height="32" style="width:32px;height:32px;vertical-align:middle;padding:0;padding-${end}:10px;line-height:0">
        <img src="${m.origin}/email/icon.png" width="32" height="32" alt="Shalom Mail" style="display:block;width:32px;height:32px;border:0;border-radius:8px">
      </td>
      <td style="vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:20px;font-weight:600;color:#0a0a0a;letter-spacing:-0.01em" class="t1">Shalom Mail</td>
    </tr></table>
  </td></tr>
  <tr><td class="card" style="background:#ffffff">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td class="card-pad" style="padding:8px 40px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
      <h1 class="t1" style="margin:0 0 18px;font-size:24px;line-height:30px;font-weight:600;letter-spacing:-0.02em;color:#0a0a0a">${esc(m.title)}</h1>
      ${m.intro.map(t => p(t)).join('\n      ')}
      ${m.warning ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px"><tr><td class="warn" style="background:#fbf3e6;border-radius:14px;padding:14px 16px;font-size:14px;line-height:21px;color:#8a5206">${esc(m.warning)}</td></tr></table>` : ''}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 26px"><tr>
        <td class="btn" align="center" bgcolor="#0a0a0a" style="border-radius:12px;background:#0a0a0a">
          <a href="${esc(m.button.href)}" target="_blank" style="display:inline-block;padding:14px 24px;font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px">${esc(m.button.label)}</a>
        </td>
      </tr></table>
      ${m.after.map(t => p(t, ';font-size:14px;line-height:22px;color:#6b6b70')).join('\n      ')}
      <p class="t3" style="margin:18px 0 0;font-size:12px;line-height:18px;color:#8e8e93">${esc(m.t.copyLink)}<br><a href="${esc(m.button.href)}" style="color:#6b6b70;word-break:break-all">${esc(m.button.href)}</a></p>
    </td></tr>
    </table>
  </td></tr>
  <tr><td class="card-pad" style="padding:8px 40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <p class="t3" style="margin:0;font-size:12px;line-height:18px;color:#8e8e93">${esc(fill(m.t.footer, m.account))}</p>
  </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

async function send(env: Env, to: string, subject: string, text: string, html: string, link: string) {
  if (env.EMAIL_SENDING !== 'on') {
    console.log(`[envio desligado] ${subject}: ${link}`);
    return;
  }
  if ((await bump(env.DB, sendsKey(), 24 * 3600 * 1000)) > sendCaps(env).total) throw new Error('teto geral de envio do dia atingido');
  await env.EMAIL.send({ from: { email: `nao-responda@${env.MAIL_DOMAIN}`, name: 'Shalom Mail' }, to, subject, text, html } as unknown as EmailMessageBuilder);
  await tally(env.DB, 'sent_system');
}

const NOTIFY_LANG = (lang: string) => (NOTIFY[lang] ? lang : 'en');

function confirmMail(origin: string, lang: string, account: string, link: string): Mail {
  const t = notifyTexts(lang);
  const c = t.confirm;
  return {
    origin, lang: NOTIFY_LANG(lang), t, account,
    preheader: fill(c.preheader, account), title: c.title,
    intro: c.intro.map(x => fill(x, account)),
    button: { label: c.button, href: link },
    after: [c.after],
  };
}

function resetMail(origin: string, lang: string, account: string, link: string): Mail {
  const t = notifyTexts(lang);
  const r = t.reset;
  return {
    origin, lang: NOTIFY_LANG(lang), t, account,
    preheader: fill(r.preheader, account), title: r.title,
    intro: [fill(r.intro, account)],
    warning: r.warning,
    button: { label: r.button, href: link },
    after: [r.after],
  };
}

const plain = (m: Mail) =>
  [m.title, m.intro.join('\n\n'), m.warning, `${m.button.label}: ${m.button.href}`, m.after.join('\n\n')].filter(Boolean).join('\n\n');

// lang: o idioma guardado na conta (users.lang). Sem texto para ele, vai em inglês.
export async function sendConfirmRecovery(env: Env, to: string, account: string, token: string, lang: string) {
  const link = `${env.APP_ORIGIN}/confirmar?t=${token}`;
  const mail = confirmMail(env.APP_ORIGIN, lang, account, link);
  await send(env, to, mail.t.confirm.subject, plain(mail), page(mail), link);
}

export async function sendReset(env: Env, to: string, account: string, token: string, lang: string) {
  const link = `${env.APP_ORIGIN}/nova-senha?t=${token}`;
  const mail = resetMail(env.APP_ORIGIN, lang, account, link);
  await send(env, to, mail.t.reset.subject, plain(mail), page(mail), link);
}

// Prévia dos modelos (scripts/email-preview.ts): o HTML de cada um com um link de exemplo.
export function previewMails(origin: string, lang = 'pt') {
  const account = 'helena@shalomail.com';
  return {
    confirmar: page(confirmMail(origin, lang, account, `${origin}/confirmar?t=exemplo`)),
    senha: page(resetMail(origin, lang, account, `${origin}/nova-senha?t=exemplo`)),
  };
}
