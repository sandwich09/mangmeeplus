-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "triggerPayloadJson" JSONB NOT NULL DEFAULT '{}';
