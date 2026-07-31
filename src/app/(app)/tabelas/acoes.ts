"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { exigirPermissao } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { parseDataBr, parseValorBr } from "@/lib/normalize";
import { registrarAuditoria } from "@/server/services/auditoria";
import { apurarComissoesEquipe } from "@/server/services/comissao-equipe";
import { recalcularComissoes } from "@/server/services/recalculo";
import { formatarMoeda, formatarNumero } from "@/lib/format";

export interface EstadoAcao {
  erro?: string;
  sucesso?: string;
}

const CATEGORIAS = ["INICIANTE", "VETERANO", "EXPERT"] as const;

const SEGMENTOS = ["IMOVEL", "AUTOMOVEL"] as const;

/** Vazio no formulário quer dizer "vale para todos os segmentos". */
function lerSegmento(formData: FormData): "IMOVEL" | null | undefined {
  const bruto = String(formData.get("segmento") ?? "").trim();
  if (!bruto) return null;
  if (!SEGMENTOS.includes(bruto as (typeof SEGMENTOS)[number])) return undefined;
  return bruto as "IMOVEL";
}

/**
 * Cria uma nova versão da tabela de comissão. Tabelas anteriores não são
 * alteradas: o cálculo já realizado permanece com os percentuais da época.
 */
export async function acaoCriarTabela(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "criar");

  const nome = String(formData.get("nome") ?? "").trim();
  const categoria = String(formData.get("categoria") ?? "") as (typeof CATEGORIAS)[number];
  const vigenteDe = parseDataBr(String(formData.get("vigenteDe") ?? ""));
  const segmento = lerSegmento(formData);

  if (nome.length < 2) return { erro: "Informe o nome da tabela." };
  if (!CATEGORIAS.includes(categoria)) return { erro: "Categoria inválida." };
  if (!vigenteDe) return { erro: "Informe a data de início de vigência." };
  if (segmento === undefined) return { erro: "Segmento inválido." };

  const faixas: { parcela: number; percentual: string }[] = [];
  for (let parcela = 1; parcela <= 12; parcela += 1) {
    const bruto = String(formData.get(`percentual_${parcela}`) ?? "").trim();
    if (!bruto) continue;
    const valor = parseValorBr(bruto);
    if (valor === null || valor < 0) {
      return { erro: `Percentual inválido na parcela ${parcela}.` };
    }
    if (valor > 0) faixas.push({ parcela, percentual: valor.toFixed(4) });
  }

  if (faixas.length === 0) {
    return { erro: "Informe ao menos um percentual. Parcelas sem percentual não geram comissão." };
  }

  const criada = await prisma.$transaction(async (tx) => {
    // Encerra a vigência da tabela anterior da mesma categoria E DO MESMO
    // SEGMENTO. Imóvel e automóvel convivem: criar a de automóvel não pode
    // encerrar a de imóvel.
    const anterior = await tx.tabelaComissao.findFirst({
      where: { categoria, segmento, ativo: true, vigenteAte: null },
      orderBy: { vigenteDe: "desc" },
    });

    if (anterior) {
      const fim = new Date(vigenteDe);
      fim.setUTCDate(fim.getUTCDate() - 1);
      await tx.tabelaComissao.update({ where: { id: anterior.id }, data: { vigenteAte: fim } });
    }

    return tx.tabelaComissao.create({
      data: {
        nome,
        categoria,
        segmento,
        vigenteDe,
        faixas: {
          create: faixas.map((faixa) => ({
            parcela: faixa.parcela,
            percentual: new Prisma.Decimal(faixa.percentual),
          })),
        },
      },
      include: { faixas: true },
    });
  });

  await registrarAuditoria({
    acao: "MUDANCA_PERCENTUAL",
    entidade: "TabelaComissao",
    entidadeId: criada.id,
    descricao: `Nova tabela de comissão "${nome}" para ${categoria} vigente a partir de ${vigenteDe.toISOString().slice(0, 10)}`,
    dadosDepois: { nome, categoria, segmento, vigenteDe, faixas },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/tabelas");
  return {
    sucesso:
      "Tabela criada. Os cálculos já realizados mantêm os percentuais que estavam vigentes na época.",
  };
}

const PAPEIS = ["VENDEDOR", "SUPERVISOR", "GERENCIA"] as const;

const CONDICOES = ["SEMPRE", "SUPERVISAO_DIFERENTE_GERENCIA", "EQUIPE_HABILITADA"] as const;

/**
 * Cria uma nova versão da tabela de comissão da equipe.
 *
 * Mesma lógica da tabela WR: a vigência anterior é fechada no dia anterior e o
 * que já foi apurado com ela permanece atrelado àquela versão. Os percentuais
 * são inteiramente do cadastro — o sistema não conhece nenhum valor padrão.
 */
export async function acaoCriarTabelaEquipe(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "criar");

  const nome = String(formData.get("nome") ?? "").trim();
  const categoria = String(formData.get("categoria") ?? "") as (typeof CATEGORIAS)[number];
  const vigenteDe = parseDataBr(String(formData.get("vigenteDe") ?? ""));
  const parcelasParaLiberacao = Number(formData.get("parcelasParaLiberacao") ?? 1);
  const segmento = lerSegmento(formData);

  if (nome.length < 2) return { erro: "Informe o nome da tabela." };
  if (!CATEGORIAS.includes(categoria)) return { erro: "Categoria inválida." };
  if (!vigenteDe) return { erro: "Informe a data de início de vigência." };
  if (segmento === undefined) return { erro: "Segmento inválido." };
  if (!Number.isInteger(parcelasParaLiberacao) || parcelasParaLiberacao < 1) {
    return { erro: "As parcelas para liberação devem ser um número inteiro a partir de 1." };
  }

  const regras: { papel: (typeof PAPEIS)[number]; percentual: string; condicao: string }[] = [];

  for (const papel of PAPEIS) {
    const bruto = String(formData.get(`percentual_${papel}`) ?? "").trim();
    if (!bruto) continue;

    const valor = parseValorBr(bruto);
    if (valor === null || valor < 0 || valor > 100) {
      return { erro: `Percentual inválido para ${papel.toLowerCase()}.` };
    }
    if (valor === 0) continue;

    const condicao = String(formData.get(`condicao_${papel}`) ?? "SEMPRE");
    if (!CONDICOES.includes(condicao as (typeof CONDICOES)[number])) {
      return { erro: `Condição inválida para ${papel.toLowerCase()}.` };
    }

    regras.push({ papel, percentual: valor.toFixed(4), condicao });
  }

  if (regras.length === 0) {
    return { erro: "Informe ao menos um percentual. Papéis sem percentual não recebem comissão." };
  }

  const criada = await prisma.$transaction(async (tx) => {
    const anterior = await tx.tabelaComissaoEquipe.findFirst({
      where: { categoria, segmento, ativo: true, vigenteAte: null },
      orderBy: { vigenteDe: "desc" },
    });

    if (anterior) {
      const fim = new Date(vigenteDe);
      fim.setUTCDate(fim.getUTCDate() - 1);
      await tx.tabelaComissaoEquipe.update({ where: { id: anterior.id }, data: { vigenteAte: fim } });
    }

    return tx.tabelaComissaoEquipe.create({
      data: {
        nome,
        categoria,
        segmento,
        vigenteDe,
        parcelasParaLiberacao,
        regras: {
          create: regras.map((regra) => ({
            papel: regra.papel,
            percentual: new Prisma.Decimal(regra.percentual),
            condicao: regra.condicao as "SEMPRE",
          })),
        },
      },
    });
  });

  await registrarAuditoria({
    acao: "MUDANCA_PERCENTUAL",
    entidade: "TabelaComissaoEquipe",
    entidadeId: criada.id,
    descricao: `Nova tabela de comissão da equipe "${nome}" para ${categoria} vigente a partir de ${vigenteDe.toISOString().slice(0, 10)}`,
    dadosDepois: { nome, categoria, segmento, vigenteDe, parcelasParaLiberacao, regras },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  // A apuração roda em seguida: cadastrar a tabela já produz os valores.
  const resumo = await apurarComissoesEquipe({
    usuario: { id: sessao.id, nome: sessao.nome },
    registrarAuditoria: false,
  });

  revalidatePath("/tabelas");
  revalidatePath("/comissoes-equipe");

  return {
    sucesso:
      `Tabela criada e comissões apuradas: ${formatarNumero(resumo.linhasGravadas)} linha(s) sobre ` +
      `${formatarNumero(resumo.cotasComTabela)} venda(s), somando ${formatarMoeda(resumo.valorPrevisto)} previstos.`,
  };
}

/** Marca a equipe para as regras cuja condição é EQUIPE_HABILITADA. */
export async function acaoAlternarEquipeHabilitada(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Equipe não informada." };

  const equipe = await prisma.equipe.findUnique({ where: { id } });
  if (!equipe) return { erro: "Equipe não encontrada." };

  const atualizada = await prisma.equipe.update({
    where: { id },
    data: { habilitadaComissao: !equipe.habilitadaComissao },
  });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "Equipe",
    entidadeId: id,
    descricao: `Equipe "${equipe.nome}" ${atualizada.habilitadaComissao ? "marcada" : "desmarcada"} para as regras condicionais de comissão`,
    dadosAntes: { habilitadaComissao: equipe.habilitadaComissao },
    dadosDepois: { habilitadaComissao: atualizada.habilitadaComissao },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  await apurarComissoesEquipe({
    usuario: { id: sessao.id, nome: sessao.nome },
    registrarAuditoria: false,
  });

  revalidatePath("/tabelas");
  revalidatePath("/comissoes-equipe");

  return {
    sucesso: atualizada.habilitadaComissao
      ? "Equipe marcada. As regras condicionais passam a valer para as vendas dela."
      : "Equipe desmarcada.",
  };
}

const esquemaFlex = z.object({
  nome: z.string().trim().min(2, "Informe o nome da modalidade"),
  percentual: z.string().min(1, "Informe o percentual"),
});

export async function acaoCriarModalidadeFlex(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "criar");

  const parsed = esquemaFlex.safeParse({
    nome: formData.get("nome"),
    percentual: formData.get("percentual"),
  });
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const percentual = parseValorBr(parsed.data.percentual);
  if (percentual === null || percentual <= 0 || percentual > 100) {
    return { erro: "O percentual deve estar entre 0 e 100." };
  }

  const existente = await prisma.modalidadeFlex.findUnique({ where: { nome: parsed.data.nome } });
  if (existente) return { erro: "Já existe uma modalidade com esse nome." };

  const modalidade = await prisma.modalidadeFlex.create({
    data: { nome: parsed.data.nome, percentual: new Prisma.Decimal(percentual.toFixed(4)) },
  });

  await registrarAuditoria({
    acao: "CRIACAO",
    entidade: "ModalidadeFlex",
    entidadeId: modalidade.id,
    descricao: `Modalidade Flex "${modalidade.nome}" criada com ${percentual}%`,
    dadosDepois: { nome: modalidade.nome, percentual },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/tabelas");
  return { sucesso: "Modalidade cadastrada." };
}

export async function acaoAlternarModalidade(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Modalidade não informada." };

  const modalidade = await prisma.modalidadeFlex.findUnique({ where: { id } });
  if (!modalidade) return { erro: "Modalidade não encontrada." };

  const atualizada = await prisma.modalidadeFlex.update({
    where: { id },
    data: { ativo: !modalidade.ativo },
  });

  await registrarAuditoria({
    acao: atualizada.ativo ? "REATIVACAO" : "INATIVACAO",
    entidade: "ModalidadeFlex",
    entidadeId: id,
    descricao: `Modalidade Flex "${modalidade.nome}" ${atualizada.ativo ? "reativada" : "inativada"}`,
    dadosAntes: { ativo: modalidade.ativo },
    dadosDepois: { ativo: atualizada.ativo },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  revalidatePath("/tabelas");
  return { sucesso: atualizada.ativo ? "Modalidade reativada." : "Modalidade inativada." };
}

// ---------------------------------------------------------------------------
// Correção e remoção de tabelas
// ---------------------------------------------------------------------------

/**
 * Corrige uma tabela existente no lugar, em vez de abrir nova vigência.
 *
 * A vigência nova existe para quando o percentual REALMENTE mudou a partir de
 * uma data — o passado continua valendo o que valia. Já uma tabela cadastrada
 * errada nunca deveria ter valido: corrigi-la é o certo, e abrir vigência só
 * eternizaria o engano.
 *
 * O recálculo roda em seguida, porque o que já foi calculado com a tabela
 * errada precisa ser refeito. A auditoria guarda como era antes.
 */
export async function acaoEditarTabela(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Tabela não informada." };

  const nome = String(formData.get("nome") ?? "").trim();
  const vigenteDe = parseDataBr(String(formData.get("vigenteDe") ?? ""));
  const vigenteAteBruto = String(formData.get("vigenteAte") ?? "").trim();
  const vigenteAte = vigenteAteBruto ? parseDataBr(vigenteAteBruto) : null;
  const segmento = lerSegmento(formData);

  if (nome.length < 2) return { erro: "Informe o nome da tabela." };
  if (!vigenteDe) return { erro: "Informe a data de início de vigência." };
  if (vigenteAteBruto && !vigenteAte) return { erro: "Data de fim de vigência inválida." };
  if (vigenteAte && vigenteAte < vigenteDe) {
    return { erro: "A vigência não pode terminar antes de começar." };
  }
  if (segmento === undefined) return { erro: "Segmento inválido." };

  const atual = await prisma.tabelaComissao.findUnique({
    where: { id },
    include: { faixas: { orderBy: { parcela: "asc" } } },
  });
  if (!atual) return { erro: "Tabela não encontrada." };

  const faixas: { parcela: number; percentual: string }[] = [];
  for (let parcela = 1; parcela <= 12; parcela += 1) {
    const bruto = String(formData.get(`percentual_${parcela}`) ?? "").trim();
    if (!bruto) continue;
    const valor = parseValorBr(bruto);
    if (valor === null || valor < 0) {
      return { erro: `Percentual inválido na parcela ${parcela}.` };
    }
    if (valor > 0) faixas.push({ parcela, percentual: valor.toFixed(4) });
  }

  if (faixas.length === 0) {
    return { erro: "Informe ao menos um percentual. Parcelas sem percentual não geram comissão." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.faixaComissao.deleteMany({ where: { tabelaId: id } });
    await tx.tabelaComissao.update({
      where: { id },
      data: {
        nome,
        segmento,
        vigenteDe,
        vigenteAte,
        faixas: {
          create: faixas.map((faixa) => ({
            parcela: faixa.parcela,
            percentual: new Prisma.Decimal(faixa.percentual),
          })),
        },
      },
    });
  });

  await registrarAuditoria({
    acao: "MUDANCA_PERCENTUAL",
    entidade: "TabelaComissao",
    entidadeId: id,
    descricao: `Tabela de comissão "${atual.nome}" corrigida`,
    dadosAntes: {
      nome: atual.nome,
      segmento: atual.segmento,
      vigenteDe: atual.vigenteDe,
      vigenteAte: atual.vigenteAte,
      faixas: atual.faixas.map((faixa) => ({
        parcela: faixa.parcela,
        percentual: faixa.percentual.toString(),
      })),
    },
    dadosDepois: { nome, segmento, vigenteDe, vigenteAte, faixas },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  const resumo = await recalcularComissoes({ id: sessao.id, nome: sessao.nome });

  revalidatePath("/tabelas");
  revalidatePath("/comissoes");
  revalidatePath("/comissoes-equipe");

  return {
    sucesso:
      `Tabela corrigida e comissões recalculadas: ${formatarNumero(resumo.lancamentosAtualizados)} ` +
      `lançamento(s) atualizados, somando ${formatarMoeda(resumo.valorComissaoWr)} de comissão WR.`,
  };
}

/**
 * Apaga uma tabela que nunca foi usada.
 *
 * Tabela que já entrou em algum cálculo não é apagada — apagá-la deixaria o
 * cálculo sem a origem que o justifica. Nesse caso ela é inativada, some das
 * listas e para de valer para vendas novas, mas o vínculo com o que já foi
 * calculado continua de pé.
 */
export async function acaoRemoverTabela(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Tabela não informada." };

  const tabela = await prisma.tabelaComissao.findUnique({
    where: { id },
    select: { id: true, nome: true, categoria: true, _count: { select: { comissoes: true } } },
  });
  if (!tabela) return { erro: "Tabela não encontrada." };

  const emUso = tabela._count.comissoes > 0;

  if (emUso) {
    await prisma.tabelaComissao.update({ where: { id }, data: { ativo: false } });
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.faixaComissao.deleteMany({ where: { tabelaId: id } });
      await tx.tabelaComissao.delete({ where: { id } });
    });
  }

  await registrarAuditoria({
    acao: emUso ? "INATIVACAO" : "ATUALIZACAO",
    entidade: "TabelaComissao",
    entidadeId: id,
    descricao: emUso
      ? `Tabela "${tabela.nome}" inativada — está em ${tabela._count.comissoes} cálculo(s) e por isso não foi apagada`
      : `Tabela "${tabela.nome}" excluída, sem nenhum cálculo associado`,
    dadosAntes: { nome: tabela.nome, categoria: tabela.categoria },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  const resumo = await recalcularComissoes({ id: sessao.id, nome: sessao.nome });

  revalidatePath("/tabelas");
  revalidatePath("/comissoes");
  revalidatePath("/comissoes-equipe");

  return {
    sucesso: emUso
      ? `A tabela já foi usada em ${formatarNumero(tabela._count.comissoes)} cálculo(s), então foi inativada em vez de apagada — ela deixa de valer para vendas novas e o histórico continua rastreável. ${formatarNumero(resumo.lancamentosAtualizados)} lançamento(s) recalculados.`
      : `Tabela excluída. ${formatarNumero(resumo.lancamentosAtualizados)} lançamento(s) recalculados.`,
  };
}

/** Remove uma tabela de comissão da equipe. A apuração é derivada e se refaz. */
export async function acaoRemoverTabelaEquipe(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const sessao = await exigirPermissao("tabelas", "editar");

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Tabela não informada." };

  const tabela = await prisma.tabelaComissaoEquipe.findUnique({
    where: { id },
    select: { id: true, nome: true, categoria: true },
  });
  if (!tabela) return { erro: "Tabela não encontrada." };

  // As regras caem por cascata; a apuração é derivada e se refaz em seguida.
  await prisma.tabelaComissaoEquipe.delete({ where: { id } });

  await registrarAuditoria({
    acao: "ATUALIZACAO",
    entidade: "TabelaComissaoEquipe",
    entidadeId: id,
    descricao: `Tabela de comissão da equipe "${tabela.nome}" excluída`,
    dadosAntes: { nome: tabela.nome, categoria: tabela.categoria },
    usuario: { id: sessao.id, nome: sessao.nome },
  });

  const resumo = await apurarComissoesEquipe({
    usuario: { id: sessao.id, nome: sessao.nome },
    registrarAuditoria: false,
  });

  revalidatePath("/tabelas");
  revalidatePath("/comissoes-equipe");

  return {
    sucesso: `Tabela excluída e comissões reapuradas: ${formatarNumero(resumo.linhasGravadas)} linha(s) sobre ${formatarNumero(resumo.cotasComTabela)} venda(s).`,
  };
}
