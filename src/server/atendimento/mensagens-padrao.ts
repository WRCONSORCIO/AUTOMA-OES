/**
 * Textos padrão do atendimento.
 *
 * Ficam aqui apenas como carga inicial: depois de semeados, quem manda é o que
 * está no banco, editável em Atendimento → Mensagens. Nenhum ponto do motor lê
 * este arquivo em tempo de execução.
 */

export interface ModeloPadrao {
  chave: string;
  titulo: string;
  conteudo: string;
  descricao: string;
  variaveis: string[];
}

export const MODELOS_PADRAO: readonly ModeloPadrao[] = [
  {
    chave: "saudacao",
    titulo: "Saudação",
    conteudo: "👋 Olá! Seja bem-vindo!",
    descricao: "Primeira mensagem enviada a um contato novo.",
    variaveis: ["customer_name"],
  },
  {
    chave: "menu_inicial",
    titulo: "Menu inicial",
    conteudo: "👋 Olá! Seja bem-vindo!\nComo podemos ajudar você hoje?",
    descricao: "Texto do menu principal do bot.",
    variaveis: ["customer_name"],
  },
  {
    chave: "escolha_plano",
    titulo: "Escolha do plano",
    conteudo: "Perfeito! 🛒\nEscolha seu plano:",
    descricao: "Enviado antes da lista de planos ativos.",
    variaveis: [],
  },
  {
    chave: "pagamento",
    titulo: "Cobrança gerada",
    conteudo:
      "📋 Plano escolhido: {{plan_name}}\nValor: {{plan_price}}\n\nPara continuar, realize o pagamento:\n{{payment_link}}",
    descricao: "Mensagem com o link de pagamento. Precisa conter {{payment_link}}.",
    variaveis: ["plan_name", "plan_price", "payment_link", "order_id"],
  },
  {
    chave: "pagamento_pendente",
    titulo: "Pagamento ainda não confirmado",
    conteudo:
      "🟡 Ainda não recebemos a confirmação do pagamento do pedido #{{order_id}}.\nAssim que o pagamento for confirmado, continuamos automaticamente por aqui.",
    descricao:
      "Resposta a quem diz que já pagou. A confirmação só vem do gateway — nunca do texto do cliente.",
    variaveis: ["order_id", "payment_link"],
  },
  {
    chave: "pagamento_aprovado",
    titulo: "Pagamento confirmado",
    conteudo: "✅ Pagamento confirmado!\nAgora selecione o aparelho em que você irá utilizar o serviço:",
    descricao: "Disparada pelo webhook do gateway, nunca por mensagem do cliente.",
    variaveis: ["customer_name", "plan_name", "order_id"],
  },
  {
    chave: "pagamento_recusado",
    titulo: "Pagamento recusado",
    conteudo:
      "🔴 O pagamento do pedido #{{order_id}} não foi aprovado.\nVocê pode tentar novamente enviando *menu*.",
    descricao: "Enviada quando o gateway informa falha.",
    variaveis: ["order_id"],
  },
  {
    chave: "pagamento_expirado",
    titulo: "Cobrança expirada",
    conteudo:
      "⏱️ Seu pagamento expirou.\nSe ainda deseja continuar, responda *menu* para gerar uma nova cobrança.",
    descricao: "Enviada quando a cobrança passa da validade sem pagamento.",
    variaveis: ["order_id"],
  },
  {
    chave: "escolha_aparelho",
    titulo: "Escolha do aparelho",
    conteudo: "Selecione o aparelho em que você irá utilizar o serviço:",
    descricao: "Enviada antes da lista de aparelhos ativos.",
    variaveis: ["customer_name"],
  },
  {
    chave: "instrucoes",
    titulo: "Instruções por aparelho",
    conteudo: "📖 Instruções para {{device_name}}:",
    descricao: "Cabeçalho das instruções específicas do aparelho.",
    variaveis: ["device_name"],
  },
  {
    chave: "encerramento",
    titulo: "Encerramento",
    conteudo: "✅ Tudo certo por aqui!\nQualquer coisa, é só chamar. Responda *menu* para recomeçar.",
    descricao: "Última mensagem do fluxo.",
    variaveis: ["customer_name"],
  },
  {
    chave: "atendimento_humano",
    titulo: "Transferência para atendente",
    conteudo:
      "👨‍💻 Certo! Vou chamar um atendente.\nAguarde um instante que já vamos responder por aqui.",
    descricao: "Enviada ao transferir a conversa. A partir daí o bot silencia.",
    variaveis: ["customer_name", "business_hours"],
  },
  {
    chave: "retorno_ao_bot",
    titulo: "Retorno ao atendimento automático",
    conteudo: "🤖 Voltamos ao atendimento automático. Vamos continuar de onde paramos.",
    descricao: "Enviada quando o atendente devolve a conversa para o bot.",
    variaveis: ["customer_name"],
  },
  {
    chave: "fora_do_horario",
    titulo: "Fora do horário",
    conteudo:
      "👨‍💻 Nosso atendimento humano está encerrado neste momento.\nNosso horário é {{business_hours}}.\nSua mensagem foi registrada e retornaremos assim que possível.",
    descricao: "Resposta ao pedido de atendente fora do horário configurado.",
    variaveis: ["business_hours", "customer_name"],
  },
  {
    chave: "opcao_invalida",
    titulo: "Opção não reconhecida",
    conteudo: "Não consegui identificar sua opção.\nPor favor, selecione uma das opções abaixo.",
    descricao: "Enviada antes de repetir o menu atual.",
    variaveis: [],
  },
  {
    chave: "erro",
    titulo: "Erro inesperado",
    conteudo:
      "😕 Tivemos um problema técnico por aqui.\nJá registramos a falha. Responda *atendente* se precisar falar com alguém.",
    descricao: "Enviada quando o processamento falha.",
    variaveis: [],
  },
] as const;

/** Rótulos de navegação sempre oferecidos ao cliente. */
export const COMANDOS_GLOBAIS = {
  voltar: "🔙 Voltar",
  menu: "🏠 Menu inicial",
  atendente: "👨‍💻 Falar com atendente",
} as const;
