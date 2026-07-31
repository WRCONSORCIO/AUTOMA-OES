-- CreateEnum
CREATE TYPE "SegmentoVenda" AS ENUM ('IMOVEL', 'AUTOMOVEL');

-- DropIndex
DROP INDEX "TabelaComissao_categoria_vigenteDe_idx";

-- DropIndex
DROP INDEX "TabelaComissaoEquipe_categoria_vigenteDe_idx";

-- AlterTable
ALTER TABLE "ComissaoRegistro" ADD COLUMN     "segmentoVenda" "SegmentoVenda";

-- AlterTable
ALTER TABLE "Cota" ADD COLUMN     "segmentoVenda" "SegmentoVenda";

-- AlterTable
ALTER TABLE "TabelaComissao" ADD COLUMN     "segmento" "SegmentoVenda";

-- AlterTable
ALTER TABLE "TabelaComissaoEquipe" ADD COLUMN     "segmento" "SegmentoVenda";

-- CreateIndex
CREATE INDEX "TabelaComissao_categoria_segmento_vigenteDe_idx" ON "TabelaComissao"("categoria", "segmento", "vigenteDe");

-- CreateIndex
CREATE INDEX "TabelaComissaoEquipe_categoria_segmento_vigenteDe_idx" ON "TabelaComissaoEquipe"("categoria", "segmento", "vigenteDe");


-- ---------------------------------------------------------------------------
-- Backfill: classifica o que já foi importado.
-- A base traz IMOVEL/MOVEL; o relatório de comissão traz o produto por extenso.
-- O que a administradora chama de MOVEL é o que a WR chama de automóvel.
-- ---------------------------------------------------------------------------

UPDATE "Cota"
   SET "segmentoVenda" = CASE
         WHEN upper("segmento") LIKE '%IMOVEL%' THEN 'IMOVEL'::"SegmentoVenda"
         WHEN upper("segmento") LIKE '%MOVEL%'  THEN 'AUTOMOVEL'::"SegmentoVenda"
       END
 WHERE "segmento" IS NOT NULL AND "segmentoVenda" IS NULL;

UPDATE "ComissaoRegistro" cr
   SET "segmentoVenda" = CASE
         WHEN upper(cr."objeto") LIKE '%IMOVEL%' THEN 'IMOVEL'::"SegmentoVenda"
         WHEN upper(cr."objeto") LIKE '%MOVEL%'  THEN 'AUTOMOVEL'::"SegmentoVenda"
       END
 WHERE cr."objeto" IS NOT NULL AND cr."segmentoVenda" IS NULL;

-- Lançamento sem produto legível herda o segmento da cota.
UPDATE "ComissaoRegistro" cr
   SET "segmentoVenda" = c."segmentoVenda"
  FROM "Cota" c
 WHERE c."id" = cr."cotaId"
   AND cr."segmentoVenda" IS NULL
   AND c."segmentoVenda" IS NOT NULL;
