-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "weComUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specification" TEXT,
    "unit" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "weComOptionKey" TEXT,
    "minimumStock" DECIMAL(18,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "weComSpNo" TEXT NOT NULL,
    "applicantUserId" TEXT NOT NULL,
    "applicantName" TEXT NOT NULL,
    "department" TEXT,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLine" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "requestedQuantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundOrder" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "operatorId" TEXT NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundLine" (
    "id" TEXT NOT NULL,
    "inboundOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "InboundLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementBatch" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "remainingQuantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "productionDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "purchaser" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcurementBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "remainingQuantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundOrder" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "actualQuantity" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "issuedAt" TIMESTAMP(3),
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundAllocation" (
    "id" TEXT NOT NULL,
    "outboundOrderId" TEXT NOT NULL,
    "approvalLineId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "originalQuantity" DECIMAL(18,4) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "OutboundAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferOrder" (
    "id" TEXT NOT NULL,
    "transferNo" TEXT NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferLine" (
    "id" TEXT NOT NULL,
    "transferOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "TransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnOrder" (
    "id" TEXT NOT NULL,
    "returnNo" TEXT NOT NULL,
    "originalOutboundId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnLine" (
    "id" TEXT NOT NULL,
    "returnOrderId" TEXT NOT NULL,
    "outboundAllocationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stocktake" (
    "id" TEXT NOT NULL,
    "stocktakeNo" TEXT NOT NULL,
    "periodCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "periodCode" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLedgerEntry" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "periodCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncAttempt" (
    "id" TEXT NOT NULL,
    "weComSpNo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "payload" JSONB,
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "requestId" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_weComUserId_key" ON "User"("weComUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_code_key" ON "ItemCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_prefix_key" ON "ItemCategory"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "Item_code_key" ON "Item"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Item_weComOptionKey_key" ON "Item"("weComOptionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_weComSpNo_key" ON "ApprovalRequest"("weComSpNo");

-- CreateIndex
CREATE UNIQUE INDEX "InboundOrder_orderNo_key" ON "InboundOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementBatch_warehouseId_itemId_batchNo_key" ON "ProcurementBatch"("warehouseId", "itemId", "batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_warehouseId_itemId_batchId_key" ON "StockBalance"("warehouseId", "itemId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundOrder_approvalRequestId_key" ON "OutboundOrder"("approvalRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundOrder_orderNo_key" ON "OutboundOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "TransferOrder_transferNo_key" ON "TransferOrder"("transferNo");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnOrder_returnNo_key" ON "ReturnOrder"("returnNo");

-- CreateIndex
CREATE UNIQUE INDEX "Stocktake_stocktakeNo_key" ON "Stocktake"("stocktakeNo");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_periodCode_key" ON "AccountingPeriod"("periodCode");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLine" ADD CONSTRAINT "ApprovalLine_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLine" ADD CONSTRAINT "ApprovalLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundOrder" ADD CONSTRAINT "InboundOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundLine" ADD CONSTRAINT "InboundLine_inboundOrderId_fkey" FOREIGN KEY ("inboundOrderId") REFERENCES "InboundOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundLine" ADD CONSTRAINT "InboundLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcurementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundLine" ADD CONSTRAINT "InboundLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementBatch" ADD CONSTRAINT "ProcurementBatch_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementBatch" ADD CONSTRAINT "ProcurementBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcurementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundOrder" ADD CONSTRAINT "OutboundOrder_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundAllocation" ADD CONSTRAINT "OutboundAllocation_outboundOrderId_fkey" FOREIGN KEY ("outboundOrderId") REFERENCES "OutboundOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundAllocation" ADD CONSTRAINT "OutboundAllocation_approvalLineId_fkey" FOREIGN KEY ("approvalLineId") REFERENCES "ApprovalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundAllocation" ADD CONSTRAINT "OutboundAllocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundAllocation" ADD CONSTRAINT "OutboundAllocation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundAllocation" ADD CONSTRAINT "OutboundAllocation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcurementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_transferOrderId_fkey" FOREIGN KEY ("transferOrderId") REFERENCES "TransferOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcurementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOrder" ADD CONSTRAINT "ReturnOrder_originalOutboundId_fkey" FOREIGN KEY ("originalOutboundId") REFERENCES "OutboundOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOrder" ADD CONSTRAINT "ReturnOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_returnOrderId_fkey" FOREIGN KEY ("returnOrderId") REFERENCES "ReturnOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_outboundAllocationId_fkey" FOREIGN KEY ("outboundAllocationId") REFERENCES "OutboundAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcurementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_periodCode_fkey" FOREIGN KEY ("periodCode") REFERENCES "AccountingPeriod"("periodCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_periodCode_fkey" FOREIGN KEY ("periodCode") REFERENCES "AccountingPeriod"("periodCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcurementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcurementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
