-- CreateEnum
CREATE TYPE "DestinoComissao" AS ENUM ('NOVATO', 'VETERANO', 'EXPERT', 'SUPERVISOR', 'GERENCIA');

-- CreateTable
CREATE TABLE "TabelaComissaoInterna" (
    "id" TEXT NOT NULL,
    "destino" "DestinoComissao" NOT NULL,
    "segmento" "SegmentoVenda" NOT NULL,
    "vigenteDe" DATE NOT NULL,
    "vigenteAte" DATE,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TabelaComissaoInterna_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaixaComissaoInterna" (
    "id" TEXT NOT NULL,
    "tabelaId" TEXT NOT NULL,
    "parcela" INTEGER NOT NULL,
    "percentual" DECIMAL(9,4) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaixaComissaoInterna_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TabelaComissaoInterna_destino_segmento_vigenteDe_idx" ON "TabelaComissaoInterna"("destino", "segmento", "vigenteDe");

-- CreateIndex
CREATE UNIQUE INDEX "FaixaComissaoInterna_tabelaId_parcela_key" ON "FaixaComissaoInterna"("tabelaId", "parcela");

-- AddForeignKey
ALTER TABLE "FaixaComissaoInterna" ADD CONSTRAINT "FaixaComissaoInterna_tabelaId_fkey" FOREIGN KEY ("tabelaId") REFERENCES "TabelaComissaoInterna"("id") ON DELETE CASCADE ON UPDATE CASCADE;
