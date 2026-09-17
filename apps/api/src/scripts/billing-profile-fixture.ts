/** Synthetic billing prerequisites shared by the isolated HTTP acceptance suites. */
export const BILLING_TEST_ADDRESS = { line1: '99 ถนนทดสอบ', line2: null, subdistrict: 'คลองเตย',
  district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' };

export function applySyntheticCustomerFields(customer: Record<string, any>, form: URLSearchParams) {
  for (const key of ['email', 'name']) if (form.has(key)) customer[key] = form.get(key);
  if (form.has('address[line1]')) customer.address = Object.fromEntries(
    ['country', 'line1', 'line2', 'city', 'state', 'postal_code'].map(key => [key, form.get(`address[${key}]`)]));
  return customer;
}
