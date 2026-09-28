ALTER TABLE "Item" ADD COLUMN "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "ItemRecommendationLearning" (
  "id" TEXT NOT NULL,
  "normalizedDescription" TEXT NOT NULL,
  "normalizedUnit" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "confirmationCount" INTEGER NOT NULL DEFAULT 1,
  "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ItemRecommendationLearning_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ItemRecommendationLearning_desc_unit_item_key"
  ON "ItemRecommendationLearning"("normalizedDescription", "normalizedUnit", "itemId");
CREATE INDEX "ItemRecommendationLearning_desc_unit_idx"
  ON "ItemRecommendationLearning"("normalizedDescription", "normalizedUnit");
ALTER TABLE "ItemRecommendationLearning" ADD CONSTRAINT "ItemRecommendationLearning_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
