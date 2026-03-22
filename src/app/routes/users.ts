import { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { FirebaseAuthService, FirebaseIdentity } from "../services/firebaseAuthService.js";
import { ServiceMetrics } from "../services/serviceMetrics.js";
import { UserService } from "../services/userService.js";

interface AuthenticatedRequest extends FastifyRequest {
  userIdentity?: FirebaseIdentity;
}

const SyncSessionSchema = z.object({
  idToken: z.string().min(10).optional()
});

const GameEventSchema = z.object({
  gameType: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  categoryName: z.string().min(1).optional(),
  language: z.string().min(2).max(10),
  outcome: z.enum(["won", "lost", "draw"]),
  score: z.number().int().min(0).max(100000).optional(),
  durationSeconds: z.number().int().min(0).max(86400).optional(),
  metadata: z.record(z.unknown()).optional()
});

const StatsQuerySchema = z.object({
  recentLimit: z.coerce.number().int().min(1).max(100).default(20)
});

const LeaderboardQuerySchema = z.object({
  metric: z.enum(["won", "score", "played"]).default("won"),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export async function usersRoutes(
  app: FastifyInstance,
  firebaseAuth: FirebaseAuthService,
  userService: UserService,
  metrics: ServiceMetrics
): Promise<void> {
  async function requireAuth(request: FastifyRequest, reply: { status: (code: number) => { send: (payload: unknown) => unknown } }) {
    const req = request as AuthenticatedRequest;
    try {
      const identity = await firebaseAuth.authenticateFromBearer(
        request.headers.authorization,
        typeof request.headers["x-dev-firebase-uid"] === "string"
          ? request.headers["x-dev-firebase-uid"]
          : undefined
      );
      req.userIdentity = identity;
      metrics.recordAuthAttempt(true);
    } catch (error) {
      metrics.recordAuthAttempt(false);
      metrics.recordLog("warn", "firebase_auth_failed", {
        error: error instanceof Error ? error.message : "Unknown auth error"
      });
      return reply.status(401).send({ message: "Unauthorized" });
    }
  }

  app.post("/users/firebase/session", async (request, reply) => {
    const parsedBody = SyncSessionSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsedBody.error.flatten()
      });
    }

    try {
      const idToken = parsedBody.data.idToken;
      const identity = await firebaseAuth.authenticateFromBearer(
        idToken ? `Bearer ${idToken}` : request.headers.authorization,
        typeof request.headers["x-dev-firebase-uid"] === "string"
          ? request.headers["x-dev-firebase-uid"]
          : undefined
      );
      metrics.recordAuthAttempt(true);
      const sync = await userService.upsertUserFromIdentity(identity);
      metrics.recordUserSynced(sync.created);

      return reply.status(sync.created ? 201 : 200).send({
        message: sync.created ? "User created" : "User updated",
        userId: sync.userId,
        firebaseUid: identity.firebaseUid,
        provider: identity.provider
      });
    } catch (error) {
      metrics.recordAuthAttempt(false);
      return reply.status(401).send({
        message: "Invalid Firebase token",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/users/me/profile", { preHandler: requireAuth }, async (request, reply) => {
    const req = request as AuthenticatedRequest;
    const identity = req.userIdentity;
    if (!identity) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const sync = await userService.upsertUserFromIdentity(identity);
    metrics.recordUserSynced(sync.created);

    const stats = await userService.getMyStats(identity.firebaseUid, 5);
    return reply.send({
      profile: stats.profile,
      gameSummary: {
        byGameType: stats.byGameType,
        byCategory: stats.byCategory.slice(0, 10),
        byLanguage: stats.byLanguage
      }
    });
  });

  app.get("/users/me/stats", { preHandler: requireAuth }, async (request, reply) => {
    const req = request as AuthenticatedRequest;
    const identity = req.userIdentity;
    if (!identity) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const query = StatsQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: query.error.flatten()
      });
    }

    const stats = await userService.getMyStats(identity.firebaseUid, query.data.recentLimit);
    return reply.send(stats);
  });

  app.post("/users/me/games/events", { preHandler: requireAuth }, async (request, reply) => {
    const req = request as AuthenticatedRequest;
    const identity = req.userIdentity;
    if (!identity) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const parsed = GameEventSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsed.error.flatten()
      });
    }

    await userService.recordGameEvent(identity.firebaseUid, parsed.data);
    metrics.recordGameEventStored({
      gameType: parsed.data.gameType,
      language: parsed.data.language.toLowerCase(),
      outcome: parsed.data.outcome
    });

    return reply.status(201).send({ message: "Game event stored" });
  });

  app.get("/users/leaderboard", async (request, reply) => {
    const query = LeaderboardQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: query.error.flatten()
      });
    }

    const rows = await userService.getLeaderboard(query.data.metric, query.data.limit);
    return reply.send({
      metric: query.data.metric,
      total: rows.length,
      rows
    });
  });
}
