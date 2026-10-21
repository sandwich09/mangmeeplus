CREATE TABLE "PublicHomeThemeSetting" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedBySystemAdminUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicHomeThemeSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PublicHomeThemeSetting_singleton" CHECK ("id" = 'homepage'),
    CONSTRAINT "PublicHomeThemeSetting_version_positive" CHECK ("version" > 0)
);
