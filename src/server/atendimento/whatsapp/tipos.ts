/**
 * Contrato do provedor de WhatsApp.
 *
 * Nenhuma chamada específica de provedor sai daqui. O resto do sistema fala
 * com `WhatsAppService`, que fala com este contrato — trocar Evolution API
 * pela Cloud API oficial é escrever outra implementação e mudar uma linha de
 * configuração.
 */

export interface BotaoWhats {
  /** Volta na resposta do cliente. É como o motor identifica a escolha. */
  id: string;
  rotulo: string;
}

export interface ItemLista {
  id: string;
  titulo: string;
  descricao?: string;
}

export interface SecaoLista {
  titulo: string;
  itens: ItemLista[];
}

export type MensagemSaida =
  | { tipo: "texto"; texto: string }
  | { tipo: "botoes"; texto: string; titulo?: string; rodape?: string; botoes: BotaoWhats[] }
  | {
      tipo: "lista";
      texto: string;
      titulo?: string;
      rodape?: string;
      rotuloBotao: string;
      secoes: SecaoLista[];
    }
  | { tipo: "imagem"; url: string; legenda?: string }
  | { tipo: "documento"; url: string; nomeArquivo: string; legenda?: string }
  | { tipo: "audio"; url: string }
  | { tipo: "template"; nome: string; idioma: string; parametros: string[] };

export interface ResultadoEnvio {
  sucesso: boolean;
  /** Id da mensagem no provedor, quando ele devolve. */
  externoId?: string;
  erro?: string;
  /** `true` quando vale a pena tentar de novo (rede, 5xx, limite). */
  temporario?: boolean;
}

/** O que o provedor sabe fazer. O que ele não sabe, o serviço contorna. */
export interface RecursosProvedor {
  botoes: boolean;
  listas: boolean;
  midia: boolean;
  audio: boolean;
  templates: boolean;
  marcarLido: boolean;
}

export interface EstadoConexao {
  conectado: boolean;
  detalhe?: string;
}

export interface WhatsAppProvider {
  readonly nome: string;
  readonly recursos: RecursosProvedor;
  enviar(destino: string, mensagem: MensagemSaida): Promise<ResultadoEnvio>;
  marcarComoLida(destino: string, mensagemId: string): Promise<void>;
  estadoConexao(): Promise<EstadoConexao>;
}

/** Mensagem recebida, já traduzida do formato do provedor. */
export interface MensagemRecebida {
  /** Id no provedor. Usado para não processar o mesmo webhook duas vezes. */
  externoId: string | null;
  telefone: string;
  nomeContato: string | null;
  texto: string;
  /** Id do botão/linha da lista, quando a resposta veio de um componente. */
  respostaSelecionada: string | null;
  recebidaEm: Date;
  /** Mensagem enviada pela própria instância: precisa ser ignorada. */
  daPropriaInstancia: boolean;
}
