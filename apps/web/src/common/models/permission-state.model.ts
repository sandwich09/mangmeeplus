export type PermissionState =
  | 'allowed'      // user has full read + write access
  | 'readonly'     // user can read but not mutate
  | 'forbidden'    // user cannot access the resource at all
  | 'signed_out';  // no session

export type PermissionStateOptions = {
  canRead: boolean;
  canWrite: boolean;
  isSignedIn: boolean;
};
