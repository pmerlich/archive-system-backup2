-- 3.8b — סימן מים לקובץ בודד (fileIds) + סימן מים מותאם לשיתוף (watermarkText). תוספתי בלבד.
ALTER TABLE "WatermarkTemplate" ADD COLUMN "fileIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "ShareLink" ADD COLUMN "watermarkText" TEXT;
