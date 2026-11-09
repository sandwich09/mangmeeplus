/** A record reference, with optional bill description between the noun and recency marker. */
export function lineRecentRecordReference(text: string): boolean {
  return /(?:อัน|ตัว|ใบ)(?:นี้|นั้น|เมื่อกี้)|(?:ใบเสร็จ|ใบเบิก|บิล|เอกสาร|รายการ|รูป)(?:นี้|นั้น|ที่แล้ว|[^\s\d,，。!?]{0,30}?(?:เมื่อกี้|ล่าสุด|ที่เพิ่งส่ง|ที่ส่งไป))/u.test(text);
}
