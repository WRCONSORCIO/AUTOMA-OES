-- AlterEnum
ALTER TYPE "TipoImportacao" ADD VALUE 'BONUS_PDF';

-- CreateTable
CREATE TABLE "BonusIncentivo" (
    "id" TEXT NOT NULL,
    "importacaoId" TEXT NOT NULL,
    "administradoraId" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cota" TEXT NOT NULL,
    "contrato" TEXT NOT NULL,
    "nomeConsorciado" TEXT NOT NULL,
    "tipoPessoa" TEXT,
    "parcela" INTEGER,
    "dataInclusao" DATE,
    "valorEvento" DECIMAL(18,2) NOT NULL,
    "percentualIncentivo" DECIMAL(9,4),
    "valorIncentivo" DECIMAL(18,2) NOT NULL,
    "percentualFlex" DECIMAL(9,4),
    "segmento" "SegmentoVenda",
    "periodoInicio" DATE,
    "periodoFim" DATE,
    "cotaId" TEXT,
    "vendedorId" TEXT,
    "equipeId" TEXT,
    "gerenciaId" TEXT,
    "hashRegistro" TEXT NOT NULL,
    "paginaPdf" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BonusIncentivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BonusIncentivo_hashRegistro_key" ON "BonusIncentivo"("hashRegistro");

-- CreateIndex
CREATE INDEX "BonusIncentivo_gerenciaId_idx" ON "BonusIncentivo"("gerenciaId");

-- CreateIndex
CREATE INDEX "BonusIncentivo_equipeId_idx" ON "BonusIncentivo"("equipeId");

-- CreateIndex
CREATE INDEX "BonusIncentivo_periodoInicio_periodoFim_idx" ON "BonusIncentivo"("periodoInicio", "periodoFim");

-- CreateIndex
CREATE INDEX "BonusIncentivo_grupo_cota_idx" ON "BonusIncentivo"("grupo", "cota");

-- CreateIndex
CREATE INDEX "BonusIncentivo_importacaoId_idx" ON "BonusIncentivo"("importacaoId");

-- AddForeignKey
ALTER TABLE "BonusIncentivo" ADD CONSTRAINT "BonusIncentivo_importacaoId_fkey" FOREIGN KEY ("importacaoId") REFERENCES "Importacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusIncentivo" ADD CONSTRAINT "BonusIncentivo_administradoraId_fkey" FOREIGN KEY ("administradoraId") REFERENCES "Administradora"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusIncentivo" ADD CONSTRAINT "BonusIncentivo_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusIncentivo" ADD CONSTRAINT "BonusIncentivo_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusIncentivo" ADD CONSTRAINT "BonusIncentivo_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "Equipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusIncentivo" ADD CONSTRAINT "BonusIncentivo_gerenciaId_fkey" FOREIGN KEY ("gerenciaId") REFERENCES "Gerencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
