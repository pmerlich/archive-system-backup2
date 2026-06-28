-- WatermarkTemplate — תבניות סימן מים (שלב 3.2). תוספתי בלבד: טבלה חדשה אחת.
CREATE TABLE "WatermarkTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '{email} · {datetime}',
    "fontSize" INTEGER NOT NULL DEFAULT 28,
    "color" TEXT NOT NULL DEFAULT '#ffffff',
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    "position" TEXT NOT NULL DEFAULT 'tiled',
    "angle" INTEGER NOT NULL DEFAULT 30,
    "motion" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "WatermarkTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WatermarkTemplate_isActive_idx" ON "WatermarkTemplate"("isActive");
CREATE INDEX "WatermarkTemplate_deletedAt_idx" ON "WatermarkTemplate"("deletedAt");
