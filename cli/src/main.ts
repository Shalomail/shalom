// shalom: e-mail cifrado de ponta a ponta para agentes de IA, pelo terminal.
// A pessoa entra com a chave de API da conta (Configurações > Chaves de API) e cria caixas de agente;
// cada caixa guarda a chave privada só nesta máquina (store.ts). Tudo tem saída --json para agentes.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import type { Email } from 'postal-mime';
import { fromB64, newKeyPair, open, toB64 } from '../../shared/seal';
import type { Person } from '../../shared/head';
import { ApiError, call, DOMAIN, Mailbox, type Folder } from './client';
import { addrs, bodyText, htmlToText, messageJson, people, replyDraft, typeOf, when, who } from './message';
import {
  agentPathOf, apiOf, configPath, envToken, exportToken, importToken, listAgentFiles, loadAgentFile, loadConfig, loadPins, removeAgentFile,
  saveAgent, saveConfig, savePins, StoreError, toAgent, type AgentFile,
} from './store';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';

const HELP = `shalom ${VERSION}: end-to-end encrypted mailboxes for AI agents (https://${DOMAIN})

Account
  shalom login                            Connect this terminal to your account in the browser
                                          (--no-browser to only print the link, --key for CI)
  shalom logout                           Forget the account key
  shalom whoami                           Show the account and the agents saved here
  shalom agents list                      List your agent mailboxes
  shalom agents create <name> [--name "Display name"]
                                          Create <name>@${DOMAIN}; its private key stays on this machine
  shalom agents delete <address> [--yes]  Delete a mailbox and everything in it
  shalom agents rotate <address>          Issue a new API key for a mailbox
  shalom agents export <address>          Print SHALOM_AGENT_TOKEN to run the agent on a server
  shalom agents import <token> [--yes]    Save an exported agent on this machine
  shalom plan                             Show your plan and how many mailboxes you use
  shalom upgrade                          Open the plans page: up to 5 mailboxes for US$ 4.99/mo, 12 for
                                          US$ 9.99/mo, or unlimited for US$ 49.90/mo (up to 250 new a day)

Mailbox (pick the agent with --as <address>, or set SHALOM_AGENT_TOKEN)
  shalom inbox [--folder inbox] [--limit 20] [--unread]
  shalom read <id> [--save-attachments <dir>] [--keep-unread]
  shalom send --to <address> --subject <text> [--text <text> | --text-file <file> | stdin]
              [--cc ...] [--bcc ...] [--html-file <file>] [--attach <file> ...]
  shalom reply <id> [--all] [--text <text> | --text-file <file> | stdin] [--no-quote]
  shalom move <id...> --to <inbox|archive|spam|trash>
  shalom mark <id...> [--read | --unread | --star | --unstar]
  shalom watch [--interval 15] [--exec "<command>"] [--mark-read]
                                          Wait for new mail; --exec runs a command per message with
                                          the message as JSON on stdin

Every command accepts --json for machine-readable output and --api <url> to use another server.
Ids can be shortened to their first 8 characters.`;

class CliError extends Error {}
const die = (msg: string): never => { throw new CliError(msg); };

let jsonMode = false;
const out = (human: string, json?: unknown) => {
  if (jsonMode) { if (json !== undefined) process.stdout.write(JSON.stringify(json, null, 2) + '\n'); }
  else process.stdout.write(human + '\n');
};

const fullAddress = (s: string) => (s.includes('@') ? s : `${s}@${DOMAIN}`).toLowerCase();

async function ask(question: string, hidden = false): Promise<string> {
  if (!process.stdin.isTTY) die('Missing input. Pass it as a flag (this terminal cannot prompt).');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => { if (s.startsWith(question)) process.stdout.write(question); };
  return new Promise(resolve => rl.question(question, a => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); }));
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// ---- conta ----

function account(apiFlag?: string) {
  const cfg = loadConfig();
  const key = process.env.SHALOM_API_KEY || cfg.accountKey;
  if (!key) die('Not logged in. Run `shalom login` to connect this terminal.');
  return { api: apiOf(apiFlag), key: key! };
}

type AgentInfo = { id: string; address: string; name: string; createdAt: number; paused: boolean };
type PlanInfo = { plan: string; limit: number | null; used: number };
const PLAN_NAME: Record<string, string> = { free: 'Free', agents5: 'Agents 5', agents12: 'Agents 12', unlimited: 'Unlimited' };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const OS: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

// Login pelo navegador: pede um código ao servidor, abre shalomail.com/conectar e espera a pessoa
// confirmar. A chave chega lacrada com a chave pública deste terminal, que só existe na memória daqui.
async function browserLogin(api: string, openIt: boolean): Promise<string> {
  const { secretKey, publicKey } = newKeyPair();
  const device = `${hostname().replace(/\.local$/, '')} (${OS[process.platform] ?? process.platform}), shalom ${VERSION}`;
  const start = await call<{ code: string; poll: string; url: string; interval: number; expiresIn: number }>(
    { api, key: '' }, 'POST', '/cli/start', { device, publicKey: toB64(publicKey) }, { anonymous: true });
  const say = (s: string) => process.stderr.write(s + '\n');
  say(`\nTo connect this terminal, confirm the code ${start.code} at:\n  ${start.url}\n`);
  if (openIt && process.stdout.isTTY) { openBrowser(start.url); say('Opened your browser. Waiting for you to confirm...'); }
  else say('Waiting for you to confirm...');
  const until = Date.now() + start.expiresIn * 1000;
  let wait = Math.max(1, start.interval) * 1000;
  while (Date.now() < until) {
    await sleep(wait);
    let r: { status: string; sealedKey?: string; account?: string };
    try {
      r = await call({ api, key: '' }, 'POST', '/cli/poll', { poll: start.poll }, { anonymous: true });
      wait = Math.max(1, start.interval) * 1000;
    } catch { wait = Math.min(wait * 2, 15000); continue; }
    if (r.status === 'approved' && r.sealedKey) return new TextDecoder().decode(await open(secretKey, fromB64(r.sealedKey), 'raw'));
    if (r.status === 'denied') die('The connection was cancelled in the browser.');
    if (r.status === 'expired') break;
  }
  return die('The code expired. Run `shalom login` again.');
}

async function login(args: string[]) {
  const { values } = parseArgs({ args, options: { key: { type: 'string' }, api: { type: 'string' }, json: { type: 'boolean' }, 'no-browser': { type: 'boolean' } } });
  jsonMode = !!values.json;
  const api = apiOf(values.api);
  const key = (values.key || process.env.SHALOM_API_KEY || await browserLogin(api, !values['no-browser'])).trim();
  if (!key.startsWith('shalom_sk_')) die('That is not an account API key. It starts with shalom_sk_.');
  const me = await call<{ user: { address: string } }>({ api, key }, 'GET', '/auth/me');
  saveConfig({ ...loadConfig(), api, accountKey: key, account: me.user.address });
  out(`Logged in as ${me.user.address}. Key saved in ${configPath()}.`, { account: me.user.address, api });
}

async function logout(args: string[]) {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' }, api: { type: 'string' } } });
  jsonMode = !!values.json;
  const { accountKey, account: _a, ...rest } = loadConfig();
  // A chave deixa de valer no servidor também, não só some deste computador.
  let revoked = !accountKey;
  if (accountKey) revoked = await call({ api: apiOf(values.api), key: accountKey }, 'POST', '/agents/logout', {}).then(() => true, e => e instanceof ApiError && e.status === 401);
  saveConfig(rest);
  out(revoked ? 'Logged out. Agent mailboxes saved on this machine were kept.'
    : 'Logged out here, but the server could not be reached to revoke the key. Revoke it on the AI agents page.', { ok: true, revoked });
}

async function whoami(args: string[]) {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' }, api: { type: 'string' } } });
  jsonMode = !!values.json;
  const cfg = loadConfig();
  const local = listAgentFiles().map(a => a.address);
  let address = cfg.account ?? null;
  if (cfg.accountKey || process.env.SHALOM_API_KEY) {
    address = (await call<{ user: { address: string } }>(account(values.api), 'GET', '/auth/me')).user.address;
  }
  out([
    address ? `Account: ${address}` : 'Account: not logged in (run `shalom login`)',
    `Server: ${apiOf(values.api)}`,
    `Agents on this machine: ${local.length ? local.join(', ') : 'none'}`,
  ].join('\n'), { account: address, api: apiOf(values.api), agents: local });
}

function planLine(p: PlanInfo) {
  if (p.limit === null) return `${p.used} agent mailboxes in use (Unlimited, up to 250 new a day).`;
  const next = p.plan === 'free' ? ' Need more? `shalom upgrade 5` (US$ 4.99/mo), `shalom upgrade 12` (US$ 9.99/mo) or `shalom upgrade unlimited` (US$ 49.90/mo).'
    : p.plan === 'agents5' ? ' Need more? `shalom upgrade 12` (US$ 9.99/mo) or `shalom upgrade unlimited` (US$ 49.90/mo).'
    : ' Need more? `shalom upgrade unlimited` (US$ 49.90/mo).';
  return `${p.used} of ${p.limit} agent mailboxes used (${PLAN_NAME[p.plan] ?? p.plan}).${p.used >= p.limit ? next : ''}`;
}

async function agentsCmd(args: string[]) {
  const [sub, ...rest] = args;
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: { json: { type: 'boolean' }, api: { type: 'string' }, name: { type: 'string' }, yes: { type: 'boolean', short: 'y' } },
  });
  jsonMode = !!values.json;

  if (sub === 'import') {
    const token = positionals[0] || process.env.SHALOM_AGENT_TOKEN || die('Usage: shalom agents import <token>');
    const file = importToken(token);
    // Já existe uma caixa salva com esse endereço: só troca com --yes, e as chaves fixadas dos contatos ficam.
    const old = loadAgentFile(file.address);
    if (old && !values.yes) {
      if (old.key === file.key && old.secretKey === file.secretKey) return out(`${file.address} is already saved in ${agentPathOf(file.address)}.`, { address: file.address, file: agentPathOf(file.address) });
      die(`${file.address} is already saved on this machine with other keys. Pass --yes to replace it.`);
    }
    file.createdAt = old?.createdAt ?? Date.now();
    if (old?.pins) file.pins = old.pins;
    saveAgent(file);
    return out(`Saved ${file.address} in ${agentPathOf(file.address)}.`, { address: file.address, file: agentPathOf(file.address) });
  }
  if (sub === 'export') {
    const address = fullAddress(positionals[0] || die('Usage: shalom agents export <address>'));
    const file = loadAgentFile(address) ?? die(`${address} is not saved on this machine.`);
    if (!jsonMode) process.stderr.write('This token contains the private key of the mailbox. Store it as a secret.\n');
    return out(exportToken(file), { address, token: exportToken(file) });
  }

  const creds = account(values.api);
  const list = () => call<{ agents: AgentInfo[]; plan: PlanInfo }>(creds, 'GET', '/agents');

  if (!sub || sub === 'list' || sub === 'ls') {
    const { agents, plan } = await list();
    if (jsonMode) return out('', { agents: agents.map(a => ({ ...a, onThisMachine: !!loadAgentFile(a.address) })), plan });
    if (!agents.length) return out(`No agent mailboxes yet. Create one: shalom agents create yourname-bot\n${planLine(plan)}`);
    const rows = agents.map(a => [a.address, a.name, new Date(a.createdAt).toISOString().slice(0, 10), a.paused ? 'paused' : 'active', loadAgentFile(a.address) ? 'here' : '']);
    return out(table(['ADDRESS', 'NAME', 'CREATED', 'STATUS', 'KEY'], rows) + '\n\n' + planLine(plan));
  }

  if (sub === 'create' || sub === 'new') {
    const local = positionals[0] || die('Usage: shalom agents create <name> [--name "Display name"]');
    const address = fullAddress(local);
    if (!address.endsWith(`@${DOMAIN}`)) die(`Agent mailboxes are always @${DOMAIN}.`);
    const { secretKey, publicKey } = newKeyPair();
    const r = await call<{ agent: { id: string; address: string; name: string; createdAt: number }; key: string }>(creds, 'POST', '/agents', {
      address, name: values.name ?? '', publicKey: toB64(publicKey),
    });
    const file: AgentFile = { ...r.agent, api: creds.api, key: r.key, secretKey: toB64(secretKey) };
    saveAgent(file);
    return out([
      `Created ${r.agent.address}.`,
      `Its private key and API key are in ${agentPathOf(r.agent.address)} (only on this machine).`,
      '',
      `Read mail:    shalom inbox --as ${r.agent.address}`,
      `Send mail:    shalom send --as ${r.agent.address} --to someone@example.com --subject "Hi" --text "Hello"`,
      `On a server:  shalom agents export ${r.agent.address}   (then set SHALOM_AGENT_TOKEN)`,
    ].join('\n'), { ...r.agent, file: agentPathOf(r.agent.address) });
  }

  const address = fullAddress(positionals[0] || die(`Usage: shalom agents ${sub} <address>`));
  const agent = (await list()).agents.find(a => a.address === address) ?? die(`${address} is not one of your agent mailboxes.`);

  if (sub === 'delete' || sub === 'rm') {
    if (!values.yes) {
      const typed = await ask(`This deletes ${address} and all its mail for good. Type the address to confirm: `);
      if (typed.toLowerCase() !== address) die('Not deleted.');
    }
    const local = loadAgentFile(address) ?? die(`${address} is not saved on this machine, and deleting from the terminal needs its own key. Delete it on the AI agents page of the app.`);
    await call(creds, 'POST', '/agents/delete', { id: agent.id, agentKey: local.key });
    removeAgentFile(address);
    return out(`Deleted ${address}.`, { deleted: address });
  }
  if (sub === 'rotate') {
    const file = loadAgentFile(address) ?? die(`${address} is not saved on this machine, so its private key is not here. Rotate from the machine that has it.`);
    // A chave nova chega lacrada para a chave privada da caixa, que só existe neste arquivo.
    const { sealedKey } = await call<{ sealedKey: string }>(creds, 'POST', '/agents/rotate', { id: agent.id });
    const key = new TextDecoder().decode(await open(fromB64(file.secretKey), fromB64(sealedKey), 'raw'));
    saveAgent({ ...file, key });
    return out(`New API key saved for ${address}. The old one stopped working.`, { address });
  }
  die(`Unknown command: shalom agents ${sub}. Run shalom --help.`);
}

async function planCmd(args: string[]) {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' }, api: { type: 'string' } } });
  jsonMode = !!values.json;
  const b = await call<{ plan: string; limit: number; used: number; status: string | null; periodEnd: number | null }>(account(values.api), 'GET', '/billing');
  out(planLine(b) + (b.periodEnd && b.plan !== 'free' ? `\nRenews on ${new Date(b.periodEnd).toISOString().slice(0, 10)}.` : ''), b);
}

// Assinar e trocar de plano é pela página Agentes de IA do app, com a conta aberta: a chave da conta não
// mexe em cobrança. O comando só abre a página.
async function upgrade(args: string[]) {
  const { values } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' }, api: { type: 'string' }, 'no-open': { type: 'boolean' } } });
  jsonMode = !!values.json;
  const url = `${apiOf(values.api)}/agentes-ia#ag-plans`;
  if (!values['no-open'] && !jsonMode && process.stdout.isTTY) openBrowser(url);
  out(`Choose your plan in the browser, on the AI agents page:\n${url}`, { url });
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const argv = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, argv, { stdio: 'ignore', detached: true }).unref(); } catch { /* sem navegador: o link já foi mostrado */ }
}

// ---- caixa do agente ----

function mailbox(asFlag?: string, apiFlag?: string) {
  let file: AgentFile;
  let persist = true;
  if (!asFlag && envToken()) {
    file = importToken(envToken()!);
    file.pins = loadPins(file.address);
    persist = false;
  } else if (asFlag || process.env.SHALOM_AGENT) {
    const address = fullAddress(asFlag || process.env.SHALOM_AGENT!);
    file = loadAgentFile(address) ?? die(`${address} is not saved on this machine. Create it with \`shalom agents create\` or import its token.`);
  } else {
    const all = listAgentFiles();
    if (all.length === 1) file = all[0];
    else die(all.length ? `Pick an agent with --as <address>: ${all.map(a => a.address).join(', ')}` : 'No agent mailbox on this machine. Create one: shalom agents create yourname-bot');
  }
  const cfg = loadConfig();
  const api = apiFlag ? apiOf(apiFlag) : file!.api;
  const box = new Mailbox(toAgent(file!, api), {
    server: cfg.serverKeys?.[api],
    onServer: wire => { const c = loadConfig(); saveConfig({ ...c, serverKeys: { ...c.serverKeys, [api]: wire } }); },
  });
  // Chave de cada contato Shalom fixada na primeira vez. Se mudar, o envio para.
  const checkPin = (address: string, publicKey: string, trust = false) => {
    const pins = file.pins ?? {};
    if (pins[address] && pins[address] !== publicKey && !trust) {
      die(`The encryption key of ${address} changed since the last time. Confirm with them, then resend with --trust-new-key.`);
    }
    if (pins[address] !== publicKey) {
      file.pins = { ...pins, [address]: publicKey };
      if (persist) saveAgent(file); else savePins(file.address, file.pins);
    }
  };
  return { box, file: file!, checkPin };
}

const mailOpts = { json: { type: 'boolean' }, api: { type: 'string' }, as: { type: 'string' } } as const;

const short = (id: string) => id.slice(0, 8);

function table(head: string[], rows: string[][]): string {
  const width = head.map((h, i) => Math.min(48, Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))));
  const cell = (s: string, i: number) => (s.length > width[i] ? s.slice(0, width[i] - 1) + '…' : s.padEnd(width[i]));
  return [head, ...rows].map(r => r.map(cell).join('  ').trimEnd()).join('\n');
}

async function inbox(args: string[]) {
  const { values } = parseArgs({ args, options: { ...mailOpts, folder: { type: 'string', default: 'inbox' }, limit: { type: 'string', default: '20' }, unread: { type: 'boolean' } } });
  jsonMode = !!values.json;
  const { box } = mailbox(values.as, values.api);
  const limit = Number(values.limit) || 20;
  const messages = values.unread ? await box.unread(values.folder as Folder, limit) : (await box.list(values.folder as Folder, limit)).messages;
  if (jsonMode) return out('', messages);
  if (!messages.length) return out(`Nothing in ${values.folder}.`);
  const rows = messages.map(m => [m.unread ? '•' : ' ', short(m.id), who(values.folder === 'sent' ? m.to[0] ?? null : m.from), m.subject || '(no subject)', when(m.receivedAt)]);
  out(table(['', 'ID', values.folder === 'sent' ? 'TO' : 'FROM', 'SUBJECT', 'DATE'], rows));
}

async function read(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { ...mailOpts, 'save-attachments': { type: 'string' }, 'keep-unread': { type: 'boolean' } } });
  jsonMode = !!values.json;
  const { box } = mailbox(values.as, values.api);
  const { summary, email } = await box.read(positionals[0] || die('Usage: shalom read <id>'));
  if (!values['keep-unread'] && summary.unread) await box.update([summary.id], { seen: true });
  const saved: string[] = [];
  if (values['save-attachments']) {
    mkdirSync(values['save-attachments'], { recursive: true });
    // Dois anexos com o mesmo nome (comum: image.png) não se sobrescrevem: o segundo vira "image (2).png".
    const used = new Set<string>();
    for (const a of email.attachments) {
      const name = basename(a.filename || 'attachment').replace(/^\.+/, '_');
      const dot = name.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let unique = name;
      for (let n = 2; used.has(unique.toLowerCase()); n++) unique = `${stem} (${n})${ext}`;
      used.add(unique.toLowerCase());
      const path = join(values['save-attachments'], unique);
      writeFileSync(path, new Uint8Array(a.content as ArrayBuffer));
      saved.push(path);
    }
  }
  if (jsonMode) return out('', { ...messageJson(summary, email), saved });
  const lines = [
    `From:    ${who(summary.from)}${summary.verifiedSender ? '  (Shalom, end-to-end, sender verified)' : summary.auth === 'fail' ? '  (WARNING: sender not authenticated)' : ''}`,
    `To:      ${addrs(email.to).map(who).join(', ')}`,
    ...(email.cc?.length ? [`Cc:      ${addrs(email.cc).map(who).join(', ')}`] : []),
    `Date:    ${email.date ?? when(summary.receivedAt)}`,
    `Subject: ${summary.subject || '(no subject)'}`,
    `Id:      ${summary.id}`,
    '',
    bodyText(email) || '(empty)',
  ];
  if (email.attachments.length) {
    lines.push('', 'Attachments:', ...email.attachments.map(a => `  ${a.filename ?? 'attachment'} (${a.mimeType}, ${Math.ceil((a.content as ArrayBuffer).byteLength / 1024)} KB)`));
    if (saved.length) lines.push(`Saved to ${values['save-attachments']}.`);
  }
  out(lines.join('\n'));
}

async function bodyFrom(values: { text?: string; 'text-file'?: string }) {
  if (values.text !== undefined) return values.text;
  if (values['text-file']) return readFileSync(values['text-file'], 'utf8');
  return readStdin();
}

const sendOpts = {
  ...mailOpts, to: { type: 'string', multiple: true }, cc: { type: 'string', multiple: true }, bcc: { type: 'string', multiple: true },
  subject: { type: 'string' }, text: { type: 'string' }, 'text-file': { type: 'string' }, 'html-file': { type: 'string' },
  attach: { type: 'string', multiple: true }, 'trust-new-key': { type: 'boolean' },
} as const;

async function send(args: string[]) {
  const { values } = parseArgs({ args, options: sendOpts });
  jsonMode = !!values.json;
  const to = people(values.to);
  if (!to.length) die('Add at least one recipient with --to.');
  const html = values['html-file'] ? readFileSync(values['html-file'], 'utf8') : undefined;
  // Só com HTML: a versão em texto sai do próprio HTML, sem ficar esperando a entrada padrão.
  const text = html !== undefined && values.text === undefined && !values['text-file'] ? htmlToText(html) : await bodyFrom(values);
  if (!text.trim() && !html) die('Write the message with --text, --text-file or stdin.');
  const { box, file, checkPin } = mailbox(values.as, values.api);
  const attachments = (values.attach ?? []).map(p => ({ filename: basename(p), type: typeOf(p), content: new Uint8Array(readFileSync(p)) }));
  const r = await box.send({
    from: { name: file.name, address: file.address }, to, cc: people(values.cc), bcc: people(values.bcc),
    subject: values.subject ?? '', text, html, attachments,
  }, (a, k) => checkPin(a, k, values['trust-new-key']));
  out(`Sent from ${file.address} (${[r.internal && `${r.internal} Shalom, end-to-end`, r.external && `${r.external} outside`].filter(Boolean).join(', ')}).`, { ok: true, ...r });
}

async function reply(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { ...sendOpts, all: { type: 'boolean' }, 'no-quote': { type: 'boolean' } } });
  jsonMode = !!values.json;
  const { box, file, checkPin } = mailbox(values.as, values.api);
  const { summary, email } = await box.read(positionals[0] || die('Usage: shalom reply <id> --text "..."'));
  const text = await bodyFrom(values);
  if (!text.trim()) die('Write the reply with --text, --text-file or stdin.');
  const draft = replyDraft(summary, email, file.address, { text, all: values.all, quote: !values['no-quote'], to: people(values.to), cc: people(values.cc) });
  if (!draft.to.length) die('Could not tell who to reply to. Pass --to.');
  const r = await box.send({
    from: { name: file.name, address: file.address }, ...draft, bcc: people(values.bcc),
    attachments: (values.attach ?? []).map(p => ({ filename: basename(p), type: typeOf(p), content: new Uint8Array(readFileSync(p)) })),
  }, (a, k) => checkPin(a, k, values['trust-new-key']));
  out(`Replied to ${draft.to.map(who).join(', ')}.`, { ok: true, ...r });
}

async function resolveIds(box: Mailbox, ids: string[]) {
  if (!ids.length) die('Pass at least one message id.');
  // Id inteiro também passa pelo find: id que não existe vira erro, em vez de "Updated 1" sem mudar nada.
  return Promise.all(ids.map(async id => (await box.find(id)).id));
}

async function move(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { ...mailOpts, to: { type: 'string' } } });
  jsonMode = !!values.json;
  const folder = values.to as 'inbox' | 'archive' | 'spam' | 'trash';
  if (!['inbox', 'archive', 'spam', 'trash'].includes(folder)) die('Use --to inbox, archive, spam or trash.');
  const { box } = mailbox(values.as, values.api);
  const ids = await resolveIds(box, positionals);
  await box.update(ids, { folder });
  out(`Moved ${ids.length} to ${folder}.`, { ok: true, ids, folder });
}

async function mark(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { ...mailOpts, read: { type: 'boolean' }, unread: { type: 'boolean' }, star: { type: 'boolean' }, unstar: { type: 'boolean' } } });
  jsonMode = !!values.json;
  const change: { seen?: boolean; starred?: boolean } = {};
  if (values.read || values.unread) change.seen = !!values.read;
  if (values.star || values.unstar) change.starred = !!values.star;
  if (!Object.keys(change).length) die('Use --read, --unread, --star or --unstar.');
  const { box } = mailbox(values.as, values.api);
  const ids = await resolveIds(box, positionals);
  await box.update(ids, change);
  out(`Updated ${ids.length}.`, { ok: true, ids, ...change });
}

function runExec(command: string, message: unknown, env: Record<string, string>): Promise<number> {
  return new Promise(resolve => {
    // O programa chamado não herda as credenciais: o token da caixa (com a chave privada) e a chave da conta ficam aqui.
    const { SHALOM_AGENT_TOKEN: _t, SHALOM_API_KEY: _k, ...rest } = process.env;
    const child = spawn(command, { shell: true, stdio: ['pipe', 'inherit', 'inherit'], env: { ...rest, ...env } });
    child.on('error', () => resolve(127));
    child.on('close', code => resolve(code ?? 1));
    // Programa que sai sem ler a entrada fecha o cano: sem isto, o EPIPE derrubaria o watch.
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(message) + '\n');
  });
}

async function watch(args: string[]) {
  const { values } = parseArgs({ args, options: { ...mailOpts, interval: { type: 'string', default: '15' }, exec: { type: 'string' }, 'mark-read': { type: 'boolean' }, all: { type: 'boolean' } } });
  jsonMode = !!values.json;
  const { box, file } = mailbox(values.as, values.api);
  const every = Math.max(5, Number(values.interval) || 15) * 1000;
  // Com --mark-read, o que ficou sem ler é trabalho pendente: no reinício, as não lidas voltam a passar.
  const resume = !!values['mark-read'] && !values.all;
  const seen = new Set<string>();
  if (!values.all) for (const m of (await box.list('inbox', 100)).messages) if (!(resume && m.unread)) seen.add(m.id);
  if (!jsonMode) process.stderr.write(`Watching ${file.address} every ${every / 1000}s. Ctrl+C to stop.\n`);
  let stop = false;
  process.on('SIGINT', () => { stop = true; process.stderr.write('\n'); process.exit(0); });
  let wait = every;
  let first = true;
  while (!stop) {
    try {
      for (const m of await box.unseen(seen)) {
        if (first && resume && !m.unread) { seen.add(m.id); continue; }
        // Só conta como vista depois de lida e entregue: se a rede cair no meio, ela volta na próxima volta.
        if (values.exec || jsonMode) {
          const { summary, email } = await box.read(m.id);
          const msg = messageJson(summary, email);
          if (jsonMode) process.stdout.write(JSON.stringify(msg) + '\n');
          else process.stdout.write(`${when(m.receivedAt)}  ${short(m.id)}  ${who(m.from)}  ${m.subject}\n`);
          if (values.exec) {
            const code = await runExec(values.exec, msg, { SHALOM_MESSAGE_ID: m.id, SHALOM_FROM: m.from?.address ?? '', SHALOM_SUBJECT: m.subject, SHALOM_AGENT: file.address });
            seen.add(m.id);
            if (code !== 0) process.stderr.write(`exec exited with ${code} for ${short(m.id)}\n`);
            else if (values['mark-read']) await box.update([m.id], { seen: true });
          } else {
            seen.add(m.id);
            if (values['mark-read']) await box.update([m.id], { seen: true });
          }
        } else {
          process.stdout.write(`${when(m.receivedAt)}  ${short(m.id)}  ${who(m.from)}  ${m.subject}\n`);
          seen.add(m.id);
          if (values['mark-read']) await box.update([m.id], { seen: true });
        }
      }
      first = false;
      wait = every;
    } catch (e) {
      process.stderr.write(`watch: ${(e as Error).message}\n`);
      wait = Math.min(wait * 2, 5 * 60 * 1000);
    }
    await sleep(wait);
  }
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined: case 'help': case '--help': case '-h': return out(HELP);
    case 'version': case '--version': case '-v': return out(VERSION);
    case 'login': return login(rest);
    case 'logout': return logout(rest);
    case 'whoami': return whoami(rest);
    case 'agents': case 'agent': return agentsCmd(rest);
    case 'plan': return planCmd(rest);
    case 'upgrade': return upgrade(rest);
    case 'inbox': case 'list': case 'ls': return inbox(rest);
    case 'read': case 'show': return read(rest);
    case 'send': return send(rest);
    case 'reply': return reply(rest);
    case 'move': case 'mv': return move(rest);
    case 'mark': return mark(rest);
    case 'trash': return move([...rest, '--to', 'trash']);
    case 'archive': return move([...rest, '--to', 'archive']);
    case 'watch': return watch(rest);
    default: die(`Unknown command: ${cmd}. Run shalom --help.`);
  }
}

main(process.argv.slice(2)).catch(e => {
  // Opção errada estoura antes de o comando ler o --json: quem pediu JSON recebe o erro em JSON mesmo assim.
  if (process.argv.slice(2).includes('--json')) jsonMode = true;
  const msg = e instanceof CliError || e instanceof ApiError || e instanceof StoreError ? e.message : (e as { code?: string })?.code?.startsWith('ERR_PARSE_ARGS') ? (e as Error).message : `Unexpected error: ${(e as Error)?.stack ?? e}`;
  if (jsonMode) process.stdout.write(JSON.stringify({ error: e instanceof ApiError ? e.code : 'error', message: msg }) + '\n');
  else process.stderr.write(`shalom: ${msg}\n`);
  process.exit(1);
});
