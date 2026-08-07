export interface IJwtVerifier {
  /** `tokenId` is present on session verifiers (L-05); the LINE ID-token verifier has no session. */
  verify(token: string): Promise<{ subject: string; tokenId?: string }>;
}
