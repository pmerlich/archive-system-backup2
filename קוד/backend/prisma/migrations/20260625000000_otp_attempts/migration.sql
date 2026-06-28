-- הגבלת ניסיונות OTP שגויים (הגנה מפני ניחוש בכוח על קוד 2FA)
ALTER TABLE "User" ADD COLUMN "otpAttempts" INTEGER NOT NULL DEFAULT 0;
