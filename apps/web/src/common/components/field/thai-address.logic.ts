import type { ThaiAddressOption } from '@watchdog-bms/contracts';

export type ThaiAddressValue = {
  postalCode: string;
  province: string;
  district: string;
  subdistrict: string;
};

export const uniqueAddressValues = (values: string[]) => [...new Set(values)];

/** Fill only values that have one unambiguous answer; otherwise the user chooses from the list. */
export function autofillThaiAddress(value: ThaiAddressValue, rows: ThaiAddressOption[]): ThaiAddressValue {
  const postalCodes = uniqueAddressValues(rows.map((row) => row.postalCode));
  const provinces = uniqueAddressValues(rows.map((row) => row.provinceTh));
  const province = value.province || (provinces.length === 1 ? provinces[0]! : '');
  const districts = uniqueAddressValues(rows.filter((row) => row.provinceTh === province).map((row) => row.districtTh));
  const district = value.district || (districts.length === 1 ? districts[0]! : '');
  const subdistricts = uniqueAddressValues(rows
    .filter((row) => row.provinceTh === province && row.districtTh === district)
    .map((row) => row.subdistrictTh));
  return {
    postalCode: value.postalCode.length < 5 && postalCodes.length === 1 ? postalCodes[0]! : value.postalCode,
    province,
    district,
    subdistrict: value.subdistrict || (subdistricts.length === 1 ? subdistricts[0]! : ''),
  };
}
