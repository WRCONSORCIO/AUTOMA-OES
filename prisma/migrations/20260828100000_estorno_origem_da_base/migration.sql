-- De onde saiu o valor sobre o qual o estorno foi calculado.
--
-- O estorno é uma porcentagem do que o vendedor recebeu, e esse número está
-- gravado em lugares diferentes conforme quem pagou. Quando nenhum deles foi
-- importado, resta o débito que a administradora lançou no CANCELAMENTO DE
-- PLANO — que é o que faz o estorno existir e está sempre presente.
--
-- Guardar a origem é o que permite ao financeiro defender a cobrança diante do
-- vendedor: "a administradora tirou tanto" é um argumento diferente de "você
-- recebeu tanto".

ALTER TABLE "Estorno" ADD COLUMN "origemBase" TEXT;
