-- CreateEnum
CREATE TYPE "PerfilUsuario" AS ENUM ('ADMINISTRADOR', 'GERENTE', 'SUPERVISOR', 'FINANCEIRO', 'RH');

-- CreateEnum
CREATE TYPE "CategoriaVendedor" AS ENUM ('INICIANTE', 'VETERANO', 'EXPERT');

-- CreateEnum
CREATE TYPE "SituacaoVendedor" AS ENUM ('ATIVO', 'INATIVO', 'AFASTADO', 'DESLIGADO');

-- CreateEnum
CREATE TYPE "StatusRegistro" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "SituacaoCota" AS ENUM ('ATIVO', 'CANCELADO', 'CONTEMPLADO', 'QUITADO', 'TRANSFERIDO', 'EM_ATRASO', 'DESISTENTE', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoLancamentoComissao" AS ENUM ('PAGAMENTO_COMISSAO', 'INCLUSAO_DE_PLANO', 'CANCELAMENTO_DE_PLANO', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusComissao" AS ENUM ('NORMAL', 'ESTORNO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "OrigemVendedor" AS ENUM ('ADMINISTRADORA', 'OVERRIDE_WR', 'NAO_IDENTIFICADO');

-- CreateEnum
CREATE TYPE "TipoImportacao" AS ENUM ('BASE_CSV', 'COMISSAO_PDF');

-- CreateEnum
CREATE TYPE "StatusImportacao" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'CONCLUIDA_COM_ERROS', 'FALHA');

-- CreateEnum
CREATE TYPE "AcaoAuditoria" AS ENUM ('LOGIN', 'LOGOUT', 'LOGIN_FALHA', 'CRIACAO', 'ATUALIZACAO', 'INATIVACAO', 'REATIVACAO', 'IMPORTACAO', 'MUDANCA_CATEGORIA', 'TRANSFERENCIA_VENDEDOR', 'MUDANCA_EQUIPE', 'MUDANCA_GERENCIA', 'MUDANCA_PERCENTUAL', 'RECUPERACAO', 'ESTORNO', 'BACKUP', 'RECALCULO_COMISSAO');

-- CreateEnum
CREATE TYPE "TipoBackup" AS ENUM ('AUTOMATICO', 'MANUAL');

-- CreateEnum
CREATE TYPE "StatusBackup" AS ENUM ('PENDENTE', 'EXECUTANDO', 'CONCLUIDO', 'FALHA');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "perfil" "PerfilUsuario" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "gerenciaId" TEXT,
    "equipeId" TEXT,
    "ultimoLoginEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gerencia" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gerencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipe" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "gerenciaId" TEXT NOT NULL,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendedor" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpfCnpj" TEXT NOT NULL,
    "cpfCnpjFormatado" TEXT,
    "equipeId" TEXT,
    "gerenciaId" TEXT,
    "categoriaAtual" "CategoriaVendedor" NOT NULL DEFAULT 'INICIANTE',
    "dataEntradaWr" DATE,
    "situacao" "SituacaoVendedor" NOT NULL DEFAULT 'ATIVO',
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendedorCategoriaHistorico" (
    "id" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "categoria" "CategoriaVendedor" NOT NULL,
    "vigenteDe" DATE NOT NULL,
    "vigenteAte" DATE,
    "motivo" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendedorCategoriaHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendedorAlocacaoHistorico" (
    "id" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "equipeId" TEXT,
    "gerenciaId" TEXT,
    "vigenteDe" DATE NOT NULL,
    "vigenteAte" DATE,
    "motivo" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendedorAlocacaoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendedorRecuperacao" (
    "id" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "dataInicio" DATE NOT NULL,
    "dataFim" DATE NOT NULL,
    "motivo" TEXT,
    "encerradaEm" TIMESTAMP(3),
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendedorRecuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Administradora" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "codigo" TEXT,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Administradora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cota" (
    "id" TEXT NOT NULL,
    "administradoraId" TEXT NOT NULL,
    "contrato" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cota" TEXT NOT NULL,
    "cpfCnpjCliente" TEXT NOT NULL,
    "nomeCliente" TEXT NOT NULL,
    "tipoPessoa" TEXT,
    "contatoCliente" TEXT,
    "emailCliente" TEXT,
    "ufCliente" TEXT,
    "dataVenda" DATE,
    "dataEntrada" DATE,
    "situacao" "SituacaoCota" NOT NULL DEFAULT 'ATIVO',
    "situacaoOriginal" TEXT,
    "diaVencimento" INTEGER,
    "valorCredito" DECIMAL(18,2),
    "valorParcela" DECIMAL(18,2),
    "meioPagamento" TEXT,
    "segmento" TEXT,
    "produto" TEXT,
    "prazo" INTEGER,
    "parcelasPagas" INTEGER NOT NULL DEFAULT 0,
    "parcelasAntecipadas" INTEGER NOT NULL DEFAULT 0,
    "parcelasEmitidas" INTEGER NOT NULL DEFAULT 0,
    "dataUltimoPagamento" DATE,
    "contemplado" BOOLEAN NOT NULL DEFAULT false,
    "dataContemplacao" DATE,
    "valorCreditoContemplado" DECIMAL(18,2),
    "alienado" BOOLEAN NOT NULL DEFAULT false,
    "dataAlienacao" DATE,
    "taxaAdm" DECIMAL(9,4),
    "taxaFunres" DECIMAL(9,4),
    "temSeguro" BOOLEAN NOT NULL DEFAULT false,
    "valorSeguro" DECIMAL(18,2),
    "temFlex" BOOLEAN NOT NULL DEFAULT false,
    "taxaFlex" DECIMAL(9,4),
    "cpfCnpjParceiro" TEXT,
    "cpfCnpjVendedorAdm" TEXT,
    "nomeVendedorAdm" TEXT,
    "cpfCnpjParceiroComercial" TEXT,
    "nomeParceiroComercial" TEXT,
    "origemVenda" TEXT,
    "dataCancelamento" DATE,
    "vendedorAdmId" TEXT,
    "vendedorEfetivoId" TEXT,
    "origemVendedor" "OrigemVendedor" NOT NULL DEFAULT 'ADMINISTRADORA',
    "categoriaVenda" "CategoriaVendedor",
    "categoriaVendaFixadaEm" TIMESTAMP(3),
    "emRecuperacao" BOOLEAN NOT NULL DEFAULT false,
    "recuperacaoId" TEXT,
    "recuperacaoFixadaEm" TIMESTAMP(3),
    "equipeId" TEXT,
    "gerenciaId" TEXT,
    "geraEstorno" BOOLEAN NOT NULL DEFAULT false,
    "hashConteudo" TEXT NOT NULL,
    "primeiraImportacaoId" TEXT,
    "ultimaImportacaoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CotaVersao" (
    "id" TEXT NOT NULL,
    "cotaId" TEXT NOT NULL,
    "importacaoId" TEXT,
    "hashConteudo" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "alteracoes" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CotaVersao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CotaVendedorOverride" (
    "id" TEXT NOT NULL,
    "cotaId" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "motivo" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CotaVendedorOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CotaVendedorOverrideHistorico" (
    "id" TEXT NOT NULL,
    "cotaId" TEXT NOT NULL,
    "vendedorAnteriorId" TEXT,
    "vendedorNovoId" TEXT,
    "vendedorAnteriorNome" TEXT,
    "vendedorNovoNome" TEXT,
    "motivo" TEXT NOT NULL,
    "usuarioId" TEXT,
    "usuarioNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CotaVendedorOverrideHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estorno" (
    "id" TEXT NOT NULL,
    "cotaId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "parcelasPagasNoCancelamento" INTEGER NOT NULL,
    "dataCancelamento" DATE NOT NULL,
    "valorReferencia" DECIMAL(18,2),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Estorno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComissaoRegistro" (
    "id" TEXT NOT NULL,
    "importacaoId" TEXT NOT NULL,
    "administradoraId" TEXT NOT NULL,
    "contrato" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cota" TEXT NOT NULL,
    "nomeCliente" TEXT NOT NULL,
    "contatoCliente" TEXT,
    "objeto" TEXT,
    "valorCredito" DECIMAL(18,2) NOT NULL,
    "percentualFlex" DECIMAL(9,4),
    "valorComissao" DECIMAL(18,2) NOT NULL,
    "valorDsr" DECIMAL(18,2),
    "valorSeguro" DECIMAL(18,2),
    "percentualComissao" DECIMAL(9,4),
    "tipo" "TipoLancamentoComissao" NOT NULL,
    "tipoOriginal" TEXT NOT NULL,
    "parcela" INTEGER NOT NULL,
    "dataPagamento" DATE,
    "dataContabil" DATE,
    "dataCheque" DATE,
    "dataVenda" DATE,
    "dataReferencia" DATE NOT NULL,
    "classificacaoObjeto" TEXT,
    "assinatura" TEXT,
    "cpfCnpjVendedorRelatorio" TEXT,
    "nomeVendedorRelatorio" TEXT,
    "cotaId" TEXT,
    "vendedorId" TEXT,
    "origemVendedor" "OrigemVendedor" NOT NULL DEFAULT 'NAO_IDENTIFICADO',
    "equipeId" TEXT,
    "gerenciaId" TEXT,
    "categoriaVenda" "CategoriaVendedor",
    "emRecuperacao" BOOLEAN NOT NULL DEFAULT false,
    "status" "StatusComissao" NOT NULL DEFAULT 'NORMAL',
    "hashRegistro" TEXT NOT NULL,
    "paginaPdf" INTEGER,
    "ordemPdf" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComissaoRegistro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComissaoWr" (
    "id" TEXT NOT NULL,
    "comissaoRegistroId" TEXT NOT NULL,
    "categoriaVenda" "CategoriaVendedor",
    "parcela" INTEGER NOT NULL,
    "baseCalculo" DECIMAL(18,2) NOT NULL,
    "percentual" DECIMAL(9,4) NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "regra" TEXT NOT NULL,
    "observacao" TEXT,
    "tabelaComissaoId" TEXT,
    "modalidadeFlexId" TEXT,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComissaoWr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TabelaComissao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" "CategoriaVendedor" NOT NULL,
    "vigenteDe" DATE NOT NULL,
    "vigenteAte" DATE,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TabelaComissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaixaComissao" (
    "id" TEXT NOT NULL,
    "tabelaId" TEXT NOT NULL,
    "parcela" INTEGER NOT NULL,
    "percentual" DECIMAL(9,4) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaixaComissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModalidadeFlex" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "percentual" DECIMAL(9,4) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModalidadeFlex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Importacao" (
    "id" TEXT NOT NULL,
    "tipo" "TipoImportacao" NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "hashArquivo" TEXT NOT NULL,
    "administradoraId" TEXT,
    "usuarioId" TEXT,
    "usuarioNome" TEXT,
    "status" "StatusImportacao" NOT NULL DEFAULT 'PENDENTE',
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEm" TIMESTAMP(3),
    "totalLinhas" INTEGER NOT NULL DEFAULT 0,
    "qtdCriados" INTEGER NOT NULL DEFAULT 0,
    "qtdAtualizados" INTEGER NOT NULL DEFAULT 0,
    "qtdInalterados" INTEGER NOT NULL DEFAULT 0,
    "qtdDuplicados" INTEGER NOT NULL DEFAULT 0,
    "qtdCancelados" INTEGER NOT NULL DEFAULT 0,
    "qtdContemplados" INTEGER NOT NULL DEFAULT 0,
    "qtdErros" INTEGER NOT NULL DEFAULT 0,
    "resumo" JSONB,

    CONSTRAINT "Importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportacaoErro" (
    "id" TEXT NOT NULL,
    "importacaoId" TEXT NOT NULL,
    "linha" INTEGER,
    "mensagem" TEXT NOT NULL,
    "conteudo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportacaoErro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "usuarioNome" TEXT,
    "acao" "AcaoAuditoria" NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT,
    "descricao" TEXT NOT NULL,
    "dadosAntes" JSONB,
    "dadosDepois" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "tipo" "TipoBackup" NOT NULL,
    "status" "StatusBackup" NOT NULL DEFAULT 'PENDENTE',
    "nomeArquivo" TEXT NOT NULL,
    "caminho" TEXT,
    "tamanhoBytes" INTEGER,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEm" TIMESTAMP(3),
    "erro" TEXT,
    "usuarioId" TEXT,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracaoSistema" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "descricao" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoSistema_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Usuario_perfil_ativo_idx" ON "Usuario"("perfil", "ativo");

-- CreateIndex
CREATE INDEX "Usuario_gerenciaId_idx" ON "Usuario"("gerenciaId");

-- CreateIndex
CREATE INDEX "Usuario_equipeId_idx" ON "Usuario"("equipeId");

-- CreateIndex
CREATE UNIQUE INDEX "Gerencia_nome_key" ON "Gerencia"("nome");

-- CreateIndex
CREATE INDEX "Gerencia_status_idx" ON "Gerencia"("status");

-- CreateIndex
CREATE INDEX "Equipe_status_idx" ON "Equipe"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Equipe_gerenciaId_nome_key" ON "Equipe"("gerenciaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Vendedor_cpfCnpj_key" ON "Vendedor"("cpfCnpj");

-- CreateIndex
CREATE INDEX "Vendedor_nome_idx" ON "Vendedor"("nome");

-- CreateIndex
CREATE INDEX "Vendedor_situacao_idx" ON "Vendedor"("situacao");

-- CreateIndex
CREATE INDEX "Vendedor_equipeId_idx" ON "Vendedor"("equipeId");

-- CreateIndex
CREATE INDEX "Vendedor_gerenciaId_idx" ON "Vendedor"("gerenciaId");

-- CreateIndex
CREATE INDEX "Vendedor_categoriaAtual_idx" ON "Vendedor"("categoriaAtual");

-- CreateIndex
CREATE INDEX "VendedorCategoriaHistorico_vendedorId_vigenteDe_idx" ON "VendedorCategoriaHistorico"("vendedorId", "vigenteDe");

-- CreateIndex
CREATE INDEX "VendedorCategoriaHistorico_vigenteDe_vigenteAte_idx" ON "VendedorCategoriaHistorico"("vigenteDe", "vigenteAte");

-- CreateIndex
CREATE INDEX "VendedorAlocacaoHistorico_vendedorId_vigenteDe_idx" ON "VendedorAlocacaoHistorico"("vendedorId", "vigenteDe");

-- CreateIndex
CREATE INDEX "VendedorRecuperacao_vendedorId_dataInicio_dataFim_idx" ON "VendedorRecuperacao"("vendedorId", "dataInicio", "dataFim");

-- CreateIndex
CREATE INDEX "VendedorRecuperacao_dataInicio_dataFim_idx" ON "VendedorRecuperacao"("dataInicio", "dataFim");

-- CreateIndex
CREATE UNIQUE INDEX "Administradora_nome_key" ON "Administradora"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Administradora_codigo_key" ON "Administradora"("codigo");

-- CreateIndex
CREATE INDEX "Administradora_status_idx" ON "Administradora"("status");

-- CreateIndex
CREATE INDEX "Cota_dataVenda_idx" ON "Cota"("dataVenda");

-- CreateIndex
CREATE INDEX "Cota_situacao_dataVenda_idx" ON "Cota"("situacao", "dataVenda");

-- CreateIndex
CREATE INDEX "Cota_vendedorEfetivoId_dataVenda_idx" ON "Cota"("vendedorEfetivoId", "dataVenda");

-- CreateIndex
CREATE INDEX "Cota_equipeId_dataVenda_idx" ON "Cota"("equipeId", "dataVenda");

-- CreateIndex
CREATE INDEX "Cota_gerenciaId_dataVenda_idx" ON "Cota"("gerenciaId", "dataVenda");

-- CreateIndex
CREATE INDEX "Cota_cpfCnpjCliente_idx" ON "Cota"("cpfCnpjCliente");

-- CreateIndex
CREATE INDEX "Cota_nomeCliente_idx" ON "Cota"("nomeCliente");

-- CreateIndex
CREATE INDEX "Cota_administradoraId_grupo_cota_idx" ON "Cota"("administradoraId", "grupo", "cota");

-- CreateIndex
CREATE INDEX "Cota_contrato_idx" ON "Cota"("contrato");

-- CreateIndex
CREATE INDEX "Cota_emRecuperacao_idx" ON "Cota"("emRecuperacao");

-- CreateIndex
CREATE INDEX "Cota_contemplado_idx" ON "Cota"("contemplado");

-- CreateIndex
CREATE UNIQUE INDEX "Cota_administradoraId_contrato_grupo_cota_cpfCnpjCliente_key" ON "Cota"("administradoraId", "contrato", "grupo", "cota", "cpfCnpjCliente");

-- CreateIndex
CREATE INDEX "CotaVersao_cotaId_criadoEm_idx" ON "CotaVersao"("cotaId", "criadoEm");

-- CreateIndex
CREATE INDEX "CotaVersao_importacaoId_idx" ON "CotaVersao"("importacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "CotaVendedorOverride_cotaId_key" ON "CotaVendedorOverride"("cotaId");

-- CreateIndex
CREATE INDEX "CotaVendedorOverride_vendedorId_idx" ON "CotaVendedorOverride"("vendedorId");

-- CreateIndex
CREATE INDEX "CotaVendedorOverrideHistorico_cotaId_criadoEm_idx" ON "CotaVendedorOverrideHistorico"("cotaId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Estorno_cotaId_key" ON "Estorno"("cotaId");

-- CreateIndex
CREATE INDEX "Estorno_dataCancelamento_idx" ON "Estorno"("dataCancelamento");

-- CreateIndex
CREATE UNIQUE INDEX "ComissaoRegistro_hashRegistro_key" ON "ComissaoRegistro"("hashRegistro");

-- CreateIndex
CREATE INDEX "ComissaoRegistro_dataReferencia_idx" ON "ComissaoRegistro"("dataReferencia");

-- CreateIndex
CREATE INDEX "ComissaoRegistro_tipo_dataReferencia_idx" ON "ComissaoRegistro"("tipo", "dataReferencia");

-- CreateIndex
CREATE INDEX "ComissaoRegistro_vendedorId_dataReferencia_idx" ON "ComissaoRegistro"("vendedorId", "dataReferencia");

-- CreateIndex
CREATE INDEX "ComissaoRegistro_equipeId_dataReferencia_idx" ON "ComissaoRegistro"("equipeId", "dataReferencia");

-- CreateIndex
CREATE INDEX "ComissaoRegistro_gerenciaId_dataReferencia_idx" ON "ComissaoRegistro"("gerenciaId", "dataReferencia");

-- CreateIndex
CREATE INDEX "ComissaoRegistro_administradoraId_dataReferencia_idx" ON "ComissaoRegistro"("administradoraId", "dataReferencia");

-- CreateIndex
CREATE INDEX "ComissaoRegistro_status_idx" ON "ComissaoRegistro"("status");

-- CreateIndex
CREATE INDEX "ComissaoRegistro_cotaId_idx" ON "ComissaoRegistro"("cotaId");

-- CreateIndex
CREATE INDEX "ComissaoRegistro_importacaoId_idx" ON "ComissaoRegistro"("importacaoId");

-- CreateIndex
CREATE INDEX "ComissaoRegistro_grupo_cota_idx" ON "ComissaoRegistro"("grupo", "cota");

-- CreateIndex
CREATE UNIQUE INDEX "ComissaoWr_comissaoRegistroId_key" ON "ComissaoWr"("comissaoRegistroId");

-- CreateIndex
CREATE INDEX "ComissaoWr_categoriaVenda_idx" ON "ComissaoWr"("categoriaVenda");

-- CreateIndex
CREATE INDEX "ComissaoWr_calculadoEm_idx" ON "ComissaoWr"("calculadoEm");

-- CreateIndex
CREATE INDEX "TabelaComissao_categoria_vigenteDe_idx" ON "TabelaComissao"("categoria", "vigenteDe");

-- CreateIndex
CREATE UNIQUE INDEX "FaixaComissao_tabelaId_parcela_key" ON "FaixaComissao"("tabelaId", "parcela");

-- CreateIndex
CREATE UNIQUE INDEX "ModalidadeFlex_nome_key" ON "ModalidadeFlex"("nome");

-- CreateIndex
CREATE INDEX "Importacao_tipo_iniciadoEm_idx" ON "Importacao"("tipo", "iniciadoEm");

-- CreateIndex
CREATE INDEX "Importacao_status_idx" ON "Importacao"("status");

-- CreateIndex
CREATE INDEX "Importacao_hashArquivo_idx" ON "Importacao"("hashArquivo");

-- CreateIndex
CREATE INDEX "ImportacaoErro_importacaoId_idx" ON "ImportacaoErro"("importacaoId");

-- CreateIndex
CREATE INDEX "AuditLog_criadoEm_idx" ON "AuditLog"("criadoEm");

-- CreateIndex
CREATE INDEX "AuditLog_entidade_entidadeId_idx" ON "AuditLog"("entidade", "entidadeId");

-- CreateIndex
CREATE INDEX "AuditLog_usuarioId_criadoEm_idx" ON "AuditLog"("usuarioId", "criadoEm");

-- CreateIndex
CREATE INDEX "AuditLog_acao_criadoEm_idx" ON "AuditLog"("acao", "criadoEm");

-- CreateIndex
CREATE INDEX "Backup_iniciadoEm_idx" ON "Backup"("iniciadoEm");

-- CreateIndex
CREATE INDEX "Backup_status_idx" ON "Backup"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracaoSistema_chave_key" ON "ConfiguracaoSistema"("chave");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_gerenciaId_fkey" FOREIGN KEY ("gerenciaId") REFERENCES "Gerencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "Equipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipe" ADD CONSTRAINT "Equipe_gerenciaId_fkey" FOREIGN KEY ("gerenciaId") REFERENCES "Gerencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendedor" ADD CONSTRAINT "Vendedor_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "Equipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendedor" ADD CONSTRAINT "Vendedor_gerenciaId_fkey" FOREIGN KEY ("gerenciaId") REFERENCES "Gerencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorCategoriaHistorico" ADD CONSTRAINT "VendedorCategoriaHistorico_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorCategoriaHistorico" ADD CONSTRAINT "VendedorCategoriaHistorico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorAlocacaoHistorico" ADD CONSTRAINT "VendedorAlocacaoHistorico_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorAlocacaoHistorico" ADD CONSTRAINT "VendedorAlocacaoHistorico_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "Equipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorAlocacaoHistorico" ADD CONSTRAINT "VendedorAlocacaoHistorico_gerenciaId_fkey" FOREIGN KEY ("gerenciaId") REFERENCES "Gerencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorAlocacaoHistorico" ADD CONSTRAINT "VendedorAlocacaoHistorico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorRecuperacao" ADD CONSTRAINT "VendedorRecuperacao_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorRecuperacao" ADD CONSTRAINT "VendedorRecuperacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cota" ADD CONSTRAINT "Cota_administradoraId_fkey" FOREIGN KEY ("administradoraId") REFERENCES "Administradora"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cota" ADD CONSTRAINT "Cota_vendedorAdmId_fkey" FOREIGN KEY ("vendedorAdmId") REFERENCES "Vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cota" ADD CONSTRAINT "Cota_vendedorEfetivoId_fkey" FOREIGN KEY ("vendedorEfetivoId") REFERENCES "Vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cota" ADD CONSTRAINT "Cota_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "Equipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cota" ADD CONSTRAINT "Cota_gerenciaId_fkey" FOREIGN KEY ("gerenciaId") REFERENCES "Gerencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cota" ADD CONSTRAINT "Cota_recuperacaoId_fkey" FOREIGN KEY ("recuperacaoId") REFERENCES "VendedorRecuperacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotaVersao" ADD CONSTRAINT "CotaVersao_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotaVersao" ADD CONSTRAINT "CotaVersao_importacaoId_fkey" FOREIGN KEY ("importacaoId") REFERENCES "Importacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotaVendedorOverride" ADD CONSTRAINT "CotaVendedorOverride_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotaVendedorOverride" ADD CONSTRAINT "CotaVendedorOverride_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotaVendedorOverride" ADD CONSTRAINT "CotaVendedorOverride_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotaVendedorOverrideHistorico" ADD CONSTRAINT "CotaVendedorOverrideHistorico_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotaVendedorOverrideHistorico" ADD CONSTRAINT "CotaVendedorOverrideHistorico_vendedorAnteriorId_fkey" FOREIGN KEY ("vendedorAnteriorId") REFERENCES "Vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotaVendedorOverrideHistorico" ADD CONSTRAINT "CotaVendedorOverrideHistorico_vendedorNovoId_fkey" FOREIGN KEY ("vendedorNovoId") REFERENCES "Vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotaVendedorOverrideHistorico" ADD CONSTRAINT "CotaVendedorOverrideHistorico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estorno" ADD CONSTRAINT "Estorno_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoRegistro" ADD CONSTRAINT "ComissaoRegistro_importacaoId_fkey" FOREIGN KEY ("importacaoId") REFERENCES "Importacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoRegistro" ADD CONSTRAINT "ComissaoRegistro_administradoraId_fkey" FOREIGN KEY ("administradoraId") REFERENCES "Administradora"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoRegistro" ADD CONSTRAINT "ComissaoRegistro_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoRegistro" ADD CONSTRAINT "ComissaoRegistro_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoRegistro" ADD CONSTRAINT "ComissaoRegistro_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "Equipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoRegistro" ADD CONSTRAINT "ComissaoRegistro_gerenciaId_fkey" FOREIGN KEY ("gerenciaId") REFERENCES "Gerencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoWr" ADD CONSTRAINT "ComissaoWr_comissaoRegistroId_fkey" FOREIGN KEY ("comissaoRegistroId") REFERENCES "ComissaoRegistro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoWr" ADD CONSTRAINT "ComissaoWr_tabelaComissaoId_fkey" FOREIGN KEY ("tabelaComissaoId") REFERENCES "TabelaComissao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoWr" ADD CONSTRAINT "ComissaoWr_modalidadeFlexId_fkey" FOREIGN KEY ("modalidadeFlexId") REFERENCES "ModalidadeFlex"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaixaComissao" ADD CONSTRAINT "FaixaComissao_tabelaId_fkey" FOREIGN KEY ("tabelaId") REFERENCES "TabelaComissao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Importacao" ADD CONSTRAINT "Importacao_administradoraId_fkey" FOREIGN KEY ("administradoraId") REFERENCES "Administradora"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Importacao" ADD CONSTRAINT "Importacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportacaoErro" ADD CONSTRAINT "ImportacaoErro_importacaoId_fkey" FOREIGN KEY ("importacaoId") REFERENCES "Importacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
