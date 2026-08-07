export type { ResolvedAccess } from '../ports/permission-resolver.port';

export class PermissionSet {
  private readonly set: Set<string>;

  constructor(permissions: string[]) {
    this.set = new Set(permissions);
  }

  has(key: string): boolean {
    return this.set.has(key);
  }

  hasAll(keys: string[]): boolean {
    return keys.every((k) => this.set.has(k));
  }

  toArray(): string[] {
    return [...this.set];
  }
}
