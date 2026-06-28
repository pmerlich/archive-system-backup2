-- שלב 3.5 — קישורי צפייה חיצוניים. תוספתי בלבד (שתי טבלאות חדשות, ללא נגיעה בקיים).

CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "label" TEXT,
    "email" TEXT,
    "requireOtp" BOOLEAN NOT NULL DEFAULT false,
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "maxViews" INTEGER,
    "viewsUsed" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "singleDevice" BOOLEAN NOT NULL DEFAULT false,
    "boundDeviceKey" TEXT,
    "ipBlock" TEXT,
    "israelOnly" BOOLEAN NOT NULL DEFAULT false,
    "watermark" BOOLEAN NOT NULL DEFAULT true,
    "allowDownload" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");
CREATE INDEX "ShareLink_fileId_idx" ON "ShareLink"("fileId");
CREATE INDEX "ShareLink_active_idx" ON "ShareLink"("active");

CREATE TABLE "ShareSession" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "deviceKey" TEXT,
    "email" TEXT,
    "otpCodeHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "country" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "ShareSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShareSession_linkId_idx" ON "ShareSession"("linkId");
