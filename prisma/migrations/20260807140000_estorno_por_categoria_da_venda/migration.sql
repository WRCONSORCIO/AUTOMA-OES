-- DropIndex
DROP INDEX "RegraEstorno_tipo_vigenteDe_idx";

-- AlterTable
ALTER TABLE "RegraEstorno" ADD COLUMN     "categoriaVenda" "CategoriaVendedor";

-- CreateIndex
CREATE INDEX "RegraEstorno_tipo_categoriaVenda_vigenteDe_idx" ON "RegraEstorno"("tipo", "categoriaVenda", "vigenteDe");


-- ---------------------------------------------------------------------------
-- Segundo tipo de estorno: cancelamento com uma parcela paga.
--
-- Regra do negócio, informada pela WR: além da recuperação, o vendedor devolve
-- comissão quando o cliente cancela com apenas uma parcela paga — e isso vale
-- SOMENTE para as vendas feitas pelo documento veterano, que é por onde a
-- pessoa opera depois de promovida.
--
-- `parcelaLimite = 2` porque a regra estorna abaixo do limite: cancelamento com
-- 0 ou 1 parcela paga gera estorno; com 2 ou mais, não.
--
-- A regra da recuperação segue SEM restrição de categoria, como sempre foi.
-- ---------------------------------------------------------------------------
INSERT INTO "RegraEstorno" ("id", "vendedorId", "tipo", "categoriaVenda", "parcelaLimite", "percentual", "vigenteDe", "vigenteAte", "observacoes", "criadoEm")
VALUES (
  'regra_estorno_padrao_cancelamento_veterano',
  NULL,
  'CANCELAMENTO',
  'VETERANO',
  2,
  100,
  DATE '1900-01-01',
  NULL,
  'Cliente cancela com uma parcela paga. Vale apenas para vendas do documento veterano.',
  NOW()
)
ON CONFLICT ("id") DO NOTHING;
