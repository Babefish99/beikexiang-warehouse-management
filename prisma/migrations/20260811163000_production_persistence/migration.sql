-- AlterTable
ALTER TABLE "ApprovalRequest"
ADD COLUMN "outboundStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN "cancelReason" TEXT;
