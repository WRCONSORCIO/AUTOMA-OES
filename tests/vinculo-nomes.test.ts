import { describe, expect, it } from "vitest";
import {
  agruparSugestoes,
  compararCadastros,
  cpfsNoNome,
  distanciaEdicao,
  nucleoDoNome,
  type CadastroParaVinculo,
} from "@/server/domain/vinculo-nomes";

let sequencia = 0;
const cad = (nome: string, cpfCnpj: string, pessoaId?: string): CadastroParaVinculo => {
  sequencia += 1;
  return { id: `v${sequencia}`, nome, cpfCnpj, pessoaId: pessoaId ?? `p${sequencia}` };
};

const motivo = (a: CadastroParaVinculo, b: CadastroParaVinculo) => compararCadastros(a, b);

describe("núcleo do nome", () => {
  it("tira sufixo societário e atividade", () => {
    expect(nucleoDoNome("JOSE DE BARROS FELIX JUNIOR PROM DE VENDAS LTDA")).toEqual([
      "JOSE",
      "BARROS",
      "FELIX",
      "JUNIOR",
    ]);
  });

  it("tira acento, número e conectivo", () => {
    expect(nucleoDoNome("LUCAS MENEZES MALTA 11285266625")).toEqual([
      "LUCAS",
      "MENEZES",
      "MALTA",
    ]);
    expect(nucleoDoNome("MARIA DA SILVA DOS SANTOS")).toEqual(["MARIA", "SILVA", "SANTOS"]);
  });

  it("empresa sem nome de pessoa continua sendo o que é", () => {
    expect(nucleoDoNome("GROWING CONSORTIUM LTDA")).toEqual(["GROWING", "CONSORTIUM"]);
  });
});

describe("CPF escrito na razão social", () => {
  it("encontra o CPF de 11 dígitos", () => {
    expect(cpfsNoNome("LUCAS MENEZES MALTA 11285266625")).toEqual(["11285266625"]);
  });

  it("ignora sequências que não têm 11 dígitos", () => {
    expect(cpfsNoNome("EMPRESA 123 LTDA 43139859000199")).toEqual([]);
  });
});

describe("distância de edição", () => {
  it("conta as letras diferentes", () => {
    expect(distanciaEdicao("CARMO", "CARMOS", 2)).toBe(1);
    expect(distanciaEdicao("ABC", "ABC", 2)).toBe(0);
  });

  it("desiste acima do teto em vez de calcular à toa", () => {
    expect(distanciaEdicao("ABCDEFGH", "ZZZZZZZZ", 2)).toBeGreaterThan(2);
  });
});

describe("reconhecimento do mesmo vendedor", () => {
  it("CPF dentro da razão social não deixa dúvida", () => {
    const achado = motivo(
      cad("LUCAS MENEZES MALTA", "11285266625"),
      cad("LUCAS MENEZES MALTA 11285266625", "43139859000199"),
    );
    expect(achado?.confianca).toBe("CERTO");
  });

  it("mesmo nome nos dois cadastros", () => {
    const achado = motivo(
      cad("NIKSON WELLER GOMES RODRIGUES", "01771840609"),
      cad("NIKSON WELLER GOMES RODRIGUES", "59512192000168"),
    );
    expect(achado).toEqual({ confianca: "ALTA", motivo: "Mesmo nome nos dois cadastros" });
  });

  it("razão social com sufixo e atividade", () => {
    const achado = motivo(
      cad("JOSE DE BARROS FELIX JUNIOR", "11441424660"),
      cad("JOSE DE BARROS FELIX JUNIOR PROM DE VENDAS LTDA", "63983995000178"),
    );
    expect(achado?.confianca).toBe("ALTA");
  });

  it("sobrenome abreviado a uma letra", () => {
    const achado = motivo(
      cad("CAMILA STEFANE DE PAIVA FERREIRA PORFIRIO", "15205761610"),
      cad("CAMILA STEFANE DE PAIVA F PORFIRIO", "55635911000187"),
    );
    expect(achado?.confianca).toBe("ALTA");
  });

  it("um sobrenome a mais — nome de casada", () => {
    const achado = motivo(
      cad("TAUANNE SOUZA DOS SANTOS GOMES", "01915845688"),
      cad("TAUANNE SOUZA DOS SANTOS", "55163033000144"),
    );
    expect(achado?.confianca).toBe("ALTA");
  });

  it("espaço faltando entre sobrenomes", () => {
    const achado = motivo(
      cad("VANESSA MENDES MELO SANTANAOLIVEIRA", "15054975667"),
      cad("VANESSA MENDES MELO SANTANA OLIVEIRA", "62276553000129"),
    );
    expect(achado?.confianca).toBe("ALTA");
  });

  it("erro de digitação de uma letra", () => {
    const achado = motivo(
      cad("WANDERSON DO CARMOS CARDOSO SILVA", "05456109662"),
      cad("WANDERSON DO CARMO CARDOSO SILVA", "57668681000188"),
    );
    expect(achado?.confianca).toBe("ALTA");
  });

  it("primeiro e último nome iguais, meio diferente, fica em média", () => {
    const achado = motivo(
      cad("LUANA IZAURITA DE SOUZA", "13454678692"),
      cad("LUANA SOUZA CONSULTORIA EM VENDAS LTDA", "47924036000125"),
    );
    expect(achado?.confianca).toBe("MEDIA");
  });
});

describe("não confunde pessoas diferentes", () => {
  it("mesmo primeiro nome, sobrenomes distintos", () => {
    expect(
      motivo(
        cad("ALINE FONSECA DUTRA", "01396143629"),
        cad("ALINE PEREIRA BASTOS", "63633935000125"),
      ),
    ).toBeNull();
  });

  it("dois nomes compostos que só compartilham o começo", () => {
    expect(
      motivo(
        cad("ANA LUIZA ANDRADE DUARTE", "70298310635"),
        cad("ANA LUIZA PINTO DE CARVALHO", "70314709606"),
      ),
    ).toBeNull();
  });

  it("empresa sem nome de pessoa não casa com ninguém", () => {
    expect(
      motivo(
        cad("GROWING CONSORTIUM LTDA", "51063962000120"),
        cad("GUSTAVO ALVES PEREIRA", "17912941703"),
      ),
    ).toBeNull();
  });

  it("um sobrenome só não basta para sugerir", () => {
    expect(
      motivo(cad("CARLOS COSTA", "13262099651"), cad("KEILA COSTA COELHO", "10937317616")),
    ).toBeNull();
  });
});

describe("agrupamento", () => {
  it("junta os documentos ligados em cadeia", () => {
    const cpf = cad("MARIA SILVA SANTOS", "11111111111");
    const cnpj1 = cad("MARIA SILVA SANTOS", "22222222222222");
    const cnpj2 = cad("MARIA SILVA SANTOS 11111111111", "33333333333333");

    const grupos = agruparSugestoes([cpf, cnpj1, cnpj2]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.vendedorIds.sort()).toEqual([cpf.id, cnpj1.id, cnpj2.id].sort());
  });

  it("a confiança do grupo é a do elo mais fraco", () => {
    const cpf = cad("PEDRO ALVES COSTA", "11111111111");
    const igual = cad("PEDRO ALVES COSTA", "22222222222222");
    const fraco = cad("PEDRO MENDES COSTA", "33333333333333");

    const grupos = agruparSugestoes([cpf, igual, fraco]);

    expect(grupos[0]?.confianca).toBe("MEDIA");
  });

  it("não sugere quem já está na mesma pessoa", () => {
    const cpf = cad("JOAO PAULO LIMA", "11111111111", "pessoa-unica");
    const cnpj = cad("JOAO PAULO LIMA", "22222222222222", "pessoa-unica");

    expect(agruparSugestoes([cpf, cnpj])).toHaveLength(0);
  });

  it("empresa com o primeiro nome do dono, quando o nome é único", () => {
    const dono = cad("JHONATAS CASSIO RODRIGUES DE SOUSA", "13057214622");
    const empresa = cad("JHONATAS INVESTIMENTOS IMOBILIARIOS LTDA", "50566688000140");

    const grupos = agruparSugestoes([dono, empresa]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.confianca).toBe("BAIXA");
  });

  it("primeiro nome repetido não vira sugestão — não há como escolher", () => {
    const empresa = cad("JHONATAS INVESTIMENTOS LTDA", "50566688000140");
    const um = cad("JHONATAS CASSIO RODRIGUES", "13057214622");
    const outro = cad("JHONATAS PEREIRA GOMES", "14057214633");

    expect(agruparSugestoes([empresa, um, outro])).toHaveLength(0);
  });

  it("ordena da maior para a menor confiança", () => {
    const grupos = agruparSugestoes([
      cad("RAFAEL MENDES LIMA", "11111111111"),
      cad("RAFAEL BARROS LIMA", "22222222222222"),
      cad("BEATRIZ ALVES ROCHA", "33333333333"),
      cad("BEATRIZ ALVES ROCHA 33333333333", "44444444444444"),
    ]);

    expect(grupos.map((grupo) => grupo.confianca)).toEqual(["CERTO", "MEDIA"]);
  });
});
