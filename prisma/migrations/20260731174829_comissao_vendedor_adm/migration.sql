-- AlterEnum
ALTER TYPE "TipoImportacao" ADD VALUE 'COMISSAO_VENDEDOR_PDF';

-- CreateTable
CREATE TABLE "ComissaoVendedorAdm" (
    "id" TEXT NOT NULL,
    "importacaoId" TEXT NOT NULL,
    "administradoraId" TEXT NOT NULL,
    "vendedorDocumento" TEXT NOT NULL,
    "vendedorNome" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cota" TEXT NOT NULL,
    "contrato" TEXT NOT NULL,
    "nomeCliente" TEXT NOT NULL,
    "objeto" TEXT,
    "valorCredito" DECIMAL(18,2) NOT NULL,
    "percentualFlex" DECIMAL(9,4),
    "valorComissao" DECIMAL(18,2) NOT NULL,
    "valorDsr" DECIMAL(18,2),
    "valorSeguro" DECIMAL(18,2),
    "percentualComissao" DECIMAL(9,4),
    "parcela" INTEGER,
    "dataPagamento" DATE,
    "dataVenda" DATE,
    "cotaId" TEXT,
    "vendedorId" TEXT,
    "pessoaId" TEXT,
    "equipeId" TEXT,
    "gerenciaId" TEXT,
    "hashRegistro" TEXT NOT NULL,
    "paginaPdf" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComissaoVendedorAdm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComissaoVendedorAdm_hashRegistro_key" ON "ComissaoVendedorAdm"("hashRegistro");

-- CreateIndex
CREATE INDEX "ComissaoVendedorAdm_vendedorDocumento_idx" ON "ComissaoVendedorAdm"("vendedorDocumento");

-- CreateIndex
CREATE INDEX "ComissaoVendedorAdm_pessoaId_idx" ON "ComissaoVendedorAdm"("pessoaId");

-- CreateIndex
CREATE INDEX "ComissaoVendedorAdm_gerenciaId_idx" ON "ComissaoVendedorAdm"("gerenciaId");

-- CreateIndex
CREATE INDEX "ComissaoVendedorAdm_dataPagamento_idx" ON "ComissaoVendedorAdm"("dataPagamento");

-- CreateIndex
CREATE INDEX "ComissaoVendedorAdm_importacaoId_idx" ON "ComissaoVendedorAdm"("importacaoId");

-- AddForeignKey
ALTER TABLE "ComissaoVendedorAdm" ADD CONSTRAINT "ComissaoVendedorAdm_importacaoId_fkey" FOREIGN KEY ("importacaoId") REFERENCES "Importacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoVendedorAdm" ADD CONSTRAINT "ComissaoVendedorAdm_administradoraId_fkey" FOREIGN KEY ("administradoraId") REFERENCES "Administradora"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoVendedorAdm" ADD CONSTRAINT "ComissaoVendedorAdm_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoVendedorAdm" ADD CONSTRAINT "ComissaoVendedorAdm_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoVendedorAdm" ADD CONSTRAINT "ComissaoVendedorAdm_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoVendedorAdm" ADD CONSTRAINT "ComissaoVendedorAdm_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "Equipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoVendedorAdm" ADD CONSTRAINT "ComissaoVendedorAdm_gerenciaId_fkey" FOREIGN KEY ("gerenciaId") REFERENCES "Gerencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
