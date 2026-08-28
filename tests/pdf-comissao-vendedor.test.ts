import { describe, expect, it } from "vitest";
import { interpretarLinhas } from "@/server/importacao/pdf-comissao-vendedor";

/**
 * O relatório de comissão dos vendedores em três linhas por lançamento.
 *
 * As linhas abaixo são cópias do PDF real da SERVOPA, com os nomes trocados.
 * O que elas exercitam é a diferença que derrubou um segmento inteiro: a
 * última coluna, a classificação do objeto, vem como a letra `I` no imóvel e
 * como dígito no móvel.
 */

const CABECALHO = [
  "       SERVOPA ADMINISTRADORA DE CONSORCIOS LTDA                     CV069E",
  "       PRESTADORA: WRCON  VENDEDOR:WRCON -WR VENDAS DE COTAS DE CONSORCIOS LTDA",
  "       VENDEDOR (CPF/CNPJ): 35.666.540/0001-93 - 35.666.540 FULANA DE TAL",
];

/** Imóvel: a classificação sai como `I`. */
const IMOVEL = [
  "    1573.3360 -4   E CLIENTE DE IMOVEL                                / 31 99740.7478",
  "                   68536I10                                        100.000,00    50,00         150,00        0,00        0,00   0,3000",
  "                                               22/07/2026                              09/07/2026      I",
];

/** Móvel: a classificação sai como DÍGITO. */
const MOVEL = [
  "    3308.0293 -3   E CLIENTE DE MOVEL                                 / 31 98016.7691",
  "                   76978I10                                         34.000,00    50,00          51,00        0,00        0,00   0,3000",
  "                                               22/07/2026                              22/07/2026      1",
];

const RODAPE = [
  "                                                VLR. BENS IMOVEIS:             150,00",
  "                                                VLR. BENS MOVEIS:               51,00",
  "                                                VLR. COMISSAO:                 201,00",
];

function ler(linhas: readonly string[]) {
  return interpretarLinhas(
    linhas.map((texto) => ({ pagina: 1, texto })),
    1,
  );
}

describe("leitor do CV069E", () => {
  it("lê o lançamento de imóvel", () => {
    const { registros } = ler([...CABECALHO, ...IMOVEL, ...RODAPE]);

    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      vendedorDocumento: "35666540000193",
      grupo: "1573",
      cota: "3360-4",
      contrato: "68536I10",
      valorCredito: 100000,
      percentualFlex: 50,
      valorComissao: 150,
    });
  });

  it("lê o lançamento de móvel, cuja classificação é um dígito", () => {
    // Este é o caso que sumia. A terceira linha é a que fecha o registro, e
    // exigir letra na última coluna fazia o lançamento inteiro ser descartado
    // sem erro nenhum — o segmento de móveis simplesmente não existia.
    const { registros } = ler([...CABECALHO, ...MOVEL, ...RODAPE]);

    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      grupo: "3308",
      cota: "293-3",
      contrato: "76978I10",
      valorComissao: 51,
    });
  });

  it("soma os dois segmentos e fecha com o total impresso", () => {
    const leitura = ler([...CABECALHO, ...IMOVEL, ...MOVEL, ...RODAPE]);

    expect(leitura.registros).toHaveLength(2);
    expect(leitura.totalRelatorio).toBe(201);
    // A divergência é a única pista que o usuário tem de que uma linha não foi
    // lida. Zero aqui é o que garante que nenhum segmento ficou para trás.
    expect(leitura.somaLida).toBe(201);
    expect(leitura.divergencia).toBe(0);
  });

  it("não inventa lançamento a partir de linha solta", () => {
    // Sem a linha das datas o registro não fecha, e é assim que deve ser: os
    // valores sozinhos não dizem de qual parcela nem de qual data são.
    const { registros } = ler([...CABECALHO, IMOVEL[0]!, IMOVEL[1]!]);
    expect(registros).toHaveLength(0);
  });
});
