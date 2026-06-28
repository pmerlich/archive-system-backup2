-- AlterTable: add role/permission fields to Role
ALTER TABLE "Role" ADD COLUMN     "key" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isOwner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");