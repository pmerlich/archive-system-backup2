-- שלב 4.5 — תור עיבוד ברקע (RenderJob). תוספתי בלבד: טבלה חדשה אחת, ללא שינוי בקיים.
CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fileId" TEXT,
    "params" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "resultFileId" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RenderJob_status_idx" ON "RenderJob"("status");
CREATE INDEX "RenderJob_createdById_idx" ON "RenderJob"("createdById");
CREATE INDEX "RenderJob_createdAt_idx" ON "RenderJob"("createdAt");
