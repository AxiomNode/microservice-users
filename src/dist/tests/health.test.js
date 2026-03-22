import "dotenv/config";
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { healthRoutes } from "../app/routes/health.js";
describe("health route", () => {
    it("returns service metadata", async () => {
        const app = Fastify();
        await healthRoutes(app);
        const response = await app.inject({ method: "GET", url: "/health" });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            status: "ok",
            service: "microservice-users"
        });
        await app.close();
    });
});
