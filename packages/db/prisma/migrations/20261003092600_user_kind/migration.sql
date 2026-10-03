-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'member';

-- CreateIndex
CREATE INDEX "User_kind_idx" ON "User"("kind");
