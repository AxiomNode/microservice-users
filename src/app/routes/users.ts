import { UserRole } from "@prisma/client";
import { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { LeaderboardQuerySchema as BaseLeaderboardQuerySchema } from "@axiomnode/shared-sdk-client/contracts";

import { FirebaseAuthService, FirebaseIdentity } from "../services/firebaseAuthService.js";
import { ServiceMetrics } from "../services/serviceMetrics.js";
import {
  AccessDeniedError,
  NotFoundError,
  RoleValidationError,
  UserService,
} from "../services/userService.js";

/**
 * @module routes/users
 * User-facing routes: session sync, profile, stats, game events, leaderboard, and admin role management.
 */

interface AuthenticatedRequest extends FastifyRequest {
  userIdentity?: FirebaseIdentity;
  userRole?: UserRole;
}

const SyncSessionSchema = z.object({
  idToken: z.string().min(10).optional(),
});

const GameEventSchema = z.object({
  gameType: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  categoryName: z.string().min(1).optional(),
  language: z.string().min(2).max(10),
  outcome: z.enum(["won", "lost", "draw"]),
  score: z.number().int().min(0).max(100000).optional(),
  durationSeconds: z.number().int().min(0).max(86400).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const StatsQuerySchema = z.object({
  recentLimit: z.coerce.number().int().min(1).max(100).default(20),
});

const LeaderboardQuerySchema = BaseLeaderboardQuerySchema.extend({
  metric: z.enum(["won", "score", "played"]).default("won"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const RoleUpdateSchema = z.object({
  role: z.enum(["SuperAdmin", "Admin", "Viewer", "Gamer"]),
});

const RoleParamsSchema = z.object({
  firebaseUid: z.string().min(1),
});

/** Registers all user-domain routes on the Fastify instance. */
export async function usersRoutes(
  app: FastifyInstance,
  firebaseAuth: FirebaseAuthService,
  userService: UserService,
  metrics: ServiceMetrics,
): Promise<void> {
  async function requireAuth(
    request: FastifyRequest,
    reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
  ) {
    const req = request as AuthenticatedRequest;
    try {
      const identity = await firebaseAuth.authenticateFromBearer(
        request.headers.authorization,
        typeof request.headers["x-dev-firebase-uid"] === "string"
          ? request.headers["x-dev-firebase-uid"]
          : undefined,
      );
      req.userIdentity = identity;
      req.userRole = await userService.getRoleByFirebaseUid(identity.firebaseUid).catch(() => undefined);
      metrics.recordAuthAttempt(true);
    } catch (error) {
      metrics.recordAuthAttempt(false);
      metrics.recordLog("warn", "firebase_auth_failed", {
        error: error instanceof Error ? error.message : "Unknown auth error",
      });
      return reply.status(401).send({ message: "Unauthorized" });
    }
  }

  function requireSuperAdmin(
    request: FastifyRequest,
    reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
  ): boolean {
    const req = request as AuthenticatedRequest;
    if (req.userRole !== UserRole.SuperAdmin) {
      reply.status(403).send({ message: "Forbidden. SuperAdmin required." });
      return false;
    }
    return true;
  }

  app.post("/users/firebase/session", async (request, reply) => {
    const parsedBody = SyncSessionSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsedBody.error.flatten(),
      });
    }

    try {
      const idToken = parsedBody.data.idToken;
      const identity = await firebaseAuth.authenticateFromBearer(
        idToken ? `Bearer ${idToken}` : request.headers.authorization,
        typeof request.headers["x-dev-firebase-uid"] === "string"
          ? request.headers["x-dev-firebase-uid"]
          : undefined,
      );
      metrics.recordAuthAttempt(true);
      const sync = await userService.upsertUserFromIdentity(identity);
      const role = await userService.getRoleByFirebaseUid(identity.firebaseUid);
      metrics.recordUserSynced(sync.created);

      return reply.status(sync.created ? 201 : 200).send({
        message: sync.created ? "User created" : "User updated",
        userId: sync.userId,
        firebaseUid: identity.firebaseUid,
        provider: identity.provider,
        role,
      });
    } catch (error) {
      metrics.recordAuthAttempt(false);
      return reply.status(401).send({
        message: "Invalid Firebase token",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/users/me/profile", { preHandler: requireAuth }, async (request, reply) => {
    const req = request as AuthenticatedRequest;
    const identity = req.userIdentity;
    /* v8 ignore next -- requireAuth either populates identity or already returns 401 */
    if (!identity) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const sync = await userService.upsertUserFromIdentity(identity);
    metrics.recordUserSynced(sync.created);
    const role = await userService.getRoleByFirebaseUid(identity.firebaseUid);

    const stats = await userService.getMyStats(identity.firebaseUid, 5);
    return reply.send({
      profile: stats.profile,
      role,
      gameSummary: {
        byGameType: stats.byGameType,
        byCategory: stats.byCategory.slice(0, 10),
        byLanguage: stats.byLanguage,
      },
    });
  });

  app.get("/users/me/stats", { preHandler: requireAuth }, async (request, reply) => {
    const req = request as AuthenticatedRequest;
    const identity = req.userIdentity;
    /* v8 ignore next -- requireAuth either populates identity or already returns 401 */
    if (!identity) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const query = StatsQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: query.error.flatten(),
      });
    }

    const stats = await userService.getMyStats(identity.firebaseUid, query.data.recentLimit);
    return reply.send(stats);
  });

  app.post("/users/me/games/events", { preHandler: requireAuth }, async (request, reply) => {
    const req = request as AuthenticatedRequest;
    const identity = req.userIdentity;
    /* v8 ignore next -- requireAuth either populates identity or already returns 401 */
    if (!identity) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const parsed = GameEventSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsed.error.flatten(),
      });
    }

    try {
      await userService.recordGameEvent(identity.firebaseUid, parsed.data);
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return reply.status(403).send({ message: error.message });
      }
      throw error;
    }

    metrics.recordGameEventStored({
      gameType: parsed.data.gameType,
      language: parsed.data.language.toLowerCase(),
      outcome: parsed.data.outcome,
    });

    return reply.status(201).send({ message: "Game event stored" });
  });

  app.get("/users/admin/roles", { preHandler: requireAuth }, async (request, reply) => {
    const req = request as AuthenticatedRequest;
    const identity = req.userIdentity;
    /* v8 ignore next -- requireAuth either populates identity or already returns 401 */
    if (!identity) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    if (!requireSuperAdmin(request, reply)) {
      return;
    }

    try {
      const users = await userService.listRoleAssignments(identity.firebaseUid);
      return reply.send({
        total: users.length,
        users,
      });
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return reply.status(403).send({ message: error.message });
      }
      throw error;
    }
  });

  app.patch("/users/admin/roles/:firebaseUid", { preHandler: requireAuth }, async (request, reply) => {
    const req = request as AuthenticatedRequest;
    const identity = req.userIdentity;
    /* v8 ignore next -- requireAuth either populates identity or already returns 401 */
    if (!identity) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    if (!requireSuperAdmin(request, reply)) {
      return;
    }

    const params = RoleParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ message: "Invalid path parameters", errors: params.error.flatten() });
    }

    const parsedBody = RoleUpdateSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ message: "Invalid payload", errors: parsedBody.error.flatten() });
    }

    try {
      const updated = await userService.updateUserRoleByFirebaseUid(
        identity.firebaseUid,
        params.data.firebaseUid,
        parsedBody.data.role,
      );

      return reply.send({
        message: "Role updated",
        user: updated,
      });
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return reply.status(403).send({ message: error.message });
      }
      if (error instanceof RoleValidationError) {
        return reply.status(400).send({ message: error.message });
      }
      if (error instanceof NotFoundError) {
        return reply.status(404).send({ message: error.message });
      }
      throw error;
    }
  });

  app.get("/users/leaderboard", async (request, reply) => {
    const query = LeaderboardQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: query.error.flatten(),
      });
    }

    const rows = await userService.getLeaderboard(query.data.metric, query.data.limit);
    return reply.send({
      metric: query.data.metric,
      total: rows.length,
      rows,
    });
  });
}
