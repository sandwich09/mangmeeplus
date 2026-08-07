-- Partner member console: encrypted copy of the CURRENT system-generated temporary
-- password (AES-256-GCM, CREDENTIAL_ENCRYPTION_KEY). Set when the system issues a
-- temporary password, cleared the moment the user changes it themselves.
ALTER TABLE "UserCredential" ADD COLUMN "tempPasswordEncrypted" TEXT;
