type Row = Record<string, any>;
export const expenseCaptureFieldRole = (row: Row, field: string): string => `${row['role'] ?? row['kind'] ?? row['event'] ?? row['state'] ?? row['status'] ?? 'document'}:${field}`;
