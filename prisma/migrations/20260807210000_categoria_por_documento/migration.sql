-- ---------------------------------------------------------------------------
-- A categoria e a recuperação passam a ser do DOCUMENTO, não da pessoa.
--
-- É a trilha que a WR descreveu: a pessoa entra vendendo no CPF como iniciante
-- e, ao bater a meta, passa a operar por um CNPJ como veterano. Os dois
-- documentos coexistem com categorias diferentes, e a venda de cada um é
-- apurada pela categoria daquele documento na data em que aconteceu.
--
-- O BACKFILL é o que torna a troca segura. Cada período que hoje pertence à
-- pessoa é REPLICADO para todos os documentos dela. Assim, no instante
-- seguinte à migração, resolver por documento devolve exatamente o mesmo
-- resultado que resolver por pessoa devolvia — nenhum centavo muda. A partir
-- daí, sim, os documentos podem divergir.
--
-- `pessoaId` permanece preenchido em todas as linhas. Se a decisão de resolver
-- por documento precisar ser revertida, basta voltar a consulta para `pessoaId`
-- — sem migração de volta e sem perda de dado.
-- ---------------------------------------------------------------------------

CREATE TYPE "TipoDocumento" AS ENUM ('CPF', 'CNPJ');

ALTER TABLE "Vendedor"
  ADD COLUMN "encerradoParaVendaEm" DATE,
  ADD COLUMN "tipoDocumento" "TipoDocumento" NOT NULL DEFAULT 'CPF';

ALTER TABLE "RegraEstorno" ALTER COLUMN "categoriasVenda" DROP DEFAULT;

-- 11 dígitos é CPF, 14 é CNPJ. O documento já vem normalizado (só dígitos).
UPDATE "Vendedor" SET "tipoDocumento" = 'CNPJ' WHERE length("cpfCnpj") = 14;

-- --- Backfill: replica cada período da pessoa para todos os documentos ------

INSERT INTO "VendedorCategoriaHistorico"
  ("id", "pessoaId", "vendedorId", "categoria", "vigenteDe", "vigenteAte", "motivo", "usuarioId", "criadoEm")
SELECT
  gen_random_uuid()::text, h."pessoaId", v."id", h."categoria", h."vigenteDe", h."vigenteAte",
  COALESCE(h."motivo" || ' · ', '') || 'Replicado para o documento na migração por-documento',
  h."usuarioId", h."criadoEm"
FROM "VendedorCategoriaHistorico" h
JOIN "Vendedor" v ON v."pessoaId" = h."pessoaId"
WHERE h."pessoaId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "VendedorCategoriaHistorico" x
    WHERE x."vendedorId" = v."id"
      AND x."categoria" = h."categoria"
      AND x."vigenteDe" = h."vigenteDe"
      AND x."vigenteAte" IS NOT DISTINCT FROM h."vigenteAte"
  );

INSERT INTO "VendedorRecuperacao"
  ("id", "pessoaId", "vendedorId", "dataInicio", "dataFim", "motivo", "encerradaEm", "usuarioId", "criadoEm")
SELECT
  gen_random_uuid()::text, r."pessoaId", v."id", r."dataInicio", r."dataFim",
  COALESCE(r."motivo" || ' · ', '') || 'Replicado para o documento na migração por-documento',
  r."encerradaEm", r."usuarioId", r."criadoEm"
FROM "VendedorRecuperacao" r
JOIN "Vendedor" v ON v."pessoaId" = r."pessoaId"
WHERE r."pessoaId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "VendedorRecuperacao" x
    WHERE x."vendedorId" = v."id"
      AND x."dataInicio" = r."dataInicio"
      AND x."dataFim" = r."dataFim"
  );

-- Período órfão (sem documento) não é resolvível por documento. Não existe hoje
-- porque todo histórico nasce de um cadastro, mas a checagem fica registrada.
UPDATE "VendedorCategoriaHistorico" h
SET "vendedorId" = v."id"
FROM "Vendedor" v
WHERE h."vendedorId" IS NULL AND v."pessoaId" = h."pessoaId";

-- --- Invariante: no máximo 1 CPF por pessoa --------------------------------
--
-- O teto de 2 CNPJs não cabe em índice e é garantido no domínio
-- (`limiteDeDocumentos`), com teste. Este aqui o banco garante sozinho.
CREATE UNIQUE INDEX "Vendedor_um_cpf_por_pessoa"
  ON "Vendedor" ("pessoaId")
  WHERE "tipoDocumento" = 'CPF' AND "pessoaId" IS NOT NULL;

CREATE INDEX "Vendedor_tipoDocumento_idx" ON "Vendedor"("tipoDocumento");
CREATE INDEX "VendedorRecuperacao_vendedorId_idx" ON "VendedorRecuperacao"("vendedorId");
