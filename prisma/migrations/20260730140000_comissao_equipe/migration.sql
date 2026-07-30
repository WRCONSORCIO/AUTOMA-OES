-- CreateEnum
CREATE TYPE "PapelComissao" AS ENUM ('VENDEDOR', 'SUPERVISOR', 'GERENCIA');

-- CreateEnum
CREATE TYPE "CondicaoComissao" AS ENUM ('SEMPRE', 'SUPERVISAO_DIFERENTE_GERENCIA', 'EQUIPE_HABILITADA');

-- AlterTable
ALTER TABLE "Equipe" ADD COLUMN     "habilitadaComissao" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TabelaComissaoEquipe" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" "CategoriaVendedor" NOT NULL,
    "vigenteDe" DATE NOT NULL,
    "vigenteAte" DATE,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "parcelasParaLiberacao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TabelaComissaoEquipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegraComissaoEquipe" (
    "id" TEXT NOT NULL,
    "tabelaId" TEXT NOT NULL,
    "papel" "PapelComissao" NOT NULL,
    "percentual" DECIMAL(9,4) NOT NULL,
    "condicao" "CondicaoComissao" NOT NULL DEFAULT 'SEMPRE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegraComissaoEquipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComissaoEquipe" (
    "id" TEXT NOT NULL,
    "cotaId" TEXT NOT NULL,
    "papel" "PapelComissao" NOT NULL,
    "categoriaVenda" "CategoriaVendedor" NOT NULL,
    "pessoaId" TEXT,
    "equipeId" TEXT,
    "gerenciaId" TEXT,
    "baseCalculo" DECIMAL(18,2) NOT NULL,
    "percentual" DECIMAL(9,4) NOT NULL,
    "valorPrevisto" DECIMAL(18,2) NOT NULL,
    "valorLiberado" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "parcelasRecebidas" INTEGER NOT NULL DEFAULT 0,
    "tabelaId" TEXT,
    "regraId" TEXT,
    "regra" TEXT NOT NULL,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComissaoEquipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TabelaComissaoEquipe_categoria_vigenteDe_idx" ON "TabelaComissaoEquipe"("categoria", "vigenteDe");

-- CreateIndex
CREATE UNIQUE INDEX "RegraComissaoEquipe_tabelaId_papel_key" ON "RegraComissaoEquipe"("tabelaId", "papel");

-- CreateIndex
CREATE INDEX "ComissaoEquipe_pessoaId_idx" ON "ComissaoEquipe"("pessoaId");

-- CreateIndex
CREATE INDEX "ComissaoEquipe_equipeId_idx" ON "ComissaoEquipe"("equipeId");

-- CreateIndex
CREATE INDEX "ComissaoEquipe_gerenciaId_idx" ON "ComissaoEquipe"("gerenciaId");

-- CreateIndex
CREATE INDEX "ComissaoEquipe_categoriaVenda_idx" ON "ComissaoEquipe"("categoriaVenda");

-- CreateIndex
CREATE UNIQUE INDEX "ComissaoEquipe_cotaId_papel_key" ON "ComissaoEquipe"("cotaId", "papel");

-- AddForeignKey
ALTER TABLE "RegraComissaoEquipe" ADD CONSTRAINT "RegraComissaoEquipe_tabelaId_fkey" FOREIGN KEY ("tabelaId") REFERENCES "TabelaComissaoEquipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoEquipe" ADD CONSTRAINT "ComissaoEquipe_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoEquipe" ADD CONSTRAINT "ComissaoEquipe_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoEquipe" ADD CONSTRAINT "ComissaoEquipe_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "Equipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoEquipe" ADD CONSTRAINT "ComissaoEquipe_gerenciaId_fkey" FOREIGN KEY ("gerenciaId") REFERENCES "Gerencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoEquipe" ADD CONSTRAINT "ComissaoEquipe_tabelaId_fkey" FOREIGN KEY ("tabelaId") REFERENCES "TabelaComissaoEquipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoEquipe" ADD CONSTRAINT "ComissaoEquipe_regraId_fkey" FOREIGN KEY ("regraId") REFERENCES "RegraComissaoEquipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

