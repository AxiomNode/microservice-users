import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../db/client.js";
export class AccessDeniedError extends Error {
}
export class RoleValidationError extends Error {
}
export class NotFoundError extends Error {
}
export class UserService {
    config;
    constructor(config) {
        this.config = config;
    }
    resolveInitialRole(firebaseUid) {
        if (this.config.SUPERADMIN_FIREBASE_UID && firebaseUid === this.config.SUPERADMIN_FIREBASE_UID) {
            return UserRole.SuperAdmin;
        }
        return UserRole.Gamer;
    }
    normalizeManagedRole(role) {
        if (role === "SuperAdmin" || role === "Admin" || role === "Viewer" || role === "Gamer") {
            return role;
        }
        throw new RoleValidationError("Unsupported role");
    }
    async getRoleByFirebaseUid(firebaseUid) {
        const user = await prisma.userProfile.findUnique({
            where: { firebaseUid },
            select: { role: true },
        });
        if (!user) {
            throw new NotFoundError("User not found. Sync Firebase session first.");
        }
        return user.role;
    }
    async upsertUserFromIdentity(identity) {
        const existing = await prisma.userProfile.findUnique({
            where: { firebaseUid: identity.firebaseUid },
            select: { id: true, role: true }
        });
        if (!existing) {
            const created = await prisma.userProfile.create({
                data: {
                    firebaseUid: identity.firebaseUid,
                    firebaseProvider: identity.provider,
                    role: this.resolveInitialRole(identity.firebaseUid),
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
                role: this.config.SUPERADMIN_FIREBASE_UID && identity.firebaseUid === this.config.SUPERADMIN_FIREBASE_UID
                    ? UserRole.SuperAdmin
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
    async recordGameEvent(firebaseUid, input) {
        const user = await prisma.userProfile.findUnique({
            where: { firebaseUid },
            select: { id: true, role: true }
        });
        if (!user) {
            throw new Error("User not found. Sync Firebase session first.");
        }
        if (user.role === UserRole.Viewer) {
            throw new AccessDeniedError("Viewer cannot modify data.");
        }
        const outcome = input.outcome;
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
            await tx.$executeRaw `
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
            await tx.$executeRaw `
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
    async getMyStats(firebaseUid, recentLimit) {
        const user = await prisma.userProfile.findUnique({
            where: { firebaseUid },
            include: {
                gameTypeStats: { orderBy: { played: "desc" } },
                categoryStats: { orderBy: { played: "desc" } },
                languageStats: { orderBy: { played: "desc" } },
                gameEvents: {
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
    async getLeaderboard(metric, limit) {
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
    async listRoleAssignments(requesterFirebaseUid) {
        const requesterRole = await this.getRoleByFirebaseUid(requesterFirebaseUid);
        if (requesterRole !== UserRole.SuperAdmin) {
            throw new AccessDeniedError("Only SuperAdmin can manage role assignments.");
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
    async updateUserRoleByFirebaseUid(requesterFirebaseUid, targetFirebaseUid, roleRaw) {
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
