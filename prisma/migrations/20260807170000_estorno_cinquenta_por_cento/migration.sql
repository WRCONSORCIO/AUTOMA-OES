-- ---------------------------------------------------------------------------
-- Percentual de estorno: 50% da comissão recebida, nos dois casos.
--
-- Informado pela WR. As duas regras foram semeadas com 100% por suposição
-- minha, não por informação — 100% nunca foi o percentual praticado.
--
-- Por isso aqui é CORREÇÃO e não nova vigência. Abrir um período novo diria
-- "era 100% até ontem, é 50% a partir de hoje", e faria todo estorno de venda
-- antiga ser apurado a 100%. O valor sempre foi 50%, desde o começo do
-- histórico, e é assim que a vigência precisa ficar.
--
-- Estorno já gravado guarda o percentual congelado na linha e NÃO é alterado
-- por esta migração. Se algum tiver sido apurado a 100%, precisa ser reapurado
-- explicitamente — o histórico não se reescreve sozinho.
-- ---------------------------------------------------------------------------
UPDATE "RegraEstorno"
SET "percentual" = 50,
    "observacoes" = COALESCE("observacoes", '') || ' Percentual de 50% confirmado pela WR.'
WHERE "id" IN (
  'regra_estorno_padrao_recuperacao',
  'regra_estorno_padrao_cancelamento_veterano'
)
AND "percentual" = 100;
