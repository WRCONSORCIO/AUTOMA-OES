import "server-only";
import { prisma } from "@/lib/prisma";
import {
  avaliarPromocao,
  type AptidaoPromocao,
  type MetaPromocao,
} from "../../domain/rules/promocao";
import {
  consolidarPessoas,
  type ConsolidadoPessoa,
} from "../../infrastructure/queries/consolidado-pessoa";

/**
 * Quem está apto ao próximo degrau da trilha.
 *
 * Alimenta o cartão "Vendedores aptos para promoção" do Dashboard e a lista do
 * módulo Comercial. Nunca promove sozinho: promoção abre documento novo e muda
 * quanto a pessoa recebe daí em diante, então é decisão de gente.
 */

export interface PessoaComAptidao extends ConsolidadoPessoa {
  aptidao: AptidaoPromocao;
}

export async function carregarMetas(): Promise<MetaPromocao[]> {
  const linhas = await prisma.metaPromocao.findMany({
    orderBy: { vigenteDe: "desc" },
  });

  return linhas
    .filter((linha) => linha.categoriaAlvo !== "INICIANTE")
    .map((linha) => ({
      id: linha.id,
      categoriaAlvo: linha.categoriaAlvo as "VETERANO" | "EXPERT",
      volumeMinimo: Number(linha.volumeMinimo),
      abreDocumento: linha.abreDocumento,
      vigenteDe: linha.vigenteDe,
      vigenteAte: linha.vigenteAte,
    }));
}

export async function avaliarPessoas(opcoes: {
  pessoaIds?: string[];
  gerenciaId?: string;
  equipeId?: string;
  limite?: number;
  busca?: string;
  em?: Date;
} = {}): Promise<PessoaComAptidao[]> {
  const [pessoas, metas] = await Promise.all([
    consolidarPessoas(opcoes),
    carregarMetas(),
  ]);

  const em = opcoes.em ?? new Date();

  return pessoas.map((pessoa) => ({
    ...pessoa,
    aptidao: avaliarPromocao(
      {
        pessoaId: pessoa.pessoaId,
        nome: pessoa.nome,
        categoriaAtual: pessoa.categoriaAtual,
        volumeAcumulado: pessoa.volumeVendido,
        documentosCnpj: pessoa.documentosCnpj,
      },
      metas,
      em,
    ),
  }));
}

/**
 * Só os aptos, ordenados por quem passou mais longe da meta.
 *
 * Quem estourou o limite há mais tempo é quem está sendo pago errado há mais
 * tempo — é a fila que o RH precisa atacar primeiro.
 */
export async function aptosParaPromocao(opcoes: {
  gerenciaId?: string;
  equipeId?: string;
  limite?: number;
} = {}): Promise<PessoaComAptidao[]> {
  const todas = await avaliarPessoas({ ...opcoes, limite: opcoes.limite ?? 1000 });
  return todas
    .filter((pessoa) => pessoa.aptidao.apto)
    .sort((a, b) => a.aptidao.faltam - b.aptidao.faltam);
}

export async function contarAptosParaPromocao(opcoes: {
  gerenciaId?: string;
  equipeId?: string;
} = {}): Promise<number> {
  const aptos = await aptosParaPromocao(opcoes);
  return aptos.length;
}
