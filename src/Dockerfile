FROM node:22-bookworm-slim AS deps
# openssl is needed here (not only at runtime) so Prisma downloads the
# debian-openssl-3.0.x engines when the packages are installed.
RUN apt-get update 	&& apt-get install -y --no-install-recommends openssl ca-certificates 	&& rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/shared-sdk-client/typescript
COPY shared-sdk-client/typescript/package.json shared-sdk-client/typescript/package-lock.json ./
RUN npm ci
COPY shared-sdk-client/typescript ./
RUN npm run build
WORKDIR /workspace/microservice-users/src
COPY microservice-users/src/package.json microservice-users/src/package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /workspace/microservice-users/src
RUN apt-get update 	&& apt-get install -y --no-install-recommends openssl ca-certificates 	&& rm -rf /var/lib/apt/lists/*
# node_modules/@axiomnode/shared-sdk-client is a relative symlink to
# /workspace/shared-sdk-client/typescript, so the SDK must live at that path.
COPY --from=deps /workspace/shared-sdk-client/typescript /workspace/shared-sdk-client/typescript
COPY --from=deps /workspace/microservice-users/src/node_modules ./node_modules
COPY microservice-users/src/package.json ./package.json
COPY microservice-users/src/tsconfig*.json ./
COPY microservice-users/src/.env.example ./.env.example
COPY microservice-users/src/prisma ./prisma
COPY microservice-users/src/app ./app
RUN npm run db:generate && npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production 	CHECKPOINT_DISABLE=1
RUN apt-get update 	&& apt-get install -y --no-install-recommends openssl ca-certificates 	&& rm -rf /var/lib/apt/lists/*
# From /app/node_modules/@axiomnode the same relative symlink resolves to
# /shared-sdk-client/typescript, so the SDK is copied once, to that path.
COPY --from=build --chown=node:node /workspace/shared-sdk-client/typescript /shared-sdk-client/typescript
COPY --from=build --chown=node:node /workspace/microservice-users/src/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/microservice-users/src/dist ./dist
COPY --from=build --chown=node:node /workspace/microservice-users/src/prisma ./prisma
COPY --from=build --chown=node:node /workspace/microservice-users/src/.env.example ./.env.example
USER 1000:1000
EXPOSE 7100
# prisma is a pinned production dependency, so npx resolves the local CLI and
# never downloads anything at boot; the client was already generated at build.
CMD ["sh", "-c", "npx --no-install prisma db push --skip-generate && node dist/app/server.js"]
