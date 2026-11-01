-- Aviso de mensagem nova: a chave passa a ser (token, conta). Um iPhone com várias contas tem uma linha
-- por conta, e registrar o aparelho numa conta não tira mais ele de outra: antes, outra conta que soubesse
-- o token conseguia tomá-lo para si.
CREATE TABLE push_tokens_new (
  token TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session TEXT NOT NULL,
  env TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token, user_id)
) WITHOUT ROWID;
INSERT INTO push_tokens_new (token, user_id, session, env, created_at) SELECT token, user_id, session, env, created_at FROM push_tokens;
DROP TABLE push_tokens;
ALTER TABLE push_tokens_new RENAME TO push_tokens;
CREATE INDEX IF NOT EXISTS push_tokens_user ON push_tokens (user_id);
