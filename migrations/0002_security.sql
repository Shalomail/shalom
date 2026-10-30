-- Segurança da conta escolhida pela pessoa: tempo de inatividade até sair sozinho, PIN de entrada e
-- verificação em duas etapas (TOTP). Os dois fatores são independentes: dá para ter um, outro ou os dois.
-- idle_minutes: 43200 = 30 dias, o comportamento de antes.
ALTER TABLE users ADD COLUMN idle_minutes INTEGER NOT NULL DEFAULT 43200;
-- HMAC do PIN com o AUTH_PEPPER (fora do banco). Nulo = sem PIN.
ALTER TABLE users ADD COLUMN pin_hash TEXT;
-- Segredo do TOTP trancado com a ENVELOPE_KEY. totp_on só vira 1 depois que a pessoa confirma um código.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_on INTEGER NOT NULL DEFAULT 0;
-- Último passo de 30 s aceito: o mesmo código não entra duas vezes.
ALTER TABLE users ADD COLUMN totp_step INTEGER NOT NULL DEFAULT 0;
-- Códigos de recuperação (JSON com os HMACs dos que ainda valem).
ALTER TABLE users ADD COLUMN recovery TEXT;

-- Login que já passou da senha e espera o PIN e/ou o código. Vale 5 minutos e 5 tentativas.
CREATE TABLE login_tickets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
