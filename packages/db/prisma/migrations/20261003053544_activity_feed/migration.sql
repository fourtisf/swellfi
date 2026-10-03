-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "likes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Fill" ADD COLUMN     "oid" BIGINT;

-- CreateTable
CREATE TABLE "ActivityLike" (
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,

    CONSTRAINT "ActivityLike_pkey" PRIMARY KEY ("userId","activityId")
);

-- CreateTable
CREATE TABLE "IndexState" (
    "userId" TEXT NOT NULL,
    "fillCursor" BIGINT NOT NULL DEFAULT 0,
    "backfilled" BOOLEAN NOT NULL DEFAULT false,
    "equityAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleStreak" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexState_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "IndexState_nextPollAt_idx" ON "IndexState"("nextPollAt");

-- CreateIndex
CREATE INDEX "Activity_userId_createdAt_idx" ON "Activity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Fill_userId_oid_idx" ON "Fill"("userId", "oid");

-- AddForeignKey
ALTER TABLE "ActivityLike" ADD CONSTRAINT "ActivityLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLike" ADD CONSTRAINT "ActivityLike_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexState" ADD CONSTRAINT "IndexState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
