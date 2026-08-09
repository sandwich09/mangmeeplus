BEGIN;

CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS_OF_USE', 'PRIVACY_NOTICE');
CREATE TYPE "LegalDocumentAction" AS ENUM ('ACCEPTED', 'ACKNOWLEDGED');
CREATE TYPE "LegalAcceptanceCapacity" AS ENUM ('AUTHORIZED_REPRESENTATIVE', 'INVITED_MEMBER', 'SYSTEM_OPERATOR');
CREATE TYPE "LegalAcceptanceSurface" AS ENUM ('FIRST_ACCEPTANCE', 'MATERIAL_UPDATE');

CREATE TABLE "LegalDocumentActionRecord" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "documentType" "LegalDocumentType" NOT NULL,
  "action" "LegalDocumentAction" NOT NULL,
  "scopeRef" TEXT NOT NULL,
  "documentVersion" TEXT NOT NULL,
  "artifactUrl" TEXT NOT NULL,
  "releaseFingerprintSha256" TEXT NOT NULL,
  "statementVersion" TEXT NOT NULL,
  "statementText" TEXT NOT NULL,
  "statementSha256" TEXT NOT NULL,
  "acceptedByUserId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "actorCapacity" "LegalAcceptanceCapacity" NOT NULL,
  "rolesJson" JSONB NOT NULL,
  "authProvider" TEXT NOT NULL,
  "sessionTokenId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "displayChallenge" TEXT NOT NULL,
  "surface" "LegalAcceptanceSurface" NOT NULL,
  "userAgent" TEXT,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LegalDocumentActionRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalDocumentActionRecord_scopeRef_documentType_documentVersion_action_key"
  ON "LegalDocumentActionRecord"("scopeRef", "documentType", "documentVersion", "action");
CREATE INDEX "LegalDocumentActionRecord_acceptedByUserId_acceptedAt_idx"
  ON "LegalDocumentActionRecord"("acceptedByUserId", "acceptedAt");
CREATE INDEX "LegalDocumentActionRecord_companyId_acceptedAt_idx"
  ON "LegalDocumentActionRecord"("companyId", "acceptedAt");
CREATE INDEX "LegalDocumentActionRecord_membershipId_acceptedAt_idx"
  ON "LegalDocumentActionRecord"("membershipId", "acceptedAt");
CREATE INDEX "LegalDocumentActionRecord_batchId_idx"
  ON "LegalDocumentActionRecord"("batchId");

-- Clickwrap evidence is append-only at the database boundary, not merely by application
-- convention. A future legally reviewed retention/erasure migration must explicitly drop these
-- triggers inside its transaction, perform the narrowly scoped mutation, and recreate them before
-- commit; there is intentionally no runtime/session-variable bypass.
CREATE FUNCTION prevent_legal_document_action_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'LegalDocumentActionRecord is append-only; UPDATE, DELETE and TRUNCATE are prohibited'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "LegalDocumentActionRecord_prevent_update_delete"
  BEFORE UPDATE OR DELETE ON "LegalDocumentActionRecord"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_legal_document_action_record_mutation();

CREATE TRIGGER "LegalDocumentActionRecord_prevent_truncate"
  BEFORE TRUNCATE ON "LegalDocumentActionRecord"
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_legal_document_action_record_mutation();

COMMIT;
