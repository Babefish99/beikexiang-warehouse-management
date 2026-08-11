-- Preserve immutable stocktake before/after quantities for future adjustments.
ALTER TABLE "StockAdjustment"
  ADD COLUMN "bookQuantity" DECIMAL(18,4),
  ADD COLUMN "actualQuantity" DECIMAL(18,4);

-- Historical rows only stored the signed delta. Backfill a non-negative pair
-- that preserves actualQuantity - bookQuantity = quantity.
UPDATE "StockAdjustment"
SET
  "bookQuantity" = GREATEST(-"quantity", 0),
  "actualQuantity" = GREATEST("quantity", 0);

ALTER TABLE "StockAdjustment"
  ALTER COLUMN "bookQuantity" SET NOT NULL,
  ALTER COLUMN "actualQuantity" SET NOT NULL;
