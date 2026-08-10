import { describe, expect, it } from "vitest";
import { novoId } from "@/shared/domain/identificador";

/**
 * O id passou a ser gerado aqui, e não pelo banco, para que a importação em
 * lote possa montar o evento antes de inserir a cota. Isso transfere para o
 * nosso lado uma responsabilidade que era do Postgres — daí estes testes.
 */
describe("identificador", () => {
  it("tem o mesmo formato do cuid que o Prisma gera", () => {
    // 25 caracteres começando por `c`, só letras e dígitos: é o que já está
    // gravado nas colunas de id. Ids dos dois geradores precisam conviver sem
    // que nada consiga distingui-los.
    expect(novoId()).toMatch(/^c[0-9a-z]{24}$/);
  });

  it("não repete, nem gerando tudo no mesmo milissegundo", () => {
    // Uma importação real cria milhares de ids em sequência, muitos deles
    // dentro do mesmo milissegundo. Colisão aqui seria chave duplicada no
    // meio de uma transação de lote — o pior lugar possível para descobrir.
    const ids = new Set<string>();
    for (let i = 0; i < 50_000; i += 1) ids.add(novoId());
    expect(ids.size).toBe(50_000);
  });

  it("cresce ao longo do tempo, o que mantém a ordem de inserção", async () => {
    // Não é garantia de ordenação total, mas evita que ids criados depois
    // caiam antes no índice — que é o que causa fragmentação em B-tree.
    const antes = novoId();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(novoId() > antes).toBe(true);
  });
});
