import type { StatusPagamento } from "@prisma/client";

/** Cor de cada status de pagamento no painel. O rótulo vive em `servicos/pedidos`. */
export const TOM_STATUS: Record<StatusPagamento, "neutro" | "bom" | "atencao" | "critico"> = {
  PENDING: "atencao",
  PROCESSING: "atencao",
  PAID: "bom",
  FAILED: "critico",
  CANCELLED: "neutro",
  EXPIRED: "neutro",
  REFUNDED: "neutro",
};
