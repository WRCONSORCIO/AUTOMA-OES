import "server-only";
import type { EventoPublicado } from "@/shared/events/catalogo";
import type { Handler } from "@/shared/events/registro";
import { sincronizarEstornos } from "../sincronizar-estorno";

/**
 * Os dois fatos que podem fazer nascer um estorno.
 *
 * O cancelamento tem duas metades, e elas chegam por arquivos diferentes, em
 * meses diferentes:
 *
 *   1. a **base de clientes** diz que o cliente saiu;
 *   2. o **relatório de comissão** traz o CANCELAMENTO DE PLANO, que é quando
 *      a administradora tira da WR o que já havia pago.
 *
 * A cobrança do vendedor só existe quando as duas estão na mesa, e a
 * competência é a da segunda: enquanto o débito não aparece no relatório, a WR
 * não perdeu nada, e cobrar seria adiantar dinheiro do vendedor por uma perda
 * que ainda não houve — às vezes por dois meses.
 *
 * Como a ordem de chegada não é garantida (uma base pode ser importada depois
 * do relatório que já trouxe o débito), os dois eventos disparam a mesma
 * sincronização. Quem chega por último completa o par; quem chega primeiro não
 * faz nada, e não precisa saber disso.
 */

type EventoCancelada = EventoPublicado<"carteira.cota.cancelada">;
type EventoLancamento = EventoPublicado<"apuracao.cancelamento.lancado">;

/**
 * Idempotência em duas camadas.
 *
 * A primeira é a `EventoEntrega`, que impede o handler de rodar duas vezes para
 * o mesmo evento. A segunda é a própria sincronização, que decide a partir dos
 * fatos e nunca do que já estava gravado — reentregar o evento reescreve o
 * mesmo valor.
 */
export const gerarEstornoHandler: Handler<"carteira.cota.cancelada"> = {
  nome: "apuracao.gerar-estorno",
  evento: "carteira.cota.cancelada",
  prioridade: 10,

  async executar(evento: EventoCancelada): Promise<void> {
    await sincronizarEstornos([evento.payload.cotaId], {
      importacaoId: evento.metadados.importacaoId ?? null,
      origem: "cancelamento na base de clientes",
      auditarCadaCota: true,
      // Quem disparou a importação responde pelo estorno. Sem usuário (cron,
      // script), a auditoria fica sem autor — e é assim que deve ser: inventar
      // um "sistema" com id falso quebraria a rastreabilidade.
      usuario: evento.metadados.usuarioId
        ? { id: evento.metadados.usuarioId, nome: evento.metadados.usuarioNome ?? "—" }
        : null,
    });
  },
};

/**
 * Reage ao débito de cancelamento lançado pela administradora.
 *
 * É este o gatilho que efetivamente cobra: a linha CANCELAMENTO DE PLANO do
 * relatório da WR. A cota já estava cancelada na base há semanas ou meses —
 * o que faltava era a perda existir.
 */
export const estornoPorLancamentoHandler: Handler<"apuracao.cancelamento.lancado"> = {
  nome: "apuracao.estorno-por-lancamento",
  evento: "apuracao.cancelamento.lancado",
  prioridade: 10,

  async executar(evento: EventoLancamento): Promise<void> {
    await sincronizarEstornos([evento.payload.cotaId], {
      importacaoId: evento.metadados.importacaoId ?? null,
      origem: "CANCELAMENTO DE PLANO no relatório de comissão",
      auditarCadaCota: true,
      usuario: evento.metadados.usuarioId
        ? { id: evento.metadados.usuarioId, nome: evento.metadados.usuarioNome ?? "—" }
        : null,
    });
  },
};
