-- שלב 3.4 — הגבלות צפייה (מכשיר / זמן / מספר צפיות) + קישור ההפעלה להגבלה.
-- תוספתי בלבד: טבלה חדשה + עמודה חדשה ב-ViewSession. אין שינוי/מחיקה בנתונים קיימים.

CREATE TABLE "ViewRestriction" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxViews" INTEGER,
    "viewsUsed" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    CONSTRAINT "ViewRestriction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ViewRestriction_fileId_idx" ON "ViewRestriction"("fileId");
CREATE INDEX "ViewRestriction_userId_idx" ON "ViewRestriction"("userId");
CREATE INDEX "ViewRestriction_active_idx" ON "ViewRestriction"("active");

ALTER TABLE "ViewSession" ADD COLUMN "restrictionId" TEXT;
