-- Contas. A chave privada só existe aqui dentro do envelope (trancado pela senha no aparelho)
-- e o envelope ainda leva a segunda tranca do servidor (ENVELOPE_KEY, fora do banco).
-- canonical é a parte local sem ponto, hífen e sublinhado: thomaz.jr e thomazjr são o mesmo dono,
-- para ninguém registrar o sósia de outra pessoa e receber as respostas dos contatos dela.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  canonical TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  auth_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  kdf TEXT NOT NULL,
  public_key TEXT NOT NULL,
  envelope TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;
CREATE INDEX sessions_user ON sessions(user_id);

-- Aparelho onde a pessoa já entrou antes (cookie próprio). Quem tem o cookie pula o Turnstile e não é
-- travado pelas tentativas de um atacante contra o mesmo endereço.
CREATE TABLE known_devices (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX known_devices_user ON known_devices(user_id);

-- Ingressos de entrega já usados (assinatura cega). A semana permite apagar os vencidos.
CREATE TABLE spent_tokens (
  hash TEXT PRIMARY KEY,
  week INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX spent_tokens_week ON spent_tokens(week);

-- As mensagens não ficam aqui: cada conta tem a sua caixa (Durable Object com SQLite, worker/box.ts).

-- Contadores com janela de tempo: tentativas de login, cadastros, envios por dia.
CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
) WITHOUT ROWID;
