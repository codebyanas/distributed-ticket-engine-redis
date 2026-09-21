FROM node:20-alpine AS build

WORKDIR /app

RUN corepack enable
RUN corepack prepare pnpm@12.5.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.prisma.json ./
RUN pnpm install --frozen-lockfile

RUN pnpm prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM build AS production-deps

RUN pnpm prune --prod

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable
RUN corepack prepare pnpm@12.5.1 --activate
COPY --from=build /app/dist ./dist
COPY --from=production-deps /app/node_modules ./node_modules
COPY prisma ./prisma

EXPOSE 5000
CMD ["node", "dist/server.js"]