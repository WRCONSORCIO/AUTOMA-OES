import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashConteudo } from "@/server/domain/regras";
import { registrarAuditoria } from "@/server/services/auditoria";
import type { ContextoUsuario } from "@/server/services/vendedores";
import { conferirFormulario, FORMULARIOS } from "./formularios";
import { lerPdfBonus, type RegistroBonusPdf } from "./pdf-bonus";
import {
  evento,
  type MetadadosEvento,
} from "@/shared/events/catalogo";
import { publicar } from "@/shared/events/outbox-prisma";
import { drenarEventos } from "@/shared/events/handlers";

const TAMANHO_LOTE = 200;

export interface ResumoImportacaoBonus {
  importacaoId: string;
  totalRegistros: number;
  criados: number;
  duplicados: number;
  erros: number;
  /** Linhas cuja cota não foi encontrada na base — ficam sem gerência. */
  semCotaVinculada: number;
  semGerencia: number;
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
 * Importa o relatório de incentivo de vendas e rateia por gerência.
 *
 * O bônus é da WR e não é repassado a ninguém — o que se quer saber é de onde
 * ele veio. Como o relatório não traz vendedor, a atribuição sai da cota: a
 * mesma cota que está na base já carrega o vendedor efetivo, a equipe e a
 * gerência fixados na venda.
 *
 * A cota que não estiver na base fica sem gerência em vez de ser descartada:
 * o valor é da WR de qualquer forma, e some-lo num "sem gerência" visível é
 * mais honesto do que deixá-lo fora do total.
 */
export async function importarBonusPdf(
  entrada: EntradaImportacao,
): Promise<ResumoImportacaoBonus> {
  const hashArquivo = createHash("sha256").update(entrada.arquivo).digest("hex");

  const importacao = await prisma.importacao.create({
    data: {
      tipo: "BONUS_PDF",
      nomeArquivo: entrada.nomeArquivo,
      tamanhoBytes: entrada.arquivo.byteLength,
      hashArquivo,
      administradoraId: entrada.administradoraId,
      usuarioId: entrada.usuario.id,
      usuarioNome: entrada.usuario.nome,
      status: "PROCESSANDO",
    },
  });

  const contadores = { criados: 0, duplicados: 0, erros: 0, semCotaVinculada: 0, semGerencia: 0 };
  let valorTotal = 0;

  try {
    const leitura = await lerPdfBonus(entrada.arquivo);

    conferirFormulario(leitura.formulario, FORMULARIOS.BONUS, "bônus de incentivo");

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
      const cotas = await localizarCotas(entrada.administradoraId, lote);

      for (const registro of lote) {
        try {
          const cota = cotas.get(`${registro.grupo}|${registro.cota}`) ?? null;

          const gravado = await gravarBonus({
            registro,
            cota,
            importacaoId: importacao.id,
            administradoraId: entrada.administradoraId,
            hashArquivo,
            periodoInicio: leitura.periodoInicio,
            periodoFim: leitura.periodoFim,
            metadados: {
              usuarioId: entrada.usuario.id,
              usuarioNome: entrada.usuario.nome,
              importacaoId: importacao.id,
              correlacaoId: importacao.id,
            },
          });

          if (gravado.duplicado) {
            contadores.duplicados += 1;
            continue;
          }

          contadores.criados += 1;
          valorTotal += registro.valorIncentivo;
          if (!cota) contadores.semCotaVinculada += 1;
          if (!cota?.gerenciaId) contadores.semGerencia += 1;
        } catch (erro) {
          contadores.erros += 1;
          await prisma.importacaoErro.create({
            data: {
              importacaoId: importacao.id,
              linha: registro.pagina,
              mensagem:
                erro instanceof Error ? erro.message : "Erro ao gravar a linha do bônus.",
              conteudo: `${registro.grupo}-${registro.cota} / ${registro.contrato}`,
            },
          });
        }
      }
    }

    const status = contadores.erros > 0 ? "CONCLUIDA_COM_ERROS" : "CONCLUIDA";

    const eventos = await drenarEventos();

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
          eventos: {
            processados: eventos.eventos,
            entregas: eventos.entregasOk,
            falhas: eventos.eventosComFalha,
          },
          paginas: leitura.paginas,
          prestadora: leitura.prestadora,
          periodo: {
            de: leitura.periodoInicio?.toISOString() ?? null,
            ate: leitura.periodoFim?.toISOString() ?? null,
          },
          totalRelatorio: leitura.totalRelatorio,
          totalLiquido: leitura.totalLiquido,
          somaLida: leitura.somaLida,
          divergenciaLeitura: leitura.divergencia,
          semCotaVinculada: contadores.semCotaVinculada,
          semGerencia: contadores.semGerencia,
        },
      },
    });

    await registrarAuditoria({
      acao: "IMPORTACAO",
      entidade: "Importacao",
      entidadeId: importacao.id,
      descricao: `Bônus de incentivo ${entrada.nomeArquivo} importado: ${contadores.criados} linha(s), ${contadores.duplicados} já existentes, ${contadores.semGerencia} sem gerência identificada`,
      dadosDepois: contadores,
      usuario: entrada.usuario,
    });

    return {
      importacaoId: importacao.id,
      totalRegistros: leitura.registros.length,
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

interface CotaLocalizada {
  id: string;
  vendedorEfetivoId: string | null;
  equipeId: string | null;
  gerenciaId: string | null;
}

/** Uma consulta por lote resolve o rateio de todas as linhas dele. */
async function localizarCotas(
  administradoraId: string,
  lote: readonly RegistroBonusPdf[],
): Promise<Map<string, CotaLocalizada>> {
  const cotas = await prisma.cota.findMany({
    where: {
      administradoraId,
      OR: lote.map((registro) => ({ grupo: registro.grupo, cota: registro.cota })),
    },
    select: {
      id: true,
      grupo: true,
      cota: true,
      vendedorEfetivoId: true,
      equipeId: true,
      gerenciaId: true,
    },
  });

  const mapa = new Map<string, CotaLocalizada>();
  for (const cota of cotas) {
    // Grupo e cota se repetem entre contratos; a primeira encontrada responde.
    const chave = `${cota.grupo}|${cota.cota}`;
    if (!mapa.has(chave)) mapa.set(chave, cota);
  }
  return mapa;
}

async function gravarBonus(entrada: {
  registro: RegistroBonusPdf;
  cota: CotaLocalizada | null;
  importacaoId: string;
  administradoraId: string;
  hashArquivo: string;
  periodoInicio: Date | null;
  periodoFim: Date | null;
  metadados: MetadadosEvento;
}): Promise<{ duplicado: boolean }> {
  const { registro, cota } = entrada;

  // Idempotência por arquivo: reimportar o mesmo PDF não duplica nada.
  const hashRegistro = hashConteudo([
    entrada.hashArquivo,
    registro.grupo,
    registro.cota,
    registro.contrato,
    String(registro.parcela ?? ""),
    registro.valorIncentivo.toFixed(2),
    String(registro.pagina),
  ]);

  const existente = await prisma.bonusIncentivo.findUnique({
    where: { hashRegistro },
    select: { id: true },
  });
  if (existente) return { duplicado: true };

  await prisma.$transaction(async (tx) => {
    const gravado = await tx.bonusIncentivo.create({
    data: {
      importacaoId: entrada.importacaoId,
      administradoraId: entrada.administradoraId,
      grupo: registro.grupo,
      cota: registro.cota,
      contrato: registro.contrato,
      nomeConsorciado: registro.nomeConsorciado,
      tipoPessoa: registro.tipoPessoa,
      parcela: registro.parcela,
      dataInclusao: registro.dataInclusao,
      valorEvento: new Prisma.Decimal(registro.valorEvento.toFixed(2)),
      percentualIncentivo:
        registro.percentualIncentivo === null
          ? null
          : new Prisma.Decimal(registro.percentualIncentivo.toFixed(4)),
      valorIncentivo: new Prisma.Decimal(registro.valorIncentivo.toFixed(2)),
      percentualFlex:
        registro.percentualFlex === null
          ? null
          : new Prisma.Decimal(registro.percentualFlex.toFixed(4)),
      segmento: registro.segmento,
      periodoInicio: entrada.periodoInicio,
      periodoFim: entrada.periodoFim,
      cotaId: cota?.id ?? null,
      vendedorId: cota?.vendedorEfetivoId ?? null,
      equipeId: cota?.equipeId ?? null,
      gerenciaId: cota?.gerenciaId ?? null,
      hashRegistro,
      paginaPdf: registro.pagina,
    },
      select: { id: true },
    });

    // O bônus não paga ninguém: serve para descobrir de qual gerência veio o
    // valor. O evento é o que permite ao rateio reagir sem varrer a base.
    await publicar(tx, [
      evento(
        "apuracao.bonus.rateado",
        "BonusIncentivo",
        gravado.id,
        {
          bonusId: gravado.id,
          gerenciaId: cota?.gerenciaId ?? null,
          valorIncentivo: registro.valorIncentivo,
        },
        entrada.metadados,
      ),
    ]);
  });

  return { duplicado: false };
}
