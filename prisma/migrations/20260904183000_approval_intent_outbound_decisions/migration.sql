BEGIN;

-- Add the new intent and decision linkage as nullable columns first so all
-- historical facts can be validated and backfilled before constraints change.
ALTER TABLE "ApprovalRequest"
  ADD COLUMN "sourceTemplateId" TEXT;

ALTER TABLE "ApprovalLine"
  ADD COLUMN "requestedItemName" TEXT,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "legacyResolutionStatus" TEXT,
  ALTER COLUMN "itemId" DROP NOT NULL;

CREATE TABLE "OutboundDecisionLine" (
  "id" TEXT NOT NULL,
  "outboundOrderId" TEXT NOT NULL,
  "approvalLineId" TEXT NOT NULL,
  "selectedItemId" TEXT,
  "actualQuantity" DECIMAL(18,4) NOT NULL,
  "varianceReason" TEXT,
  "decidedBy" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OutboundDecisionLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OutboundAllocation"
  ADD COLUMN "outboundDecisionLineId" TEXT;

-- Preserve the legacy approval's displayed item name as immutable intent.
UPDATE "ApprovalLine" AS approval_line
SET "requestedItemName" = item."name"
FROM "Item" AS item
WHERE approval_line."itemId" = item."id";

-- No pre-migration record has trustworthy template provenance. In particular,
-- every still-open legacy approval must be re-synced before it can become
-- EXACT_LOCKED; completed records retain this conservative audit marker too.
UPDATE "ApprovalLine"
SET "legacyResolutionStatus" = 'REAPPLY_REQUIRED';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ApprovalLine"
    WHERE "requestedItemName" IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot backfill requested item name for every historical approval line';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "OutboundAllocation"
    GROUP BY "outboundOrderId", "approvalLineId"
    HAVING COUNT(DISTINCT "itemId") > 1
  ) THEN
    RAISE EXCEPTION 'historical approval line maps to multiple item ids';
  END IF;
END $$;

-- An outbound order closed its complete approval under the legacy workflow, so
-- every approval line on that order receives exactly one durable decision. A
-- line without allocations becomes the historical zero-issue decision.
INSERT INTO "OutboundDecisionLine" (
  "id",
  "outboundOrderId",
  "approvalLineId",
  "selectedItemId",
  "actualQuantity",
  "varianceReason",
  "decidedBy",
  "decidedAt"
)
SELECT
  'legacy-decision-' || md5(outbound_order."id" || ':' || approval_line."id"),
  outbound_order."id",
  approval_line."id",
  CASE
    WHEN COALESCE(SUM(allocation."quantity"), 0) > 0 THEN MIN(allocation."itemId")
    ELSE NULL
  END,
  COALESCE(SUM(allocation."quantity"), 0),
  CASE
    WHEN COALESCE(SUM(allocation."quantity"), 0) < approval_line."requestedQuantity"
      THEN outbound_order."reason"
    ELSE NULL
  END,
  outbound_order."operatorId",
  COALESCE(outbound_order."issuedAt", outbound_order."createdAt")
FROM "OutboundOrder" AS outbound_order
JOIN "ApprovalLine" AS approval_line
  ON approval_line."approvalRequestId" = outbound_order."approvalRequestId"
LEFT JOIN "OutboundAllocation" AS allocation
  ON allocation."outboundOrderId" = outbound_order."id"
 AND allocation."approvalLineId" = approval_line."id"
GROUP BY
  outbound_order."id",
  approval_line."id";

UPDATE "OutboundAllocation" AS allocation
SET "outboundDecisionLineId" = decision."id"
FROM "OutboundDecisionLine" AS decision
WHERE decision."outboundOrderId" = allocation."outboundOrderId"
  AND decision."approvalLineId" = allocation."approvalLineId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "OutboundAllocation"
    WHERE "outboundDecisionLineId" IS NULL
  ) THEN
    RAISE EXCEPTION 'historical outbound allocation remains without an outbound decision';
  END IF;
END $$;

-- Tighten the contract only after every historical row has a safe value.
ALTER TABLE "ApprovalLine"
  ALTER COLUMN "requestedItemName" SET NOT NULL,
  ALTER COLUMN "legacyResolutionStatus" SET NOT NULL;

ALTER TABLE "OutboundAllocation"
  ALTER COLUMN "outboundDecisionLineId" SET NOT NULL;

CREATE UNIQUE INDEX "OutboundDecisionLine_approvalLineId_key"
  ON "OutboundDecisionLine"("approvalLineId");

ALTER TABLE "OutboundDecisionLine"
  ADD CONSTRAINT "OutboundDecisionLine_outboundOrderId_fkey"
    FOREIGN KEY ("outboundOrderId") REFERENCES "OutboundOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OutboundDecisionLine_approvalLineId_fkey"
    FOREIGN KEY ("approvalLineId") REFERENCES "ApprovalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OutboundDecisionLine_selectedItemId_fkey"
    FOREIGN KEY ("selectedItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OutboundAllocation"
  ADD CONSTRAINT "OutboundAllocation_outboundDecisionLineId_fkey"
    FOREIGN KEY ("outboundDecisionLineId") REFERENCES "OutboundDecisionLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Remove the superseded approval-line link only after the decision link is
-- populated, required, and protected by its foreign key.
ALTER TABLE "OutboundAllocation"
  DROP CONSTRAINT "OutboundAllocation_approvalLineId_fkey",
  DROP COLUMN "approvalLineId";

COMMIT;
