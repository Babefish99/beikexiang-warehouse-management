CREATE TABLE "InboundBatchSequence" (
    "purchasedDate" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL,

    CONSTRAINT "InboundBatchSequence_pkey" PRIMARY KEY ("purchasedDate")
);

INSERT INTO "InboundBatchSequence" ("purchasedDate", "lastSequence")
SELECT
    substring("batchNo" FROM '^([0-9]{8})-[0-9]+$'),
    MAX(substring("batchNo" FROM '^[0-9]{8}-([0-9]+)$')::INTEGER)
FROM "ProcurementBatch"
WHERE "batchNo" ~ '^[0-9]{8}-[0-9]+$'
GROUP BY substring("batchNo" FROM '^([0-9]{8})-[0-9]+$');
