import { describe, expect, it } from "vitest";
import { prepararConexaoPgDump } from "@/server/services/conexao-pg";

describe("preparação da conexão para o pg_dump", () => {
  it("remove os parâmetros que só o Prisma entende", () => {
    const { url } = prepararConexaoPgDump(
      "postgresql://u:s@host:5432/db?schema=public&connection_limit=20&pool_timeout=20",
    );
    expect(url).not.toContain("schema=");
    expect(url).not.toContain("connection_limit");
    expect(url).not.toContain("pool_timeout");
  });

  it("converte o schema em opção de linha de comando", () => {
    const { argumentos } = prepararConexaoPgDump("postgresql://u:s@host/db?schema=wr");
    expect(argumentos).toContain("--schema=wr");
  });

  it("preserva parâmetros válidos do libpq", () => {
    const { url } = prepararConexaoPgDump(
      "postgresql://u:s@host/db?schema=public&sslmode=require&connect_timeout=10",
    );
    expect(url).toContain("sslmode=require");
    expect(url).toContain("connect_timeout=10");
  });

  it("não quebra com URL fora do padrão", () => {
    expect(prepararConexaoPgDump("nao-e-uma-url")).toEqual({
      url: "nao-e-uma-url",
      argumentos: [],
    });
  });
});
