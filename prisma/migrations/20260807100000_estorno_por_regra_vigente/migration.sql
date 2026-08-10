-- AlterTable
ALTER TABLE "Estorno" ADD COLUMN     "importacaoId" TEXT;

-- CreateIndex
CREATE INDEX "Estorno_importacaoId_idx" ON "Estorno"("importacaoId");

-- AddForeignKey
ALTER TABLE "Estorno" ADD CONSTRAINT "Estorno_importacaoId_fkey" FOREIGN KEY ("importacaoId") REFERENCES "Importacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Regra padrão de estorno.
--
-- Reproduz EXATAMENTE o que a constante `PARCELA_LIMITE_ESTORNO = 6` fazia:
-- venda marcada em recuperação, cancelada com menos de 6 parcelas pagas,
-- estorna integralmente. A parametrização entra sem mexer em um centavo.
--
-- Repare que NÃO existe regra padrão para CANCELAMENTO. Hoje o sistema só
-- estorna venda de recuperação; criar aqui uma regra de cancelamento faria toda
-- cota cancelada abaixo de 6 parcelas passar a estornar da noite para o dia.
-- Esse é o segundo tipo previsto no briefing, e ele precisa ser cadastrado
-- conscientemente pelo financeiro, com o percentual que a WR de fato pratica.
--
-- `vigenteDe` em 1900 porque a regra precisa cobrir todo o histórico já
-- importado: um cancelamento de 2024 tem que encontrar regra vigente em 2024.
-- ---------------------------------------------------------------------------
INSERT INTO "RegraEstorno" ("id", "vendedorId", "tipo", "parcelaLimite", "percentual", "vigenteDe", "vigenteAte", "observacoes", "criadoEm")
VALUES (
  'regra_estorno_padrao_recuperacao',
  NULL,
  'RECUPERACAO',
  6,
  100,
  DATE '1900-01-01',
  NULL,
  'Regra padrão da WR, criada na migração que parametrizou o estorno. Equivale ao limite de 6 parcelas que era constante no código.',
  NOW()
)
ON CONFLICT ("id") DO NOTHING;
