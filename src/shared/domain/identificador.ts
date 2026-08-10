import { randomBytes } from "node:crypto";

/**
 * Identificador gerado no cliente, no mesmo formato que o `@default(cuid())`
 * do Prisma produz.
 *
 * Existe por um motivo específico: em importação de lote, a cota e o evento que
 * fala dela entram na mesma transação, e o evento precisa do id da cota. Deixar
 * o banco gerar o id obriga a inserir uma cota por vez e ler o id de volta —
 * uma ida ao banco por linha do arquivo. Gerando aqui, mil cotas entram num
 * único `createMany` e os eventos já nascem apontando para elas.
 *
 * O formato imita o cuid v1 de propósito: `c` + tempo + contador + aleatório,
 * 25 caracteres. Ids gerados aqui e ids gerados pelo Prisma convivem na mesma
 * coluna sem que nada consiga distingui-los.
 *
 * A colisão é impedida por três camadas independentes: o milissegundo separa
 * processos que rodam em momentos diferentes, o contador separa chamadas dentro
 * do mesmo milissegundo, e os 48 bits aleatórios separam processos concorrentes
 * que caiam no mesmo milissegundo com o mesmo contador.
 */

let contador = Math.floor(Math.random() * 36 ** 4);

function base36(valor: number, tamanho: number): string {
  return valor.toString(36).padStart(tamanho, "0").slice(-tamanho);
}

export function novoId(): string {
  contador = (contador + 1) % 36 ** 4;
  const tempo = base36(Date.now(), 8);
  const sequencia = base36(contador, 4);
  const aleatorio = base36(randomBytes(6).readUIntBE(0, 6), 12);
  return `c${tempo}${sequencia}${aleatorio}`;
}
