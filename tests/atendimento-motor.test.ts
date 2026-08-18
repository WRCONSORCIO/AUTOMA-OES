import { describe, expect, it } from "vitest";
import {
  desempilharEtapa,
  detectarComando,
  empilharEtapa,
  interpretarEscolha,
  montarMenuTexto,
  normalizar,
  type OpcaoApresentada,
} from "@/server/atendimento/dominio/motor";

const MENU: OpcaoApresentada[] = [
  { id: "op-1", rotulo: "🔄 Renovação", valor: "renovacao" },
  { id: "op-2", rotulo: "🆕 Nova contratação", valor: "nova_contratacao" },
  { id: "op-3", rotulo: "👨‍💻 Falar com atendente", valor: "atendente" },
];

describe("normalização de texto", () => {
  it("tira acento, emoji e pontuação", () => {
    expect(normalizar("🆕 Nova contratação!")).toBe("nova contratacao");
    expect(normalizar("  TV   SMART  ")).toBe("tv smart");
  });
});

describe("interpretação da resposta do cliente", () => {
  it("aceita o id devolvido pelo botão nativo", () => {
    const escolha = interpretarEscolha("op-2", MENU);
    expect(escolha).toMatchObject({ tipo: "opcao", opcao: { valor: "nova_contratacao" } });
  });

  it("aceita o rótulo escrito por extenso, com ou sem acento", () => {
    expect(interpretarEscolha("nova contratacao", MENU)).toMatchObject({
      tipo: "opcao",
      opcao: { valor: "nova_contratacao" },
    });
    expect(interpretarEscolha("🆕 Nova contratação", MENU)).toMatchObject({
      tipo: "opcao",
      opcao: { valor: "nova_contratacao" },
    });
  });

  it("aceita o número da posição no menu", () => {
    expect(interpretarEscolha("1", MENU)).toMatchObject({
      tipo: "opcao",
      opcao: { valor: "renovacao" },
      posicao: 1,
    });
  });

  it("não inventa opção para número fora da lista", () => {
    expect(interpretarEscolha("9", MENU)).toEqual({ tipo: "nenhuma" });
  });

  it("resolve a opção quando o rótulo aparece dentro da frase", () => {
    const planos: OpcaoApresentada[] = [
      { id: "p1", rotulo: "30 dias", valor: "p1" },
      { id: "p2", rotulo: "90 dias", valor: "p2" },
    ];

    expect(interpretarEscolha("quero o de 90 dias", planos)).toMatchObject({
      tipo: "opcao",
      opcao: { id: "p2" },
    });
  });

  it("prefere o rótulo mais específico quando um contém o outro", () => {
    const aparelhos: OpcaoApresentada[] = [
      { id: "a", rotulo: "TV Smart", valor: "a" },
      { id: "b", rotulo: "TV Box", valor: "b" },
    ];

    expect(interpretarEscolha("tenho uma tv box", aparelhos)).toMatchObject({
      tipo: "opcao",
      opcao: { id: "b" },
    });
  });

  it("não escolhe quando dois rótulos do mesmo tamanho casam com a frase", () => {
    const ambiguas: OpcaoApresentada[] = [
      { id: "a", rotulo: "Box A", valor: "a" },
      { id: "b", rotulo: "Box B", valor: "b" },
    ];

    expect(interpretarEscolha("tenho box a e box b", ambiguas)).toEqual({ tipo: "nenhuma" });
  });

  it("a opção do menu vence o comando global de mesmo assunto", () => {
    // O menu tem um botão de atendente: clicar nele segue o destino que o
    // administrador configurou, não o atalho embutido.
    expect(interpretarEscolha("👨‍💻 Falar com atendente", MENU)).toMatchObject({
      tipo: "opcao",
      opcao: { valor: "atendente" },
    });
  });

  it("reconhece os comandos globais fora do menu", () => {
    const semOpcoes: OpcaoApresentada[] = [];

    expect(interpretarEscolha("menu", semOpcoes)).toEqual({ tipo: "comando", comando: "menu" });
    expect(interpretarEscolha("voltar", semOpcoes)).toEqual({ tipo: "comando", comando: "voltar" });
    expect(interpretarEscolha("quero falar com um humano", semOpcoes)).toEqual({
      tipo: "comando",
      comando: "atendente",
    });
  });

  it("não volta ao menu por causa da palavra no meio da frase", () => {
    expect(detectarComando("me mostra o menu de planos de 30 dias")).toBeNull();
    expect(detectarComando("menu")).toBe("menu");
  });

  it("devolve 'nenhuma' para texto que não é opção nem comando", () => {
    expect(interpretarEscolha("bom dia, tudo bem?", MENU)).toEqual({ tipo: "nenhuma" });
  });
});

describe("menu em texto (fallback)", () => {
  it("numera as opções na mesma ordem apresentada", () => {
    expect(montarMenuTexto("Como podemos ajudar?", MENU, "Responda com o número.")).toBe(
      "Como podemos ajudar?\n\n1. 🔄 Renovação\n2. 🆕 Nova contratação\n3. 👨‍💻 Falar com atendente\n\nResponda com o número.",
    );
  });
});

describe("histórico de navegação", () => {
  it("empilha sem repetir a mesma etapa e volta de verdade", () => {
    let historico = empilharEtapa([], "menu");
    historico = empilharEtapa(historico, "menu");
    historico = empilharEtapa(historico, "planos");

    expect(historico).toEqual(["menu", "planos"]);

    const volta = desempilharEtapa(historico);
    expect(volta.anterior).toBe("planos");
    expect(volta.historico).toEqual(["menu"]);
  });

  it("limita o tamanho da pilha", () => {
    let historico: string[] = [];
    for (let i = 0; i < 40; i += 1) historico = empilharEtapa(historico, `etapa-${i}`, 5);

    expect(historico).toHaveLength(5);
    expect(historico.at(-1)).toBe("etapa-39");
  });
});

describe("resposta digitada parcialmente", () => {
  const planos = [
    { id: "plano:a", rotulo: "Plano 30 dias — R$ 99,90", valor: "a" },
    { id: "plano:b", rotulo: "Plano 90 dias — R$ 249,90", valor: "b" },
  ];

  it("aceita o trecho que o cliente digita quando só um rótulo casa", () => {
    const escolha = interpretarEscolha("Plano 30 dias", planos);

    expect(escolha.tipo).toBe("opcao");
    expect(escolha.tipo === "opcao" && escolha.opcao.id).toBe("plano:a");
  });

  it("não chuta quando o trecho casa com mais de um rótulo", () => {
    expect(interpretarEscolha("plano", planos).tipo).toBe("nenhuma");
  });
});
