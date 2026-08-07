-- ---------------------------------------------------------------------------
-- Estorno vale só para veterano e expert, nas DUAS situações.
--
-- Informado pela WR. Faz sentido com a mecânica do negócio: veterano e expert
-- recebem direto da administradora, e é esse dinheiro que volta. A venda de
-- iniciante é paga pela WR à própria equipe e não é cobrada de volta.
--
-- ATENÇÃO — isto MUDA comportamento. Até aqui a recuperação estornava qualquer
-- categoria, inclusive iniciante. A partir desta migração, não estorna mais.
-- Estornos de venda iniciante já gravados NÃO são desfeitos por esta migração:
-- o histórico não se reescreve sozinho, e desfazer cobrança é decisão do
-- financeiro, não efeito colateral de um deploy.
--
-- A coluna vira lista porque a regra vale para DUAS categorias. Guardar isso em
-- duas linhas convidaria ao pior erro possível: alterar o percentual de uma e
-- esquecer a outra, deixando o sistema cobrando valores diferentes para a mesma
-- regra de negócio.
-- ---------------------------------------------------------------------------

-- Nova coluna ao lado da antiga, para migrar sem perder nada.
ALTER TABLE "RegraEstorno" ADD COLUMN "categoriasVenda" "CategoriaVendedor"[] NOT NULL DEFAULT ARRAY[]::"CategoriaVendedor"[];

-- Preserva o que estava configurado: valor único vira lista de um elemento.
UPDATE "RegraEstorno"
SET "categoriasVenda" = ARRAY["categoriaVenda"]::"CategoriaVendedor"[]
WHERE "categoriaVenda" IS NOT NULL;

-- As duas regras padrão passam a valer para veterano e expert.
UPDATE "RegraEstorno"
SET "categoriasVenda" = ARRAY['VETERANO', 'EXPERT']::"CategoriaVendedor"[]
WHERE "id" IN (
  'regra_estorno_padrao_recuperacao',
  'regra_estorno_padrao_cancelamento_veterano'
);

ALTER TABLE "RegraEstorno" DROP COLUMN "categoriaVenda";

DROP INDEX IF EXISTS "RegraEstorno_tipo_categoriaVenda_vigenteDe_idx";
CREATE INDEX "RegraEstorno_tipo_vigenteDe_idx" ON "RegraEstorno"("tipo", "vigenteDe");
