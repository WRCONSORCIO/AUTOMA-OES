-- DropIndex
DROP INDEX "Vendedor_tipoDocumento_idx";

-- DropIndex
DROP INDEX "VendedorRecuperacao_vendedorId_idx";

-- CreateTable
CREATE TABLE "MetaPromocao" (
    "id" TEXT NOT NULL,
    "categoriaAlvo" "CategoriaVendedor" NOT NULL,
    "volumeMinimo" DECIMAL(18,2) NOT NULL,
    "abreDocumento" "TipoDocumento" NOT NULL DEFAULT 'CNPJ',
    "vigenteDe" DATE NOT NULL,
    "vigenteAte" DATE,
    "observacoes" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaPromocao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaPromocao_categoriaAlvo_vigenteDe_idx" ON "MetaPromocao"("categoriaAlvo", "vigenteDe");

-- AddForeignKey
ALTER TABLE "MetaPromocao" ADD CONSTRAINT "MetaPromocao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- As duas metas da trilha, informadas pela WR.
--
-- R$ 3 milhões promove o iniciante a veterano, abrindo o primeiro CNPJ.
-- R$ 30 milhões promove o veterano a expert, abrindo o segundo.
--
-- O volume conta a CARTEIRA COMPLETA — todas as vendas da pessoa, somando os
-- documentos.
--
-- `vigenteDe` em 1900 para cobrir todo o histórico já importado: quem já vendeu
-- acima do limite precisa aparecer como apto desde já, não só a partir de hoje.
-- ---------------------------------------------------------------------------
INSERT INTO "MetaPromocao" ("id", "categoriaAlvo", "volumeMinimo", "abreDocumento", "vigenteDe", "observacoes", "criadoEm")
VALUES
  ('meta_promocao_veterano', 'VETERANO',  3000000,  'CNPJ', DATE '1900-01-01',
   'Iniciante que atinge o volume passa a operar por CNPJ como veterano e para de vender no CPF.', NOW()),
  ('meta_promocao_expert',   'EXPERT',   30000000,  'CNPJ', DATE '1900-01-01',
   'Veterano que atinge o volume abre um segundo CNPJ como expert. O CNPJ de expert não vende: é a identidade pela qual recebe supervisão.', NOW())
ON CONFLICT ("id") DO NOTHING;
