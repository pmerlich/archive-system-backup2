-- ViewSession — הפעלות צפייה מוגנת (שלב 3.1). תוספתי בלבד: טבלה חדשה אחת, בלי שינוי טבלאות קיימות.
CREATE TABLE "ViewSession" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ViewSession_fileId_idx" ON "ViewSession"("fileId");
CREATE INDEX "ViewSession_userId_idx" ON "ViewSession"("userId");
CREATE INDEX "ViewSession_expiresAt_idx" ON "ViewSession"("expiresAt");
