// Administração do Shalom Mail pelo terminal, com a ADMIN_KEY (Keychain, serviço shalom-prod; no local, a
// do .dev.vars). Nada aqui lê e-mail.
//
//   npm run admin -- user <endereço>                 o básico da conta (criada em, caixas de agente, plano, suspensão)
//   npm run admin -- suspend <endereço> "<motivo>"   suspende por abuso: sai de todas as sessões e as chaves param
//   npm run admin -- unsuspend <endereço>            desfaz a suspensão
//   npm run admin -- delete <endereço> --yes         apaga de vez (sem --yes, só mostra o que seria apagado)
//
// --local fala com o Worker local (127.0.0.1:8790) em vez de shalomail.com.
//
// Gerar a ADMIN_KEY uma vez (fica só no Keychain; o deploy sobe para a Cloudflare):
//   npm run admin -- new-key
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const local = args.includes('--local');
const yes = args.includes('--yes');
const [cmd, address, reason] = args.filter(a => !a.startsWith('--'));
const die = msg => { console.error(msg); process.exit(1); };

const keychain = ['-s', 'shalom-prod', '-a', 'ADMIN_KEY'];
if (cmd === 'new-key') {
  try {
    execFileSync('security', ['find-generic-password', ...keychain], { stdio: 'ignore' });
    die('Já existe uma ADMIN_KEY no Keychain. Para trocar, apague antes: security delete-generic-password -s shalom-prod -a ADMIN_KEY');
  } catch { /* não existe: segue */ }
  execFileSync('security', ['add-generic-password', ...keychain, '-w', randomBytes(32).toString('base64url')]);
  console.log('ADMIN_KEY criada e guardada no Keychain (shalom-prod). Rode npm run deploy para ela valer em shalomail.com.');
  process.exit(0);
}

const USAGE = 'Uso: npm run admin -- <user|suspend|unsuspend|delete> <endereço> ["motivo"] [--yes] [--local]';
if (!['user', 'suspend', 'unsuspend', 'delete'].includes(cmd) || !address) die(USAGE);

const key = local
  ? /^ADMIN_KEY=(.+)$/m.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1]?.trim()
  : (() => { try { return execFileSync('security', ['find-generic-password', ...keychain, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } })();
if (!key) die(local ? 'Falta ADMIN_KEY no .dev.vars.' : 'Falta a ADMIN_KEY no Keychain. Crie com: npm run admin -- new-key');
const base = local ? 'http://127.0.0.1:8790' : 'https://shalomail.com';

async function call(path, body) {
  const res = await fetch(`${base}/api/admin/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shalom': '1', 'x-admin-key': key },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) die(res.status === 404 && json.error === 'not_found' && json.message === 'Não encontrado.'
    ? 'O servidor não aceitou a chave (ou a ADMIN_KEY ainda não subiu: rode npm run deploy).'
    : `${json.message ?? res.status}`);
  return json;
}

const show = u => {
  const lines = [
    `${u.address}${u.name ? ` (${u.name})` : ''}`,
    `  criada em ${new Date(u.createdAt).toISOString().slice(0, 10)}`,
    u.agentOf ? `  caixa de agente de ${u.agentOf}` : `  ${u.agents} caixa(s) de agente, plano ${u.plan}`,
    u.suspended ? `  SUSPENSA em ${new Date(u.suspended.at).toISOString().slice(0, 16).replace('T', ' ')}: ${u.suspended.reason}` : '  ativa',
  ];
  console.log(lines.join('\n'));
};

if (cmd === 'user') show(await call('user', { address }));
if (cmd === 'suspend') {
  if (!reason) die('Diga o motivo: npm run admin -- suspend <endereço> "spam em massa"');
  show(await call('suspend', { address, reason }));
}
if (cmd === 'unsuspend') show(await call('unsuspend', { address }));
if (cmd === 'delete') {
  const u = await call('user', { address });
  if (!yes) {
    show(u);
    console.log(`\nIsto apaga de vez a caixa, os e-mails${u.agents ? `, as ${u.agents} caixa(s) de agente` : ''} e a assinatura. Para confirmar, rode de novo com --yes.`);
    process.exit(0);
  }
  const { deleted } = await call('delete', { address });
  console.log(`Apagada: ${deleted.address}${deleted.agents ? ` e ${deleted.agents} caixa(s) de agente` : ''}. O endereço fica reservado.`);
}
