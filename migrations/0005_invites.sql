-- Convites que cada conta cria para trazer alguém (uso único, sem limite de quantidade). Guarda só o
-- hash do código; quem usou não fica registrado, para o banco não montar o mapa de quem convidou quem.
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS invites_owner ON invites (owner_id, created_at);
