CREATE TYPE "PlatformAccessState" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "PlatformAccessControl" (
    "id" TEXT NOT NULL,
    "state" "PlatformAccessState" NOT NULL DEFAULT 'CLOSED',
    "updatedBySystemAdminUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAccessControl_pkey" PRIMARY KEY ("id")
);
