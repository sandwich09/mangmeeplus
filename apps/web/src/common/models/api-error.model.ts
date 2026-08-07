export type ApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'validation'
  | 'server_error'
  | 'network_error'
  | 'unknown';

export type FieldError = {
  field: string;
  message: string;
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly statusCode?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly fieldErrors?: FieldError[];

  constructor(opts: {
    kind: ApiErrorKind;
    message: string;
    statusCode?: number;
    code?: string;
    requestId?: string;
    fieldErrors?: FieldError[];
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.kind = opts.kind;
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.fieldErrors = opts.fieldErrors;
  }
}
