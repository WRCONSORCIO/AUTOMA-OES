import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Vendas que chegaram num documento já fechado para venda nova.
 *
 * Quando a pessoa é promovida, o CPF para de receber venda — mas a
 * administradora é a fonte da verdade, e se ela mandar uma venda nova nesse CPF
 * o sistema **grava assim mesmo**. Bloquear seria fingir que o fato não
 * aconteceu; ignorar seria calcular comissão pela categoria errada em silêncio.
 * O caminho certo é gravar e avisar.
 *
 * Normalmente significa uma de duas coisas, e as duas custam dinheiro:
 *
 * - a promoção foi registrada com data errada, e vendas legítimas estão sendo
 *   tratadas como anomalia;
 * - a venda saiu pelo documento errado, e está sendo apurada pela categoria de
 *   iniciante quando deveria ser de veterano (ou o contrário).
 *
 * É uma **consulta derivada**, não uma tabela. Os dois fatos que a definem — a
 * data da venda e a data em que o documento fechou — já estão gravados, então
 * guardar a conclusão criaria um terceiro estado para sair de sincronia com os
 * outros dois. Corrigir a data da promoção faz o alerta sumir sozinho, que é
 * exatamente o comportamento desejado.
 */

export interface VendaForaDoDocumento {
  cotaId: string;
  contrato: string;
  grupo: string;
  cota: string;
  nomeCliente: string;
  dataVenda: Date;
  valorCredito: number | null;
  categoriaVenda: string | null;

  vendedorId: string;
  vendedorNome: string;
  vendedorDocumento: string;
  fechadoEm: Date;

  pessoaId: string | null;
  pessoaNome: string | null;
}

interface LinhaBruta {
  cotaId: string;
  contrato: string;
  grupo: string;
  cota: string;
  nomeCliente: string;
  dataVenda: Date;
  valorCredito: Prisma.Decimal | null;
  categoriaVenda: string | null;
  vendedorId: string;
  vendedorNome: string;
  vendedorDocumento: string;
  fechadoEm: Date;
  pessoaId: string | null;
  pessoaNome: string | null;
}

export async function vendasForaDoDocumento(opcoes: {
  pessoaId?: string;
  gerenciaId?: string;
  equipeId?: string;
  limite?: number;
} = {}): Promise<VendaForaDoDocumento[]> {
  const { pessoaId, gerenciaId, equipeId, limite = 200 } = opcoes;

  const filtros = Prisma.sql`
    ${pessoaId ? Prisma.sql`AND v."pessoaId" = ${pessoaId}` : Prisma.empty}
    ${gerenciaId ? Prisma.sql`AND c."gerenciaId" = ${gerenciaId}` : Prisma.empty}
    ${equipeId ? Prisma.sql`AND c."equipeId" = ${equipeId}` : Prisma.empty}
  `;

  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT
      c."id"                    AS "cotaId",
      c."contrato"              AS "contrato",
      c."grupo"                 AS "grupo",
      c."cota"                  AS "cota",
      c."nomeCliente"           AS "nomeCliente",
      c."dataVenda"             AS "dataVenda",
      c."valorCredito"          AS "valorCredito",
      c."categoriaVenda"::text  AS "categoriaVenda",
      v."id"                    AS "vendedorId",
      v."nome"                  AS "vendedorNome",
      v."cpfCnpj"               AS "vendedorDocumento",
      v."encerradoParaVendaEm"  AS "fechadoEm",
      p."id"                    AS "pessoaId",
      p."nome"                  AS "pessoaNome"
    FROM "Cota" c
    JOIN "Vendedor" v ON v."id" = c."vendedorEfetivoId"
    LEFT JOIN "Pessoa" p ON p."id" = v."pessoaId"
    WHERE v."encerradoParaVendaEm" IS NOT NULL
      AND c."dataVenda" IS NOT NULL
      AND c."dataVenda" > v."encerradoParaVendaEm"
      ${filtros}
    ORDER BY c."dataVenda" DESC
    LIMIT ${limite}
  `;

  return linhas.map((linha) => ({
    ...linha,
    valorCredito: linha.valorCredito === null ? null : Number(linha.valorCredito),
  }));
}

/** Só a contagem, para o cartão do Dashboard. */
export async function contarVendasForaDoDocumento(opcoes: {
  gerenciaId?: string;
  equipeId?: string;
} = {}): Promise<number> {
  const { gerenciaId, equipeId } = opcoes;

  const filtros = Prisma.sql`
    ${gerenciaId ? Prisma.sql`AND c."gerenciaId" = ${gerenciaId}` : Prisma.empty}
    ${equipeId ? Prisma.sql`AND c."equipeId" = ${equipeId}` : Prisma.empty}
  `;

  const [linha] = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT COUNT(*) AS total
    FROM "Cota" c
    JOIN "Vendedor" v ON v."id" = c."vendedorEfetivoId"
    WHERE v."encerradoParaVendaEm" IS NOT NULL
      AND c."dataVenda" IS NOT NULL
      AND c."dataVenda" > v."encerradoParaVendaEm"
      ${filtros}
  `;

  return Number(linha?.total ?? 0);
}
