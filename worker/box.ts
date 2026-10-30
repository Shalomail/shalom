// Uma caixa de e-mail = um Durable Object com SQLite próprio (até 10 GB só dela).
// Assim não existe teto de banco único nem fila única de consultas: cada conta cresce sozinha.
// Aqui ficam só as linhas da lista (cabeçalho lacrado); o corpo lacrado fica no R2.
import { DurableObject } from 'cloudflare:workers';
import { isSealedSender } from '../shared/sender';
import type { Env } from './env';

export type Folder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash';
export const FOLDERS = new Set<Folder>(['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash']);
// Espaço por conta (soma dos corpos lacrados).
export const QUOTA_BYTES = 1024 * 1024 * 1024;
// O D1 e o SQLite aceitam até 100 parâmetros por consulta.
export const MAX_IDS = 90;

export const boxOf = (env: Env, userId: string) => env.MAILBOX.get(env.MAILBOX.idFromName(userId));

export type NewMessage = { id: string; folder: Folder; seen: boolean; size: number; sender: string | null; head: Uint8Array };
export type Row = { id: string; folder: Folder; seen: number; starred: number; pinned: number; received_at: number; size: number; sender: string | null; head: ArrayBuffer };
export type Counts = Partial<Record<Folder, number>>;
export type Change = { seen?: boolean; starred?: boolean; pinned?: boolean; folder?: Folder };
// Tela de espaço: quanto cada pasta ocupa e a ordem da lista que junta todas.
export type FolderTotals = Partial<Record<Folder, { count: number; bytes: number }>>;
export type StorageSort = 'size' | 'date';
export type WipeResult = { deleted: number; freed: number; more: boolean };
export type MigrationRow = { id: string; folder: Folder; seen: number; starred: number; pinned: number; received_at: number; size: number; sender: string | null; head: ArrayBuffer; trashed_at: number | null };
export type SwapResult = { ok: true; freed: number } | { ok: false; why: 'not_found' | 'sealed_sender' | 'not_smaller' };

export class Mailbox extends DurableObject<Env> {
  sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // O app manda "ping" de tempos em tempos para a conexão não cair; a resposta sai sem acordar a caixa.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          folder TEXT NOT NULL,
          seen INTEGER NOT NULL DEFAULT 0,
          starred INTEGER NOT NULL DEFAULT 0,
          received_at INTEGER NOT NULL,
          size INTEGER NOT NULL,
          sender TEXT,
          head BLOB NOT NULL
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS by_folder ON messages(folder, received_at DESC);
        CREATE INDEX IF NOT EXISTS by_star ON messages(received_at DESC) WHERE starred = 1;
        CREATE INDEX IF NOT EXISTS unread ON messages(folder) WHERE seen = 0;
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL) WITHOUT ROWID;
      `);
      // Coluna nova em caixas antigas: conversa fixada no topo da lista.
      const cols = this.sql.exec<{ name: string }>('PRAGMA table_info(messages)').toArray().map(c => c.name);
      if (!cols.includes('pinned')) this.sql.exec('ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
      // Quando foi para a Lixeira ou o Spam: os 30 dias contam daí, não da chegada.
      if (!cols.includes('trashed_at')) this.sql.exec('ALTER TABLE messages ADD COLUMN trashed_at INTEGER');
      // Tela de espaço: todas as pastas juntas ou uma só, por tamanho ou por data, sem ler a caixa inteira
      // a cada página.
      this.sql.exec(`
        CREATE INDEX IF NOT EXISTS by_size ON messages(size);
        CREATE INDEX IF NOT EXISTS by_time ON messages(received_at);
        CREATE INDEX IF NOT EXISTS by_folder_size ON messages(folder, size);
        CREATE INDEX IF NOT EXISTS by_folder_time ON messages(folder, received_at);
      `);
    });
  }

  private used(): number {
    return this.sql.exec<{ value: number }>(`SELECT value FROM meta WHERE key = 'bytes'`).toArray()[0]?.value ?? 0;
  }

  private addUsed(delta: number) {
    this.sql.exec(`INSERT INTO meta (key, value) VALUES ('bytes', MAX(0, ?1))
      ON CONFLICT(key) DO UPDATE SET value = MAX(0, value + ?1)`, delta);
  }

  counts(): Counts {
    const out: Counts = {};
    for (const r of this.sql.exec<{ folder: Folder; n: number }>('SELECT folder, COUNT(*) AS n FROM messages WHERE seen = 0 GROUP BY folder')) out[r.folder] = r.n;
    return out;
  }

  // Cabe mais esta mensagem? Chamado antes de ler o corpo do e-mail.
  fits(size: number): boolean {
    return this.used() + size <= QUOTA_BYTES;
  }

  usage() {
    return { used: this.used(), quota: QUOTA_BYTES };
  }

  // Caixa ao vivo: o app abre um WebSocket aqui (pela rota /api/live, já com a sessão conferida) e
  // recebe um aviso curto quando chega ou muda algo. O aviso não leva conteúdo, só o tipo e a pasta; o
  // app busca a lista de novo. A conexão hiberna junto com a caixa e não custa nada parada.
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade') !== 'websocket') return new Response('websocket', { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 ? 1000 : code); } catch { /* já fechou */ }
  }

  private tell(t: 'new' | 'changed', folder?: Folder) {
    const note = JSON.stringify(folder ? { t, folder } : { t });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(note); } catch { /* conexão caindo: o app reconecta */ }
    }
  }

  add(m: NewMessage): boolean {
    if (!this.fits(m.size)) return false;
    this.sql.exec(
      'INSERT INTO messages (id, folder, seen, starred, received_at, size, sender, head) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
      m.id, m.folder, m.seen ? 1 : 0, Date.now(), m.size, m.sender, m.head,
    );
    this.addUsed(m.size);
    this.tell('new', m.folder);
    return true;
  }

  list(folder: Folder | 'starred', before: number, limit: number) {
    const cols = 'id, folder, seen, starred, pinned, received_at, size, sender, head';
    const rows = folder === 'starred'
      ? this.sql.exec<Row>(`SELECT ${cols} FROM messages WHERE starred = 1 AND folder NOT IN ('trash', 'spam') AND received_at < ? ORDER BY received_at DESC LIMIT ?`, before, limit + 1).toArray()
      : this.sql.exec<Row>(`SELECT ${cols} FROM messages WHERE folder = ? AND received_at < ? ORDER BY received_at DESC LIMIT ?`, folder, before, limit + 1).toArray();
    return { rows: rows.slice(0, limit), more: rows.length > limit, counts: this.counts() };
  }

  one(id: string): Row | null {
    return this.sql.exec<Row>('SELECT id, folder, seen, starred, pinned, received_at, size, sender, head FROM messages WHERE id = ?', id).toArray()[0] ?? null;
  }

  update(ids: string[], change: Change): Counts {
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    if (change.seen !== undefined) { sets.push('seen = ?'); args.push(change.seen ? 1 : 0); }
    if (change.starred !== undefined) { sets.push('starred = ?'); args.push(change.starred ? 1 : 0); }
    if (change.pinned !== undefined) { sets.push('pinned = ?'); args.push(change.pinned ? 1 : 0); }
    if (change.folder !== undefined) {
      sets.push('folder = ?'); args.push(change.folder);
      // Entrando na Lixeira ou no Spam, o relógio dos 30 dias começa agora; saindo, para.
      sets.push('trashed_at = ?'); args.push(change.folder === 'trash' || change.folder === 'spam' ? Date.now() : null);
    }
    if (sets.length && ids.length) {
      this.sql.exec(`UPDATE messages SET ${sets.join(', ')} WHERE id IN (${ids.map(() => '?').join(',')})`, ...args, ...ids);
      this.tell('changed');
    }
    return this.counts();
  }

  // Apaga de vez só o que está na lixeira ou no spam. Devolve os ids apagados, para o Worker limpar o R2.
  removeFromTrash(ids: string[]): string[] {
    const marks = ids.map(() => '?').join(',');
    const rows = this.sql.exec<{ id: string; size: number }>(`SELECT id, size FROM messages WHERE folder IN ('trash', 'spam') AND id IN (${marks})`, ...ids).toArray();
    if (!rows.length) return [];
    this.sql.exec(`DELETE FROM messages WHERE id IN (${rows.map(() => '?').join(',')})`, ...rows.map(r => r.id));
    this.addUsed(-rows.reduce((n, r) => n + r.size, 0));
    this.tell('changed');
    return rows.map(r => r.id);
  }

  // Rascunho trocado pela versão nova ou descartado: sai de vez (só da pasta Rascunhos). Devolve os ids
  // apagados, para o Worker limpar o R2.
  removeDrafts(ids: string[]): string[] {
    const marks = ids.map(() => '?').join(',');
    const rows = this.sql.exec<{ id: string; size: number }>(`SELECT id, size FROM messages WHERE folder = 'drafts' AND id IN (${marks})`, ...ids).toArray();
    if (!rows.length) return [];
    this.sql.exec(`DELETE FROM messages WHERE id IN (${rows.map(() => '?').join(',')})`, ...rows.map(r => r.id));
    this.addUsed(-rows.reduce((n, r) => n + r.size, 0));
    this.tell('changed');
    return rows.map(r => r.id);
  }

  // Todas as pastas juntas (ou só uma, com folder), por tamanho ou por data. O cursor é o par (valor, id)
  // da última linha, então apagar no meio do caminho não pula nem repete nada. A primeira página traz o
  // total de cada pasta, sempre de todas, para a barra.
  storage(sort: StorageSort, dir: 'desc' | 'asc', after: [number, string] | null, limit: number, folder?: Folder) {
    const col = sort === 'size' ? 'size' : 'received_at';
    const order = dir === 'desc' ? 'DESC' : 'ASC';
    const conds: string[] = [];
    const args: (string | number)[] = [];
    if (folder) { conds.push('folder = ?'); args.push(folder); }
    if (after) { conds.push(`(${col}, id) ${dir === 'desc' ? '<' : '>'} (?, ?)`); args.push(...after); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = this.sql.exec<Row>(
      `SELECT id, folder, seen, starred, pinned, received_at, size, sender, head FROM messages ${where} ORDER BY ${col} ${order}, id ${order} LIMIT ?`,
      ...args, limit + 1,
    ).toArray();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const next = rows.length > limit && last ? `${last[col]}.${last.id}` : null;
    if (after) return { rows: page, next };
    const folders: FolderTotals = {};
    for (const r of this.sql.exec<{ folder: Folder; n: number; bytes: number }>('SELECT folder, COUNT(*) AS n, SUM(size) AS bytes FROM messages GROUP BY folder')) {
      folders[r.folder] = { count: r.n, bytes: r.bytes };
    }
    // `at`: hora do servidor deste resumo. "Apagar tudo" usa como limite (o que chegou depois fica).
    return { rows: page, next, folders, ...this.usage(), at: Date.now() };
  }

  // Troca o corpo por outro menor, montado no aparelho sem os anexos. A linha ganha id novo, com a mesma
  // pasta, marcas e hora de chegada: o corpo antigo, que o navegador guarda em cache pelo id, não volta.
  // Só vale para lacre comum: no remetente lacrado, o lacre de quem enviou cobre a mensagem inteira.
  swap(oldId: string, newId: string, size: number, head: Uint8Array): SwapResult {
    const row = this.sql.exec<{ size: number; head: ArrayBuffer }>('SELECT size, head FROM messages WHERE id = ?', oldId).toArray()[0];
    if (!row) return { ok: false, why: 'not_found' };
    if (isSealedSender(new Uint8Array(row.head))) return { ok: false, why: 'sealed_sender' };
    if (size >= row.size) return { ok: false, why: 'not_smaller' };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`INSERT INTO messages (id, folder, seen, starred, pinned, received_at, size, sender, head)
        SELECT ?, folder, seen, starred, pinned, received_at, ?, sender, ? FROM messages WHERE id = ?`, newId, size, head, oldId);
      this.sql.exec('DELETE FROM messages WHERE id = ?', oldId);
      this.addUsed(size - row.size);
    });
    return { ok: true, freed: row.size - size };
  }

  // Esvazia a caixa: linhas e corpos no R2, em lotes de 1000 (o máximo do R2 por pedido). Usado por
  // "Apagar tudo" em Configurações e pela troca de senha por e-mail de recuperação (as mensagens antigas
  // ficam presas à chave antiga). owner: id da conta (sem ele, vale o guardado no cadastro/login).
  // before: só o que chegou até essa hora. limit: para depois de tantas, para a tela mostrar o progresso.
  // folder: só uma pasta. Sem nada disso, apaga tudo. Com a caixa vazia, o contador de espaço volta a zero.
  async wipe(owner?: string, opts: { before?: number; limit?: number; folder?: Folder } = {}): Promise<WipeResult> {
    const who = owner ?? (await this.ctx.storage.get<string>('owner'));
    if (!who) throw new Error('caixa sem dono registrado: passe o id da conta');
    const before = opts.before ?? Number.MAX_SAFE_INTEGER;
    const max = opts.limit ?? Number.POSITIVE_INFINITY;
    const inFolder = opts.folder ? ' AND folder = ?' : '';
    const folderArg = opts.folder ? [opts.folder] : [];
    let deleted = 0;
    let freed = 0;
    while (deleted < max) {
      const ids = this.sql.exec<{ id: string }>(`SELECT id FROM messages WHERE received_at <= ?${inFolder} LIMIT ?`, before, ...folderArg, Math.min(1000, max - deleted))
        .toArray().map(r => r.id);
      if (!ids.length) break;
      await this.env.BLOBS.delete(ids.map(id => `m/${who}/${id}`));
      // RETURNING conta só o que saiu de fato (outro pedido pode ter apagado alguma no meio do caminho).
      for (let i = 0; i < ids.length; i += MAX_IDS) {
        const part = ids.slice(i, i + MAX_IDS);
        for (const r of this.sql.exec<{ size: number }>(`DELETE FROM messages WHERE id IN (${part.map(() => '?').join(',')}) RETURNING size`, ...part)) {
          deleted++;
          freed += r.size;
        }
      }
    }
    this.addUsed(-freed);
    const left = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM messages').one().n;
    if (!left) this.sql.exec(`INSERT INTO meta (key, value) VALUES ('bytes', 0) ON CONFLICT(key) DO UPDATE SET value = 0`);
    const more = left > 0 && this.sql.exec(`SELECT 1 FROM messages WHERE received_at <= ?${inFolder} LIMIT 1`, before, ...folderArg).toArray().length > 0;
    return { deleted, freed, more };
  }

  // Caixa apagada de vez (caixa de agente removida): corpos no R2, linhas, alarme e tudo que a caixa guarda.
  async destroy(owner: string): Promise<void> {
    await this.wipe(owner);
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'gone');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // Migração de conta Cloudflare (worker/admin.ts, scripts/migrate.mjs): as linhas saem em páginas, pela
  // ordem do id, com o cabeçalho lacrado como veio. Os corpos vão à parte, direto do R2.
  exportRows(after: string, limit: number): MigrationRow[] {
    return this.sql.exec<MigrationRow>(
      'SELECT id, folder, seen, starred, pinned, received_at, size, sender, head, trashed_at FROM messages WHERE id > ? ORDER BY id LIMIT ?', after, limit,
    ).toArray();
  }

  // Do outro lado: "replace" troca as linhas pelas da origem (a primeira página apaga as que já havia);
  // "merge" só acrescenta as que faltam, para a última passada depois da troca do domínio, quando a caixa
  // nova já pode ter recebido coisa nova. O espaço usado é recontado no fim.
  async importRows(owner: string, rows: MigrationRow[], mode: 'replace' | 'merge', first: boolean): Promise<number> {
    const verb = mode === 'merge' ? 'INSERT OR IGNORE' : 'INSERT OR REPLACE';
    this.ctx.storage.transactionSync(() => {
      if (first && mode === 'replace') this.sql.exec('DELETE FROM messages');
      for (const r of rows) {
        this.sql.exec(`${verb} INTO messages (id, folder, seen, starred, pinned, received_at, size, sender, head, trashed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.id, r.folder, r.seen, r.starred, r.pinned, r.received_at, r.size, r.sender, r.head, r.trashed_at);
      }
      const total = this.sql.exec<{ n: number }>('SELECT COALESCE(SUM(size), 0) AS n FROM messages').toArray()[0].n;
      this.sql.exec(`INSERT INTO meta (key, value) VALUES ('bytes', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`, total);
    });
    await this.ensureAlarm(owner);
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM messages').toArray()[0].n;
  }

  // Para conferir depois de copiar: quantas mensagens e quantos bytes.
  tally(): { messages: number; bytes: number } {
    const r = this.sql.exec<{ n: number; b: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM messages').toArray()[0];
    return { messages: r.n, bytes: r.b };
  }

  // Lixeira e spam com mais de 30 dias. Chamado pelo alarme diário da própria caixa.
  async alarm() {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const owner = await this.ctx.storage.get<string>('owner');
    // Spam que chegou direto no Spam não tem trashed_at: conta da chegada.
    const old = this.sql.exec<{ id: string }>(`SELECT id FROM messages WHERE folder IN ('trash', 'spam') AND COALESCE(trashed_at, received_at) < ? LIMIT 500`, cutoff).toArray().map(r => r.id);
    for (let i = 0; i < old.length; i += MAX_IDS) {
      const ids = this.removeFromTrash(old.slice(i, i + MAX_IDS));
      if (ids.length && owner) await this.env.BLOBS.delete(ids.map(id => `m/${owner}/${id}`));
    }
    await this.ctx.storage.setAlarm(Date.now() + 24 * 3600 * 1000);
  }

  // Chamado no cadastro e no login: guarda de quem é a caixa e liga a limpeza diária da lixeira.
  async ensureAlarm(owner: string) {
    if ((await this.ctx.storage.get<string>('owner')) !== owner) await this.ctx.storage.put('owner', owner);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 24 * 3600 * 1000);
  }
}
