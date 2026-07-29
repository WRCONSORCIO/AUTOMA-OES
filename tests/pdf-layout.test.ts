import { describe, expect, it } from "vitest";
import { reconstruirLinhas } from "@/server/importacao/pdf-comissao";

/**
 * Trava o comportamento da reconstrução posicional de linhas — a base do
 * parser do relatório. Os itens simulam o que o pdf.js devolve: cada trecho de
 * texto com a matriz de transformação e a largura renderizada.
 */
function item(texto: string, coluna: number, larguraChar = 4.286) {
  return {
    str: texto,
    transform: [larguraChar, 0, 0, 10, coluna * larguraChar, 700],
    width: texto.length * larguraChar,
  };
}

describe("reconstrução de linhas do PDF", () => {
  it("recoloca cada token na coluna original", () => {
    const linhas = reconstruirLinhas([
      item("1574.2754.4", 4),
      item("CREDITO P/IMOVEL 7", 30),
      item("110.000,00", 67),
      item("50,00", 80),
      item("825,00", 95),
    ]);

    expect(linhas).toHaveLength(1);
    const linha = linhas[0]!;
    expect(linha.indexOf("1574.2754.4")).toBe(4);
    expect(linha.indexOf("110.000,00")).toBe(67);
    expect(linha.indexOf("50,00")).toBe(80);
    expect(linha.indexOf("825,00")).toBe(95);
  });

  it("separa linhas por coordenada vertical, da superior para a inferior", () => {
    const superior = { ...item("PRIMEIRA", 4) };
    const inferior = { ...item("SEGUNDA", 4) };
    inferior.transform = [4.286, 0, 0, 10, 4 * 4.286, 690];

    expect(reconstruirLinhas([inferior, superior])).toEqual(["    PRIMEIRA", "    SEGUNDA"]);
  });

  it("mantém a coluna mesmo quando o extrator quebra um número em pedaços", () => {
    // O texto corrido produziria "1.365,5 9"; a posição preserva "1.365,59".
    const linhas = reconstruirLinhas([item("1.365,5", 95), item("9", 102)]);
    expect(linhas[0]!.slice(95, 103)).toBe("1.365,59");
  });
});
