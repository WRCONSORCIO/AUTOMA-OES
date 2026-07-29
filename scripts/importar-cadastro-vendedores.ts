/**
 * Aplica o cadastro interno de vendedores (categoria, supervisão e gerência)
 * sobre os vendedores já existentes na base.
 *
 * Os vendedores chegam ao sistema pela importação da base da administradora,
 * que traz o CPF/CNPJ real. Este script complementa esses registros com as
 * informações que só existem na planilha de controle da WR, casando pelo nome.
 *
 * Entrada: CSV com cabeçalho e as colunas VENDEDOR, CATEGORIA, SUPERVISAO e
 * GERENCIA (separador ";" ou ","). Na planilha use "Salvar como → CSV".
 *
 * Uso:
 *   npx tsx scripts/importar-cadastro-vendedores.ts cadastro.csv [--aplicar]
 *
 * Sem `--aplicar` o script apenas simula e mostra o que faria.
 */
import { readFile } from "node:fs/promises";
import type { CategoriaVendedor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarTexto } from "@/lib/normalize";
import { inicioDoDiaUtc } from "@/server/domain/regras";

interface LinhaCadastro {
  vendedor: string;
  categoria: CategoriaVendedor;
  supervisao: string | null;
  gerencia: string | null;
}

const CATEGORIAS: Record<string, CategoriaVendedor> = {
  INICIANTE: "INICIANTE",
  VETERANO: "VETERANO",
  EXPERT: "EXPERT",
};

function lerCsv(conteudo: string): { linhas: LinhaCadastro[]; ignoradas: string[] } {
  const linhasBrutas = conteudo.split(/\r?\n/).filter((linha) => linha.trim().length > 0);
  if (linhasBrutas.length === 0) return { linhas: [], ignoradas: [] };

  const separador = (linhasBrutas[0]!.match(/;/g)?.length ?? 0) > 0 ? ";" : ",";
  const cabecalho = linhasBrutas[0]!.split(separador).map((coluna) => normalizarTexto(coluna));

  const indice = (nomes: string[]) =>
    cabecalho.findIndex((coluna) => nomes.some((nome) => coluna.startsWith(nome)));

  const iVendedor = indice(["VENDEDOR", "NOME"]);
  const iCategoria = indice(["CATEGORIA"]);
  const iSupervisao = indice(["SUPERVISAO", "SUPERVISÃO", "EQUIPE"]);
  const iGerencia = indice(["GERENCIA", "GERÊNCIA"]);

  if (iVendedor < 0 || iCategoria < 0) {
    throw new Error("O CSV precisa conter ao menos as colunas VENDEDOR e CATEGORIA.");
  }

  const linhas: LinhaCadastro[] = [];
  const ignoradas: string[] = [];

  for (const bruta of linhasBrutas.slice(1)) {
    const colunas = bruta.split(separador);
    const nome = colunas[iVendedor]?.trim();
    const categoria = CATEGORIAS[normalizarTexto(colunas[iCategoria])];

    if (!nome || !categoria) {
      if (nome) ignoradas.push(`${nome} — categoria não reconhecida`);
      continue;
    }

    const limpar = (valor: string | undefined) => {
      const texto = valor?.trim();
      return texto && texto !== "—" && texto !== "-" ? texto : null;
    };

    linhas.push({
      vendedor: nome,
      categoria,
      supervisao: iSupervisao >= 0 ? limpar(colunas[iSupervisao]) : null,
      gerencia: iGerencia >= 0 ? limpar(colunas[iGerencia]) : null,
    });
  }

  return { linhas, ignoradas };
}

async function main() {
  const [caminho, ...opcoes] = process.argv.slice(2);
  const aplicar = opcoes.includes("--aplicar");

  if (!caminho) {
    throw new Error("Informe o caminho do CSV de cadastro.");
  }

  const { linhas, ignoradas } = lerCsv(await readFile(caminho, "utf8"));
  console.log(`${linhas.length} linha(s) lida(s)${aplicar ? "" : " (simulação)"}\n`);

  const [vendedores, equipes, gerencias] = await Promise.all([
    prisma.vendedor.findMany({
      select: { id: true, nome: true, categoriaAtual: true, equipeId: true, gerenciaId: true },
    }),
    prisma.equipe.findMany({ select: { id: true, nome: true, gerenciaId: true } }),
    prisma.gerencia.findMany({ select: { id: true, nome: true } }),
  ]);

  // Casamento por nome normalizado; nomes parciais casam por prefixo.
  const porNome = new Map(vendedores.map((v) => [normalizarTexto(v.nome), v]));
  const equipePorNome = new Map(equipes.map((e) => [normalizarTexto(e.nome), e]));
  const gerenciaPorNome = new Map(gerencias.map((g) => [normalizarTexto(g.nome), g]));

  const contadores = { atualizados: 0, semCorrespondencia: 0, semMudanca: 0 };
  const naoEncontrados: string[] = [];

  for (const linha of linhas) {
    const chave = normalizarTexto(linha.vendedor);
    let vendedor = porNome.get(chave);

    if (!vendedor) {
      // A administradora costuma trazer o nome completo; a planilha, o curto.
      const candidatos = vendedores.filter((v) => normalizarTexto(v.nome).startsWith(chave));
      if (candidatos.length === 1) vendedor = candidatos[0];
    }

    if (!vendedor) {
      contadores.semCorrespondencia += 1;
      naoEncontrados.push(linha.vendedor);
      continue;
    }

    const equipe = linha.supervisao
      ? equipePorNome.get(normalizarTexto(linha.supervisao))
      : undefined;
    const gerencia = linha.gerencia
      ? gerenciaPorNome.get(normalizarTexto(linha.gerencia))
      : undefined;

    const mudaCategoria = vendedor.categoriaAtual !== linha.categoria;
    const mudaEquipe = equipe !== undefined && vendedor.equipeId !== equipe.id;
    const mudaGerencia = gerencia !== undefined && vendedor.gerenciaId !== gerencia.id;

    if (!mudaCategoria && !mudaEquipe && !mudaGerencia) {
      contadores.semMudanca += 1;
      continue;
    }

    console.log(
      `${vendedor.nome}: ${mudaCategoria ? `categoria ${vendedor.categoriaAtual} → ${linha.categoria} ` : ""}${
        mudaEquipe ? `equipe → ${equipe!.nome} ` : ""
      }${mudaGerencia ? `gerência → ${gerencia!.nome}` : ""}`.trim(),
    );

    if (aplicar) {
      await prisma.$transaction(async (tx) => {
        if (mudaEquipe || mudaGerencia) {
          await tx.vendedor.update({
            where: { id: vendedor!.id },
            data: {
              equipeId: equipe?.id ?? vendedor!.equipeId,
              gerenciaId: gerencia?.id ?? equipe?.gerenciaId ?? vendedor!.gerenciaId,
            },
          });
        }

        // O histórico de categoria é a fonte do cálculo por venda: só criamos
        // um período quando ainda não existe nenhum para o vendedor.
        const jaTemHistorico = await tx.vendedorCategoriaHistorico.count({
          where: { vendedorId: vendedor!.id },
        });

        if (jaTemHistorico === 0) {
          await tx.vendedorCategoriaHistorico.create({
            data: {
              vendedorId: vendedor!.id,
              categoria: linha.categoria,
              vigenteDe: inicioDoDiaUtc(
                process.env.CADASTRO_VIGENTE_DE
                  ? new Date(process.env.CADASTRO_VIGENTE_DE)
                  : new Date(Date.UTC(2026, 0, 1)),
              ),
              motivo: "Carga do cadastro interno de vendedores",
            },
          });
        }

        await tx.vendedor.update({
          where: { id: vendedor!.id },
          data: { categoriaAtual: linha.categoria },
        });
      });
    }

    contadores.atualizados += 1;
  }

  console.log("\n─── resumo ───");
  console.log(`atualizados........ ${contadores.atualizados}`);
  console.log(`sem mudança........ ${contadores.semMudanca}`);
  console.log(`sem correspondência ${contadores.semCorrespondencia}`);
  if (ignoradas.length > 0) console.log(`linhas ignoradas... ${ignoradas.length}`);

  if (naoEncontrados.length > 0) {
    console.log("\nVendedores da planilha sem correspondência na base:");
    for (const nome of naoEncontrados) console.log(`  · ${nome}`);
    console.log(
      "\nImporte a base da administradora antes, ou cadastre esses vendedores manualmente com o CPF/CNPJ.",
    );
  }

  if (!aplicar) {
    console.log("\nNenhuma alteração foi gravada. Rode de novo com --aplicar para efetivar.");
  }
}

main()
  .catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
