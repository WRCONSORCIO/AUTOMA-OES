/**
 * Normalização de número de telefone.
 *
 * O número é a identidade do cliente no WhatsApp: um número, um cliente. Se a
 * normalização variar, o mesmo cliente vira dois cadastros e a conversa perde o
 * histórico — por isso ela é função pura, coberta por teste, e é a única porta
 * de entrada para gravar telefone no banco.
 *
 * O provedor entrega o número em formatos diferentes conforme o evento:
 * `5511999998888`, `+55 11 99999-8888`, `5511999998888@s.whatsapp.net`.
 * Todos precisam colapsar no mesmo valor.
 */

const DDI_PADRAO = "55";

export interface TelefoneNormalizado {
  /** Somente dígitos, sempre com DDI. É a chave única do cliente. */
  numero: string;
  /** Como o número aparece no painel. */
  exibicao: string;
}

/**
 * Extrai os dígitos, descartando sufixo de JID (`@s.whatsapp.net`, `@c.us`) e
 * qualquer pontuação.
 */
export function apenasDigitos(bruto: string): string {
  const semJid = bruto.split("@")[0] ?? "";
  return semJid.replace(/\D+/g, "");
}

/**
 * Normaliza para o formato canônico.
 *
 * Devolve `null` quando não sobra número plausível — é o que impede criar
 * cliente a partir de evento de grupo ou de transmissão do próprio sistema.
 */
export function normalizarTelefone(bruto: string | null | undefined): TelefoneNormalizado | null {
  if (!bruto) return null;

  const internacionalExplicito = bruto.trim().startsWith("+");

  let digitos = apenasDigitos(bruto);
  if (digitos.length < 8) return null;

  // Número brasileiro sem DDI (10 ou 11 dígitos) recebe o DDI padrão.
  //
  // Só os dígitos não bastam para decidir: `14155550100` tanto pode ser um
  // celular dos Estados Unidos quanto um número do DDD 14 sem DDI. O que
  // desempata é o `+` escrito por quem enviou — com ele, o número já é
  // internacional e não se mexe.
  if (!internacionalExplicito && digitos.length <= 11 && !digitos.startsWith(DDI_PADRAO)) {
    digitos = `${DDI_PADRAO}${digitos}`;
  }

  if (digitos.length > 15) return null; // E.164 não passa de 15 dígitos.

  return { numero: digitos, exibicao: formatarTelefone(digitos) };
}

/** Formata para leitura humana. Número não brasileiro sai em E.164. */
export function formatarTelefone(digitos: string): string {
  if (!digitos.startsWith(DDI_PADRAO)) return `+${digitos}`;

  const nacional = digitos.slice(DDI_PADRAO.length);
  if (nacional.length === 11) {
    return `+55 (${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  }
  if (nacional.length === 10) {
    return `+55 (${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  }
  return `+${digitos}`;
}

/** JID usado pelos provedores para endereçar a mensagem. */
export function jidDoNumero(digitos: string): string {
  return `${digitos}@s.whatsapp.net`;
}
