FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/microservice-users/src
COPY microservice-users/src/package.json microservice-users/src/package-lock.json* ./
COPY shared-sdk-client/typescript /workspace/shared-sdk-client/typescript
COPY contracts-and-schemas /workspace/contracts-and-schemas
RUN npm --prefix /workspace/shared-sdk-client/typescript install \
	&& npm --prefix /workspace/shared-sdk-client/typescript run build
RUN npm install

FROM node:20-bookworm-slim AS build
WORKDIR /workspace/microservice-users/src
RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=deps /workspace/microservice-users/src/node_modules ./node_modules
COPY --from=deps /workspace/shared-sdk-client/typescript /workspace/shared-sdk-client/typescript
COPY --from=deps /workspace/shared-sdk-client/typescript /shared-sdk-client/typescript
COPY microservice-users/src/package.json ./package.json
COPY microservice-users/src/tsconfig*.json ./
COPY microservice-users/src/.env.example ./.env.example
COPY microservice-users/src/prisma ./prisma
COPY microservice-users/src/app ./app
RUN npm run db:generate && npm run build
RUN npm prune --production

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=build /workspace/microservice-users/src/node_modules ./node_modules
COPY --from=build /workspace/shared-sdk-client/typescript /workspace/shared-sdk-client/typescript
COPY --from=build /workspace/shared-sdk-client/typescript /shared-sdk-client/typescript
COPY --from=build /workspace/microservice-users/src/dist ./dist
COPY --from=build /workspace/microservice-users/src/prisma ./prisma
COPY --from=build /workspace/microservice-users/src/.env.example ./.env.example
RUN mkdir -p /workspace /shared-sdk-client && chown -R node:node /app /workspace /shared-sdk-client
USER 1000:1000
EXPOSE 7100
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/app/server.js"]
