-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN "timeRangeDays" INTEGER NOT NULL DEFAULT 30;

-- CreateIndex
CREATE UNIQUE INDEX "incident_analyses_evaluationId_periodStart_periodEnd_key" ON "incident_analyses"("evaluationId", "periodStart", "periodEnd");
