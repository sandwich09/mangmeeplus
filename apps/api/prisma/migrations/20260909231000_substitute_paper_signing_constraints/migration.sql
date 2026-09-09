-- Preserve digital signature checks; paper ink is on the retained scan.
ALTER TABLE "ExpenseSubstituteReceiptEvidence"
  DROP CONSTRAINT "ExpenseSubstituteReceiptEvidence_payer_certified_check",
  DROP CONSTRAINT "ExpenseSubstituteReceiptEvidence_issued_check",
  ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_identity_mode_check" CHECK (
    "payerUserId" IS NOT NULL OR (
      "signatureMode" = 'PAPER' AND "approverUserId" IS NULL
      AND "payerSignatureAttachmentId" IS NULL AND "approverSignatureAttachmentId" IS NULL
    )
  ),
  ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_payer_certified_check" CHECK (
    "status" NOT IN ('PAYER_CERTIFIED', 'ISSUED') OR (
      "snapshotJson" IS NOT NULL AND "snapshotChecksumSha256" IS NOT NULL
      AND "payerPosition" IS NOT NULL AND "certifiedAt" IS NOT NULL AND (
        ("signatureMode" = 'DIGITAL' AND "payerUserId" IS NOT NULL
          AND "payerSignatureAttachmentId" IS NOT NULL AND "payerSignatureChecksumSha256" IS NOT NULL
          AND "certifiedArtifactAttachmentId" IS NOT NULL AND "certifiedArtifactChecksumSha256" IS NOT NULL)
        OR ("signatureMode" = 'PAPER' AND "wetSignedScanAttachmentId" IS NOT NULL
          AND "wetSignedScanChecksumSha256" IS NOT NULL AND (
            ("payerUserId" IS NOT NULL AND "certifiedArtifactAttachmentId" IS NOT NULL AND "certifiedArtifactChecksumSha256" IS NOT NULL)
            OR ("payerUserId" IS NULL AND "status" = 'ISSUED' AND "paperFormSnapshotJson" IS NOT NULL
              AND "paperSubmissionJson" IS NOT NULL AND "paperReviewedByUserId" IS NOT NULL)
          ))
      )
    )
  ),
  ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_issued_check" CHECK (
    "status" <> 'ISSUED' OR (
      "approverName" IS NOT NULL AND "approverPosition" IS NOT NULL AND "approvedAt" IS NOT NULL
      AND "issuedByUserId" IS NOT NULL AND "issuedAt" IS NOT NULL
      AND "artifactAttachmentId" IS NOT NULL AND "checksumSha256" IS NOT NULL AND (
        ("signatureMode" = 'DIGITAL' AND "approverUserId" IS NOT NULL AND "approverSignatureAttachmentId" IS NOT NULL)
        OR ("signatureMode" = 'PAPER' AND "wetSignedScanAttachmentId" IS NOT NULL AND "wetSignedScanChecksumSha256" IS NOT NULL AND (
          ("payerUserId" IS NOT NULL AND "approverUserId" IS NOT NULL)
          OR ("payerUserId" IS NULL AND "approverUserId" IS NULL AND "paperReviewedByUserId" IS NOT NULL
            AND "paperReviewedByUserId" = "issuedByUserId" AND "paperFormSnapshotJson" IS NOT NULL AND "paperSubmissionJson" IS NOT NULL)
        ))
      )
    )
  );
