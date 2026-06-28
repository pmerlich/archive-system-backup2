-- שלב 1.7 — ייבוא מדיסקים: טבלאות ImportJob + ImportItem (תוספת בלבד, אין שינוי בטבלאות קיימות)
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scanning',
    "targetFolderId" TEXT,
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "hashedFiles" INTEGER NOT NULL DEFAULT 0,
    "newFiles" INTEGER NOT NULL DEFAULT 0,
    "newBytes" BIGINT NOT NULL DEFAULT 0,
    "duplicateFiles" INTEGER NOT NULL DEFAULT 0,
    "importedFiles" INTEGER NOT NULL DEFAULT 0,
    "importedBytes" BIGINT NOT NULL DEFAULT 0,
    "errorFiles" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fileId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImportItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportItem_jobId_status_idx" ON "ImportItem"("jobId", "status");

ALTER TABLE "ImportItem" ADD CONSTRAINT "ImportItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
