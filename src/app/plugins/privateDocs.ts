import swaggerUi from "@fastify/swagger-ui";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { AppConfig } from "../config.js";

export function isAuthorizedForPrivateDocs(
  request: FastifyRequest,
  expectedToken: string
): boolean {
  const headerToken = request.headers["x-private-docs-token"];
  const tokenFromHeader = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  if (typeof tokenFromHeader === "string" && tokenFromHeader === expectedToken) {
    return true;
  }

  const authHeader = request.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim() === expectedToken;
  }

  return false;
}

export async function registerPrivateDocs(app: FastifyInstance, config: AppConfig): Promise<void> {
  if (!config.PRIVATE_DOCS_ENABLED) {
    return;
  }

  await app.register(swaggerUi, {
    routePrefix: config.PRIVATE_DOCS_PREFIX,
    staticCSP: true,
    transformSpecificationClone: true,
    uiHooks: {
      onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
        const expectedToken = config.PRIVATE_DOCS_TOKEN;
        if (!expectedToken || !isAuthorizedForPrivateDocs(request, expectedToken)) {
          return reply.code(401).send({ message: "Unauthorized private docs access" });
        }
        return;
      }
    }
  });
}
