import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Bancos gerenciados costumam ficar em outra região da aplicação, e cada
    // ida e volta pesa. O padrão de 5s do Prisma é curto nesse cenário.
    transactionOptions: { timeout: 20_000, maxWait: 10_000 },
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
