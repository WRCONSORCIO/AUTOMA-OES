import { describe, expect, it } from "vitest";
import { planejarPromocao } from "@/modules/comercial/domain/rules/promover";
import type { DocumentoDaPessoa } from "@/modules/comercial/domain/rules/documentos";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const cpf: DocumentoDaPessoa = {
  id: "cpf",
  cpfCnpj: "11122233344",
  tipo: "CPF",
  categoriaAtual: "INICIANTE",
  encerradoParaVendaEm: null,
};

const cnpjVeterano: DocumentoDaPessoa = {
  id: "cnpj1",
  cpfCnpj: "11222333000181",
  tipo: "CNPJ",
  categoriaAtual: "VETERANO",
  encerradoParaVendaEm: null,
};

const CNPJ_NOVO = "99887766000199";

describe("promoção a veterano", () => {
  const plano = planejarPromocao({
    documentos: [cpf],
    categoriaAlvo: "VETERANO",
    cpfCnpjNovo: CNPJ_NOVO,
    vigenteDe: dia("2025-03-01"),
  });

  it("abre um CNPJ que vende, como veterano", () => {
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    expect(plano.valor.documentoNovo.categoria).toBe("VETERANO");
    expect(plano.valor.documentoNovo.vende).toBe(true);
  });

  it("o CPF para de receber venda nova na véspera da estreia do CNPJ", () => {
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    expect(plano.valor.encerrarParaVenda?.vendedorId).toBe("cpf");
    expect(plano.valor.encerrarParaVenda?.em).toEqual(dia("2025-02-28"));
  });

  it("o resumo deixa claro que o CPF continua RECEBENDO", () => {
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    expect(plano.valor.resumo).toMatch(/continua recebendo/i);
  });

  it("pessoa sem CPF não tem nada a encerrar", () => {
    const semCpf = planejarPromocao({
      documentos: [],
      categoriaAlvo: "VETERANO",
      cpfCnpjNovo: CNPJ_NOVO,
      vigenteDe: dia("2025-03-01"),
    });
    expect(semCpf.ok).toBe(true);
    if (semCpf.ok) expect(semCpf.valor.encerrarParaVenda).toBeNull();
  });
});

describe("promoção a expert", () => {
  const plano = planejarPromocao({
    documentos: [{ ...cpf, encerradoParaVendaEm: dia("2024-12-31") }, cnpjVeterano],
    categoriaAlvo: "EXPERT",
    cpfCnpjNovo: CNPJ_NOVO,
    vigenteDe: dia("2025-06-01"),
  });

  it("NÃO encerra o CNPJ veterano — ele continua vendendo", () => {
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    expect(plano.valor.encerrarParaVenda).toBeNull();
  });

  it("o CNPJ de expert não vende: é identidade de supervisão", () => {
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    expect(plano.valor.documentoNovo.categoria).toBe("EXPERT");
    expect(plano.valor.documentoNovo.vende).toBe(false);
  });

  it("o resumo explica que o veterano segue vendendo", () => {
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    expect(plano.valor.resumo).toMatch(/veterano continua vendendo/i);
  });
});

describe("o que a promoção recusa", () => {
  it("recusa CPF como documento novo — os dois degraus abrem CNPJ", () => {
    const plano = planejarPromocao({
      documentos: [cpf],
      categoriaAlvo: "VETERANO",
      cpfCnpjNovo: "55566677788",
      vigenteDe: dia("2025-03-01"),
    });
    expect(plano.ok).toBe(false);
    if (!plano.ok) expect(plano.erro.codigo).toBe("PROMOCAO_EXIGE_CNPJ");
  });

  it("recusa o terceiro CNPJ — a trilha tem dois degraus", () => {
    const plano = planejarPromocao({
      documentos: [
        cpf,
        cnpjVeterano,
        { ...cnpjVeterano, id: "cnpj2", cpfCnpj: "11222333000262", categoriaAtual: "EXPERT" },
      ],
      categoriaAlvo: "EXPERT",
      cpfCnpjNovo: CNPJ_NOVO,
      vigenteDe: dia("2025-06-01"),
    });
    expect(plano.ok).toBe(false);
    if (!plano.ok) expect(plano.erro.codigo).toBe("PESSOA_JA_TEM_DOIS_CNPJ");
  });

  it("recusa promover ao degrau que a pessoa já alcançou", () => {
    const plano = planejarPromocao({
      documentos: [cpf, cnpjVeterano],
      categoriaAlvo: "VETERANO",
      cpfCnpjNovo: CNPJ_NOVO,
      vigenteDe: dia("2025-06-01"),
    });
    expect(plano.ok).toBe(false);
    if (!plano.ok) expect(plano.erro.codigo).toBe("DEGRAU_JA_ALCANCADO");
  });

  it("recusa documento que já é da própria pessoa, e aponta o caminho certo", () => {
    const plano = planejarPromocao({
      documentos: [cpf, cnpjVeterano],
      categoriaAlvo: "EXPERT",
      cpfCnpjNovo: cnpjVeterano.cpfCnpj,
      vigenteDe: dia("2025-06-01"),
    });
    expect(plano.ok).toBe(false);
    if (!plano.ok) {
      expect(plano.erro.codigo).toBe("DOCUMENTO_JA_VINCULADO");
      expect(plano.erro.mensagem).toMatch(/alteração de categoria/i);
    }
  });

  it("aceita CNPJ com máscara", () => {
    const plano = planejarPromocao({
      documentos: [cpf],
      categoriaAlvo: "VETERANO",
      cpfCnpjNovo: "99.887.766/0001-99",
      vigenteDe: dia("2025-03-01"),
    });
    expect(plano.ok).toBe(true);
    if (plano.ok) expect(plano.valor.documentoNovo.cpfCnpj).toBe("99887766000199");
  });
});
