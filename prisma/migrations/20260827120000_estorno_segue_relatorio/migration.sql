-- Estorno passa a acompanhar o lançamento de CANCELAMENTO DE PLANO do
-- relatório de comissão, e não mais a data de cancelamento da base de clientes.
--
-- A base de clientes continua sendo a fonte da verdade sobre o cliente estar
-- ativo ou não. Mas a cobrança do vendedor só nasce quando a administradora
-- debita a WR — o que pode acontecer meses depois do cancelamento.

ALTER TABLE "Estorno" ADD COLUMN "dataCobranca" DATE;
ALTER TABLE "Estorno" ADD COLUMN "comissaoRegistroId" TEXT;

ALTER TABLE "Estorno"
  ADD CONSTRAINT "Estorno_comissaoRegistroId_fkey"
  FOREIGN KEY ("comissaoRegistroId") REFERENCES "ComissaoRegistro"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Estorno_dataCobranca_idx" ON "Estorno"("dataCobranca");
CREATE INDEX "Estorno_comissaoRegistroId_idx" ON "Estorno"("comissaoRegistroId");
