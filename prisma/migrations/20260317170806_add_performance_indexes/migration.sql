-- CreateIndex
CREATE INDEX "config_snapshots_domainId_capturedAt_idx" ON "config_snapshots"("domainId", "capturedAt");

-- CreateIndex
CREATE INDEX "evaluations_domainId_idx" ON "evaluations"("domainId");

-- CreateIndex
CREATE INDEX "evaluations_status_idx" ON "evaluations"("status");

-- CreateIndex
CREATE INDEX "migration_mappings_evaluationId_idx" ON "migration_mappings"("evaluationId");

-- CreateIndex
CREATE INDEX "pd_resources_snapshotId_pdType_idx" ON "pd_resources"("snapshotId", "pdType");
