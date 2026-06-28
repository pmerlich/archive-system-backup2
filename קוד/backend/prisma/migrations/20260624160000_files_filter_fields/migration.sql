-- שלב 2.2 — שדות לסינון מתקדם (תוספת בלבד; ברירות מחדל בטוחות, לא משנה נתונים קיימים).
ALTER TABLE "File" ADD COLUMN "uploadedById" TEXT;
ALTER TABLE "File" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE "File" ADD COLUMN "backedUp" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "File_mimeType_idx" ON "File"("mimeType");
CREATE INDEX "File_sizeBytes_idx" ON "File"("sizeBytes");
CREATE INDEX "File_uploadedById_idx" ON "File"("uploadedById");
CREATE INDEX "File_source_idx" ON "File"("source");
CREATE INDEX "File_backedUp_idx" ON "File"("backedUp");
