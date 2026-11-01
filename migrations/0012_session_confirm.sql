-- Confirmação de identidade por sessão: ações perigosas (apagar de vez, trocar a senha, apagar a conta,
-- chaves de API, conectar o terminal) pedem senha e o segundo fator ligado; confirmada, a sessão fica
-- liberada até confirmed_until (10 minutos). signup marca a sessão aberta pelo cadastro, a única que escolhe o
-- primeiro e-mail de recuperação sem senha.
ALTER TABLE sessions ADD COLUMN confirmed_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN signup INTEGER NOT NULL DEFAULT 0;
