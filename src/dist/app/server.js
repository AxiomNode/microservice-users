import "dotenv/config";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
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
        const requestAny = request;
        requestAny._startedAt = Date.now();
        const contentLength = Number(request.headers["content-length"] ?? 0);
        requestAny._requestBytes = Number.isFinite(contentLength) ? contentLength : 0;
        const inboundCorrelationId = String(request.headers["x-correlation-id"] ?? "").trim();
        requestAny._correlationId = inboundCorrelationId || randomUUID();
        request.headers["x-correlation-id"] = requestAny._correlationId;
    });
    app.addHook("onResponse", async (request, reply) => {
        if (request.url === "/health") {
            return;
        }
        const requestAny = request;
        const responseContentLength = Number(reply.getHeader("content-length") ?? 0);
        const responseBytes = Number.isFinite(responseContentLength) ? responseContentLength : 0;
        const route = (request.routeOptions.url ?? "UNMATCHED");
        const correlationId = requestAny._correlationId ?? randomUUID();
        const durationMs = Math.max(0, Date.now() - (requestAny._startedAt ?? Date.now()));
        reply.header("x-correlation-id", correlationId);
        metrics.recordIncomingRequest({
            method: request.method,
            route,
            statusCode: reply.statusCode,
            durationMs,
            requestBytes: requestAny._requestBytes ?? 0,
            responseBytes
        });
        app.log.info({
            correlation_id: correlationId,
            service: config.SERVICE_NAME,
            route,
            status_code: reply.statusCode,
            duration_ms: durationMs,
            error_code: reply.statusCode >= 500 ? "upstream_or_internal_error" : undefined
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
    app.log.info({ service: config.SERVICE_NAME, domain: "users" }, "Service started");
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
