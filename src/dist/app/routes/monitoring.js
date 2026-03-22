import { z } from "zod";
const LogsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(2000).default(200)
});
export async function monitoringRoutes(app, metrics) {
    app.get("/monitor/stats", async (_request, reply) => {
        return reply.send(metrics.snapshot());
    });
    app.get("/monitor/logs", async (request, reply) => {
        const parsed = LogsQuerySchema.safeParse(request.query ?? {});
        if (!parsed.success) {
            return reply.status(400).send({
                message: "Invalid query parameters",
                errors: parsed.error.flatten()
            });
        }
        const logs = metrics.recentLogs(parsed.data.limit);
        return reply.send({
            service: "microservice-users",
            total: logs.length,
            logs
        });
    });
    app.get("/metrics", async (_request, reply) => {
        reply.type("text/plain; version=0.0.4");
        return reply.send(metrics.toPrometheus());
    });
}
