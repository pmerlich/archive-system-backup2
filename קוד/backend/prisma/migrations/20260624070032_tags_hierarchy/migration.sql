-- Tag: hierarchical (self-reference) + uniqueness per (parentId, name)
DROP INDEX "Tag_name_key";
ALTER TABLE "Tag" ADD COLUMN "parentId" TEXT;
CREATE UNIQUE INDEX "Tag_parentId_name_key" ON "Tag"("parentId", "name");
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;