-- שלב 3.8 — סימני מים גמישים: כמה תבניות פעילות יחד, לוגו, עיצוב, וטווח-החלה. תוספתי בלבד.
ALTER TABLE "WatermarkTemplate" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WatermarkTemplate" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WatermarkTemplate" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "WatermarkTemplate" ADD COLUMN "imagePath" TEXT;
ALTER TABLE "WatermarkTemplate" ADD COLUMN "imageScale" DOUBLE PRECISION NOT NULL DEFAULT 0.25;
ALTER TABLE "WatermarkTemplate" ADD COLUMN "outline" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WatermarkTemplate" ADD COLUMN "folderIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "WatermarkTemplate" ADD COLUMN "tagIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "WatermarkTemplate" ADD COLUMN "mimeTypes" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "WatermarkTemplate" ADD COLUMN "sensitivities" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "WatermarkTemplate" ADD COLUMN "includeSubfolders" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WatermarkTemplate" ADD COLUMN "includeSubtags" BOOLEAN NOT NULL DEFAULT true;
-- שמירת המצב הקיים: תבנית שהייתה "פעילה" הופכת ל-enabled
UPDATE "WatermarkTemplate" SET "enabled" = "isActive";
