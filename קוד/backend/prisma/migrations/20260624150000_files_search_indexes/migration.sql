-- שלב 2.1 — אינדקסים לחיפוש ומיון מהירים על קבצים (תוספת בלבד; לא משנה נתונים).
-- אינדקסי B-Tree למיון, עימוד וסינון:
CREATE INDEX "File_createdAt_idx" ON "File"("createdAt");
CREATE INDEX "File_name_idx" ON "File"("name");
CREATE INDEX "File_folderId_idx" ON "File"("folderId");

-- חיפוש טקסט מהיר בשם (ILIKE '%...%') גם על מיליוני קבצים — אינדקס טריגרם (pg_trgm).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "File_name_trgm_idx" ON "File" USING gin ("name" gin_trgm_ops);
