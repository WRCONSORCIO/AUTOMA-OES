import { formatarMoeda, formatarNumero } from "@/lib/format";
import { Cabecalho, Tabela, TabelaVazia, Td, Th, Tr } from "@/components/ui";
import type { ItemRanking } from "@/server/services/dashboard";

/**
 * Visão tabular do ranking. Garante que os valores fiquem legíveis mesmo quando
 * a cor do gráfico não é distinguível (impressão, daltonismo, alto contraste).
 */
export function TabelaRanking({
  dados,
  rotuloDimensao,
}: {
  dados: ItemRanking[];
  rotuloDimensao: string;
}) {
  return (
    <details className="mt-4 group">
      <summary className="cursor-pointer text-sm text-[var(--color-texto-2)] hover:text-[var(--color-texto)]">
        Ver como tabela
      </summary>
      <div className="mt-3 rounded-lg border border-[var(--color-borda)]">
        <Tabela>
          <Cabecalho>
            <tr>
              <Th>{rotuloDimensao}</Th>
              <Th className="text-right">Recebido</Th>
              <Th className="text-right">Comissão WR</Th>
              <Th className="text-right">Lançamentos</Th>
            </tr>
          </Cabecalho>
          <tbody>
            {dados.length === 0 ? (
              <TabelaVazia colunas={4} mensagem="Sem dados no período." />
            ) : (
              dados.map((item) => (
                <Tr key={item.id}>
                  <Td className="font-medium">{item.nome}</Td>
                  <Td className="numerico text-right">{formatarMoeda(item.valor)}</Td>
                  <Td className="numerico text-right">{formatarMoeda(item.comissaoWr)}</Td>
                  <Td className="numerico text-right">{formatarNumero(item.quantidade)}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </Tabela>
      </div>
    </details>
  );
}
