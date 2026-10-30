-- Idioma da conta: escolhido no cadastro (site ou navegador) e trocado nas Configurações. Os e-mails do
-- sistema (confirmação, senha nova) saem nele.
ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'pt';
