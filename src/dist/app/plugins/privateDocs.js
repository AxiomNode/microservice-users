import swaggerUi from "@fastify/swagger-ui";
export function isAuthorizedForPrivateDocs(request, expectedToken) {
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
export async function registerPrivateDocs(app, config) {
    if (!config.PRIVATE_DOCS_ENABLED) {
        return;
    }
    await app.register(swaggerUi, {
        routePrefix: config.PRIVATE_DOCS_PREFIX,
        staticCSP: true,
        transformSpecificationClone: true,
        uiHooks: {
            onRequest: async (request, reply) => {
                const expectedToken = config.PRIVATE_DOCS_TOKEN;
                if (!expectedToken || !isAuthorizedForPrivateDocs(request, expectedToken)) {
                    return reply.code(401).send({ message: "Unauthorized private docs access" });
                }
                return;
            }
        }
    });
}
