-- Caixas de agente (IA): contas sem senha que uma pessoa (owner_id) cria pelo CLI. A chave privada fica
-- na máquina onde o agente roda; o servidor guarda só a pública, como em qualquer conta.
ALTER TABLE users ADD COLUMN owner_id TEXT;
CREATE INDEX IF NOT EXISTS users_owner ON users (owner_id, created_at) WHERE owner_id IS NOT NULL;

-- Chaves de API, guardadas só pelo hash. A da pessoa (kind 'account') cria e apaga caixas de agente; a
-- de uma caixa de agente (kind 'agent') lê e envia só por ela.
CREATE TABLE IF NOT EXISTS api_keys (
  key_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  hint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys (user_id);

-- Endereço de caixa de agente apagada fica guardado para o mesmo dono: ninguém mais pega o endereço e
-- recebe o que ainda chegar para ele.
CREATE TABLE IF NOT EXISTS retired (
  canonical TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  at INTEGER NOT NULL
) WITHOUT ROWID;

-- Plano das caixas de agente (Stripe). Sem linha: plano grátis.
CREATE TABLE IF NOT EXISTS billing (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  customer_id TEXT,
  subscription_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT,
  period_end INTEGER,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS billing_sub ON billing (subscription_id);
