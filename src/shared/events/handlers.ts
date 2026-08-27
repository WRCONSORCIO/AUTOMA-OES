import "server-only";
import {
  estornoPorLancamentoHandler,
  gerarEstornoHandler,
} from "@/modules/apuracao/application/handlers/gerar-estorno";
import { despachar, type OpcoesDespacho, type ResumoDespacho } from "./despachante";
import { outboxPrisma } from "./outbox-prisma";
import { RegistroHandlers } from "./registro";

/**
 * Montagem do barramento: onde as reações do sistema são declaradas.
 *
 * É o único lugar que conhece todos os módulos ao mesmo tempo. Cada handler
 * mora no seu próprio contexto e é ligado aqui — os contextos continuam sem se
 * importar uns aos outros.
 *
 * Para acrescentar uma reação nova, escreva o handler no módulo dono do assunto
 * e registre-o nesta lista. Nada mais precisa mudar.
 */
const registro = new RegistroHandlers()
  .registrar(gerarEstornoHandler)
  .registrar(estornoPorLancamentoHandler);

export function registroDeHandlers(): RegistroHandlers {
  return registro;
}

/**
 * Processa a fila de eventos pendentes.
 *
 * Chamada logo após a importação, para que o resultado já esteja pronto quando
 * o usuário vê o resumo, e também pela rota de manutenção, que recolhe eventos
 * que ficaram para trás por falha temporária.
 */
export function processarEventosPendentes(
  opcoes?: OpcoesDespacho,
): Promise<ResumoDespacho> {
  return despachar(outboxPrisma, registro, opcoes);
}

/**
 * Eventos por rodada da drenagem.
 *
 * Maior que o lote padrão do despachante de propósito. Uma importação de base
 * inteira publica um evento por venda, e com 100 por rodada o teto de rodadas
 * era atingido antes da fila esvaziar: numa medição real, 5.668 eventos
 * gerados e 5.000 processados — os 668 restantes ficavam pendentes até o cron
 * passar, e o resumo mostrado ao usuário saía sem eles.
 */
const LOTE_DA_DRENAGEM = 500;

/**
 * Drena a fila até esvaziar, com teto de rodadas.
 *
 * Uma importação grande gera mais eventos do que cabe num lote, e devolver o
 * resumo com metade dos estornos calculados seria pior do que demorar um pouco
 * mais. O teto existe para que um handler que sempre falha não segure o
 * processo indefinidamente — o que sobrar fica pendente e é recolhido depois.
 */
export async function drenarEventos(
  maxRodadas = 50,
  lote = LOTE_DA_DRENAGEM,
): Promise<ResumoDespacho> {
  let eventos = 0;
  let entregasOk = 0;
  let entregasIgnoradas = 0;
  let entregasFalhas = 0;
  let eventosComFalha = 0;

  for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
    const resumo = await processarEventosPendentes({ lote });
    eventos += resumo.eventos;
    entregasOk += resumo.entregasOk;
    entregasIgnoradas += resumo.entregasIgnoradas;
    entregasFalhas += resumo.entregasFalhas;
    eventosComFalha += resumo.eventosComFalha;

    // Nada pendente, ou só sobrou o que já falhou nesta rodada — insistir
    // agora só repetiria a falha antes do backoff vencer.
    if (resumo.eventos === 0 || resumo.eventos === resumo.eventosComFalha) break;
  }

  return { eventos, entregasOk, entregasIgnoradas, entregasFalhas, eventosComFalha };
}
