-- Índice da chave pública: o cadastro, a senha nova pelo link e as caixas de agente recusam uma chave que já
-- é de outra conta (worker/util.ts keyInUse). Sem UNIQUE, para a migração não falhar se já houver repetida.
CREATE INDEX IF NOT EXISTS users_public_key ON users (public_key);
