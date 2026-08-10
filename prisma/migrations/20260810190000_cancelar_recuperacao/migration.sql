-- Cancelamento de recuperação registrada por engano.
--
-- Diferente de `encerradaEm`, que marca uma recuperação que terminou de
-- verdade: aqui o período não deveria ter existido. Um é fato, o outro é
-- correção de lançamento, e confundir os dois apagaria a diferença entre
-- "o vendedor se recuperou" e "alguém digitou errado".
--
-- A linha não é apagada. Fica com o registro de quem cancelou, quando e por
-- quê, e passa a ser ignorada na resolução dos períodos.
ALTER TABLE "VendedorRecuperacao"
  ADD COLUMN "canceladaEm" TIMESTAMP(3),
  ADD COLUMN "canceladoPorId" TEXT,
  ADD COLUMN "motivoCancelamento" TEXT;

ALTER TABLE "VendedorRecuperacao"
  ADD CONSTRAINT "VendedorRecuperacao_canceladoPorId_fkey"
  FOREIGN KEY ("canceladoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A resolução por data passa a filtrar por este campo; sem o índice, cada
-- consulta de período varreria a tabela inteira.
CREATE INDEX "VendedorRecuperacao_canceladaEm_idx" ON "VendedorRecuperacao"("canceladaEm");
