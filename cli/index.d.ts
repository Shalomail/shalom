// Types for the shalomail Node SDK: import { Agent, Account } from 'shalomail'.

export type Folder = 'inbox' | 'starred' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash';
export type Person = { name: string; address: string };

export type Summary = {
  id: string;
  folder: string;
  from: Person | null;
  to: Person[];
  subject: string;
  date: string;
  receivedAt: number;
  snippet: string;
  attachments: number;
  unread: boolean;
  starred: boolean;
  /** Shalom to Shalom: sender verified by the server certificate and sealed end to end. */
  verifiedSender: boolean;
  /** Mail from other providers: DMARC result seen on arrival. */
  auth: 'pass' | 'fail' | 'unknown';
};

export type Message = Omit<Summary, 'attachments'> & {
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  replyTo: Person[];
  cc: Person[];
  text: string;
  html: string | null;
  attachments: { filename: string; mimeType: string; size: number; content: Uint8Array }[];
};

export type Attachment = { filename: string; content: Uint8Array; type?: string };

export type SendInput = {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Attachment[];
  inReplyTo?: string;
  references?: string;
};

export type SendResult = { id: string; external: number; internal: number };

export declare class ApiError extends Error {
  status: number;
  code: string;
}

/** One agent mailbox. Opening, sealing and sending happen on your machine. */
export declare class Agent {
  /** From SHALOM_AGENT_TOKEN or the file in SHALOM_AGENT_TOKEN_FILE (see `shalom agents export`). */
  static fromToken(token?: string, opts?: { api?: string }): Agent;
  /** From the file the CLI saved in ~/.config/shalom/agents. */
  static fromFile(address: string, opts?: { api?: string }): Agent;
  readonly address: string;
  inbox(opts?: { folder?: Folder; limit?: number; unread?: boolean }): Promise<Summary[]>;
  /** Marks the message as read unless markRead is false. Ids can be shortened to 8 characters. */
  read(id: string, opts?: { markRead?: boolean }): Promise<Message>;
  send(msg: SendInput, opts?: { trustNewKey?: boolean }): Promise<SendResult>;
  reply(id: string, msg: { text: string; html?: string; all?: boolean; quote?: boolean; attachments?: Attachment[] }, opts?: { trustNewKey?: boolean }): Promise<SendResult>;
  move(ids: string | string[], folder: 'inbox' | 'archive' | 'spam' | 'trash'): Promise<void>;
  mark(ids: string | string[], change: { read?: boolean; starred?: boolean }): Promise<void>;
  /** New inbox messages, one at a time, until the loop breaks or the signal aborts. includeUnread also yields the unread ones already there, to resume after a restart. */
  watch(opts?: { interval?: number; signal?: AbortSignal; includeExisting?: boolean; includeUnread?: boolean }): AsyncGenerator<Message>;
}

/** Your account: creates and deletes agent mailboxes with the account API key. */
export declare class Account {
  constructor(apiKey?: string, opts?: { api?: string });
  /** plan.limit is null on the Unlimited plan. */
  listAgents(): Promise<{ agents: { id: string; address: string; name: string; createdAt: number; paused: boolean }[]; plan: { plan: string; limit: number | null; used: number } }>;
  /** The mailbox private key is created here. The returned token is the full credential: store it as a secret. */
  createAgent(name: string, opts?: { displayName?: string; save?: boolean }): Promise<{ id: string; address: string; name: string; token: string }>;
  /** Needs the mailbox's own credential: { token }, or the file the CLI saved. Or delete it in the app. */
  deleteAgent(address: string, opts?: { token?: string }): Promise<void>;
}
