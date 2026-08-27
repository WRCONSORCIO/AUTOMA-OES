import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lerPlanilha } from "@/server/importacao/xlsx";
import { lerPlanilhaCadastro } from "@/server/importacao/planilha-cadastro";
import {
  montarPeriodos,
  type LinhaCategoria,
} from "@/server/importacao/planilha-cadastro";

/**
 * O leitor roda contra a planilha de verdade da WR, com os NOMES TROCADOS.
 *
 * Um arquivo montado à mão testaria o leitor contra a ideia que eu faço do
 * Excel, não contra o que o Excel grava. A planilha real traz o que quebra na
 * prática: título e instruções antes do cabeçalho, texto solto dentro da faixa
 * de dados, nome cortado em 30 caracteres pelo relatório e um vendedor com
 * duas categorias no mesmo mês.
 *
 * Só a tabela de textos do arquivo foi reescrita, com nomes fictícios de
 * comprimento idêntico — o resto são os bytes que o Excel gravou. A estrutura
 * é a real; a folha de pessoal não entra no repositório.
 */

const ARQUIVO = new URL("./dados/cadastro-wr.xlsx", import.meta.url);

function planilha() {
  return lerPlanilhaCadastro(readFileSync(ARQUIVO));
}

describe("leitor de .xlsx", () => {
  it("lê as três abas com os nomes que o Excel gravou", () => {
    const abas = lerPlanilha(readFileSync(ARQUIVO));
    expect(abas.map((aba) => aba.nome)).toEqual([
      "VENDEDORES",
      "HISTORICO CATEGORIA",
      "NOMES DE CADASTRO",
    ]);
  });

  it("preserva a posição das células, não só a ordem", () => {
    const [vendedores] = lerPlanilha(readFileSync(ARQUIVO));
    // O cabeçalho está na terceira linha: as duas de cima são título e
    // instrução. Achá-lo pela posição é justamente o que o leitor não faz.
    expect(vendedores!.linhas[2]).toEqual([
      "COD",
      "VENDEDOR",
      "CATEGORIA ATUAL",
      "SUPERVISOR",
      "GERENTE",
      "SITUAÇÃO",
      "OBSERVAÇÃO",
    ]);
  });
});

describe("leitor do cadastro", () => {
  it("acha o cabeçalho abaixo do título e das instruções", () => {
    const { vendedores } = planilha();
    expect(vendedores).toHaveLength(66);
    expect(vendedores[0]).toMatchObject({
      nome: "KELLY ESTEVES MENDE",
      categoriaAtual: "VETERANO",
      supervisor: "ULISSES BARROS C",
      gerente: "ULISSES BARROS C",
      situacao: "DESLIGADO",
    });
  });

  it("ignora instrução solta no meio dos dados sem reportar erro", () => {
    const { nomes, problemas } = planilha();
    // A aba de de-para tem uma frase de instrução numa célula abaixo do
    // cabeçalho. Ela não é linha de dado nem erro de preenchimento.
    expect(nomes).toHaveLength(105);
    expect(problemas.filter((p) => p.aba === "NOMES DE CADASTRO")).toHaveLength(0);
  });

  it("deixa em branco quem não é vendedor da WR", () => {
    const { nomes } = planilha();
    expect(nomes.filter((linha) => linha.vendedorWr === null)).not.toHaveLength(0);
  });

  it("converte o mês AAAA-MM no primeiro dia", () => {
    const { categorias } = planilha();
    const alvo = categorias.filter((linha) => linha.vendedor === "KELLY ESTEVES MENDE");
    expect(alvo.map((linha) => [linha.mes, linha.vigenteDe.toISOString().slice(0, 10)])).toEqual(
      [
        ["2025-07", "2025-07-01"],
        ["2025-12", "2025-12-01"],
      ],
    );
  });

  it("aponta o vendedor com duas categorias no mesmo mês", () => {
    const { problemas } = planilha();
    const conflito = problemas.find((p) => p.mensagem.includes("duas categorias diferentes"));
    expect(conflito?.mensagem).toContain("VETERANO e EXPERT");
    expect(conflito?.aba).toBe("HISTORICO CATEGORIA");
  });
});

function linha(mes: string, categoria: LinhaCategoria["categoria"], ordem = 0): LinhaCategoria {
  const [ano, numero] = mes.split("-").map(Number);
  return {
    numeroLinha: ordem,
    vendedor: "FULANO",
    vigenteDe: new Date(Date.UTC(ano!, numero! - 1, 1)),
    mes,
    categoria,
    observacao: null,
  };
}

const dia = (data: Date | null) => (data ? data.toISOString().slice(0, 10) : null);

describe("períodos de categoria", () => {
  it("fecha cada período na véspera do seguinte", () => {
    const periodos = montarPeriodos(
      [linha("2025-07", "INICIANTE", 1), linha("2025-12", "VETERANO", 2)],
      "VETERANO",
    );

    expect(periodos.map((p) => [p.categoria, dia(p.vigenteDe), dia(p.vigenteAte)])).toEqual([
      ["INICIANTE", "2000-01-01", "2025-11-30"],
      ["VETERANO", "2025-12-01", null],
    ]);
  });

  it("recua o primeiro período para trás da primeira linha", () => {
    const [primeiro] = montarPeriodos([linha("2026-05", "INICIANTE", 1)], "INICIANTE");
    // Venda anterior à primeira linha da planilha não pode ficar sem
    // categoria: sem categoria ela não paga e não avisa, que é o pior desfecho.
    expect(dia(primeiro!.vigenteDe)).toBe("2000-01-01");
    expect(primeiro!.vigenteAte).toBeNull();
  });

  it("sem nenhuma mudança registrada, a categoria atual vale desde sempre", () => {
    const periodos = montarPeriodos([], "EXPERT");
    expect(periodos).toHaveLength(1);
    expect(periodos[0]).toMatchObject({ categoria: "EXPERT", vigenteAte: null });
  });

  it("não inventa período quando não há categoria nenhuma", () => {
    expect(montarPeriodos([], null)).toEqual([]);
  });

  it("no mesmo mês, a última linha corrige a anterior", () => {
    const periodos = montarPeriodos(
      [linha("2025-11", "VETERANO", 1), linha("2025-11", "EXPERT", 2)],
      "EXPERT",
    );
    // Duas linhas no mesmo mês criariam um período de duração zero, e a
    // resolução por data devolveria a errada dependendo da ordem de leitura.
    expect(periodos).toHaveLength(1);
    expect(periodos[0]!.categoria).toBe("EXPERT");
  });

  it("não parte o período quando a categoria se repete", () => {
    const periodos = montarPeriodos(
      [
        linha("2024-01", "INICIANTE", 1),
        linha("2024-06", "INICIANTE", 2),
        linha("2025-01", "VETERANO", 3),
      ],
      "VETERANO",
    );

    expect(periodos.map((p) => p.categoria)).toEqual(["INICIANTE", "VETERANO"]);
    expect(dia(periodos[0]!.vigenteAte)).toBe("2024-12-31");
  });

  it("ordena por data, não pela ordem das linhas na planilha", () => {
    const periodos = montarPeriodos(
      [linha("2025-12", "VETERANO", 1), linha("2025-07", "INICIANTE", 2)],
      "VETERANO",
    );

    expect(periodos.map((p) => p.categoria)).toEqual(["INICIANTE", "VETERANO"]);
  });
});
