import { describe, expect, it } from "vitest";
import {
  documentoQueVende,
  podeAcrescentarDocumento,
  tipoDoDocumento,
  vendaEmDocumentoEncerrado,
  type DocumentoDaPessoa,
} from "@/modules/comercial/domain/rules/documentos";
import {
  avaliarPromocao,
  categoriaDaPessoa,
  proximoDegrau,
  type MetaPromocao,
  type SituacaoPessoa,
} from "@/modules/comercial/domain/rules/promocao";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const doc = (over: Partial<DocumentoDaPessoa> = {}): DocumentoDaPessoa => ({
  id: "d1",
  cpfCnpj: "11122233344",
  tipo: "CPF",
  categoriaAtual: "INICIANTE",
  encerradoParaVendaEm: null,
  ...over,
});

describe("tipo do documento", () => {
  it("11 dígitos é CPF, 14 é CNPJ", () => {
    expect(tipoDoDocumento("11122233344")).toBe("CPF");
    expect(tipoDoDocumento("11222333000181")).toBe("CNPJ");
  });

  it("ignora máscara", () => {
    expect(tipoDoDocumento("111.222.333-44")).toBe("CPF");
    expect(tipoDoDocumento("11.222.333/0001-81")).toBe("CNPJ");
  });

  it("tamanho fora dos dois é documento inválido, não um palpite", () => {
    expect(tipoDoDocumento("123")).toBeNull();
    expect(tipoDoDocumento("")).toBeNull();
  });
});

describe("limite de documentos por pessoa", () => {
  const cpf = doc({ id: "cpf", tipo: "CPF" });
  const cnpj1 = doc({ id: "c1", tipo: "CNPJ", categoriaAtual: "VETERANO" });
  const cnpj2 = doc({ id: "c2", tipo: "CNPJ", categoriaAtual: "EXPERT" });

  it("aceita a trilha completa: 1 CPF + 2 CNPJ", () => {
    expect(podeAcrescentarDocumento([], "CPF").ok).toBe(true);
    expect(podeAcrescentarDocumento([cpf], "CNPJ").ok).toBe(true);
    expect(podeAcrescentarDocumento([cpf, cnpj1], "CNPJ").ok).toBe(true);
  });

  it("recusa o segundo CPF — pessoa física tem um só", () => {
    const resultado = podeAcrescentarDocumento([cpf], "CPF");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.codigo).toBe("PESSOA_JA_TEM_CPF");
  });

  it("recusa o terceiro CNPJ — não há degrau para ele", () => {
    const resultado = podeAcrescentarDocumento([cpf, cnpj1, cnpj2], "CNPJ");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.codigo).toBe("PESSOA_JA_TEM_DOIS_CNPJ");
  });

  it("o motivo explica o que fazer, não só que deu errado", () => {
    const resultado = podeAcrescentarDocumento([cpf], "CPF");
    if (!resultado.ok) expect(resultado.erro.mensagem).toMatch(/vínculo/i);
  });
});

describe("qual documento vende", () => {
  it("recém-chegado vende pelo CPF", () => {
    const documentos = [doc({ id: "cpf", categoriaAtual: "INICIANTE" })];
    expect(documentoQueVende(documentos)?.id).toBe("cpf");
  });

  it("promovido vende pelo CNPJ veterano, não mais pelo CPF", () => {
    const documentos = [
      doc({ id: "cpf", categoriaAtual: "INICIANTE", encerradoParaVendaEm: dia("2025-01-31") }),
      doc({ id: "cnpj1", tipo: "CNPJ", categoriaAtual: "VETERANO" }),
    ];
    expect(documentoQueVende(documentos)?.id).toBe("cnpj1");
  });

  it("expert continua vendendo pelo CNPJ veterano — o de expert não vende", () => {
    const documentos = [
      doc({ id: "cpf", categoriaAtual: "INICIANTE", encerradoParaVendaEm: dia("2025-01-31") }),
      doc({ id: "cnpj1", tipo: "CNPJ", categoriaAtual: "VETERANO" }),
      doc({ id: "cnpj2", tipo: "CNPJ", categoriaAtual: "EXPERT" }),
    ];
    expect(documentoQueVende(documentos)?.id).toBe("cnpj1");
  });

  it("documento sem categoria não vende — não se inventa categoria para calcular dinheiro", () => {
    expect(documentoQueVende([doc({ categoriaAtual: null })])).toBeNull();
  });
});

describe("venda em documento encerrado", () => {
  const encerrado = doc({ encerradoParaVendaEm: dia("2025-01-31") });

  it("venda posterior ao encerramento é anomalia", () => {
    expect(vendaEmDocumentoEncerrado(encerrado, dia("2025-03-10"))).toBe(true);
  });

  it("venda anterior ao encerramento é normal", () => {
    expect(vendaEmDocumentoEncerrado(encerrado, dia("2024-12-01"))).toBe(false);
  });

  it("no próprio dia do encerramento ainda vale", () => {
    expect(vendaEmDocumentoEncerrado(encerrado, dia("2025-01-31"))).toBe(false);
  });

  it("documento em atividade nunca é anomalia", () => {
    expect(vendaEmDocumentoEncerrado(doc(), dia("2030-01-01"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const meta = (over: Partial<MetaPromocao> = {}): MetaPromocao => ({
  id: "m",
  categoriaAlvo: "VETERANO",
  volumeMinimo: 3_000_000,
  abreDocumento: "CNPJ",
  vigenteDe: dia("2020-01-01"),
  vigenteAte: null,
  ...over,
});

const METAS = [
  meta({ id: "veterano", categoriaAlvo: "VETERANO", volumeMinimo: 3_000_000 }),
  meta({ id: "expert", categoriaAlvo: "EXPERT", volumeMinimo: 30_000_000 }),
];

const pessoa = (over: Partial<SituacaoPessoa> = {}): SituacaoPessoa => ({
  pessoaId: "p1",
  nome: "João",
  categoriaAtual: "INICIANTE",
  volumeAcumulado: 0,
  documentosCnpj: 0,
  ...over,
});

describe("degraus da trilha", () => {
  it("iniciante sobe para veterano, veterano para expert", () => {
    expect(proximoDegrau("INICIANTE")).toBe("VETERANO");
    expect(proximoDegrau("VETERANO")).toBe("EXPERT");
  });

  it("quem ainda não tem categoria mira o primeiro degrau", () => {
    expect(proximoDegrau(null)).toBe("VETERANO");
  });

  it("expert é o topo", () => {
    expect(proximoDegrau("EXPERT")).toBeNull();
  });
});

describe("aptidão para promoção", () => {
  it("iniciante que bateu 3 milhões está apto a veterano", () => {
    const resultado = avaliarPromocao(
      pessoa({ volumeAcumulado: 3_000_000 }),
      METAS,
      dia("2025-06-10"),
    );
    expect(resultado.apto).toBe(true);
    expect(resultado.categoriaAlvo).toBe("VETERANO");
  });

  it("exatamente na meta já conta", () => {
    expect(avaliarPromocao(pessoa({ volumeAcumulado: 3_000_000 }), METAS, dia("2025-06-10")).apto).toBe(true);
  });

  it("um real abaixo não conta, e diz quanto falta", () => {
    const resultado = avaliarPromocao(
      pessoa({ volumeAcumulado: 2_999_999 }),
      METAS,
      dia("2025-06-10"),
    );
    expect(resultado.apto).toBe(false);
    expect(resultado.faltam).toBe(1);
  });

  it("veterano só vira expert com 30 milhões, não com 3", () => {
    const comTres = avaliarPromocao(
      pessoa({ categoriaAtual: "VETERANO", volumeAcumulado: 3_000_000 }),
      METAS,
      dia("2025-06-10"),
    );
    expect(comTres.apto).toBe(false);
    expect(comTres.categoriaAlvo).toBe("EXPERT");

    const comTrinta = avaliarPromocao(
      pessoa({ categoriaAtual: "VETERANO", volumeAcumulado: 30_000_000 }),
      METAS,
      dia("2025-06-10"),
    );
    expect(comTrinta.apto).toBe(true);
  });

  it("expert não tem degrau seguinte", () => {
    const resultado = avaliarPromocao(
      pessoa({ categoriaAtual: "EXPERT", volumeAcumulado: 99_000_000 }),
      METAS,
      dia("2025-06-10"),
    );
    expect(resultado.apto).toBe(false);
    expect(resultado.motivo).toMatch(/topo|expert/i);
  });

  it("sem meta cadastrada não promove, e diz que falta configurar", () => {
    const resultado = avaliarPromocao(pessoa({ volumeAcumulado: 99_000_000 }), [], dia("2025-06-10"));
    expect(resultado.apto).toBe(false);
    expect(resultado.motivo).toMatch(/sem meta/i);
  });

  it("resolve a meta pela vigência — mudar a meta não reclassifica o passado", () => {
    const metas = [
      meta({ id: "antiga", volumeMinimo: 1_000_000, vigenteDe: dia("2020-01-01"), vigenteAte: dia("2024-12-31") }),
      meta({ id: "nova", volumeMinimo: 3_000_000, vigenteDe: dia("2025-01-01") }),
    ];
    const alguem = pessoa({ volumeAcumulado: 2_000_000 });

    expect(avaliarPromocao(alguem, metas, dia("2024-06-01")).apto).toBe(true);
    expect(avaliarPromocao(alguem, metas, dia("2025-06-01")).apto).toBe(false);
  });
});

describe("categoria da pessoa para efeito de progressão", () => {
  it("é a mais alta entre os documentos", () => {
    expect(categoriaDaPessoa(["INICIANTE", "VETERANO"])).toBe("VETERANO");
    expect(categoriaDaPessoa(["INICIANTE", "VETERANO", "EXPERT"])).toBe("EXPERT");
  });

  it("ignora documento sem categoria", () => {
    expect(categoriaDaPessoa([null, "VETERANO", null])).toBe("VETERANO");
  });

  it("pessoa sem nenhuma categoria devolve nulo", () => {
    expect(categoriaDaPessoa([null, null])).toBeNull();
  });
});
