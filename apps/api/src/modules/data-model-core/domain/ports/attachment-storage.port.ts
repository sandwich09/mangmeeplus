export const ATTACHMENT_STORAGE = Symbol('AttachmentStoragePort');

export type CreateUploadIntentInput = {
  companyId: string;
  objectKey: string;
  mimeType: string;
  byteSize: number;
  expiresInSeconds?: number;
};

export type UploadIntent = {
  uploadUrl: string;
  uploadMethod: 'PUT' | 'POST';
  uploadHeaders: Record<string, string>;
  objectKey: string;
  bucket: string;
  storageProvider: string;
  expiresAt: Date;
};

export type CreateDownloadUrlInput = {
  bucket: string;
  objectKey: string;
  objectVersionId?: string;
  mimeType?: string;
  fileName?: string;
  expiresInSeconds?: number;
  /**
   * Opt-in preview mode; defaults to `attachment`. Honoured only for the mime types
   * `downloadContentDisposition` considers safe to render. Local storage sets no disposition
   * header at all, so it is already inline and ignores this.
   */
  disposition?: 'inline' | 'attachment';
};

export type SignedDownloadUrl = {
  url: string;
  expiresAt: Date;
};

export type GetObjectMetadataInput = {
  bucket: string;
  objectKey: string;
  objectVersionId?: string;
};

export type GetObjectInput = {
  bucket: string;
  objectKey: string;
  objectVersionId?: string;
};

export type PutObjectInput = {
  objectKey: string;
  mimeType: string;
  bytes: Buffer;
};

export type PutObjectResult = {
  bucket: string;
  objectKey: string;
  storageProvider: string;
  byteSize: number;
  checksumSha256: string;
  objectVersionId: string;
};

export type DeleteObjectInput = GetObjectInput;

export type GetExactObjectVersionInventoryInput = {
  bucket: string;
  objectKey: string;
  /** Provider page size. Paginated adapters must reject values outside their hard safety bound. */
  pageSize?: number;
  /** Maximum pages to inspect. Paginated adapters must throw instead of returning partial inventory. */
  maxPages?: number;
};

export type StoredObjectVersionInventoryEntry = {
  versionId: string;
  isLatest: boolean;
  lastModified?: Date;
  byteSize?: number;
  eTag?: string;
  objectLockMode?: 'GOVERNANCE' | 'COMPLIANCE';
  objectLockRetainUntil?: Date;
  objectLockLegalHoldStatus?: 'ON' | 'OFF';
  /**
   * Proof that the adapter explicitly checked the provider's lock state for this
   * version. Header omission alone is not proof: S3 can omit Object Lock fields
   * when the caller lacks the dedicated read permissions.
   */
  objectLockMetadataVerified: true;
};

export type StoredObjectDeleteMarkerInventoryEntry = {
  versionId: string;
  isLatest: boolean;
  lastModified?: Date;
};

export type ExactObjectVersionInventory = {
  bucket: string;
  objectKey: string;
  /** Bucket-level state obtained from the provider, never inferred from missing object headers. */
  objectLockConfiguration: 'DISABLED' | 'ENABLED';
  versions: StoredObjectVersionInventoryEntry[];
  deleteMarkers: StoredObjectDeleteMarkerInventoryEntry[];
  pagesScanned: number;
  /** Literal proof that the adapter reached the provider's final page. */
  complete: true;
};

export type StoredObject = {
  bytes: Buffer;
  mimeType?: string;
};

export type StoredObjectMetadata = {
  byteSize: number;
  mimeType?: string;
  checksumSha256?: string;
  objectVersionId?: string;
  exists: boolean;
};

export interface AttachmentStoragePort {
  createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent>;
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedDownloadUrl>;
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
  getExactObjectVersionInventory(input: GetExactObjectVersionInventoryInput): Promise<ExactObjectVersionInventory>;
  getObjectMetadata(input: GetObjectMetadataInput): Promise<StoredObjectMetadata>;
  getObject(input: GetObjectInput): Promise<StoredObject>;
}
