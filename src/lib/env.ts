import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  DIRECT_URL: z.string().optional(),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET precisa ter no mínimo 32 caracteres"),
  AUTH_SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(28800),
  BACKUP_DIR: z.string().default("./storage/backups"),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  BACKUP_CRON_TOKEN: z.string().optional(),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(52_428_800),

  // Atendimento via WhatsApp. Tudo opcional: sem configuração o módulo sobe em
  // modo simulação, que registra as mensagens sem enviar nada para fora.
  APP_URL: z.string().url().optional(),
  WHATSAPP_PROVIDER: z.enum(["EVOLUTION", "CLOUD_API", "SIMULADOR"]).optional(),
  WHATSAPP_API_URL: z.string().optional(),
  WHATSAPP_API_KEY: z.string().optional(),
  WHATSAPP_INSTANCE: z.string().optional(),
  /** Token exigido no webhook de entrada do WhatsApp. */
  WHATSAPP_WEBHOOK_TOKEN: z.string().optional(),

  PAYMENT_PROVIDER: z.enum(["STRIPE", "MANUAL", "SIMULADOR"]).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Minutos até a cobrança expirar sem pagamento. */
  PAGAMENTO_EXPIRA_MINUTOS: z.coerce.number().int().positive().default(60),
});

let cached: z.infer<typeof schema> | null = null;

/**
 * Lê e valida as variáveis de ambiente sob demanda. A validação é preguiçosa
 * para que o build não quebre em ambientes sem o `.env` completo.
 */
export function env(): z.infer<typeof schema> {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detalhes = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Configuração de ambiente inválida — ${detalhes}`);
  }

  cached = parsed.data;
  return cached;
}
