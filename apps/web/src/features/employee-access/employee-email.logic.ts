/** Match the API's basic email boundary, including an alphabetic top-level domain. */
export function isEmployeeEmail(value: string): boolean {
  return value.trim().length <= 254
    && /^[^@\s]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(value.trim());
}
