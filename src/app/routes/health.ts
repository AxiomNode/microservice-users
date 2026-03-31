import { FastifyInstance } from "fastify";

/**
 * @module routes/health
 * Liveness health-check endpoint.
 */

/** Registers the GET /health route returning service status. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "microservice-users",
      domain: "users"
    };
  });
}
