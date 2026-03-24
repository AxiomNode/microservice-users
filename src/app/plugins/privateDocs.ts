import swaggerUi from "@fastify/swagger-ui";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  isAuthorizedForPrivateDocs as isAuthorizedForPrivateDocsShared,
  resolvePrivateDocsToken as resolvePrivateDocsTokenShared
} from "@axiomnode/shared-sdk-client/private-docs";

import { AppConfig } from "../config.js";

export function isAuthorizedForPrivateDocs(
  request: FastifyRequest,
  expectedToken: string
): boolean {
  return isAuthorizedForPrivateDocsShared(request.headers, expectedToken);
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
        const expectedToken = resolvePrivateDocsTokenShared(config, {
          fallbackToAiEngineKey: false
        });
        if (!expectedToken || !isAuthorizedForPrivateDocs(request, expectedToken)) {
          return reply.code(401).send({ message: "Unauthorized private docs access" });
        }
        return;
      }
    }
  });
}
