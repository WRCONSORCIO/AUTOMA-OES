import "server-only";
import { prisma } from "@/lib/prisma";
import { formatarDocumento, normalizarDocumento } from "@/lib/normalize";
import { registrarAuditoria } from "@/server/services/auditoria";
import { evento } from "@/shared/events/catalogo";
import { publicar } from "@/shared/events/outbox-prisma";
import { falhaDominio, sucesso, type Resultado } from "@/shared/domain/resultado";
import { planejarPromocao } from "../../domain/rules/promover";
import type { Categoria, DocumentoDaPessoa } from "../../domain/rules/documentos";

/**
 * Aplica a promoção de uma pessoa ao próximo degrau da trilha.
 *
 * **Nada é desativado.** O documento anterior continua vinculado à pessoa e
 * continua recebendo comissão sobre as vendas que já fez. O que muda é por onde
 * entram as vendas novas — e, no degrau de expert, nem isso: o CNPJ de veterano
 * segue vendendo.
 *
 * A promoção também não toca em venda passada. A categoria de cada venda foi
 * congelada na importação e continua respondendo pelo dinheiro daquela venda,
 * exatamente como antes.
 */

export interface EntradaPromover {
  pessoaId: string;
  categoriaAlvo: Exclude<Categoria, "INICIANTE">;
  cpfCnpjNovo: string;
  /** Nome do novo cadastro. Vazio herda o nome da pessoa. */
  nomeNovo?: string | null;
  vigenteDe: Date;
  motivo?: string | null;
}

export interface ResultadoPromocao {
  vendedorNovoId: string;
  resumo: string;
  encerrouParaVenda: string | null;
}

export async function promoverPessoa(
  entrada: EntradaPromover,
  usuario: { id: string; nome: string },
): Promise<Resultado<ResultadoPromocao>> {
  const pessoa = await prisma.pessoa.findUnique({
    where: { id: entrada.pessoaId },
    select: {
      id: true,
      nome: true,
      documentos: {
        select: {
          id: true,
          cpfCnpj: true,
          tipoDocumento: true,
          categoriaAtual: true,
          encerradoParaVendaEm: true,
          equipeId: true,
          gerenciaId: true,
        },
      },
    },
  });

  if (!pessoa) {
    return falhaDominio("PESSOA_NAO_ENCONTRADA", "Pessoa não encontrada.");
  }

  const documento = normalizarDocumento(entrada.cpfCnpjNovo);
  if (!documento) {
    return falhaDominio("DOCUMENTO_INVALIDO", "Informe o CNPJ do novo documento.");
  }

  const emUso = await prisma.vendedor.findUnique({
    where: { cpfCnpj: documento },
    select: { id: true, nome: true, pessoaId: true },
  });
  if (emUso) {
    return falhaDominio(
      "DOCUMENTO_EM_USO",
      `Este CNPJ já está cadastrado para ${emUso.nome}.` +
        (emUso.pessoaId === pessoa.id
          ? " Ele já pertence a esta pessoa."
          : " Se for a mesma pessoa, use a tela de vínculos antes de promover."),
    );
  }

  const documentos: DocumentoDaPessoa[] = pessoa.documentos.map((doc) => ({
    id: doc.id,
    cpfCnpj: doc.cpfCnpj,
    tipo: doc.tipoDocumento,
    categoriaAtual: doc.categoriaAtual,
    encerradoParaVendaEm: doc.encerradoParaVendaEm,
  }));

  const plano = planejarPromocao({
    documentos,
    categoriaAlvo: entrada.categoriaAlvo,
    cpfCnpjNovo: documento,
    vigenteDe: entrada.vigenteDe,
  });
  if (!plano.ok) return plano;

  const { documentoNovo, encerrarParaVenda, resumo } = plano.valor;

  // O documento novo herda equipe e gerência de quem vende hoje: promover não é
  // mudar de time, e deixar o CNPJ sem alocação faria as vendas dele caírem
  // fora de qualquer rateio.
  const referencia =
    pessoa.documentos.find((doc) => !doc.encerradoParaVendaEm && doc.gerenciaId) ??
    pessoa.documentos.find((doc) => doc.gerenciaId) ??
    null;

  const criado = await prisma.$transaction(async (tx) => {
    const novo = await tx.vendedor.create({
      data: {
        nome: entrada.nomeNovo?.trim() || pessoa.nome,
        cpfCnpj: documentoNovo.cpfCnpj,
        cpfCnpjFormatado: formatarDocumento(documentoNovo.cpfCnpj),
        tipoDocumento: "CNPJ",
        categoriaAtual: documentoNovo.categoria,
        pessoaId: pessoa.id,
        equipeId: referencia?.equipeId ?? null,
        gerenciaId: referencia?.gerenciaId ?? null,
        dataEntradaWr: documentoNovo.vigenteDe,
        situacao: "ATIVO",
        observacoes: documentoNovo.vende
          ? null
          : "Documento de expert: não recebe venda. É a identidade pela qual a pessoa recebe supervisão.",
      },
      select: { id: true, nome: true },
    });

    // Período próprio de categoria. Sem isso o documento novo resolveria
    // categoria nula e suas vendas não gerariam comissão.
    await tx.vendedorCategoriaHistorico.create({
      data: {
        pessoaId: pessoa.id,
        vendedorId: novo.id,
        categoria: documentoNovo.categoria,
        vigenteDe: documentoNovo.vigenteDe,
        motivo: entrada.motivo ?? `Promoção a ${documentoNovo.categoria}`,
        usuarioId: usuario.id,
      },
    });

    await tx.vendedorAlocacaoHistorico.create({
      data: {
        vendedorId: novo.id,
        equipeId: referencia?.equipeId ?? null,
        gerenciaId: referencia?.gerenciaId ?? null,
        vigenteDe: documentoNovo.vigenteDe,
        motivo: "Alocação herdada na promoção",
        usuarioId: usuario.id,
      },
    });

    await tx.pessoaVinculoHistorico.create({
      data: {
        pessoaId: pessoa.id,
        vendedorId: novo.id,
        vendedorNome: novo.nome,
        vendedorDocumento: documentoNovo.cpfCnpj,
        acao: "VINCULO",
        motivo: `Documento aberto pela promoção a ${documentoNovo.categoria}`,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
      },
    });

    if (encerrarParaVenda) {
      // Marca que não entra venda NOVA. Não mexe em `situacao`, não mexe em
      // comissão: o documento continua recebendo o que já é dele.
      await tx.vendedor.update({
        where: { id: encerrarParaVenda.vendedorId },
        data: { encerradoParaVendaEm: encerrarParaVenda.em },
      });
    }

    await publicar(tx, [
      evento(
        "comercial.categoria.alterada",
        "Vendedor",
        novo.id,
        {
          vendedorId: novo.id,
          pessoaId: pessoa.id,
          categoria: documentoNovo.categoria,
          vigenteDe: documentoNovo.vigenteDe.toISOString().slice(0, 10),
        },
        { usuarioId: usuario.id, usuarioNome: usuario.nome },
      ),
      evento(
        "comercial.documento.vinculado",
        "Pessoa",
        pessoa.id,
        { pessoaId: pessoa.id, vendedorId: novo.id, automatico: false },
        { usuarioId: usuario.id, usuarioNome: usuario.nome },
      ),
    ]);

    return novo;
  });

  await registrarAuditoria({
    acao: "MUDANCA_CATEGORIA",
    entidade: "Pessoa",
    entidadeId: pessoa.id,
    descricao:
      `${pessoa.nome} promovido a ${documentoNovo.categoria} em ` +
      `${documentoNovo.vigenteDe.toISOString().slice(0, 10)}: ${resumo}`,
    dadosDepois: {
      vendedorNovoId: criado.id,
      cpfCnpj: documentoNovo.cpfCnpj,
      categoria: documentoNovo.categoria,
      vende: documentoNovo.vende,
      encerradoParaVenda: encerrarParaVenda?.vendedorId ?? null,
      motivo: entrada.motivo ?? null,
    },
    usuario,
  });

  return sucesso({
    vendedorNovoId: criado.id,
    resumo,
    encerrouParaVenda: encerrarParaVenda?.vendedorId ?? null,
  });
}
