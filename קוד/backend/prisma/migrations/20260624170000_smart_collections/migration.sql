-- שלב 2.3 — אוספים חכמים: טבלת SmartCollection (תוספת בלבד; אין שינוי בטבלאות קיימות).
CREATE TABLE "SmartCollection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "SmartCollection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SmartCollection_deletedAt_idx" ON "SmartCollection"("deletedAt");
