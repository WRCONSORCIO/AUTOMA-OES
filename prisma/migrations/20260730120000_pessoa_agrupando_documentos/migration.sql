-- DropForeignKey
ALTER TABLE "VendedorCategoriaHistorico" DROP CONSTRAINT "VendedorCategoriaHistorico_vendedorId_fkey";

-- DropForeignKey
ALTER TABLE "VendedorRecuperacao" DROP CONSTRAINT "VendedorRecuperacao_vendedorId_fkey";

-- AlterTable
ALTER TABLE "Vendedor" ADD COLUMN     "pessoaId" TEXT;

-- AlterTable
ALTER TABLE "VendedorCategoriaHistorico" ADD COLUMN     "pessoaId" TEXT,
ALTER COLUMN "vendedorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "VendedorRecuperacao" ADD COLUMN     "pessoaId" TEXT,
ALTER COLUMN "vendedorId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Pessoa" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PessoaVinculoHistorico" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "vendedorNome" TEXT NOT NULL,
    "vendedorDocumento" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "motivo" TEXT,
    "automatico" BOOLEAN NOT NULL DEFAULT false,
    "usuarioId" TEXT,
    "usuarioNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PessoaVinculoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pessoa_nome_idx" ON "Pessoa"("nome");

-- CreateIndex
CREATE INDEX "PessoaVinculoHistorico_pessoaId_criadoEm_idx" ON "PessoaVinculoHistorico"("pessoaId", "criadoEm");

-- CreateIndex
CREATE INDEX "PessoaVinculoHistorico_vendedorId_idx" ON "PessoaVinculoHistorico"("vendedorId");

-- CreateIndex
CREATE INDEX "Vendedor_pessoaId_idx" ON "Vendedor"("pessoaId");

-- CreateIndex
CREATE INDEX "VendedorCategoriaHistorico_pessoaId_vigenteDe_idx" ON "VendedorCategoriaHistorico"("pessoaId", "vigenteDe");

-- CreateIndex
CREATE INDEX "VendedorRecuperacao_pessoaId_dataInicio_dataFim_idx" ON "VendedorRecuperacao"("pessoaId", "dataInicio", "dataFim");

-- AddForeignKey
ALTER TABLE "PessoaVinculoHistorico" ADD CONSTRAINT "PessoaVinculoHistorico_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PessoaVinculoHistorico" ADD CONSTRAINT "PessoaVinculoHistorico_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PessoaVinculoHistorico" ADD CONSTRAINT "PessoaVinculoHistorico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendedor" ADD CONSTRAINT "Vendedor_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorCategoriaHistorico" ADD CONSTRAINT "VendedorCategoriaHistorico_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorCategoriaHistorico" ADD CONSTRAINT "VendedorCategoriaHistorico_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorRecuperacao" ADD CONSTRAINT "VendedorRecuperacao_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorRecuperacao" ADD CONSTRAINT "VendedorRecuperacao_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill: cada cadastro existente vira uma pessoa própria.
-- Nada é agrupado automaticamente aqui — o vínculo entre documentos da mesma
-- pessoa é feito depois, com conferência, pela tela de vínculos.
-- ---------------------------------------------------------------------------

INSERT INTO "Pessoa" ("id", "nome", "criadoEm", "atualizadoEm")
SELECT v."id", v."nome", v."criadoEm", CURRENT_TIMESTAMP
  FROM "Vendedor" v
 WHERE v."pessoaId" IS NULL;

UPDATE "Vendedor" v SET "pessoaId" = v."id" WHERE v."pessoaId" IS NULL;

INSERT INTO "PessoaVinculoHistorico"
       ("id", "pessoaId", "vendedorId", "vendedorNome", "vendedorDocumento",
        "acao", "motivo", "automatico", "criadoEm")
SELECT gen_random_uuid()::text, v."pessoaId", v."id", v."nome", v."cpfCnpj",
       'VINCULO', 'Pessoa criada na migração, um cadastro por documento', TRUE,
       CURRENT_TIMESTAMP
  FROM "Vendedor" v
 WHERE v."pessoaId" IS NOT NULL;

-- Categoria e recuperação passam a pertencer à pessoa, preservando o
-- documento de origem para rastreio.
UPDATE "VendedorCategoriaHistorico" h
   SET "pessoaId" = v."pessoaId"
  FROM "Vendedor" v
 WHERE v."id" = h."vendedorId" AND h."pessoaId" IS NULL;

UPDATE "VendedorRecuperacao" r
   SET "pessoaId" = v."pessoaId"
  FROM "Vendedor" v
 WHERE v."id" = r."vendedorId" AND r."pessoaId" IS NULL;
