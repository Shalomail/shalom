-- Suspensão por abuso (Termos, item 5): a conta não entra, não envia e as chaves de API dela (e das caixas
-- de agente dela) param. Os e-mails ficam guardados; desfazer é limpar as duas colunas.
ALTER TABLE users ADD COLUMN suspended_at INTEGER;
ALTER TABLE users ADD COLUMN suspended_reason TEXT;
