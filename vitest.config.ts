import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Os testes de integração do atendimento compartilham o mesmo banco e
    // limpam as tabelas antes de rodar. Em paralelo, um zerava o cenário do
    // outro no meio da execução — falha que aparecia e sumia conforme a ordem
    // dos arquivos. Um processo só, na sequência, custa menos de um segundo.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
