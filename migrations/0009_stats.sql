-- Números do painel de administração (scripts/painel.mjs), por dia e por métrica: cadastros, caixas de
-- agente, e-mails para fora, entregas entre contas Shalom, e-mails de fora recebidos e e-mails do sistema.
-- Só contagens: nenhuma linha diz quem, para quem ou o quê.
CREATE TABLE IF NOT EXISTS stats (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
) WITHOUT ROWID;
