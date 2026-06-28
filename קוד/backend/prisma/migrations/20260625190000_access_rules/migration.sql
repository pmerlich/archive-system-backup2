-- שלב 3.9 — כללי הרשאות גישה (הגבלה/הענקה) לפי טווח + דגל "מוגבל-טווח" למשתמש. תוספתי בלבד.
ALTER TABLE "User" ADD COLUMN "scopedView" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AccessRule" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "folderIds" TEXT[] NOT NULL DEFAULT '{}',
    "tagIds" TEXT[] NOT NULL DEFAULT '{}',
    "fileIds" TEXT[] NOT NULL DEFAULT '{}',
    "mimeTypes" TEXT[] NOT NULL DEFAULT '{}',
    "sensitivities" TEXT[] NOT NULL DEFAULT '{}',
    "includeSubfolders" BOOLEAN NOT NULL DEFAULT true,
    "includeSubtags" BOOLEAN NOT NULL DEFAULT true,
    "userIds" TEXT[] NOT NULL DEFAULT '{}',
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    CONSTRAINT "AccessRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccessRule_type_idx" ON "AccessRule"("type");
CREATE INDEX "AccessRule_active_idx" ON "AccessRule"("active");
