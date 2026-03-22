export async function healthRoutes(app) {
    app.get("/health", async () => {
        return {
            status: "ok",
            service: "microservice-users",
            domain: "users"
        };
    });
}
