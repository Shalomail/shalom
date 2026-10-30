// Biblioteca para Node: o mesmo que o CLI faz, chamado de dentro de um programa (import { Agent }
// from 'shalomail'). Lacrar e abrir acontece aqui, na máquina de quem usa; o servidor só vê lacrado.
import type { Email } from 'postal-mime';
import { newKeyPair, toB64 } from '../../shared/seal';
import { ApiError, call, DOMAIN, Mailbox, type Folder, type Summary } from './client';
import { addrs, bodyText, people, replyDraft, typeOf } from './message';
import { DEFAULT_API, envToken, exportToken, importToken, loadAgentFile, loadConfig, loadPins, saveAgent, saveConfig, savePins, toAgent, type AgentFile } from './store';

export { ApiError };
export type { Folder, Summary };

export type Attachment = { filename: string; content: Uint8Array; type?: string };
export type Message = Omit<Summary, 'attachments'> & {
  messageId: string | null; inReplyTo: string | null; references: string | null;
  replyTo: { name: string; address: string }[]; cc: { name: string; address: string }[];
  text: string; html: string | null;
  attachments: { filename: string; mimeType: string; size: number; content: Uint8Array }[];
};
export type SendInput = {
  to: string | string[]; cc?: string | string[]; bcc?: string | string[];
  subject: string; text: string; html?: string; attachments?: Attachment[];
  inReplyTo?: string; references?: string;
};
export type SendResult = { id: string; external: number; internal: number };

const fullMessage = (s: Summary, e: Email): Message => ({
  ...s,
  messageId: e.messageId ?? null, inReplyTo: e.inReplyTo ?? null, references: e.references ?? null,
  replyTo: addrs(e.replyTo), cc: addrs(e.cc), text: bodyText(e), html: e.html ?? null,
  attachments: e.attachments.map(a => ({ filename: a.filename ?? 'attachment', mimeType: a.mimeType, size: (a.content as ArrayBuffer).byteLength, content: new Uint8Array(a.content as ArrayBuffer) })),
});

const resolveApi = (api?: string) => (api || process.env.SHALOM_API_URL || DEFAULT_API).replace(/\/+$/, '');

// Uma caixa de agente. Abre pela credencial inteira (SHALOM_AGENT_TOKEN) ou pelo arquivo que o CLI salvou.
export class Agent {
  private box: Mailbox;
  private pins: Record<string, string>;

  private constructor(private file: AgentFile, private persist: boolean, api?: string) {
    this.pins = { ...(persist ? file.pins ?? {} : loadPins(file.address)) };
    const url = api ? resolveApi(api) : file.api;
    // Chaves do servidor fixadas como no CLI (além das embutidas para o shalomail.com).
    this.box = new Mailbox(toAgent(file, url), {
      server: loadConfig().serverKeys?.[url],
      onServer: wire => { try { const c = loadConfig(); saveConfig({ ...c, serverKeys: { ...c.serverKeys, [url]: wire } }); } catch { /* só leitura */ } },
    });
  }

  static fromToken(token = envToken(), opts: { api?: string } = {}): Agent {
    if (!token) throw new ApiError(0, 'no_token', 'Pass an agent token or set SHALOM_AGENT_TOKEN or SHALOM_AGENT_TOKEN_FILE (run `shalom agents export <address>`).');
    return new Agent(importToken(token), false, opts.api);
  }

  static fromFile(address: string, opts: { api?: string } = {}): Agent {
    const full = (address.includes('@') ? address : `${address}@${DOMAIN}`).toLowerCase();
    const file = loadAgentFile(full);
    if (!file) throw new ApiError(0, 'no_agent', `${full} is not saved on this machine.`);
    return new Agent(file, true, opts.api);
  }

  get address() { return this.file.address; }

  // Chave de cada contato Shalom fixada na primeira vez; se mudar, o envio para.
  private checkPin(trustNewKey: boolean) {
    return (address: string, publicKey: string) => {
      if (this.pins[address] && this.pins[address] !== publicKey && !trustNewKey) {
        throw new ApiError(0, 'key_changed', `The encryption key of ${address} changed since the last time. Confirm with them, then pass { trustNewKey: true }.`);
      }
      if (this.pins[address] !== publicKey) {
        this.pins[address] = publicKey;
        if (this.persist) { this.file.pins = { ...this.pins }; saveAgent(this.file); } else savePins(this.file.address, this.pins);
      }
    };
  }

  async inbox(opts: { folder?: Folder; limit?: number; unread?: boolean } = {}): Promise<Summary[]> {
    if (opts.unread) return this.box.unread(opts.folder ?? 'inbox', opts.limit ?? 20);
    return (await this.box.list(opts.folder ?? 'inbox', opts.limit ?? 20)).messages;
  }

  async read(id: string, opts: { markRead?: boolean } = {}): Promise<Message> {
    const { summary, email } = await this.box.read(id);
    if (opts.markRead !== false && summary.unread) await this.box.update([summary.id], { seen: true });
    return fullMessage(summary, email);
  }

  send(msg: SendInput, opts: { trustNewKey?: boolean } = {}): Promise<SendResult> {
    const to = people(msg.to);
    if (!to.length) throw new ApiError(0, 'bad_request', 'Add at least one recipient.');
    return this.box.send({
      from: { name: this.file.name, address: this.file.address }, to, cc: people(msg.cc), bcc: people(msg.bcc),
      subject: msg.subject, text: msg.text, html: msg.html, inReplyTo: msg.inReplyTo, references: msg.references,
      attachments: (msg.attachments ?? []).map(a => ({ filename: a.filename, type: a.type ?? typeOf(a.filename), content: new Uint8Array(a.content) })),
    }, this.checkPin(!!opts.trustNewKey));
  }

  async reply(id: string, msg: { text: string; html?: string; all?: boolean; quote?: boolean; attachments?: Attachment[] }, opts: { trustNewKey?: boolean } = {}): Promise<SendResult> {
    const { summary, email } = await this.box.read(id);
    const draft = replyDraft(summary, email, this.file.address, { text: msg.text, all: msg.all, quote: msg.quote });
    if (!draft.to.length) throw new ApiError(0, 'bad_request', 'Could not tell who to reply to.');
    return this.box.send({
      from: { name: this.file.name, address: this.file.address }, ...draft, bcc: [], html: msg.html,
      attachments: (msg.attachments ?? []).map(a => ({ filename: a.filename, type: a.type ?? typeOf(a.filename), content: new Uint8Array(a.content) })),
    }, this.checkPin(!!opts.trustNewKey));
  }

  private async ids(ids: string | string[]) {
    return Promise.all((Array.isArray(ids) ? ids : [ids]).map(async id => (await this.box.find(id)).id));
  }

  async move(ids: string | string[], folder: 'inbox' | 'archive' | 'spam' | 'trash'): Promise<void> {
    await this.box.update(await this.ids(ids), { folder });
  }

  async mark(ids: string | string[], change: { read?: boolean; starred?: boolean }): Promise<void> {
    await this.box.update(await this.ids(ids), { ...(change.read !== undefined ? { seen: change.read } : {}), ...(change.starred !== undefined ? { starred: change.starred } : {}) });
  }

  // Mensagens novas na Entrada, uma de cada vez, enquanto o laço durar (ou até o signal abortar).
  // includeUnread: as que já estavam lá sem ler também passam (para retomar depois de um reinício).
  async *watch(opts: { interval?: number; signal?: AbortSignal; includeExisting?: boolean; includeUnread?: boolean } = {}): AsyncGenerator<Message> {
    const every = Math.max(5, opts.interval ?? 15) * 1000;
    const seen = new Set<string>();
    if (!opts.includeExisting) for (const m of (await this.box.list('inbox', 100)).messages) if (!(opts.includeUnread && m.unread)) seen.add(m.id);
    let wait = every;
    let first = true;
    while (!opts.signal?.aborted) {
      try {
        for (const m of await this.box.unseen(seen)) {
          if (first && opts.includeUnread && !opts.includeExisting && !m.unread) { seen.add(m.id); continue; }
          // Só conta como vista depois de lida: se a rede cair no meio, ela volta na próxima volta.
          const msg = await this.read(m.id, { markRead: false });
          seen.add(m.id);
          yield msg;
        }
        first = false;
        wait = every;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw e;
        wait = Math.min(wait * 2, 5 * 60 * 1000);
      }
      await new Promise<void>(r => {
        const done = () => { clearTimeout(t); opts.signal?.removeEventListener('abort', done); r(); };
        const t = setTimeout(done, wait);
        opts.signal?.addEventListener('abort', done, { once: true });
      });
    }
  }
}

// A conta da pessoa: cria e apaga caixas de agente com a chave da conta (shalom login ou SHALOM_API_KEY).
export class Account {
  private creds: { api: string; key: string };

  constructor(apiKey = process.env.SHALOM_API_KEY, opts: { api?: string } = {}) {
    if (!apiKey) throw new ApiError(0, 'no_key', 'Pass an account API key or set SHALOM_API_KEY.');
    this.creds = { api: resolveApi(opts.api), key: apiKey };
  }

  listAgents(): Promise<{ agents: { id: string; address: string; name: string; createdAt: number; paused: boolean }[]; plan: { plan: string; limit: number | null; used: number } }> {
    return call(this.creds, 'GET', '/agents');
  }

  // A chave privada da caixa nasce aqui. O token devolvido é a credencial inteira: guarde como segredo.
  async createAgent(name: string, opts: { displayName?: string; save?: boolean } = {}): Promise<{ id: string; address: string; name: string; token: string }> {
    const address = (name.includes('@') ? name : `${name}@${DOMAIN}`).toLowerCase();
    const { secretKey, publicKey } = newKeyPair();
    const r = await call<{ agent: { id: string; address: string; name: string; createdAt: number }; key: string }>(this.creds, 'POST', '/agents', {
      address, name: opts.displayName ?? '', publicKey: toB64(publicKey),
    });
    const file: AgentFile = { ...r.agent, api: this.creds.api, key: r.key, secretKey: toB64(secretKey) };
    if (opts.save) saveAgent(file);
    return { id: r.agent.id, address: r.agent.address, name: r.agent.name, token: exportToken(file) };
  }

  // Apagar pela chave da conta exige também a credencial da própria caixa (o token, ou o arquivo salvo pelo
  // CLI): uma chave da conta vazada não basta para destruir caixas.
  async deleteAgent(address: string, opts: { token?: string } = {}): Promise<void> {
    const full = (address.includes('@') ? address : `${address}@${DOMAIN}`).toLowerCase();
    const agent = (await this.listAgents()).agents.find(a => a.address === full);
    if (!agent) throw new ApiError(404, 'not_found', `${full} is not one of your agent mailboxes.`);
    const agentKey = opts.token ? importToken(opts.token).key : loadAgentFile(full)?.key;
    if (!agentKey) throw new ApiError(0, 'no_agent', `Pass { token } for ${full}, or delete it on the AI agents page of the app.`);
    await call(this.creds, 'POST', '/agents/delete', { id: agent.id, agentKey });
  }
}
