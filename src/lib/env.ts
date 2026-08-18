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
