import { GameOutcome, Prisma, UserRole } from "@prisma/client";

import { AppConfig } from "../config.js";
import { prisma } from "../db/client.js";
import { FirebaseIdentity } from "./firebaseAuthService.js";

/**
 * @module services/userService
 * Core business logic for user profiles, game events, stats, leaderboards, and role management.
 */

/** Thrown when the caller lacks permission for the requested action. */
export class AccessDeniedError extends Error {}

/** Thrown when an invalid role string is provided. */
export class RoleValidationError extends Error {}

/** Thrown when the target user does not exist. */
export class NotFoundError extends Error {}

/** Input payload for recording a single game event. */
export interface RecordGameEventInput {
  gameType: string;
  categoryId?: string;
  categoryName?: string;
  language: string;
  outcome: "won" | "lost" | "draw";
  score?: number;
  durationSeconds?: number;
  metadata?: Record<string, unknown>;
}

/** Complete stats snapshot returned by getMyStats. */
export interface UserStatsSnapshot {
  profile: {
    id: string;
    firebaseUid: string;
    role: UserRole;
    email: string | null;
    displayName: string | null;
    photoUrl: string | null;
    gamesPlayed: number;
    gamesWon: number;
    gamesLost: number;
    gamesDraw: number;
    totalScore: number;
    bestScore: number;
    totalDurationSeconds: number;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  byGameType: Array<{
    gameType: string;
    played: number;
    won: number;
    lost: number;
    draw: number;
    totalScore: number;
    bestScore: number;
  }>;
  byCategory: Array<{
    gameType: string;
    categoryId: string;
    categoryName: string | null;
    played: number;
    won: number;
    lost: number;
    draw: number;
  }>;
  byLanguage: Array<{
    gameType: string;
    language: string;
    played: number;
    won: number;
    lost: number;
    draw: number;
  }>;
  recentEvents: Array<{
    id: string;
    gameType: string;
    categoryId: string | null;
    categoryName: string | null;
    language: string;
    outcome: GameOutcome;
    score: number;
    durationSeconds: number;
    playedAt: Date;
  }>;
}

const READ_ONLY_ROLES = new Set<UserRole>([UserRole.Inspector, UserRole.Viewer]);

/** Manages user profiles, game event recording, stats retrieval, and role assignments. */
export class UserService {
  constructor(private readonly config: AppConfig) {}

  private configuredInspectorEmails(): Set<string> {
    return new Set(
      (this.config.INSPECTOR_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private isInspectorIdentity(identity: FirebaseIdentity): boolean {
    if (!identity.email) {
      return false;
    }
    return this.configuredInspectorEmails().has(identity.email.trim().toLowerCase());
  }

  private resolveInitialRole(identity: FirebaseIdentity): UserRole {
    const firebaseUid = identity.firebaseUid;
    if (this.config.SUPERADMIN_FIREBASE_UID && firebaseUid === this.config.SUPERADMIN_FIREBASE_UID) {
      return UserRole.SuperAdmin;
    }
    if (this.isInspectorIdentity(identity)) {
      return UserRole.Inspector;
    }
    return UserRole.Gamer;
  }

  private normalizeManagedRole(role: string): UserRole {
    if (role === "SuperAdmin" || role === "Admin" || role === "Inspector" || role === "Viewer" || role === "Gamer") {
      return role;
    }
    throw new RoleValidationError("Unsupported role");
  }

  async getRoleByFirebaseUid(firebaseUid: string): Promise<UserRole> {
    const user = await prisma.userProfile.findUnique({
      where: { firebaseUid },
      select: { role: true },
    });

    if (!user) {
      throw new NotFoundError("User not found. Sync Firebase session first.");
    }

    return user.role;
  }

  async upsertUserFromIdentity(identity: FirebaseIdentity): Promise<{ userId: string; created: boolean }> {
    const existing = await prisma.userProfile.findUnique({
      where: { firebaseUid: identity.firebaseUid },
      select: { id: true, role: true }
    });

    if (!existing) {
      const created = await prisma.userProfile.create({
        data: {
          firebaseUid: identity.firebaseUid,
          firebaseProvider: identity.provider,
          role: this.resolveInitialRole(identity),
          email: identity.email,
          emailVerified: identity.emailVerified,
          displayName: identity.displayName,
          photoUrl: identity.photoUrl,
          lastLoginAt: new Date()
        },
        select: { id: true }
      });
      return { userId: created.id, created: true };
    }

    await prisma.userProfile.update({
      where: { id: existing.id },
      data: {
        firebaseProvider: identity.provider,
        role:
          this.config.SUPERADMIN_FIREBASE_UID && identity.firebaseUid === this.config.SUPERADMIN_FIREBASE_UID
            ? UserRole.SuperAdmin
            : this.isInspectorIdentity(identity)
              ? UserRole.Inspector
            : existing.role,
        email: identity.email,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        photoUrl: identity.photoUrl,
        lastLoginAt: new Date()
      }
    });

    return { userId: existing.id, created: false };
  }

  async recordGameEvent(firebaseUid: string, input: RecordGameEventInput): Promise<void> {
    const user = await prisma.userProfile.findUnique({
      where: { firebaseUid },
      select: { id: true, role: true }
    });

    if (!user) {
      throw new Error("User not found. Sync Firebase session first.");
    }

    if (READ_ONLY_ROLES.has(user.role)) {
      throw new AccessDeniedError("Read-only roles cannot modify data.");
    }

    const outcome = input.outcome as GameOutcome;
    const score = input.score ?? 0;
    const duration = input.durationSeconds ?? 0;
    const language = input.language.toLowerCase();

    const wonIncrement = outcome === "won" ? 1 : 0;
    const lostIncrement = outcome === "lost" ? 1 : 0;
    const drawIncrement = outcome === "draw" ? 1 : 0;

    await prisma.$transaction(async (tx) => {
      await tx.userGameEvent.create({
        data: {
          userId: user.id,
          gameType: input.gameType,
          categoryId: input.categoryId,
          categoryName: input.categoryName,
          language,
          outcome,
          score,
          durationSeconds: duration,
          metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined
        }
      });

      await tx.userProfile.update({
        where: { id: user.id },
        data: {
          gamesPlayed: { increment: 1 },
          gamesWon: { increment: wonIncrement },
          gamesLost: { increment: lostIncrement },
          gamesDraw: { increment: drawIncrement },
          totalScore: { increment: score },
          totalDurationSeconds: { increment: duration }
        }
      });

      await tx.$executeRaw`
        UPDATE "UserProfile"
        SET "bestScore" = GREATEST("bestScore", ${score})
        WHERE id = ${user.id}
      `;

      await tx.userGameTypeStat.upsert({
        where: {
          userId_gameType: {
            userId: user.id,
            gameType: input.gameType
          }
        },
        create: {
          userId: user.id,
          gameType: input.gameType,
          played: 1,
          won: wonIncrement,
          lost: lostIncrement,
          draw: drawIncrement,
          totalScore: score,
          bestScore: score
        },
        update: {
          played: { increment: 1 },
          won: { increment: wonIncrement },
          lost: { increment: lostIncrement },
          draw: { increment: drawIncrement },
          totalScore: { increment: score }
        }
      });

      await tx.$executeRaw`
        UPDATE "UserGameTypeStat"
        SET "bestScore" = GREATEST("bestScore", ${score})
        WHERE "userId" = ${user.id} AND "gameType" = ${input.gameType}
      `;

      if (input.categoryId) {
        await tx.userCategoryStat.upsert({
          where: {
            userId_gameType_categoryId: {
              userId: user.id,
              gameType: input.gameType,
              categoryId: input.categoryId
            }
          },
          create: {
            userId: user.id,
            gameType: input.gameType,
            categoryId: input.categoryId,
            categoryName: input.categoryName,
            played: 1,
            won: wonIncrement,
            lost: lostIncrement,
            draw: drawIncrement
          },
          update: {
            categoryName: input.categoryName,
            played: { increment: 1 },
            won: { increment: wonIncrement },
            lost: { increment: lostIncrement },
            draw: { increment: drawIncrement }
          }
        });
      }

      await tx.userLanguageStat.upsert({
        where: {
          userId_gameType_language: {
            userId: user.id,
            gameType: input.gameType,
            language
          }
        },
        create: {
          userId: user.id,
          gameType: input.gameType,
          language,
          played: 1,
          won: wonIncrement,
          lost: lostIncrement,
          draw: drawIncrement
        },
        update: {
          played: { increment: 1 },
          won: { increment: wonIncrement },
          lost: { increment: lostIncrement },
          draw: { increment: drawIncrement }
        }
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
    });
  }

  async getMyStats(firebaseUid: string, recentLimit: number): Promise<UserStatsSnapshot> {
    const user = await prisma.userProfile.findUnique({
      where: { firebaseUid },
      include: {
        gameTypeStats: { orderBy: { played: "desc" } },
        categoryStats: { orderBy: { played: "desc" } },
        languageStats: { orderBy: { played: "desc" } },
        gameEvents: {
          select: {
            id: true,
            gameType: true,
            categoryId: true,
            categoryName: true,
            language: true,
            outcome: true,
            score: true,
            durationSeconds: true,
            playedAt: true,
          },
          orderBy: { playedAt: "desc" },
          take: Math.max(1, recentLimit)
        }
      }
    });

    if (!user) {
      throw new Error("User not found. Sync Firebase session first.");
    }

    return {
      profile: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        role: user.role,
        email: user.email,
        displayName: user.displayName,
        photoUrl: user.photoUrl,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
        gamesLost: user.gamesLost,
        gamesDraw: user.gamesDraw,
        totalScore: user.totalScore,
        bestScore: user.bestScore,
        totalDurationSeconds: user.totalDurationSeconds,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      byGameType: user.gameTypeStats,
      byCategory: user.categoryStats,
      byLanguage: user.languageStats,
      recentEvents: user.gameEvents.map((item) => ({
        id: item.id,
        gameType: item.gameType,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        language: item.language,
        outcome: item.outcome,
        score: item.score,
        durationSeconds: item.durationSeconds,
        playedAt: item.playedAt
      }))
    };
  }

  async getLeaderboard(metric: "won" | "score" | "played", limit: number) {
    const take = Math.min(100, Math.max(1, limit));

    if (metric === "won") {
      return prisma.userProfile.findMany({
        orderBy: [{ gamesWon: "desc" }, { gamesPlayed: "desc" }],
        take,
        select: {
          firebaseUid: true,
          displayName: true,
          photoUrl: true,
          gamesWon: true,
          gamesPlayed: true,
          totalScore: true
        }
      });
    }

    if (metric === "score") {
      return prisma.userProfile.findMany({
        orderBy: [{ totalScore: "desc" }, { gamesPlayed: "desc" }],
        take,
        select: {
          firebaseUid: true,
          displayName: true,
          photoUrl: true,
          gamesWon: true,
          gamesPlayed: true,
          totalScore: true
        }
      });
    }

    return prisma.userProfile.findMany({
      orderBy: { gamesPlayed: "desc" },
      take,
      select: {
        firebaseUid: true,
        displayName: true,
        photoUrl: true,
        gamesWon: true,
        gamesPlayed: true,
        totalScore: true
      }
    });
  }

  async listRoleAssignments(requesterFirebaseUid: string) {
    const requesterRole = await this.getRoleByFirebaseUid(requesterFirebaseUid);
    if (requesterRole !== UserRole.SuperAdmin && requesterRole !== UserRole.Inspector) {
      throw new AccessDeniedError("Only SuperAdmin or Inspector can view role assignments.");
    }

    return prisma.userProfile.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        firebaseUid: true,
        displayName: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async updateUserRoleByFirebaseUid(
    requesterFirebaseUid: string,
    targetFirebaseUid: string,
    roleRaw: string,
  ) {
    const requesterRole = await this.getRoleByFirebaseUid(requesterFirebaseUid);
    if (requesterRole !== UserRole.SuperAdmin) {
      throw new AccessDeniedError("Only SuperAdmin can modify user roles.");
    }

    const nextRole = this.normalizeManagedRole(roleRaw);
    const target = await prisma.userProfile.findUnique({
      where: { firebaseUid: targetFirebaseUid },
      select: { id: true, firebaseUid: true, role: true, displayName: true, email: true },
    });

    if (!target) {
      throw new NotFoundError("Target user not found.");
    }

    const superAdminUid = this.config.SUPERADMIN_FIREBASE_UID;
    if (superAdminUid && target.firebaseUid === superAdminUid && nextRole !== UserRole.SuperAdmin) {
      throw new AccessDeniedError("Configured SuperAdmin cannot be downgraded.");
    }

    if (nextRole === UserRole.SuperAdmin) {
      if (!superAdminUid || target.firebaseUid !== superAdminUid) {
        throw new AccessDeniedError("Only configured SuperAdmin UID can hold SuperAdmin role.");
      }
    }

    const updated = await prisma.userProfile.update({
      where: { id: target.id },
      data: { role: nextRole },
      select: {
        firebaseUid: true,
        displayName: true,
        email: true,
        role: true,
        updatedAt: true,
      },
    });

    return updated;
  }
}
