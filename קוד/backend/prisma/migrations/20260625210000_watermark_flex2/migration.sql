-- [שינוי 2026-06-25] שדות גמישות לסימן מים: מרחק חזרות, תנועה (ציר/כיוון/מהירות), הבהוב (מחזור/משך)
ALTER TABLE "WatermarkTemplate"
  ADD COLUMN "tileGap" INTEGER NOT NULL DEFAULT 28,
  ADD COLUMN "motionAxis" TEXT NOT NULL DEFAULT 'x',
  ADD COLUMN "motionDir" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "motionSpeed" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "blink" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blinkInterval" DOUBLE PRECISION NOT NULL DEFAULT 5,
  ADD COLUMN "blinkOn" DOUBLE PRECISION NOT NULL DEFAULT 1.5;
