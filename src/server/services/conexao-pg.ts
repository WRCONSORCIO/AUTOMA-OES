/**
 * Ajuste da URL de conexão para os utilitários nativos do PostgreSQL.
 *
 * Módulo puro e sem dependências de servidor: o `pg_dump` recebe a mesma
 * DATABASE_URL usada pelo Prisma, mas o libpq rejeita os parâmetros que só o
 * Prisma entende.
 */

const PARAMETROS_PRISMA = new Set([
  "schema",
  "connection_limit",
  "pool_timeout",
  "socket_timeout",
  "statement_cache_size",
  "pgbouncer",
  "sslidentity",
  "sslpassword",
  "sslaccept",
]);

export function prepararConexaoPgDump(urlBanco: string): {
  url: string;
  argumentos: string[];
} {
  try {
    const url = new URL(urlBanco);
    const argumentos: string[] = [];

    for (const chave of [...url.searchParams.keys()]) {
      if (!PARAMETROS_PRISMA.has(chave)) continue;
      if (chave === "schema") {
        const schema = url.searchParams.get("schema");
        if (schema) argumentos.push(`--schema=${schema}`);
      }
      url.searchParams.delete(chave);
    }

    return { url: url.toString(), argumentos };
  } catch {
    // URL fora do padrão: repassa como veio e deixa o pg_dump validar.
    return { url: urlBanco, argumentos: [] };
  }
}
