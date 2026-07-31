#!/usr/bin/env node
import { spawnSync } from "node:child_process";

/**
 * Aplica as migrações durante o deploy — só em produção.
 *
 * A pré-visualização de um PR não pode migrar o banco que a equipe usa: os dois
 * ambientes costumam apontar para a mesma base, e uma migração disparada por um
 * PR ainda em revisão alteraria a produção sem ninguém pedir.
 *
 * De quebra, o build da pré-visualização deixa de exigir credenciais de banco,
 * que é o que vinha derrubando o check do PR.
 */

const ambiente = process.env.VERCEL_ENV;

if (ambiente && ambiente !== "production") {
  console.log(`Ambiente "${ambiente}": migrações não são aplicadas fora de produção.`);
  process.exit(0);
}

if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) {
  console.error(
    "DATABASE_URL e DIRECT_URL precisam estar definidas para aplicar as migrações.\n" +
      "Na Vercel: Settings → Environment Variables, marcando o ambiente Production.",
  );
  process.exit(1);
}

const resultado = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
process.exit(resultado.status ?? 1);
