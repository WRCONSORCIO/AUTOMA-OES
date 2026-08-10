import "server-only";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/server/services/auditoria";
import type { EventoPublicado } from "@/shared/events/catalogo";
import type { Handler } from "@/shared/events/registro";
import { avaliarEstorno } from "../../domain/rules/estorno";
import {
  comissaoPagaNaCota,
  regrasDoVendedor,
} from "../../infrastructure/repositories/regras-estorno";

/**
 * Reage a `carteira.cota.cancelada` gerando o estorno quando a regra manda.
 *
 * É o requisito do briefing: cliente cancelado nunca é apagado — muda a
 * situação e o sistema verifica sozinho se há estorno, calcula o valor e deixa
 * histórico e auditoria.
 *
 * Antes isso acontecia dentro da importação, com o limite de parcelas fixo em
 * código. Aqui a regra vem de tabela com vigência, e a decisão é tomada por uma
 * função pura já testada.
 */

type EventoCancelada = EventoPublicado<"carteira.cota.cancelada">;

/**
 * Idempotência em duas camadas.
 *
 * A primeira é a `EventoEntrega`, que impede o handler de rodar duas vezes para
 * o mesmo evento. A segunda é a checagem de estorno já existente, que protege
 * contra o caso legítimo de dois eventos distintos para a mesma cota — uma
 * reimportação do mesmo arquivo, por exemplo. Só a primeira não bastaria.
 */
export const gerarEstornoHandler: Handler<"carteira.cota.cancelada"> = {
  nome: "apuracao.gerar-estorno",
  evento: "carteira.cota.cancelada",
  prioridade: 10,

  async executar(evento: EventoCancelada): Promise<void> {
    const {
      cotaId,
      vendedorEfetivoId,
      dataCancelamento,
      parcelasPagas,
      emRecuperacao,
      categoriaVenda,
    } = evento.payload;

    const jaExiste = await prisma.estorno.findUnique({
      where: { cotaId },
      select: { id: true },
    });
    if (jaExiste) return;

    const [regras, valorReferencia] = await Promise.all([
      regrasDoVendedor(vendedorEfetivoId),
      comissaoPagaNaCota(cotaId),
    ]);

    const decisao = avaliarEstorno(
      {
        vendedorId: vendedorEfetivoId,
        emRecuperacao,
        parcelasPagas,
        dataCancelamento: new Date(`${dataCancelamento}T00:00:00.000Z`),
        valorReferencia,
        categoriaVenda,
      },
      regras,
    );

    if (!decisao.gera) return;

    // O estorno e a marcação na cota entram juntos: a flag `geraEstorno` é o
    // que o dashboard conta, e ela divergir do estorno real seria um número
    // errado na tela de quem decide pagamento.
    await prisma.$transaction(async (tx) => {
      await tx.estorno.create({
        data: {
          cotaId,
          tipo: decisao.tipo,
          motivo: decisao.motivo,
          parcelasPagasNoCancelamento: parcelasPagas,
          dataCancelamento: new Date(`${dataCancelamento}T00:00:00.000Z`),
          valorReferencia,
          regraEstornoId: decisao.regraId,
          percentualAplicado: decisao.percentualAplicado,
          parcelaLimite: decisao.parcelaLimite,
          valorEstorno: decisao.valorEstorno,
          importacaoId: evento.metadados.importacaoId ?? null,
        },
      });

      await tx.cota.update({ where: { id: cotaId }, data: { geraEstorno: true } });
    });

    await registrarAuditoria({
      acao: "ESTORNO",
      entidade: "Cota",
      entidadeId: cotaId,
      descricao: `Estorno ${decisao.tipo} de ${decisao.valorEstorno.toFixed(2)} — ${decisao.motivo}`,
      dadosDepois: {
        tipo: decisao.tipo,
        regraEstornoId: decisao.regraId,
        percentualAplicado: decisao.percentualAplicado,
        parcelaLimite: decisao.parcelaLimite,
        valorReferencia,
        valorEstorno: decisao.valorEstorno,
      },
      // Quem disparou a importação responde pelo estorno. Sem usuário (cron,
      // script), a auditoria fica sem autor — e é assim que deve ser: inventar
      // um "sistema" com id falso quebraria a rastreabilidade.
      usuario: evento.metadados.usuarioId
        ? {
            id: evento.metadados.usuarioId,
            nome: evento.metadados.usuarioNome ?? "—",
          }
        : null,
    });
  },
};
