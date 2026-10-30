-- E-mail de recuperação. Fica trancado com a ENVELOPE_KEY: o servidor só precisa dele aberto na hora
-- de mandar um link. recovery_hint é a versão mascarada para mostrar na tela (t•••@gmail.com).
-- Recuperar devolve a conta com senha e chave novas; os e-mails guardados até ali não voltam.
ALTER TABLE users ADD COLUMN recovery_email TEXT;
ALTER TABLE users ADD COLUMN recovery_hint TEXT;
ALTER TABLE users ADD COLUMN recovery_verified INTEGER NOT NULL DEFAULT 0;

-- Links mandados por e-mail, de uso único: confirmar o endereço de recuperação (24 h) e criar
-- senha nova (1 h).
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX email_tokens_user ON email_tokens(user_id);
