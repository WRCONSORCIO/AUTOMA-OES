import { NextResponse } from "next/server";
import { lerSessao } from "@/server/auth/session";
import { podeAcessar } from "@/server/auth/rbac";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { importarBaseCsv } from "@/server/importacao/importar-base";
import { importarComissaoPdf } from "@/server/importacao/importar-comissao";
import { importarBonusPdf } from "@/server/importacao/importar-bonus";
import { importarComissaoVendedorPdf } from "@/server/importacao/importar-comissao-vendedor";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Recebe o arquivo da administradora. O upload passa por rota de API — e não
 * por server action — para suportar arquivos grandes sem o limite padrão de
 * corpo das actions.
 */
export async function POST(requisicao: Request) {
  const sessao = await lerSessao();
  if (!sessao) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }
  if (!podeAcessar(sessao.perfil, "importacoes", "criar")) {
    return NextResponse.json({ erro: "Sem permissão para importar." }, { status: 403 });
  }

  const formulario = await requisicao.formData();
  const arquivo = formulario.get("arquivo");
  const tipo = String(formulario.get("tipo") ?? "");
  const administradoraId = String(formulario.get("administradoraId") ?? "");

  if (!(arquivo instanceof File)) {
    return NextResponse.json({ erro: "Selecione um arquivo." }, { status: 400 });
  }
  if (!administradoraId) {
    return NextResponse.json({ erro: "Selecione a administradora." }, { status: 400 });
  }

  const limite = env().UPLOAD_MAX_BYTES;
  if (arquivo.size > limite) {
    return NextResponse.json(
      { erro: `Arquivo acima do limite de ${Math.round(limite / 1024 / 1024)} MB.` },
      { status: 413 },
    );
  }

  const administradora = await prisma.administradora.findUnique({
    where: { id: administradoraId },
    select: { id: true },
  });
  if (!administradora) {
    return NextResponse.json({ erro: "Administradora não encontrada." }, { status: 400 });
  }

  const conteudo = Buffer.from(await arquivo.arrayBuffer());
  const usuario = { id: sessao.id, nome: sessao.nome };

  try {
    if (tipo === "BASE_CSV") {
      const resumo = await importarBaseCsv({
        arquivo: conteudo,
        nomeArquivo: arquivo.name,
        administradoraId,
        usuario,
      });
      return NextResponse.json({ tipo, resumo });
    }

    if (tipo === "COMISSAO_PDF") {
      const resumo = await importarComissaoPdf({
        arquivo: conteudo,
        nomeArquivo: arquivo.name,
        administradoraId,
        usuario,
      });
      return NextResponse.json({ tipo, resumo });
    }

    if (tipo === "BONUS_PDF") {
      const resumo = await importarBonusPdf({
        arquivo: conteudo,
        nomeArquivo: arquivo.name,
        administradoraId,
        usuario,
      });
      return NextResponse.json({ tipo, resumo });
    }

    if (tipo === "COMISSAO_VENDEDOR_PDF") {
      const resumo = await importarComissaoVendedorPdf({
        arquivo: conteudo,
        nomeArquivo: arquivo.name,
        administradoraId,
        usuario,
      });
      return NextResponse.json({ tipo, resumo });
    }

    return NextResponse.json({ erro: "Tipo de importação inválido." }, { status: 400 });
  } catch (erro) {
    console.error("[importacao] falha", erro);
    return NextResponse.json(
      { erro: erro instanceof Error ? erro.message : "Falha ao processar o arquivo." },
      { status: 500 },
    );
  }
}
