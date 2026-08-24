ALTER TABLE "InboundLine" ADD COLUMN "remark" TEXT;

CREATE TABLE "OpeningStockImport" (
    "id" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "baselineDate" TIMESTAMP(3) NOT NULL,
    "operatorId" TEXT NOT NULL,
    "financeReviewer" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "createdItemCount" INTEGER NOT NULL,
    "inventoryRowCount" INTEGER NOT NULL,
    "positiveRowCount" INTEGER NOT NULL,
    "zeroRowCount" INTEGER NOT NULL,
    "totalQuantity" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningStockImport_pkey" PRIMARY KEY ("id")
);
