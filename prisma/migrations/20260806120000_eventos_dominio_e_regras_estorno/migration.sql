-- CreateEnum
CREATE TYPE "TipoEstorno" AS ENUM ('CANCELAMENTO', 'RECUPERACAO');

-- CreateEnum
CREATE TYPE "StatusEvento" AS ENUM ('PENDENTE', 'PROCESSANDO', 'PROCESSADO', 'FALHA');

-- AlterTable
ALTER TABLE "Estorno" ADD COLUMN     "parcelaLimite" INTEGER,
ADD COLUMN     "percentualAplicado" DECIMAL(9,4),
ADD COLUMN     "regraEstornoId" TEXT,
ADD COLUMN     "tipo" "TipoEstorno" NOT NULL DEFAULT 'RECUPERACAO',
ADD COLUMN     "valorEstorno" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "EventoDominio" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "agregado" TEXT NOT NULL,
    "agregadoId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "metadados" JSONB,
    "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StatusEvento" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "processadoEm" TIMESTAMP(3),

    CONSTRAINT "EventoDominio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoEntrega" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "handler" TEXT NOT NULL,
    "status" "StatusEvento" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "duracaoMs" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "EventoEntrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegraEstorno" (
    "id" TEXT NOT NULL,
    "vendedorId" TEXT,
    "tipo" "TipoEstorno" NOT NULL,
    "parcelaLimite" INTEGER NOT NULL,
    "percentual" DECIMAL(9,4) NOT NULL,
    "vigenteDe" DATE NOT NULL,
    "vigenteAte" DATE,
    "observacoes" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegraEstorno_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventoDominio_status_proximaTentativaEm_idx" ON "EventoDominio"("status", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "EventoDominio_tipo_ocorridoEm_idx" ON "EventoDominio"("tipo", "ocorridoEm");

-- CreateIndex
CREATE INDEX "EventoDominio_agregado_agregadoId_idx" ON "EventoDominio"("agregado", "agregadoId");

-- CreateIndex
CREATE INDEX "EventoDominio_ocorridoEm_idx" ON "EventoDominio"("ocorridoEm");

-- CreateIndex
CREATE INDEX "EventoEntrega_status_handler_idx" ON "EventoEntrega"("status", "handler");

-- CreateIndex
CREATE UNIQUE INDEX "EventoEntrega_eventoId_handler_key" ON "EventoEntrega"("eventoId", "handler");

-- CreateIndex
CREATE INDEX "RegraEstorno_vendedorId_tipo_vigenteDe_idx" ON "RegraEstorno"("vendedorId", "tipo", "vigenteDe");

-- CreateIndex
CREATE INDEX "RegraEstorno_tipo_vigenteDe_idx" ON "RegraEstorno"("tipo", "vigenteDe");

-- CreateIndex
CREATE INDEX "Estorno_tipo_dataCancelamento_idx" ON "Estorno"("tipo", "dataCancelamento");

-- AddForeignKey
ALTER TABLE "Estorno" ADD CONSTRAINT "Estorno_regraEstornoId_fkey" FOREIGN KEY ("regraEstornoId") REFERENCES "RegraEstorno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoEntrega" ADD CONSTRAINT "EventoEntrega_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "EventoDominio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegraEstorno" ADD CONSTRAINT "RegraEstorno_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegraEstorno" ADD CONSTRAINT "RegraEstorno_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

