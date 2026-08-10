/**
 * Aplica o cadastro interno de vendedores (categoria, equipe e gerência) sobre
 * os vendedores já existentes na base.
 *
 * Os vendedores chegam ao sistema pela importação da base da administradora,
 * que traz o CPF/CNPJ real. Este script complementa esses registros com o que
 * só existe no controle da WR, casando pelo nome.
 *
 * Aceita dois formatos, reconhecidos pelo cabeçalho:
 *
 *   1. Planilha de cadastro — uma linha por vendedor:
 *      VENDEDOR ; CATEGORIA ; SUPERVISAO ; GERENCIA
 *
 *   2. Controle de clientes — uma linha por COTA, com o vendedor repetido:
 *      Cliente ; Grupo ; Cota ; ... ; Vendedor ; Equipe ; Gerência ; ...
 *      Não traz categoria; preenche apenas equipe e gerência.
 *
 * Uso:
 *   npx tsx scripts/importar-cadastro-vendedores.ts arquivo.csv [--aplicar] [--criar-estrutura]
 *
 * Sem `--aplicar` o script apenas simula. `--criar-estrutura` cria as equipes e
 * gerências citadas no arquivo que ainda não existem.
 */
import { readFile } from "node:fs/promises";
import type { CategoriaVendedor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarTexto } from "@/lib/normalize";
import { inicioDoDiaUtc } from "@/server/domain/regras";

interface LinhaCadastro {
  vendedor: string;
  /** Nulo quando o arquivo não informa categoria — o controle de clientes não traz. */
  categoria: CategoriaVendedor | null;
  supervisao: string | null;
  gerencia: string | null;
}

interface LeituraCadastro {
  linhas: LinhaCadastro[];
  ignoradas: string[];
  /** Vendedor que aparece com equipe ou gerência diferente em linhas distintas. */
  conflitos: string[];
  temCategoria: boolean;
  totalLinhasArquivo: number;
}

const CATEGORIAS: Record<string, CategoriaVendedor> = {
  INICIANTE: "INICIANTE",
  VETERANO: "VETERANO",
  EXPERT: "EXPERT",
};

function limpar(valor: string | undefined): string | null {
  const texto = valor?.trim().replace(/^"|"$/g, "").trim();
  return texto && texto !== "—" && texto !== "-" ? texto : null;
}

function lerCsv(conteudo: string): LeituraCadastro {
  // O Excel salva UTF-8 com BOM, e o BOM gruda na primeira coluna do cabeçalho.
  const linhasBrutas = conteudo
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((linha) => linha.trim().length > 0);

  if (linhasBrutas.length === 0) {
    return { linhas: [], ignoradas: [], conflitos: [], temCategoria: false, totalLinhasArquivo: 0 };
  }

  const separador = (linhasBrutas[0]!.match(/;/g)?.length ?? 0) > 0 ? ";" : ",";
  const cabecalho = linhasBrutas[0]!
    .split(separador)
    .map((coluna) => normalizarTexto(coluna.replace(/^"|"$/g, "")));

  const indice = (nomes: string[]) =>
    cabecalho.findIndex((coluna) => nomes.some((nome) => coluna.startsWith(nome)));

  const iVendedor = indice(["VENDEDOR", "NOME"]);
  const iCategoria = indice(["CATEGORIA"]);
  const iSupervisao = indice(["SUPERVISAO", "EQUIPE"]);
  const iGerencia = indice(["GERENCIA"]);

  if (iVendedor < 0) {
    throw new Error(
      "O arquivo precisa ter uma coluna VENDEDOR (ou Vendedor, no controle de clientes).\n" +
        `Colunas encontradas: ${cabecalho.join(", ")}`,
    );
  }
  if (iCategoria < 0 && iSupervisao < 0 && iGerencia < 0) {
    throw new Error(
      "O arquivo não traz CATEGORIA, EQUIPE nem GERÊNCIA — não há o que aplicar.",
    );
  }

  // Uma linha por vendedor. O controle de clientes repete o vendedor em cada
  // cota dele, então a mesma informação chega centenas de vezes.
  const porVendedor = new Map<string, LinhaCadastro>();
  const ignoradas: string[] = [];
  const conflitos = new Set<string>();

  for (const bruta of linhasBrutas.slice(1)) {
    const colunas = bruta.split(separador);
    const nome = limpar(colunas[iVendedor]);
    if (!nome) continue;

    const categoria =
      iCategoria >= 0 ? (CATEGORIAS[normalizarTexto(colunas[iCategoria])] ?? null) : null;

    if (iCategoria >= 0 && !categoria) {
      ignoradas.push(`${nome} — categoria não reconhecida`);
      continue;
    }

    const nova: LinhaCadastro = {
      vendedor: nome,
      categoria,
      supervisao: iSupervisao >= 0 ? limpar(colunas[iSupervisao]) : null,
      gerencia: iGerencia >= 0 ? limpar(colunas[iGerencia]) : null,
    };

    const chave = normalizarTexto(nome);
    const anterior = porVendedor.get(chave);

    if (!anterior) {
      porVendedor.set(chave, nova);
      continue;
    }

    // Divergência entre linhas do mesmo vendedor é dado sujo, e escolher uma
    // delas em silêncio esconderia o problema. Fica registrado e a primeira
    // leitura prevalece — trocar de equipe é decisão de gente.
    if (
      (nova.supervisao && anterior.supervisao && nova.supervisao !== anterior.supervisao) ||
      (nova.gerencia && anterior.gerencia && nova.gerencia !== anterior.gerencia) ||
      (nova.categoria && anterior.categoria && nova.categoria !== anterior.categoria)
    ) {
      conflitos.add(
        `${nome}: ${anterior.supervisao ?? "—"}/${anterior.gerencia ?? "—"} vs ` +
          `${nova.supervisao ?? "—"}/${nova.gerencia ?? "—"}`,
      );
    }
  }

  return {
    linhas: [...porVendedor.values()],
    ignoradas,
    conflitos: [...conflitos],
    temCategoria: iCategoria >= 0,
    totalLinhasArquivo: linhasBrutas.length - 1,
  };
}

async function main() {
  const [caminho, ...opcoes] = process.argv.slice(2);
  const aplicar = opcoes.includes("--aplicar");
  const criarEstrutura = opcoes.includes("--criar-estrutura");

  if (!caminho) {
    throw new Error("Informe o caminho do CSV de cadastro.");
  }

  const leitura = lerCsv(await readFile(caminho, "utf8"));
  console.log(
    `${leitura.totalLinhasArquivo} linha(s) no arquivo → ${leitura.linhas.length} vendedor(es)` +
      `${aplicar ? "" : " (simulação)"}`,
  );
  if (!leitura.temCategoria) {
    console.log(
      "O arquivo não traz CATEGORIA: serão preenchidas apenas equipe e gerência.\n" +
        "Sem categoria as vendas continuam sem gerar comissão — resolva pela tela de Pendências.",
    );
  }
  console.log("");

  const [vendedores, equipes, gerencias] = await Promise.all([
    prisma.vendedor.findMany({
      select: { id: true, nome: true, categoriaAtual: true, equipeId: true, gerenciaId: true },
    }),
    prisma.equipe.findMany({ select: { id: true, nome: true, gerenciaId: true } }),
    prisma.gerencia.findMany({ select: { id: true, nome: true } }),
  ]);

  const porNome = new Map(vendedores.map((v) => [normalizarTexto(v.nome), v]));
  const equipePorNome = new Map(equipes.map((e) => [normalizarTexto(e.nome), e]));
  const gerenciaPorNome = new Map(gerencias.map((g) => [normalizarTexto(g.nome), g]));

  // --- Estrutura citada no arquivo que ainda não existe ---------------------
  //
  // A equipe pertence a uma gerência, e o arquivo diz qual: é a gerência que
  // aparece nas linhas daquela equipe. Criar a equipe sem isso a deixaria
  // órfã e as vendas dela fora de qualquer rateio.
  const gerenciaDaEquipe = new Map<string, string>();
  for (const linha of leitura.linhas) {
    if (linha.supervisao && linha.gerencia) {
      gerenciaDaEquipe.set(linha.supervisao, linha.gerencia);
    }
  }

  const gerenciasFaltando = [
    ...new Set(
      leitura.linhas
        .map((l) => l.gerencia)
        .filter((g): g is string => Boolean(g) && !gerenciaPorNome.has(normalizarTexto(g!))),
    ),
  ];
  const equipesFaltando = [
    ...new Set(
      leitura.linhas
        .map((l) => l.supervisao)
        .filter((e): e is string => Boolean(e) && !equipePorNome.has(normalizarTexto(e!))),
    ),
  ];

  if (gerenciasFaltando.length > 0 || equipesFaltando.length > 0) {
    console.log("─── estrutura citada no arquivo que não existe na base ───");
    if (gerenciasFaltando.length) console.log(`gerências: ${gerenciasFaltando.join(", ")}`);
    if (equipesFaltando.length) console.log(`equipes..: ${equipesFaltando.join(", ")}`);

    if (criarEstrutura && aplicar) {
      for (const nome of gerenciasFaltando) {
        const criada = await prisma.gerencia.create({ data: { nome } });
        gerenciaPorNome.set(normalizarTexto(nome), criada);
        console.log(`  criada gerência ${nome}`);
      }
      for (const nome of equipesFaltando) {
        const nomeGerencia = gerenciaDaEquipe.get(nome);
        const gerencia = nomeGerencia
          ? gerenciaPorNome.get(normalizarTexto(nomeGerencia))
          : undefined;
        if (!gerencia) {
          console.log(`  equipe ${nome} NÃO criada: o arquivo não diz a gerência dela`);
          continue;
        }
        const criada = await prisma.equipe.create({
          data: { nome, gerenciaId: gerencia.id },
        });
        equipePorNome.set(normalizarTexto(nome), criada);
        console.log(`  criada equipe ${nome} sob ${gerencia.nome}`);
      }
    } else if (criarEstrutura) {
      console.log("  (seriam criadas com --aplicar)");
    } else {
      console.log("  use --criar-estrutura para criá-las junto");
    }
    console.log("");
  }

  const contadores = { atualizados: 0, semCorrespondencia: 0, semMudanca: 0, ambiguos: 0 };
  const naoEncontrados: string[] = [];
  const ambiguos: string[] = [];

  for (const linha of leitura.linhas) {
    const chave = normalizarTexto(linha.vendedor);
    let vendedor = porNome.get(chave);

    if (!vendedor) {
      // A administradora costuma trazer o nome completo; o controle, o curto.
      const candidatos = vendedores.filter((v) => normalizarTexto(v.nome).startsWith(chave));
      if (candidatos.length === 1) {
        vendedor = candidatos[0];
      } else if (candidatos.length > 1) {
        // Escolher um entre homônimos atribuiria vendas à pessoa errada.
        contadores.ambiguos += 1;
        ambiguos.push(`${linha.vendedor} → ${candidatos.map((c) => c.nome).join(" | ")}`);
        continue;
      }
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

    const mudaCategoria = linha.categoria !== null && vendedor.categoriaAtual !== linha.categoria;
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
      const alvo = vendedor;
      await prisma.$transaction(async (tx) => {
        if (mudaEquipe || mudaGerencia) {
          await tx.vendedor.update({
            where: { id: alvo.id },
            data: {
              equipeId: equipe?.id ?? alvo.equipeId,
              gerenciaId: gerencia?.id ?? equipe?.gerenciaId ?? alvo.gerenciaId,
            },
          });

          // A alocação é resolvida por vigência na data da venda; sem período
          // no histórico o rateio cairia na alocação atual para todo o passado.
          await tx.vendedorAlocacaoHistorico.create({
            data: {
              vendedorId: alvo.id,
              equipeId: equipe?.id ?? alvo.equipeId,
              gerenciaId: gerencia?.id ?? equipe?.gerenciaId ?? alvo.gerenciaId,
              vigenteDe: vigenciaInicial(),
              motivo: "Carga do cadastro interno de vendedores",
            },
          });
        }

        if (linha.categoria) {
          // O histórico de categoria é a fonte do cálculo por venda: só se cria
          // um período quando ainda não existe nenhum para o documento.
          const jaTemHistorico = await tx.vendedorCategoriaHistorico.count({
            where: { vendedorId: alvo.id },
          });

          if (jaTemHistorico === 0) {
            await tx.vendedorCategoriaHistorico.create({
              data: {
                vendedorId: alvo.id,
                categoria: linha.categoria,
                vigenteDe: vigenciaInicial(),
                motivo: "Carga do cadastro interno de vendedores",
              },
            });
          }

          await tx.vendedor.update({
            where: { id: alvo.id },
            data: { categoriaAtual: linha.categoria },
          });
        }
      });
    }

    contadores.atualizados += 1;
  }

  console.log("\n─── resumo ───");
  console.log(`atualizados........ ${contadores.atualizados}`);
  console.log(`sem mudança........ ${contadores.semMudanca}`);
  console.log(`sem correspondência ${contadores.semCorrespondencia}`);
  if (contadores.ambiguos > 0) console.log(`ambíguos........... ${contadores.ambiguos}`);
  if (leitura.ignoradas.length > 0) console.log(`linhas ignoradas... ${leitura.ignoradas.length}`);

  if (leitura.conflitos.length > 0) {
    console.log("\nVendedores com equipe/gerência divergente entre linhas do arquivo:");
    for (const conflito of leitura.conflitos) console.log(`  · ${conflito}`);
    console.log("  Prevaleceu a primeira leitura. Confira a origem do arquivo.");
  }

  if (ambiguos.length > 0) {
    console.log("\nNomes que casam com mais de um cadastro — nada foi alterado neles:");
    for (const item of ambiguos) console.log(`  · ${item}`);
  }

  if (naoEncontrados.length > 0) {
    console.log(`\n${naoEncontrados.length} vendedor(es) do arquivo sem correspondência na base:`);
    for (const nome of naoEncontrados.slice(0, 20)) console.log(`  · ${nome}`);
    if (naoEncontrados.length > 20) console.log(`  … e mais ${naoEncontrados.length - 20}`);
    console.log(
      "\nImporte a base da administradora antes, ou cadastre esses vendedores com o CPF/CNPJ.",
    );
  }

  if (!aplicar) {
    console.log("\nNenhuma alteração foi gravada. Rode de novo com --aplicar para efetivar.");
  }
}

/**
 * Data em que os períodos criados pela carga passam a valer.
 *
 * Precisa cobrir as vendas já importadas, senão a alocação e a categoria
 * resolvem nulo para elas. Ajustável por `CADASTRO_VIGENTE_DE`.
 */
function vigenciaInicial(): Date {
  return inicioDoDiaUtc(
    process.env.CADASTRO_VIGENTE_DE
      ? new Date(process.env.CADASTRO_VIGENTE_DE)
      : new Date(Date.UTC(2020, 0, 1)),
  );
}

main()
  .catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
