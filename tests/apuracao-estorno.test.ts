import { describe, expect, it } from "vitest";
import {
  resumirApuracao,
  type ResultadoSincronizacao,
} from "@/modules/apuracao/domain/rules/apuracao-estorno";

/**
 * O resumo é o que o usuário lê para decidir o que fazer, e cada contagem
 * empurra para uma ação diferente: cadastrar regra, esperar a administradora,
 * ou nada. Misturar duas delas num número só foi exatamente o problema que
 * esta apuração veio resolver.
 */

function resultado(
  desfecho: ResultadoSincronizacao["desfecho"],
  extra: Partial<ResultadoSincronizacao> = {},
): ResultadoSincronizacao {
  return {
    cotaId: `cota-${desfecho}-${Math.random()}`,
    desfecho,
    valorEstorno: 0,
    valorAnterior: 0,
    semComissaoPaga: false,
    motivo: "",
    ...extra,
  };
}

describe("resumo da apuração de estornos", () => {
  it("separa quem espera a administradora de quem espera cadastro de regra", () => {
    const resumo = resumirApuracao([
      resultado("AGUARDANDO_LANCAMENTO"),
      resultado("AGUARDANDO_LANCAMENTO"),
      resultado("SEM_REGRA"),
    ]);

    expect(resumo.semEstorno.aguardandoLancamento).toBe(2);
    expect(resumo.semEstorno.semRegra).toBe(1);
    expect(resumo.semEstorno.acimaDoLimiteDeParcelas).toBe(0);
  });

  it("não conta venda ativa como venda avaliada", () => {
    const resumo = resumirApuracao([
      resultado("SEM_CANCELAMENTO"),
      resultado("SEM_CANCELAMENTO"),
      resultado("CRIADO", { valorEstorno: 100 }),
    ]);

    // As ativas entram no conjunto só para desfazer cobrança velha; contá-las
    // como avaliadas inflaria o número que o usuário confere.
    expect(resumo.canceladasAvaliadas).toBe(1);
    expect(resumo.criados).toBe(1);
  });

  it("soma no total apenas o que continua sendo devido", () => {
    const resumo = resumirApuracao([
      resultado("CRIADO", { valorEstorno: 1250.5 }),
      resultado("INALTERADO", { valorEstorno: 300.25 }),
      resultado("ATUALIZADO", { valorEstorno: 100, valorAnterior: 500 }),
      // Removido não soma: deixou de ser devido.
      resultado("REMOVIDO", { valorAnterior: 900 }),
    ]);

    expect(resumo.valorTotal).toBe(1650.75);
    expect(resumo.removidos).toBe(1);
    expect(resumo.atualizados).toBe(1);
    expect(resumo.inalterados).toBe(1);
  });

  it("conta separadamente o estorno que a regra manda cobrar mas não tem base", () => {
    const resumo = resumirApuracao([
      resultado("CRIADO", { valorEstorno: 0, semComissaoPaga: true }),
      resultado("CRIADO", { valorEstorno: 400 }),
    ]);

    expect(resumo.criados).toBe(2);
    expect(resumo.semEstorno.semComissaoPaga).toBe(1);
    expect(resumo.valorTotal).toBe(400);
  });

  it("devolve tudo zerado quando não há nada a apurar", () => {
    const resumo = resumirApuracao([]);

    expect(resumo.canceladasAvaliadas).toBe(0);
    expect(resumo.valorTotal).toBe(0);
    expect(resumo.semEstorno.aguardandoLancamento).toBe(0);
  });
});
