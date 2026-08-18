# ---------------------------------------------------------------------------
# Imagem de produção do sistema.
#
# Três estágios: dependências, build e execução. O estágio final carrega apenas
# o necessário para rodar — o `standalone` do Next já traz as dependências que
# o servidor usa, e o cliente do Prisma vai junto porque é gerado, não
# instalado.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# O build precisa do cliente do Prisma gerado, mas não do banco de pé.
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl postgresql16-client
ENV NODE_ENV=production
ENV PORT=3000

# Usuário sem privilégios: o processo não precisa ser root para servir HTTP.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations, seed e cliente do Prisma: a aplicação roda `prisma migrate deploy`
# na subida, então os arquivos precisam existir na imagem.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma

USER nextjs
EXPOSE 3000

# `migrate deploy` é idempotente: aplica só o que falta e não recria nada.
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
