import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashConteudo } from "@/server/domain/regras";
import { registrarAuditoria } from "@/server/services/auditoria";
import type { ContextoUsuario } from "@/server/services/vendedores";
import { conferirFormulario, FORMULARIOS } from "./formularios";
import {
  lerPdfComissaoVendedor,
  type RegistroComissaoVendedorPdf,
} from "./pdf-comissao-vendedor";

const TAMANHO_LOTE = 200;

export interface ResumoImportacaoComissaoVendedor {
  importacaoId: string;
  totalRegistros: number;
  criados: number;
  duplicados: number;
  erros: number;
  vendedores: number;
  semVendedorCadastrado: number;
  semCotaVinculada: number;
  valorTotal: number;
  totalRelatorio: number | null;
  divergenciaLeitura: number | null;
}

interface EntradaImportacao {
  arquivo: Buffer;
  nomeArquivo: string;
  administradoraId: string;
  usuario: ContextoUsuario;
}

/**
 * Importa o relatório de comissão dos vendedores (CV065E).
 *
 * É o que a administradora paga direto a veteranos e experts. Nada aqui gera
 * obrigação de pagamento para a WR — o registro existe para a WR enxergar
 * quanto cada vendedor recebeu por fora e conferir com o próprio fechamento.
 *
 * O formulário é conferido antes de gravar: o CV056E, que é a receita da WR,
 * tem cabeçalho quase igual e a mesma prestadora. Trocar um pelo outro
 * transformaria receita em repasse, então é melhor recusar o arquivo errado
 * do que importá-lo no lugar errado.
 */
export async function importarComissaoVendedorPdf(
  entrada: EntradaImportacao,
): Promise<ResumoImportacaoComissaoVendedor> {
  const hashArquivo = createHash("sha256").update(entrada.arquivo).digest("hex");

  const importacao = await prisma.importacao.create({
    data: {
      tipo: "COMISSAO_VENDEDOR_PDF",
      nomeArquivo: entrada.nomeArquivo,
      tamanhoBytes: entrada.arquivo.byteLength,
      hashArquivo,
      administradoraId: entrada.administradoraId,
      usuarioId: entrada.usuario.id,
      usuarioNome: entrada.usuario.nome,
      status: "PROCESSANDO",
    },
  });

  const contadores = {
    criados: 0,
    duplicados: 0,
    erros: 0,
    semVendedorCadastrado: 0,
    semCotaVinculada: 0,
  };
  let valorTotal = 0;

  try {
    const leitura = await lerPdfComissaoVendedor(entrada.arquivo);

    conferirFormulario(
      leitura.formulario,
      FORMULARIOS.COMISSAO_VENDEDOR,
      "comissão dos vendedores",
    );

    contadores.erros = leitura.erros.length;

    if (leitura.erros.length > 0) {
      await prisma.importacaoErro.createMany({
        data: leitura.erros.map((erro) => ({
          importacaoId: importacao.id,
          linha: erro.pagina,
          mensagem: `Página ${erro.pagina}: ${erro.mensagem}`,
          conteudo: erro.conteudo,
        })),
      });
    }

    for (let inicio = 0; inicio < leitura.registros.length; inicio += TAMANHO_LOTE) {
      const lote = leitura.registros.slice(inicio, inicio + TAMANHO_LOTE);
      const [vendedores, cotas] = await Promise.all([
        localizarVendedores(lote),
        localizarCotas(entrada.administradoraId, lote),
      ]);

      for (const registro of lote) {
        try {
          const vendedor = vendedores.get(registro.vendedorDocumento) ?? null;
          const cota = cotas.get(`${registro.grupo}|${registro.cota}`) ?? null;

          const gravado = await gravar({
            registro,
            vendedor,
            cota,
            importacaoId: importacao.id,
            administradoraId: entrada.administradoraId,
            hashArquivo,
          });

          if (gravado.duplicado) {
            contadores.duplicados += 1;
            continue;
          }

          contadores.criados += 1;
          valorTotal += registro.valorComissao;
          if (!vendedor) contadores.semVendedorCadastrado += 1;
          if (!cota) contadores.semCotaVinculada += 1;
        } catch (erro) {
          contadores.erros += 1;
          await prisma.importacaoErro.create({
            data: {
              importacaoId: importacao.id,
              linha: registro.pagina,
              mensagem: erro instanceof Error ? erro.message : "Erro ao gravar o lançamento.",
              conteudo: `${registro.grupo}-${registro.cota} / ${registro.contrato}`,
            },
          });
        }
      }
    }

    const status = contadores.erros > 0 ? "CONCLUIDA_COM_ERROS" : "CONCLUIDA";

    await prisma.importacao.update({
      where: { id: importacao.id },
      data: {
        status,
        finalizadoEm: new Date(),
        totalLinhas: leitura.registros.length,
        qtdCriados: contadores.criados,
        qtdDuplicados: contadores.duplicados,
        qtdErros: contadores.erros,
        resumo: {
          paginas: leitura.paginas,
          formulario: leitura.formulario,
          dataEmissao: leitura.dataEmissao?.toISOString() ?? null,
          vendedores: leitura.totaisPorVendedor.size,
          totalRelatorio: leitura.totalRelatorio,
          totalLiquido: leitura.totalLiquido,
          somaLida: leitura.somaLida,
          divergenciaLeitura: leitura.divergencia,
          semVendedorCadastrado: contadores.semVendedorCadastrado,
          semCotaVinculada: contadores.semCotaVinculada,
        },
      },
    });

    await registrarAuditoria({
      acao: "IMPORTACAO",
      entidade: "Importacao",
      entidadeId: importacao.id,
      descricao: `Comissão dos vendedores ${entrada.nomeArquivo} importada: ${contadores.criados} lançamento(s) de ${leitura.totaisPorVendedor.size} vendedor(es)`,
      dadosDepois: contadores,
      usuario: entrada.usuario,
    });

    return {
      importacaoId: importacao.id,
      totalRegistros: leitura.registros.length,
      vendedores: leitura.totaisPorVendedor.size,
      valorTotal: Math.round(valorTotal * 100) / 100,
      totalRelatorio: leitura.totalRelatorio,
      divergenciaLeitura: leitura.divergencia,
      ...contadores,
    };
  } catch (erro) {
    await prisma.importacao.update({
      where: { id: importacao.id },
      data: { status: "FALHA", finalizadoEm: new Date() },
    });
    await prisma.importacaoErro.create({
      data: {
        importacaoId: importacao.id,
        mensagem: erro instanceof Error ? erro.message : "Falha desconhecida na importação.",
      },
    });
    throw erro;
  }
}

interface VendedorLocalizado {
  id: string;
  pessoaId: string | null;
  equipeId: string | null;
  gerenciaId: string | null;
}

async function localizarVendedores(
  lote: readonly RegistroComissaoVendedorPdf[],
): Promise<Map<string, VendedorLocalizado>> {
  const documentos = [...new Set(lote.map((registro) => registro.vendedorDocumento))].filter(
    Boolean,
  );
  if (documentos.length === 0) return new Map();

  const vendedores = await prisma.vendedor.findMany({
    where: { cpfCnpj: { in: documentos } },
    select: { id: true, cpfCnpj: true, pessoaId: true, equipeId: true, gerenciaId: true },
  });

  return new Map(vendedores.map((vendedor) => [vendedor.cpfCnpj, vendedor]));
}

async function localizarCotas(
  administradoraId: string,
  lote: readonly RegistroComissaoVendedorPdf[],
): Promise<Map<string, { id: string }>> {
  const cotas = await prisma.cota.findMany({
    where: {
      administradoraId,
      OR: lote.map((registro) => ({ grupo: registro.grupo, cota: registro.cota })),
    },
    select: { id: true, grupo: true, cota: true },
  });

  const mapa = new Map<string, { id: string }>();
  for (const cota of cotas) {
    const chave = `${cota.grupo}|${cota.cota}`;
    if (!mapa.has(chave)) mapa.set(chave, { id: cota.id });
  }
  return mapa;
}

async function gravar(entrada: {
  registro: RegistroComissaoVendedorPdf;
  vendedor: VendedorLocalizado | null;
  cota: { id: string } | null;
  importacaoId: string;
  administradoraId: string;
  hashArquivo: string;
}): Promise<{ duplicado: boolean }> {
  const { registro, vendedor, cota } = entrada;

  const hashRegistro = hashConteudo([
    entrada.hashArquivo,
    registro.vendedorDocumento,
    registro.grupo,
    registro.cota,
    registro.contrato,
    String(registro.parcela ?? ""),
    registro.valorComissao.toFixed(2),
    String(registro.pagina),
  ]);

  const existente = await prisma.comissaoVendedorAdm.findUnique({
    where: { hashRegistro },
    select: { id: true },
  });
  if (existente) return { duplicado: true };

  await prisma.comissaoVendedorAdm.create({
    data: {
      importacaoId: entrada.importacaoId,
      administradoraId: entrada.administradoraId,
      vendedorDocumento: registro.vendedorDocumento,
      vendedorNome: registro.vendedorNome,
      grupo: registro.grupo,
      cota: registro.cota,
      contrato: registro.contrato,
      nomeCliente: registro.nomeCliente,
      objeto: registro.objeto,
      valorCredito: new Prisma.Decimal(registro.valorCredito.toFixed(2)),
      percentualFlex: decimalOuNulo(registro.percentualFlex, 4),
      valorComissao: new Prisma.Decimal(registro.valorComissao.toFixed(2)),
      valorDsr: decimalOuNulo(registro.valorDsr, 2),
      valorSeguro: decimalOuNulo(registro.valorSeguro, 2),
      percentualComissao: decimalOuNulo(registro.percentualComissao, 4),
      parcela: registro.parcela,
      dataPagamento: registro.dataPagamento,
      dataVenda: registro.dataVenda,
      cotaId: cota?.id ?? null,
      vendedorId: vendedor?.id ?? null,
      pessoaId: vendedor?.pessoaId ?? null,
      equipeId: vendedor?.equipeId ?? null,
      gerenciaId: vendedor?.gerenciaId ?? null,
      hashRegistro,
      paginaPdf: registro.pagina,
    },
  });

  return { duplicado: false };
}

function decimalOuNulo(valor: number | null, casas: number): Prisma.Decimal | null {
  return valor === null ? null : new Prisma.Decimal(valor.toFixed(casas));
}
