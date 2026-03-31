-- AlterEnum
ALTER TYPE "PdResourceType" ADD VALUE 'ACCOUNT_INFO';

-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "configOnly" BOOLEAN NOT NULL DEFAULT false;
