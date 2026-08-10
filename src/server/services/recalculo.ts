import "server-only";

import { Prisma, type CategoriaVendedor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calcularComissaoWr, recuperacaoAlcancaVenda } from "@/server/domain/regras";
import { registrarAuditoria } from "./auditoria";
import { apurarComissoesEquipe } from "./comissao-equipe";
import { CacheVendedores, type ContextoUsuario } from "./vendedores";

const TAMANHO_LOTE = 500;

export interface ResumoRecalculo {
  cotasAvaliadas: number;
  cotasComCategoriaPreenchida: number;
  cotasMarcadasEmRecuperacao: number;
  /** Vendas que estavam sem equipe/gerência e receberam a alocação do vendedor. */
  cotasComUnidadePreenchida: number;
  lancamentosAvaliados: number;
  lancamentosAtualizados: number;
  valorComissaoWr: number;
  /** Comissão da equipe apurada no mesmo passe. */
  linhasComissaoEquipe: number;
  valorComissaoEquipePrevisto: number;
  valorComissaoEquipeLiberado: number;
}

/**
 * Reaplica as regras de cálculo sobre o que já foi importado.
 *
 * Necessário quando o cadastro é completado depois da importação — por exemplo,
 * quando o RH define a categoria de um vendedor que a base criou automaticamente.
 *
 * Garantias:
 * - Snapshots já gravados NUNCA são sobrescritos. A categoria da venda só é
 *   preenchida onde ainda está vazia; a marcação de recuperação só é acrescentada.
 * - O valor da comissão WR é recalculado com a tabela vigente para a categoria
 *   daquela venda, nunca com a categoria atual do vendedor.
 */
export interface EscopoRecalculo {
  /**
   * Limita o recálculo às vendas de um documento.
   *
   * É o caso de longe mais comum: alguém acabou de definir a categoria de um
   * vendedor e as vendas dele precisam sair de "sem categoria". Varrer a base
   * inteira para atender um cadastro faria o custo crescer com o tamanho do
   * histórico em vez de com o tamanho da correção.
   */
  vendedorId?: string;
}

export async function recalcularComissoes(
  usuario: ContextoUsuario,
  escopo: EscopoRecalculo = {},
): Promise<ResumoRecalculo> {
  const resumo: ResumoRecalculo = {
    cotasAvaliadas: 0,
    cotasComCategoriaPreenchida: 0,
    cotasMarcadasEmRecuperacao: 0,
    cotasComUnidadePreenchida: 0,
    lancamentosAvaliados: 0,
    lancamentosAtualizados: 0,
    valorComissaoWr: 0,
    linhasComissaoEquipe: 0,
    valorComissaoEquipePrevisto: 0,
    valorComissaoEquipeLiberado: 0,
  };

  const cache = new CacheVendedores(prisma);

  const cotasTocadas = await preencherSnapshotsDeCotas(cache, resumo, escopo);
  await recalcularLancamentos(cache, resumo, escopo);

  // A comissão da equipe depende dos snapshots acima e dos recebimentos, então
  // vem sempre no fim — nunca antes de a categoria da venda estar resolvida.
  const equipe = await apurarComissoesEquipe({
    ...(escopo.vendedorId ? { cotaIds: cotasTocadas } : {}),
    registrarAuditoria: false,
  });
  resumo.linhasComissaoEquipe = equipe.linhasGravadas;
  resumo.valorComissaoEquipePrevisto = equipe.valorPrevisto;
  resumo.valorComissaoEquipeLiberado = equipe.valorLiberado;

  await registrarAuditoria({
    acao: "RECALCULO_COMISSAO",
    entidade: "ComissaoWr",
    descricao: `Recálculo executado: ${resumo.cotasComCategoriaPreenchida} venda(s) com categoria preenchida, ${resumo.lancamentosAtualizados} lançamento(s) atualizado(s), ${equipe.linhasGravadas} linha(s) de comissão da equipe`,
    dadosDepois: resumo,
    usuario,
  });

  resumo.valorComissaoWr = Math.round(resumo.valorComissaoWr * 100) / 100;
  return resumo;
}

/**
 * Preenche a categoria da venda das cotas que ficaram sem ela e acrescenta a
 * marcação de recuperação quando aplicável.
 */
async function preencherSnapshotsDeCotas(
  cache: CacheVendedores,
  resumo: ResumoRecalculo,
  escopo: EscopoRecalculo,
): Promise<string[]> {
  let cursor: string | undefined;
  const tocadas: string[] = [];

  for (;;) {
    const cotas = await prisma.cota.findMany({
      where: {
        ...(escopo.vendedorId
          ? { vendedorEfetivoId: escopo.vendedorId }
          : { vendedorEfetivoId: { not: null } }),
        dataVenda: { not: null },
        OR: [
          { categoriaVenda: null },
          { emRecuperacao: false },
          { equipeId: null },
          { gerenciaId: null },
        ],
      },
      select: {
        id: true,
        dataVenda: true,
        vendedorEfetivoId: true,
        categoriaVenda: true,
        emRecuperacao: true,
        equipeId: true,
        gerenciaId: true,
      },
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: TAMANHO_LOTE,
    });

    if (cotas.length === 0) break;
    cursor = cotas.at(-1)!.id;

    for (const cota of cotas) {
      resumo.cotasAvaliadas += 1;

      const vendedorId = cota.vendedorEfetivoId!;
      const dataVenda = cota.dataVenda!;

      const dados: Prisma.CotaUpdateInput = {};

      let categoriaVenda = cota.categoriaVenda;

      if (!categoriaVenda) {
        const categoria = await cache.categoriaNaData(vendedorId, dataVenda);
        if (categoria) {
          categoriaVenda = categoria;
          dados.categoriaVenda = categoria;
          dados.categoriaVendaFixadaEm = new Date();
          resumo.cotasComCategoriaPreenchida += 1;
        }
      }

      // Usa a categoria recém-resolvida, e não a que veio do banco: é
      // justamente a venda que acabou de ganhar categoria que estava esperando
      // para ser avaliada. Ler o valor antigo adiaria a marcação para a
      // próxima passada, sem motivo.
      if (!cota.emRecuperacao && recuperacaoAlcancaVenda(categoriaVenda)) {
        const recuperacao = await cache.recuperacaoNaData(vendedorId, dataVenda);
        if (recuperacao) {
          dados.emRecuperacao = true;
          dados.recuperacao = { connect: { id: recuperacao.id } };
          dados.recuperacaoFixadaEm = new Date();
          resumo.cotasMarcadasEmRecuperacao += 1;
        }
      }

      // A equipe e a gerência da venda ficam vazias quando a base é importada
      // antes de o vendedor ser alocado. Preenche onde falta, nunca sobrescreve:
      // é o que permite a comissão de supervisão e gerência sobre o histórico.
      if (!cota.equipeId || !cota.gerenciaId) {
        const alocacao = await cache.alocacaoNaData(vendedorId, dataVenda);
        if (!cota.equipeId && alocacao.equipeId) {
          dados.equipe = { connect: { id: alocacao.equipeId } };
          resumo.cotasComUnidadePreenchida += 1;
        }
        if (!cota.gerenciaId && alocacao.gerenciaId) {
          dados.gerencia = { connect: { id: alocacao.gerenciaId } };
        }
      }

      if (Object.keys(dados).length > 0) {
        await prisma.cota.update({ where: { id: cota.id }, data: dados });
        tocadas.push(cota.id);
      }
    }
  }

  return tocadas;
}

async function recalcularLancamentos(
  cache: CacheVendedores,
  resumo: ResumoRecalculo,
  escopo: EscopoRecalculo,
): Promise<void> {
  let cursor: string | undefined;

  for (;;) {
    const lancamentos = await prisma.comissaoRegistro.findMany({
      ...(escopo.vendedorId ? { where: { vendedorId: escopo.vendedorId } } : {}),
      select: {
        id: true,
        parcela: true,
        tipo: true,
        valorCredito: true,
        percentualFlex: true,
        valorComissao: true,
        valorDsr: true,
        valorSeguro: true,
        percentualComissao: true,
        categoriaVenda: true,
        emRecuperacao: true,
        segmentoVenda: true,
        dataVenda: true,
        dataReferencia: true,
        vendedorId: true,
        equipeId: true,
        gerenciaId: true,
        cotaRef: {
          select: {
            categoriaVenda: true,
            emRecuperacao: true,
            dataVenda: true,
            segmentoVenda: true,
            equipeId: true,
            gerenciaId: true,
          },
        },
        comissaoWr: {
          select: { id: true, valor: true, regra: true, tabelaComissaoId: true },
        },
      },
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: TAMANHO_LOTE,
    });

    if (lancamentos.length === 0) break;
    cursor = lancamentos.at(-1)!.id;

    for (const lancamento of lancamentos) {
      resumo.lancamentosAvaliados += 1;

      // A cota é a fonte da verdade dos snapshots quando o vínculo existe.
      let categoria: CategoriaVendedor | null =
        lancamento.cotaRef?.categoriaVenda ?? lancamento.categoriaVenda;
      let emRecuperacao = lancamento.cotaRef?.emRecuperacao ?? lancamento.emRecuperacao;

      const dataVenda = lancamento.cotaRef?.dataVenda ?? lancamento.dataVenda;

      if (!categoria && lancamento.vendedorId && dataVenda) {
        categoria = await cache.categoriaNaData(lancamento.vendedorId, dataVenda);
      }
      if (!emRecuperacao && lancamento.vendedorId && dataVenda) {
        emRecuperacao =
          (await cache.recuperacaoNaData(lancamento.vendedorId, dataVenda)) !== null;
      }

      const segmento = lancamento.cotaRef?.segmentoVenda ?? lancamento.segmentoVenda;

      // Equipe e gerência do lançamento.
      //
      // O lançamento nasce com a alocação que o vendedor tinha no momento da
      // IMPORTAÇÃO. Quando o cadastro é completado depois — que é o fluxo
      // normal, e o motivo de este recálculo existir — ela nasce nula e
      // continuaria nula para sempre. É o que esvaziava o rateio por equipe e
      // por gerência no Dashboard.
      //
      // A cota é a fonte preferida, porque nela a alocação é o snapshot da
      // venda. Sem cota vinculada, resolve-se pelo histórico do vendedor na
      // data — nunca pela alocação de hoje, que reescreveria o passado.
      let equipeId = lancamento.equipeId ?? lancamento.cotaRef?.equipeId ?? null;
      let gerenciaId = lancamento.gerenciaId ?? lancamento.cotaRef?.gerenciaId ?? null;

      if ((!equipeId || !gerenciaId) && lancamento.vendedorId && dataVenda) {
        const alocacao = await cache.alocacaoNaData(lancamento.vendedorId, dataVenda);
        equipeId = equipeId ?? alocacao.equipeId;
        gerenciaId = gerenciaId ?? alocacao.gerenciaId;
      }

      const calculo = calcularComissaoWr({
        valorComissao: Number(lancamento.valorComissao),
        valorDsr: lancamento.valorDsr === null ? null : Number(lancamento.valorDsr),
        valorSeguro: lancamento.valorSeguro === null ? null : Number(lancamento.valorSeguro),
        percentualRelatorio:
          lancamento.percentualComissao === null
            ? null
            : Number(lancamento.percentualComissao),
        valorCredito: Number(lancamento.valorCredito),
        percentualFlex:
          lancamento.percentualFlex === null ? null : Number(lancamento.percentualFlex),
        tipo: lancamento.tipo,
      });

      const atual = lancamento.comissaoWr;

      // Não basta comparar o valor: cadastrar a tabela do segmento pode manter
      // o valor em zero (parcela fora da tabela) e ainda assim mudar a razão
      // registrada. Deixar a razão velha faria a tela mentir sobre o motivo.
      const mudou =
        categoria !== lancamento.categoriaVenda ||
        emRecuperacao !== lancamento.emRecuperacao ||
        segmento !== lancamento.segmentoVenda ||
        equipeId !== lancamento.equipeId ||
        gerenciaId !== lancamento.gerenciaId ||
        atual === null ||
        Number(atual.valor) !== calculo.valor ||
        atual.regra !== calculo.regra;

      if (!mudou) continue;

      await prisma.$transaction(async (tx) => {
        await tx.comissaoRegistro.update({
          where: { id: lancamento.id },
          data: {
            categoriaVenda: categoria,
            emRecuperacao,
            segmentoVenda: segmento,
            equipeId,
            gerenciaId,
          },
        });

        const dadosWr = {
          categoriaVenda: categoria,
          parcela: lancamento.parcela,
          baseCalculo: new Prisma.Decimal(calculo.baseCalculo.toFixed(2)),
          percentual: new Prisma.Decimal(calculo.percentual.toFixed(4)),
          valor: new Prisma.Decimal(calculo.valor.toFixed(2)),
          regra: calculo.regra,
          observacao: calculo.observacao ?? null,
          tabelaComissaoId: null,
          calculadoEm: new Date(),
        };

        if (atual) {
          await tx.comissaoWr.update({ where: { id: atual.id }, data: dadosWr });
        } else {
          await tx.comissaoWr.create({
            data: { ...dadosWr, comissaoRegistroId: lancamento.id },
          });
        }
      });

      resumo.lancamentosAtualizados += 1;
      resumo.valorComissaoWr += calculo.valor;
    }
  }
}

