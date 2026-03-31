import { PrismaClient } from "@prisma/client";

/**
 * @module db/client
 * Shared Prisma client instance for database access.
 */

/** Singleton Prisma client used across the application. */
export const prisma = new PrismaClient();
