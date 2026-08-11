import { falhaDominio, sucesso, type Resultado } from "@/shared/domain/resultado";
import { encerramentoAnterior, inicioDoDia } from "@/shared/domain/periodo";
import {
  podeAcrescentarDocumento,
  tipoDoDocumento,
  type Categoria,
  type DocumentoDaPessoa,
} from "./documentos";

/**
 * O que acontece quando alguém é promovido.
 *
 * A promoção **não desativa nada**. O documento anterior continua existindo,
 * continua vinculado à pessoa e — o que mais importa — **continua recebendo
 * comissão sobre as vendas que já fez**. A promoção só decide por onde entram
 * as vendas NOVAS.
 *
 * Os dois degraus se comportam de forma diferente, e a diferença é da WR:
 *
 * | Degrau | Documento novo | O anterior |
 * |---|---|---|
 * | Iniciante → Veterano | CNPJ que passa a vender | CPF **para de vender**, segue recebendo |
 * | Veterano → Expert | CNPJ que **não vende** | CNPJ veterano **continua vendendo** normalmente |
 *
 * No segundo degrau nada é encerrado: o expert vende pelo CNPJ de veterano, e o
 * CNPJ de expert existe para ser a identidade pela qual ele recebe supervisão.
 *
 * Módulo puro: sem banco, sem I/O. Devolve o plano; quem aplica é o caso de uso.
 */

export interface PlanoPromocao {
  /** Documento a criar, com a categoria do degrau alcançado. */
  readonly documentoNovo: {
    readonly cpfCnpj: string;
    readonly tipo: "CPF" | "CNPJ";
    readonly categoria: Categoria;
    readonly vigenteDe: Date;
    /** Falso para o CNPJ de expert: ele é identidade de supervisão. */
    readonly vende: boolean;
  };
  /**
   * Documento que deixa de receber venda nova. Nulo quando nenhum deixa.
   *
   * Nunca significa desativar: o documento segue recebendo o que já é dele.
   */
  readonly encerrarParaVenda: {
    readonly vendedorId: string;
    readonly em: Date;
  } | null;
  readonly resumo: string;
}

export interface EntradaPromocao {
  readonly documentos: readonly DocumentoDaPessoa[];
  readonly categoriaAlvo: Exclude<Categoria, "INICIANTE">;
  readonly cpfCnpjNovo: string;
  /** Data em que o documento novo passa a valer. */
  readonly vigenteDe: Date;
}

/**
 * Monta o plano da promoção, ou explica por que ela não pode acontecer.
 *
 * Valida antes de qualquer escrita porque promover é caro de desfazer: cria
 * cadastro, abre vigência e muda por onde o dinheiro entra.
 */
export function planejarPromocao(
  entrada: EntradaPromocao,
): Resultado<PlanoPromocao> {
  const tipo = tipoDoDocumento(entrada.cpfCnpjNovo);
  if (tipo !== "CNPJ") {
    return falhaDominio(
      "PROMOCAO_EXIGE_CNPJ",
      "Os dois degraus da trilha abrem um CNPJ. Informe um CNPJ válido, com 14 dígitos.",
    );
  }

  const jaExiste = entrada.documentos.some(
    (doc) => doc.cpfCnpj.replace(/\D/g, "") === entrada.cpfCnpjNovo.replace(/\D/g, ""),
  );

  // Promover um documento que a pessoa já tem é caso legítimo, e o mais comum
  // de todos: o vendedor abre o CNPJ e vende por ele antes de alguém registrar
  // a promoção aqui, e a importação da base cria o cadastro sozinha. Quando o
  // registro finalmente é feito, exigir um CNPJ "novo" é exigir um que não
  // existe — era o que travava quem já era veterano ou expert na prática.
  //
  // O limite de documentos só vale quando um documento é acrescentado. Promover
  // o que já está lá não acrescenta nada.
  if (!jaExiste) {
    const limite = podeAcrescentarDocumento(entrada.documentos, "CNPJ");
    if (!limite.ok) return limite;
  }

  const jaTemCategoria = entrada.documentos.some(
    (doc) => doc.categoriaAtual === entrada.categoriaAlvo,
  );
  if (jaTemCategoria) {
    return falhaDominio(
      "DEGRAU_JA_ALCANCADO",
      `Esta pessoa já tem um documento ${entrada.categoriaAlvo}. Cada degrau é alcançado uma vez só.`,
    );
  }

  const vigenteDe = inicioDoDia(entrada.vigenteDe);

  if (entrada.categoriaAlvo === "VETERANO") {
    // O CPF para de receber venda nova na véspera da estreia do CNPJ, para que
    // não exista um dia em que os dois estejam vendendo.
    const cpf = entrada.documentos.find((doc) => doc.tipo === "CPF");

    return sucesso({
      documentoNovo: {
        cpfCnpj: entrada.cpfCnpjNovo.replace(/\D/g, ""),
        tipo: "CNPJ",
        categoria: "VETERANO",
        vigenteDe,
        vende: true,
      },
      encerrarParaVenda: cpf
        ? { vendedorId: cpf.id, em: encerramentoAnterior(vigenteDe) ?? vigenteDe }
        : null,
      resumo: cpf
        ? "Abre o CNPJ de veterano e o CPF deixa de receber venda nova. O CPF continua recebendo a comissão das vendas que já fez."
        : "Abre o CNPJ de veterano. A pessoa não tem CPF cadastrado, então nada deixa de vender.",
    });
  }

  // Veterano → Expert. Nada é encerrado: quem vende continua sendo o CNPJ de
  // veterano, e o CNPJ de expert nasce como identidade de supervisão.
  return sucesso({
    documentoNovo: {
      cpfCnpj: entrada.cpfCnpjNovo.replace(/\D/g, ""),
      tipo: "CNPJ",
      categoria: "EXPERT",
      vigenteDe,
      vende: false,
    },
    encerrarParaVenda: null,
    resumo:
      "Abre o CNPJ de expert, que não vende — é a identidade pela qual a pessoa recebe supervisão. O CNPJ de veterano continua vendendo e recebendo normalmente.",
  });
}
