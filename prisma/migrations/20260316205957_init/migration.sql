-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SA_SE', 'VIEWER');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'INVALID', 'VALIDATING');

-- CreateEnum
CREATE TYPE "PdResourceType" AS ENUM ('BUSINESS_SERVICE', 'ESCALATION_POLICY', 'RULESET', 'SCHEDULE', 'SERVICE', 'TEAM', 'USER');

-- CreateEnum
CREATE TYPE "ConfigSnapshotStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('PENDING', 'CONFIG_EXPORT', 'INCIDENT_PULL', 'ANALYZING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('TEAM', 'SERVICE');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('AUTO', 'MANUAL', 'SKIP', 'UNSUPPORTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "pdContractRenewal" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pd_domains" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "apiTokenEnc" BYTEA NOT NULL,
    "tokenLast4" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValidated" TIMESTAMP(3),
    "status" "DomainStatus" NOT NULL DEFAULT 'VALIDATING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pd_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_snapshots" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "terraformState" BYTEA NOT NULL,
    "resourcesJson" BYTEA NOT NULL,
    "resourceCounts" JSONB NOT NULL,
    "staleResources" JSONB,
    "status" "ConfigSnapshotStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pd_resources" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "pdType" "PdResourceType" NOT NULL,
    "pdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamIds" TEXT[],
    "configJson" BYTEA NOT NULL,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "lastActivity" TIMESTAMP(3),
    "dependencies" TEXT[],

    CONSTRAINT "pd_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "configSnapshotId" TEXT,
    "scopeType" "ScopeType" NOT NULL,
    "scopeIds" TEXT[],
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_analyses" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "serviceId" TEXT,
    "teamId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "incidentCount" INTEGER NOT NULL,
    "alertCount" INTEGER NOT NULL,
    "noiseRatio" DOUBLE PRECISION NOT NULL,
    "mttrP50" DOUBLE PRECISION,
    "mttrP95" DOUBLE PRECISION,
    "sourcesJson" BYTEA NOT NULL,
    "patternsJson" BYTEA NOT NULL,
    "shadowSignals" TEXT[],

    CONSTRAINT "incident_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_mappings" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "pdResourceId" TEXT NOT NULL,
    "ioResourceType" TEXT,
    "conversionStatus" "ConversionStatus" NOT NULL,
    "effortEstimate" TEXT,
    "notes" TEXT,
    "ioTfSnippet" TEXT,

    CONSTRAINT "migration_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadataJson" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "pd_domains_customerId_subdomain_key" ON "pd_domains"("customerId", "subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "pd_resources_snapshotId_pdId_key" ON "pd_resources"("snapshotId", "pdId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pd_domains" ADD CONSTRAINT "pd_domains_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_snapshots" ADD CONSTRAINT "config_snapshots_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "pd_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pd_resources" ADD CONSTRAINT "pd_resources_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "config_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "pd_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_configSnapshotId_fkey" FOREIGN KEY ("configSnapshotId") REFERENCES "config_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_analyses" ADD CONSTRAINT "incident_analyses_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_mappings" ADD CONSTRAINT "migration_mappings_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_mappings" ADD CONSTRAINT "migration_mappings_pdResourceId_fkey" FOREIGN KEY ("pdResourceId") REFERENCES "pd_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
