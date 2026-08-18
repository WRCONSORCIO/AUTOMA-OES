import type { StatusConversa } from "@prisma/client";
import { Badge } from "@/components/ui";

/** Como cada estado da conversa aparece no painel. */
export const ROTULO_CONVERSA: Record<StatusConversa, string> = {
  BOT: "🤖 Bot",
  WAITING_PAYMENT: "🟡 Aguardando pagamento",
  HUMAN: "🔴 Atendimento humano",
  CLOSED: "⚫ Encerrada",
};

const TOM: Record<StatusConversa, "neutro" | "marca" | "bom" | "atencao" | "critico"> = {
  BOT: "marca",
  WAITING_PAYMENT: "atencao",
  HUMAN: "critico",
  CLOSED: "neutro",
};

export function EstadoConversa({ status }: { status: StatusConversa }) {
  return <Badge tom={TOM[status]}>{ROTULO_CONVERSA[status]}</Badge>;
}
