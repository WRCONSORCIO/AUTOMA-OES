-- ---------------------------------------------------------------------------
-- Remove o módulo de atendimento via WhatsApp.
--
-- O atendimento virou sistema próprio: o ERP não guarda mais conversa, pedido
-- de plano nem credencial de WhatsApp. Esta migração desfaz o que a migração
-- `20260818160028_atendimento_whatsapp` criou.
--
-- A migração anterior continua no repositório de propósito. Apagá-la faria o
-- histórico do Prisma divergir do que está gravado no banco; o caminho correto
-- é sempre para a frente, com uma migração que desfaz.
--
-- ATENÇÃO: isto apaga dados. Em um banco onde o atendimento chegou a ser usado,
-- as conversas e os pedidos vão junto. Faça o backup antes (ver README, seção
-- Backup). Em banco onde o módulo nunca foi configurado, as tabelas estão
-- vazias e nada se perde.
-- ---------------------------------------------------------------------------

-- Nenhum usuário pode ficar com um perfil que deixará de existir. Falhar aqui é
-- melhor do que apagar o valor e deixar a conta em estado inválido: quem for
-- migrar troca o perfil dessas pessoas e roda de novo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Usuario" WHERE "perfil" = 'ATENDENTE') THEN
    RAISE EXCEPTION
      'Existem usuários com o perfil ATENDENTE. Altere o perfil dessas contas antes de remover o módulo de atendimento.';
  END IF;
END
$$;

-- As tabelas caem em bloco com CASCADE porque as chaves estrangeiras são todas
-- entre elas próprias — nenhuma tabela do ERP aponta para cá.
DROP TABLE IF EXISTS "LogAtendimento" CASCADE;
DROP TABLE IF EXISTS "EventoPagamento" CASCADE;
DROP TABLE IF EXISTS "PedidoHistorico" CASCADE;
DROP TABLE IF EXISTS "Pagamento" CASCADE;
DROP TABLE IF EXISTS "Pedido" CASCADE;
DROP TABLE IF EXISTS "MensagemAtendimento" CASCADE;
DROP TABLE IF EXISTS "Conversa" CASCADE;
DROP TABLE IF EXISTS "ClienteAtendimento" CASCADE;
DROP TABLE IF EXISTS "OpcaoEtapaFluxo" CASCADE;
DROP TABLE IF EXISTS "EtapaFluxo" CASCADE;
DROP TABLE IF EXISTS "Fluxo" CASCADE;
DROP TABLE IF EXISTS "Aparelho" CASCADE;
DROP TABLE IF EXISTS "Plano" CASCADE;
DROP TABLE IF EXISTS "ModeloMensagem" CASCADE;
DROP TABLE IF EXISTS "InstanciaWhatsApp" CASCADE;
DROP TABLE IF EXISTS "HorarioAtendimento" CASCADE;

DROP TYPE IF EXISTS "TipoEtapaFluxo";
DROP TYPE IF EXISTS "TipoFluxo";
DROP TYPE IF EXISTS "StatusConversa";
DROP TYPE IF EXISTS "OrigemMensagem";
DROP TYPE IF EXISTS "TipoMensagemWhats";
DROP TYPE IF EXISTS "TipoPedido";
DROP TYPE IF EXISTS "StatusPagamento";
DROP TYPE IF EXISTS "ProvedorPagamento";
DROP TYPE IF EXISTS "ProvedorWhatsApp";
DROP TYPE IF EXISTS "StatusEventoPagamento";
DROP TYPE IF EXISTS "TipoLogAtendimento";

-- PostgreSQL não remove um valor de enum: o tipo precisa ser recriado sem ele.
ALTER TYPE "PerfilUsuario" RENAME TO "PerfilUsuario_antigo";

CREATE TYPE "PerfilUsuario" AS ENUM ('ADMINISTRADOR', 'GERENTE', 'SUPERVISOR', 'FINANCEIRO', 'RH');

ALTER TABLE "Usuario"
  ALTER COLUMN "perfil" TYPE "PerfilUsuario"
  USING "perfil"::text::"PerfilUsuario";

DROP TYPE "PerfilUsuario_antigo";
