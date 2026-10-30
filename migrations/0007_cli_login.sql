-- Login do CLI pelo navegador: o terminal pede um código, a pessoa confirma numa página do Shalom com a
-- conta aberta, e o terminal recebe uma chave de API da conta. O banco guarda só o hash do segredo do
-- terminal; a chave criada vai lacrada com a chave pública que o terminal mandou (só ele abre) e a
-- linha some quando o terminal busca.
CREATE TABLE IF NOT EXISTS cli_logins (
  poll_hash TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  device TEXT NOT NULL DEFAULT '',
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT,
  sealed_key TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS cli_logins_created ON cli_logins (created_at);
