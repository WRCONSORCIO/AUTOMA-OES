import { describe, expect, it } from "vitest";
import { interpretarLinhas } from "@/server/importacao/pdf-comissao-vendedor";

/**
 * Trecho literal do relatório CV065E de 22/07/2026 — as duas páginas de um
 * vendedor, transcritas com o espaçamento original.
 *
 * O relatório imprime o total do vendedor e o total do fechamento, e é contra
 * eles que a leitura se confere: se a soma do que foi lido não bate, alguma
 * linha ficou de fora ou foi lida errado.
 */
const PAGINA_8 = `
SERVOPA ADMINISTRADORA DE CONSORCIOS LTDA                     CV065E                        HORA:  20:11        PAGINA:           8
ATIVIDADE  : CV     -  COMISSAO DE VEN     REL COMISSAO Y VENDEDOR                                  EMISSAO: 22/07/2026
SOLICITANTE: 000108 -  ABIGAIL
------------------------------------------------------------------------------------------------------------------------------------
PRESTADORA: WRCON  VENDEDOR:WRCON -WR VENDAS DE COTAS DE CONSORCIOS LTDA      N. MATRICULA:         CPF/CNPJ:42.726.684/0001-53
COTA        D E NOME DO CLIENTE                                      CONTATO
            CONTRATO   OBJETO                               VL.CREDITO  %FLEX    VLR.COMISSAO     VLR.DSR  VLR.SEGURO    (%)
     ORIGEM                         PARC     DT PAGAM     DT CONTAB    DT.CHEQUE   DT VENDA        CLAOBJ ASS
----------------------------------------------------------------------------------------------------------------------------------
VENDEDOR (CPF/CNPJ): 35.666.540/0001-93 - 35.666.540 ELZENI DE PAIVA FERREIRA
1566.1053 -1   E MARIANA DAS GRACAS SILVA SOUZA                      / 31 97338.7112
    37966I10                                              103.312,00   50,00          51,66        0,00        0,00   0,1000
              3   22/07/2026                                          01/05/2026      I
1569.1392 -5   E BRENDA CARLA DOS SANTOS SILVA            31 98226.0058 / 31 98226.0058
    42158I10                                              100.000,00   50,00          50,00        0,00        0,00   0,1000
              4   22/07/2026                                          04/04/2026      I
1569.3477 -9   E FERNANDA SIMAO COELHO OLIVEIRA           33 99993.8898 / 33 99993.8898
    38353I10                                              100.000,00   50,00          50,00        0,00        0,00   0,1000
              4   22/07/2026                              27/03/2026  30/03/2026      I
1570.1036 -8   E JULIA BIANCA SOUZA ARAUJO                           / 33 99921.5251
    37222I10                                              250.000,00   50,00         125,00        0,00        0,00   0,1000
              4   22/07/2026                                          03/04/2026      I
1570.1299 -9   E DANIEL FELIPE RAMOS CAETANO                         / 12 013491703
    37490I10                                              250.000,00   50,00         125,00        0,00        0,00   0,1000
              4   22/07/2026                                          20/03/2026      I
1570.2089 -4   E CARLOS ALBERTO DA SILVA                             / 31 99554.0662
    49697I10                                              300.000,00   50,00         150,00        0,00        0,00   0,1000
              3   22/07/2026                                          30/04/2026      I
1570.3785 -1   E ANA MARIA COSTA MENDES                              / 31 99745.6265
    56913I10                                              300.000,00   50,00         150,00        0,00        0,00   0,1000
              3   22/07/2026                                          18/05/2026      I
1571.1619 -1   E ANTONY OLIVEIRA BATISTA                             / 31 99516.8636
    45032I10                                              150.000,00   50,00          75,00        0,00        0,00   0,1000
              3   22/07/2026                                          21/04/2026      I
1571.3005 -3   E LIVANCLEYF SILVA VIANA                              / 31 97519.6621
    50185I10                                              150.000,00   50,00          75,00        0,00        0,00   0,1000
              3   22/07/2026                                          29/04/2026      I
1570.3829 -7   E THAIZA APARECIDA GARCIA GONCALVES                   / 33 99875.0310
    75515I10                                              250.000,00   50,00         375,00        0,00        0,00   0,3000
                  22/07/2026                                          20/07/2026      I
1572.1093 -6   E JOAO VITOR SOUTO VILIAN                             / 31 98793.9681
    75097I10                                              400.000,00   50,00         600,00        0,00        0,00   0,3000
                  22/07/2026                                          15/07/2026      I
1573.2877 -5   E THIERRY BARROS PEREIRA                              / 31 99740.7478
    68239I10                                              100.000,00   50,00         150,00        0,00        0,00   0,3000
                  22/07/2026                                          09/04/2026      I
1573.3360 -4   E THIERRY BARROS PEREIRA                              / 31 99740.7478
    68536I10                                              100.000,00   50,00         150,00        0,00        0,00   0,3000
                  22/07/2026                                          09/04/2026      I
3308.0293 -3   E LYVIA JESSICA COSTA SILVA ANDRADE                   / 31 98016.7691
    76978I10                                               34.000,00   50,00          51,00        0,00        0,00   0,3000
                  22/07/2026                                          22/07/2026      I
                                                          Total do Vendedor ......:  2.177,66        0,00        0,00
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
`;

const PAGINA_9 = `
SERVOPA ADMINISTRADORA DE CONSORCIOS LTDA                     CV065E                        HORA:  20:11        PAGINA:           9
ATIVIDADE  : CV     -  COMISSAO DE VEN     REL COMISSAO Y VENDEDOR                                  EMISSAO: 22/07/2026
SOLICITANTE: 000108 -  ABIGAIL
------------------------------------------------------------------------------------------------------------------------------------
PRESTADORA: WRCON  VENDEDOR:WRCON -WR VENDAS DE COTAS DE CONSORCIOS LTDA      N. MATRICULA:         CPF/CNPJ:42.726.684/0001-53
COTA        D E NOME DO CLIENTE                                      CONTATO
            CONTRATO   OBJETO                               VL.CREDITO  %FLEX    VLR.COMISSAO     VLR.DSR  VLR.SEGURO    (%)
     ORIGEM                         PARC     DT PAGAM     DT CONTAB    DT.CHEQUE   DT VENDA        CLAOBJ ASS
----------------------------------------------------------------------------------------------------------------------------------
                                              Sub-Total...............:   2.177,66        0,00        0,00

                                       VLR. BENS IMOVEIS:      2.126,66
                                       VLR. BENS MOVEIS:          51,00
                                                          ------------------
                                       VLR. COMISSAO:          2.177,66
                                       I.R. (-):                  32,66
                                                          ------------------
                                       TOTAL LIQUIDO:          2.145,00

                              * * RELATORIO PARA ACOMPANHAMENTO DAS COMISSOES * *
                              * * DOS VENDEDORES                              * *
                                     * * NAO EMITIR NOTA FISCAL * *
`;

function linhas(...paginas: string[]) {
  return paginas.flatMap((conteudo, indice) =>
    conteudo
      .split("\n")
      .filter((texto) => texto.trim().length > 0)
      .map((texto) => ({ pagina: indice + 8, texto })),
  );
}

const leitura = interpretarLinhas(linhas(PAGINA_8, PAGINA_9), 2);

describe("relatório de comissão dos vendedores (CV065E)", () => {
  it("lê todos os lançamentos do vendedor", () => {
    expect(leitura.erros).toEqual([]);
    expect(leitura.registros).toHaveLength(14);
  });

  it("a soma bate com o total impresso do vendedor", () => {
    expect(leitura.somaLida).toBe(2_177.66);
    expect(leitura.totaisPorVendedor.get("35666540000193")).toBe(2_177.66);
    expect(leitura.divergencia).toBe(0);
  });

  it("a soma bate também com o total do fechamento", () => {
    // O relatório imprime imóveis e móveis separados: 2.126,66 + 51,00.
    expect(leitura.totalRelatorio).toBe(2_177.66);
    expect(leitura.totalLiquido).toBe(2_145);
  });

  it("identifica o vendedor dono da seção", () => {
    expect(leitura.registros[0]?.vendedorDocumento).toBe("35666540000193");
    expect(leitura.registros[0]?.vendedorNome).toBe("ELZENI DE PAIVA FERREIRA");
  });

  it("reconhece o formulário, que é o que separa este relatório do da WR", () => {
    expect(leitura.formulario).toBe("CV065E");
  });

  it("lê o primeiro lançamento por inteiro", () => {
    const primeiro = leitura.registros[0]!;

    expect(primeiro.grupo).toBe("1566");
    expect(primeiro.cota).toBe("1053-1");
    expect(primeiro.contrato).toBe("37966I10");
    expect(primeiro.nomeCliente).toBe("MARIANA DAS GRACAS SILVA SOUZA");
    expect(primeiro.valorCredito).toBe(103_312);
    expect(primeiro.percentualFlex).toBe(50);
    expect(primeiro.valorComissao).toBe(51.66);
    expect(primeiro.percentualComissao).toBe(0.1);
    expect(primeiro.parcela).toBe(3);
  });

  it("o lançamento sem parcela impressa é a inclusão de plano, parcela 1", () => {
    const semParcela = leitura.registros.find((item) => item.contrato === "75097I10")!;

    expect(semParcela.parcela).toBe(1);
    expect(semParcela.valorComissao).toBe(600);
    expect(semParcela.percentualComissao).toBe(0.3);
  });

  it("a comissão confere com crédito × flex × percentual", () => {
    for (const registro of leitura.registros) {
      const base = registro.valorCredito * ((registro.percentualFlex ?? 100) / 100);
      const esperado = Math.round(base * (registro.percentualComissao ?? 0)) / 100;
      expect(registro.valorComissao).toBeCloseTo(esperado, 2);
    }
  });

  it("a linha de total não vira lançamento", () => {
    expect(leitura.registros.every((item) => item.contrato !== "Total")).toBe(true);
  });
});
