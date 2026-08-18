-- CreateEnum
CREATE TYPE "TipoEtapaFluxo" AS ENUM ('TEXT', 'MENU', 'BUTTONS', 'LIST', 'INPUT', 'PAYMENT', 'PAYMENT_STATUS', 'DEVICE_SELECTION', 'HUMAN_HANDOFF', 'END');

-- CreateEnum
CREATE TYPE "TipoFluxo" AS ENUM ('PRINCIPAL', 'NOVA_CONTRATACAO', 'RENOVACAO', 'APARELHO', 'AUXILIAR');

-- CreateEnum
CREATE TYPE "StatusConversa" AS ENUM ('BOT', 'WAITING_PAYMENT', 'HUMAN', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrigemMensagem" AS ENUM ('CLIENTE', 'BOT', 'ATENDENTE', 'SISTEMA');

-- CreateEnum
CREATE TYPE "TipoMensagemWhats" AS ENUM ('TEXTO', 'BOTOES', 'LISTA', 'IMAGEM', 'DOCUMENTO', 'AUDIO', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "TipoPedido" AS ENUM ('NOVA_CONTRATACAO', 'RENOVACAO');

-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ProvedorPagamento" AS ENUM ('STRIPE', 'MERCADO_PAGO', 'ASAAS', 'PAGBANK', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProvedorWhatsApp" AS ENUM ('EVOLUTION', 'CLOUD_API');

-- CreateEnum
CREATE TYPE "StatusEventoPagamento" AS ENUM ('RECEBIDO', 'PROCESSADO', 'IGNORADO', 'ERRO');

-- CreateEnum
CREATE TYPE "TipoLogAtendimento" AS ENUM ('MENSAGEM_RECEBIDA', 'MENSAGEM_ENVIADA', 'MUDANCA_ETAPA', 'PEDIDO_CRIADO', 'PAGAMENTO', 'WEBHOOK', 'TRANSFERENCIA_HUMANA', 'RETORNO_AO_BOT', 'ERRO');

-- AlterEnum
ALTER TYPE "PerfilUsuario" ADD VALUE 'ATENDENTE';

-- CreateTable
CREATE TABLE "Plano" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "duracaoDias" INTEGER NOT NULL,
    "preco" DECIMAL(12,2) NOT NULL,
    "moeda" TEXT NOT NULL DEFAULT 'BRL',
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "destaque" BOOLEAN NOT NULL DEFAULT false,
    "textoCliente" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plano_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aparelho" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "icone" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "fluxoId" TEXT,
    "instrucoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Aparelho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fluxo" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "TipoFluxo" NOT NULL DEFAULT 'AUXILIAR',
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "etapaInicialId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fluxo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EtapaFluxo" (
    "id" TEXT NOT NULL,
    "fluxoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoEtapaFluxo" NOT NULL,
    "mensagem" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "condicao" JSONB,
    "acao" JSONB,
    "config" JSONB,
    "proximaEtapaId" TEXT,
    "proximoFluxoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtapaFluxo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpcaoEtapaFluxo" (
    "id" TEXT NOT NULL,
    "etapaId" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "proximaEtapaId" TEXT,
    "proximoFluxoId" TEXT,
    "acao" JSONB,
    "planoId" TEXT,
    "aparelhoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpcaoEtapaFluxo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClienteAtendimento" (
    "id" TEXT NOT NULL,
    "nome" TEXT,
    "telefone" TEXT NOT NULL,
    "telefoneExibicao" TEXT NOT NULL,
    "whatsappId" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "ultimaInteracaoEm" TIMESTAMP(3),

    CONSTRAINT "ClienteAtendimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversa" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "status" "StatusConversa" NOT NULL DEFAULT 'BOT',
    "fluxoId" TEXT,
    "etapaId" TEXT,
    "historicoEtapas" JSONB NOT NULL DEFAULT '[]',
    "contexto" JSONB NOT NULL DEFAULT '{}',
    "atendenteId" TEXT,
    "instanciaId" TEXT,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaMensagemEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradaEm" TIMESTAMP(3),

    CONSTRAINT "Conversa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MensagemAtendimento" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "origem" "OrigemMensagem" NOT NULL,
    "tipo" "TipoMensagemWhats" NOT NULL DEFAULT 'TEXTO',
    "conteudo" TEXT NOT NULL,
    "externoId" TEXT,
    "metadados" JSONB,
    "usuarioId" TEXT,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MensagemAtendimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "clienteId" TEXT NOT NULL,
    "planoId" TEXT NOT NULL,
    "conversaId" TEXT,
    "tipo" "TipoPedido" NOT NULL DEFAULT 'NOVA_CONTRATACAO',
    "valor" DECIMAL(12,2) NOT NULL,
    "moeda" TEXT NOT NULL DEFAULT 'BRL',
    "provedorPagamento" "ProvedorPagamento" NOT NULL DEFAULT 'STRIPE',
    "status" "StatusPagamento" NOT NULL DEFAULT 'PENDING',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagoEm" TIMESTAMP(3),
    "expiraEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "metadados" JSONB,

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoHistorico" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "statusAnterior" "StatusPagamento",
    "status" "StatusPagamento" NOT NULL,
    "descricao" TEXT NOT NULL,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedidoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pagamento" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "provedor" "ProvedorPagamento" NOT NULL,
    "externoId" TEXT NOT NULL,
    "status" "StatusPagamento" NOT NULL DEFAULT 'PENDING',
    "valor" DECIMAL(12,2) NOT NULL,
    "moeda" TEXT NOT NULL DEFAULT 'BRL',
    "link" TEXT,
    "expiraEm" TIMESTAMP(3),
    "payload" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoPagamento" (
    "id" TEXT NOT NULL,
    "provedor" "ProvedorPagamento" NOT NULL,
    "eventoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" "StatusEventoPagamento" NOT NULL DEFAULT 'RECEBIDO',
    "payload" JSONB,
    "erro" TEXT,
    "pedidoId" TEXT,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),

    CONSTRAINT "EventoPagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModeloMensagem" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "descricao" TEXT,
    "variaveis" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModeloMensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanciaWhatsApp" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "provedor" "ProvedorWhatsApp" NOT NULL DEFAULT 'EVOLUTION',
    "apiUrl" TEXT NOT NULL,
    "apiKeyCifrada" TEXT,
    "instancia" TEXT,
    "webhookTokenCifrado" TEXT,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "conectadoEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanciaWhatsApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HorarioAtendimento" (
    "id" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "abertura" TEXT NOT NULL DEFAULT '08:00',
    "fechamento" TEXT NOT NULL DEFAULT '18:00',
    "fechado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "HorarioAtendimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogAtendimento" (
    "id" TEXT NOT NULL,
    "tipo" "TipoLogAtendimento" NOT NULL,
    "descricao" TEXT NOT NULL,
    "conversaId" TEXT,
    "clienteId" TEXT,
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogAtendimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Plano_status_ordem_idx" ON "Plano"("status", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "Aparelho_chave_key" ON "Aparelho"("chave");

-- CreateIndex
CREATE INDEX "Aparelho_status_ordem_idx" ON "Aparelho"("status", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "Fluxo_chave_key" ON "Fluxo"("chave");

-- CreateIndex
CREATE INDEX "Fluxo_tipo_status_idx" ON "Fluxo"("tipo", "status");

-- CreateIndex
CREATE INDEX "EtapaFluxo_fluxoId_ordem_idx" ON "EtapaFluxo"("fluxoId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "EtapaFluxo_fluxoId_chave_key" ON "EtapaFluxo"("fluxoId", "chave");

-- CreateIndex
CREATE INDEX "OpcaoEtapaFluxo_etapaId_ordem_idx" ON "OpcaoEtapaFluxo"("etapaId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "ClienteAtendimento_telefone_key" ON "ClienteAtendimento"("telefone");

-- CreateIndex
CREATE INDEX "ClienteAtendimento_ultimaInteracaoEm_idx" ON "ClienteAtendimento"("ultimaInteracaoEm");

-- CreateIndex
CREATE INDEX "Conversa_status_ultimaMensagemEm_idx" ON "Conversa"("status", "ultimaMensagemEm");

-- CreateIndex
CREATE INDEX "Conversa_clienteId_iniciadaEm_idx" ON "Conversa"("clienteId", "iniciadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "MensagemAtendimento_externoId_key" ON "MensagemAtendimento"("externoId");

-- CreateIndex
CREATE INDEX "MensagemAtendimento_conversaId_criadoEm_idx" ON "MensagemAtendimento"("conversaId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_numero_key" ON "Pedido"("numero");

-- CreateIndex
CREATE INDEX "Pedido_status_criadoEm_idx" ON "Pedido"("status", "criadoEm");

-- CreateIndex
CREATE INDEX "Pedido_clienteId_criadoEm_idx" ON "Pedido"("clienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "PedidoHistorico_pedidoId_criadoEm_idx" ON "PedidoHistorico"("pedidoId", "criadoEm");

-- CreateIndex
CREATE INDEX "Pagamento_pedidoId_criadoEm_idx" ON "Pagamento"("pedidoId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Pagamento_provedor_externoId_key" ON "Pagamento"("provedor", "externoId");

-- CreateIndex
CREATE INDEX "EventoPagamento_tipo_recebidoEm_idx" ON "EventoPagamento"("tipo", "recebidoEm");

-- CreateIndex
CREATE UNIQUE INDEX "EventoPagamento_provedor_eventoId_key" ON "EventoPagamento"("provedor", "eventoId");

-- CreateIndex
CREATE UNIQUE INDEX "ModeloMensagem_chave_key" ON "ModeloMensagem"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "HorarioAtendimento_diaSemana_key" ON "HorarioAtendimento"("diaSemana");

-- CreateIndex
CREATE INDEX "LogAtendimento_tipo_criadoEm_idx" ON "LogAtendimento"("tipo", "criadoEm");

-- CreateIndex
CREATE INDEX "LogAtendimento_conversaId_criadoEm_idx" ON "LogAtendimento"("conversaId", "criadoEm");

-- AddForeignKey
ALTER TABLE "Aparelho" ADD CONSTRAINT "Aparelho_fluxoId_fkey" FOREIGN KEY ("fluxoId") REFERENCES "Fluxo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fluxo" ADD CONSTRAINT "Fluxo_etapaInicialId_fkey" FOREIGN KEY ("etapaInicialId") REFERENCES "EtapaFluxo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EtapaFluxo" ADD CONSTRAINT "EtapaFluxo_fluxoId_fkey" FOREIGN KEY ("fluxoId") REFERENCES "Fluxo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EtapaFluxo" ADD CONSTRAINT "EtapaFluxo_proximaEtapaId_fkey" FOREIGN KEY ("proximaEtapaId") REFERENCES "EtapaFluxo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EtapaFluxo" ADD CONSTRAINT "EtapaFluxo_proximoFluxoId_fkey" FOREIGN KEY ("proximoFluxoId") REFERENCES "Fluxo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpcaoEtapaFluxo" ADD CONSTRAINT "OpcaoEtapaFluxo_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "EtapaFluxo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpcaoEtapaFluxo" ADD CONSTRAINT "OpcaoEtapaFluxo_proximaEtapaId_fkey" FOREIGN KEY ("proximaEtapaId") REFERENCES "EtapaFluxo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpcaoEtapaFluxo" ADD CONSTRAINT "OpcaoEtapaFluxo_proximoFluxoId_fkey" FOREIGN KEY ("proximoFluxoId") REFERENCES "Fluxo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpcaoEtapaFluxo" ADD CONSTRAINT "OpcaoEtapaFluxo_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "Plano"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpcaoEtapaFluxo" ADD CONSTRAINT "OpcaoEtapaFluxo_aparelhoId_fkey" FOREIGN KEY ("aparelhoId") REFERENCES "Aparelho"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversa" ADD CONSTRAINT "Conversa_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "ClienteAtendimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversa" ADD CONSTRAINT "Conversa_fluxoId_fkey" FOREIGN KEY ("fluxoId") REFERENCES "Fluxo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversa" ADD CONSTRAINT "Conversa_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "EtapaFluxo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversa" ADD CONSTRAINT "Conversa_atendenteId_fkey" FOREIGN KEY ("atendenteId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversa" ADD CONSTRAINT "Conversa_instanciaId_fkey" FOREIGN KEY ("instanciaId") REFERENCES "InstanciaWhatsApp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MensagemAtendimento" ADD CONSTRAINT "MensagemAtendimento_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "Conversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MensagemAtendimento" ADD CONSTRAINT "MensagemAtendimento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "ClienteAtendimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "Plano"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "Conversa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoHistorico" ADD CONSTRAINT "PedidoHistorico_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoHistorico" ADD CONSTRAINT "PedidoHistorico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogAtendimento" ADD CONSTRAINT "LogAtendimento_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "Conversa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogAtendimento" ADD CONSTRAINT "LogAtendimento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "ClienteAtendimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
