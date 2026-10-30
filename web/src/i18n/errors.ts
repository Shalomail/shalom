// Erros do servidor no idioma do app. O servidor responde { error: código, message: texto em português }
// (worker/*.ts). A tradução vai pelo código; quando o mesmo código tem mais de um caso, o texto em
// português diz qual é, e números ou endereços saem dele. Código sem tradução mostra o texto do servidor.
import { t, type Key, type Vars } from './index';

type Rule = Key | ((msg: string) => [Key, Vars?] | Key | null);

const has = (msg: string, ...words: string[]) => words.some(w => msg.includes(w));
// Primeiro número do texto ("limite de 50 entregas") e o endereço ("A caixa de lia@... está cheia.").
const numberIn = (msg: string) => Number(/\d+/.exec(msg)?.[0] ?? NaN);
const addressIn = (msg: string) => /[^\s@]+@[^\s@]+\.[a-z0-9-]+/i.exec(msg)?.[0] ?? '';

const RULES: Record<string, Rule> = {
  offline: 'err.offline',
  too_many: m => has(m, 'contas criadas') ? 'err.too_many_signups' : has(m, 'trocas') ? 'err.too_many_changes'
    : has(m, 'envios') ? 'err.too_many_sends' : 'err.too_many',
  wrong: m => has(m, 'Endereço ou senha') ? 'err.wrong_login' : has(m, 'senha atual') ? 'err.wrong_current'
    : has(m, 'Código') ? 'err.wrong_totp' : 'err.wrong',
  no_session: m => has(m, 'inatividade') ? 'mailbox.idleOut' : has(m, 'acabou') ? 'err.session_over' : 'err.no_session',
  slow_down: m => has(m, 'envios') ? 'err.slow_sends' : has(m, 'imagens') ? 'err.slow_images'
    : has(m, 'consultas') ? 'err.slow_lookups' : has(m, 'entregas') ? 'err.slow_deliveries' : 'err.slow_down',
  captcha: 'err.captcha',
  invite: 'err.invite',
  bad_address: 'err.bad_address',
  paused: 'err.paused',
  taken: m => has(m, 'acabou de ser') ? 'err.taken_now' : 'auth.addrTaken',
  locked: m => has(m, '15') ? 'err.locked_15' : 'err.locked_hour',
  wrong_captcha: 'err.wrong_captcha',
  ticket: 'err.ticket',
  wrong_second: m => has(m, 'PIN ou') ? 'err.wrong_pin_code' : has(m, 'PIN') ? 'err.wrong_pin' : 'err.wrong_code',
  link: m => has(m, 'configurações') ? 'err.link_settings' : 'err.link',
  bad_request: m => has(m, 'Escreva um nome') ? 'err.name_required' : has(m, 'PIN tem') ? 'err.pin_digits' : 'err.bad_request',
  bad_type: 'err.bad_type',
  too_big: m => has(m, 'Foto') ? 'err.too_big_photo' : has(m, 'Imagem') ? 'err.too_big_image' : 'err.too_big_message',
  already: 'err.already',
  state: m => has(m, 'desligada') ? 'err.state_off' : 'err.state_restart',
  bad_email: 'err.bad_email',
  own_domain: 'err.own_domain',
  none: 'err.no_recovery',
  bad_folder: 'err.bad_folder',
  not_found: 'err.not_found',
  bad_cursor: 'err.bad_cursor',
  send_limit: m => {
    const n = numberIn(m);
    if (Number.isNaN(n)) return null;
    return [has(m, 'fora do Shalom') ? 'err.send_limit_external' : 'err.send_limit', { n }];
  },
  send_limit_all: 'err.send_limit_all',
  too_many_recipients: m => { const n = numberIn(m); return Number.isNaN(n) ? null : ['err.too_many_recipients', { n }]; },
  bad_recipient: m => {
    if (has(m, 'Contas Shalom')) return 'err.bad_recipient_internal';
    if (has(m, 'Destino')) return 'err.bad_destination';
    const address = /:\s*(.+)$/.exec(m)?.[1];
    return address ? ['err.bad_recipient', { address }] : null;
  },
  send_failed: 'err.send_failed',
  full: m => {
    if (has(m, 'Sua caixa')) return 'err.full';
    const address = addressIn(m);
    return address ? ['err.full_recipient', { address }] : null;
  },
  recipient_busy: m => { const address = addressIn(m); return address ? ['err.recipient_busy', { address }] : null; },
  no_such_user: m => { const address = addressIn(m); return address ? ['err.no_such_user', { address }] : null; },
  img_failed: 'err.img_failed',
  bad_token: m => has(m, 'vencido') ? 'err.bad_token_expired' : 'err.bad_token',
  token_used: 'err.token_used',
  bad_seal: 'err.bad_seal',
  csrf: 'err.csrf',
  suspended: 'err.suspended',
  maintenance: 'err.maintenance',
  confirm: 'err.confirm_address',
  stripe_error: m => (has(m, 'nada foi apagado') ? 'err.delete_stripe' : null),
  internal: 'err.internal',
};

export function apiMessage(code: string, message: string | undefined): string {
  const rule = RULES[code];
  if (rule) {
    const hit = typeof rule === 'function' ? rule(message ?? '') : rule;
    if (hit) return Array.isArray(hit) ? t(hit[0], hit[1]) : t(hit);
  }
  return message || t('common.genericError');
}
