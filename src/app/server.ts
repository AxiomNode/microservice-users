import "dotenv/config";

import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import Fastify from "fastify";

import { loadConfig } from "./config.js";
import { prisma } from "./db/client.js";
import { registerPrivateDocs } from "./plugins/privateDocs.js";
import { healthRoutes } from "./routes/health.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { usersRoutes } from "./routes/users.js";
import { FirebaseAuthService } from "./services/firebaseAuthService.js";
import { ServiceMetrics } from "./services/serviceMetrics.js";
import { UserService } from "./services/userService.js";

async function buildServer() {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  const metrics = new ServiceMetrics(config);

  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: {
      info: {
        title: `${config.SERVICE_NAME} API`,
        version: "0.1.0"
      }
    }
  });

  await registerPrivateDocs(app, config);

  const firebaseAuthService = new FirebaseAuthService(config);
  const userService = new UserService(config);

  app.addHook("onRequest", async (request) => {
    const requestAny = request as typeof request & {
      _startedAt?: number;
      _requestBytes?: number;
    };
    requestAny._startedAt = Date.now();

    const contentLength = Number(request.headers["content-length"] ?? 0);
    requestAny._requestBytes = Number.isFinite(contentLength) ? contentLength : 0;
  });

  app.addHook("onResponse", async (request, reply) => {
    const requestAny = request as typeof request & {
      _startedAt?: number;
      _requestBytes?: number;
    };

    const responseContentLength = Number(reply.getHeader("content-length") ?? 0);
    const responseBytes = Number.isFinite(responseContentLength) ? responseContentLength : 0;
    const route = (request.routeOptions.url ?? request.url.split("?")[0]) as string;

    metrics.recordIncomingRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs: Math.max(0, Date.now() - (requestAny._startedAt ?? Date.now())),
      requestBytes: requestAny._requestBytes ?? 0,
      responseBytes
    });
  });

  await healthRoutes(app);
  await usersRoutes(app, firebaseAuthService, userService, metrics);
  await monitoringRoutes(app, metrics);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return { app, config };
}

async function main() {
  const { app, config } = await buildServer();

  await app.listen({ host: "0.0.0.0", port: config.SERVICE_PORT });
  app.log.info(
    { service: config.SERVICE_NAME, domain: "users" },
    "Service started"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
