-- Aparelhos iOS que recebem o aviso de mensagem nova (APNs). O aviso não leva conteúdo: só "Mensagem nova"
-- e o número de não lidas. Cada token vale enquanto a sessão daquele iPhone existir (sair, desconectar
-- por outro aparelho ou trocar a senha encerram o aviso junto); some também quando a Apple diz que ele
-- não vale mais e quando a conta é apagada.
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session TEXT NOT NULL,
  env TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS push_tokens_user ON push_tokens (user_id);
