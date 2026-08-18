import { randomUUID } from "node:crypto";
import type {
  EstadoConexao,
  MensagemSaida,
  RecursosProvedor,
  ResultadoEnvio,
  WhatsAppProvider,
} from "./tipos";

/**
 * Provedor de simulação.
 *
 * Existe por dois motivos: manter o sistema executável antes de qualquer
 * credencial ser cadastrada — dá para percorrer o fluxo inteiro pelo painel —
 * e permitir testar o motor sem rede.
 *
 * Não envia nada para fora. A mensagem continua sendo gravada na conversa pelo
 * `WhatsAppService`, então o histórico do painel mostra exatamente o que o
 * cliente receberia.
 */
export class SimuladorProvider implements WhatsAppProvider {
  readonly nome = "SIMULADOR";

  readonly recursos: RecursosProvedor = {
    botoes: true,
    listas: true,
    midia: false,
    audio: false,
    templates: false,
    marcarLido: false,
  };

  readonly enviadas: { destino: string; mensagem: MensagemSaida }[] = [];

  async enviar(destino: string, mensagem: MensagemSaida): Promise<ResultadoEnvio> {
    this.enviadas.push({ destino, mensagem });

    // Id único de verdade, não a posição na lista: cada requisição cria um
    // simulador novo, e um contador reiniciado colidiria com o `externoId`
    // único das mensagens já gravadas — o registro da segunda mensagem se
    // perderia em silêncio.
    return { sucesso: true, externoId: `sim_${randomUUID()}` };
  }

  async marcarComoLida(): Promise<void> {}

  async estadoConexao(): Promise<EstadoConexao> {
    return { conectado: false, detalhe: "modo simulação — nenhuma mensagem sai do servidor" };
  }
}
