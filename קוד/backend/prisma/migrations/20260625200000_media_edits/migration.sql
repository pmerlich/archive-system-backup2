-- שלב 4.1 — פרויקטי עריכה וגרסאות (עריכה לא-הרסנית). תוספתי בלבד: שתי טבלאות חדשות, ללא שינוי בטבלאות קיימות.
CREATE TABLE "MediaEdit" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'עריכה',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "MediaEdit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MediaEdit_fileId_idx" ON "MediaEdit"("fileId");

CREATE TABLE "MediaEditVersion" (
    "id" TEXT NOT NULL,
    "editId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "label" TEXT,
    "recipe" JSONB NOT NULL,
    "resultFileId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaEditVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MediaEditVersion_editId_idx" ON "MediaEditVersion"("editId");
ALTER TABLE "MediaEditVersion" ADD CONSTRAINT "MediaEditVersion_editId_fkey" FOREIGN KEY ("editId") REFERENCES "MediaEdit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
