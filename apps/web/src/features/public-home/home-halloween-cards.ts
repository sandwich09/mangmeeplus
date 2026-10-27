export type GhostRegion = 'thai' | 'western' | 'japanese' | 'chinese' | 'korean' | 'secret';
export type GhostCard = { id: string; name: string; region: GhostRegion; tag: string; quote: readonly string[]; image: string };

export const STANDARD_CARD_BACK = '/home/events/halloween/cards/back-standard.png';
export const SECRET_CARD_BACK = '/home/events/halloween/cards/back-secret.png';
export const HALLOWEEN_URL = 'https://mangmeeplus.com/halloween';
export const HALLOWEEN_HOME_URL = 'https://mangmeeplus.com';
export const HALLOWEEN_LINE_URL = 'https://line.me/R/ti/p/@mangmeeplus';

export const GHOST_CARDS: readonly GhostCard[] = [
  {
    "id": "01-krasue",
    "name": "กระสือ",
    "region": "thai",
    "tag": "สายล่องลอย",
    "quote": [
      "ตัวไม่อยู่ในวง",
      "แต่รู้ทุกเรื่อง"
    ],
    "image": "/home/events/halloween/cards/01-krasue.png"
  },
  {
    "id": "02-krahang",
    "name": "กระหัง",
    "region": "thai",
    "tag": "สายบินกลางคืน",
    "quote": [
      "บินได้ทั้งคืน",
      "แต่ตื่นไปทำงานไม่ได้"
    ],
    "image": "/home/events/halloween/cards/02-krahang.png"
  },
  {
    "id": "03-mae-nak",
    "name": "แม่นาก",
    "region": "thai",
    "tag": "สายรักมั่นคง",
    "quote": [
      "รักเธอจนตาย",
      "อ้าว… ตายแล้วนี่หว่า"
    ],
    "image": "/home/events/halloween/cards/03-mae-nak.png"
  },
  {
    "id": "04-nang-tani",
    "name": "นางตานี",
    "region": "thai",
    "tag": "สายหวานซ่อนซน",
    "quote": [
      "อยู่นานจนกล้วยสุก",
      "ยังโสดอยู่เลยจ้า"
    ],
    "image": "/home/events/halloween/cards/04-nang-tani.png"
  },
  {
    "id": "05-nang-takhian",
    "name": "นางตะเคียน",
    "region": "thai",
    "tag": "สายรักธรรมชาติ",
    "quote": [
      "ขูดเลขกันเบา ๆ",
      "จะไม่เหลือเปลือกแล้วแม่"
    ],
    "image": "/home/events/halloween/cards/05-nang-takhian.png"
  },
  {
    "id": "06-pop",
    "name": "ปอบ",
    "region": "thai",
    "tag": "สายหิวตลอดกาล",
    "quote": [
      "ขอจกได้ไหม",
      "ตับไตของเธอ"
    ],
    "image": "/home/events/halloween/cards/06-pop.png"
  },
  {
    "id": "07-pret",
    "name": "เปรต",
    "region": "thai",
    "tag": "สายสูงแต่ติดดิน",
    "quote": [
      "ขอเงินเดือน",
      "เท่าส่วนสูงได้ไหมบอส"
    ],
    "image": "/home/events/halloween/cards/07-pret.png"
  },
  {
    "id": "08-kuman-thong",
    "name": "กุมารทอง",
    "region": "thai",
    "tag": "สายซนตัวจิ๋ว",
    "quote": [
      "เลี้ยงง่าย ไม่ดื้อ",
      "แค่ต้องซื้อของเล่น"
    ],
    "image": "/home/events/halloween/cards/08-kuman-thong.png"
  },
  {
    "id": "09-dracula",
    "name": "แดร็กคูลา",
    "region": "western",
    "tag": "หล่อหลังเที่ยงคืน",
    "quote": [
      "แพ้แสงตอนกลางวัน",
      "แพ้เธอตอนกลางคืน"
    ],
    "image": "/home/events/halloween/cards/09-dracula.png"
  },
  {
    "id": "10-werewolf",
    "name": "มนุษย์หมาป่า",
    "region": "western",
    "tag": "สายปล่อยของ",
    "quote": [
      "แบบพี่",
      "พอจะเป็นหมาเด็กได้ไหมครับ"
    ],
    "image": "/home/events/halloween/cards/10-werewolf.png"
  },
  {
    "id": "11-zombie",
    "name": "ซอมบี้",
    "region": "western",
    "tag": "สายทำงานหนัก",
    "quote": [
      "กายหยาบอยู่ออฟฟิศ",
      "ดวงจิตอยู่ที่บ้าน"
    ],
    "image": "/home/events/halloween/cards/11-zombie.png"
  },
  {
    "id": "12-mummy",
    "name": "มัมมี่",
    "region": "western",
    "tag": "สายพันใจ",
    "quote": [
      "พันปีไม่เคยแกะ",
      "กลัวไม่ตรงปก"
    ],
    "image": "/home/events/halloween/cards/12-mummy.png"
  },
  {
    "id": "13-frankenstein",
    "name": "อสูรแฟรงเกนสไตน์",
    "region": "western",
    "tag": "สายจริงใจ",
    "quote": [
      "ประกอบมาหลายส่วน",
      "ส่วนมากคือความหล่อ"
    ],
    "image": "/home/events/halloween/cards/13-frankenstein.png"
  },
  {
    "id": "14-pancake",
    "name": "อีแพนเค้ก",
    "region": "thai",
    "tag": "สายฟาดตัวแม่",
    "quote": [
      "ขอบคุณมากนะคะ",
      "ที่คุณเรียกฉันช็อกกะรี"
    ],
    "image": "/home/events/halloween/cards/14-pancake.png"
  },
  {
    "id": "15-payoon",
    "name": "เจ๊พะยูน",
    "region": "thai",
    "tag": "สายปฏิเสธไว้ก่อน",
    "quote": [
      "รู้ไหม ใครฆ่าอารียา",
      "พยูน……… ไม่ได้ฆ่า"
    ],
    "image": "/home/events/halloween/cards/15-payoon.png"
  },
  {
    "id": "16-the-nun",
    "name": "เดอะนัน",
    "region": "western",
    "tag": "สายสวดตัวแม่",
    "quote": [
      "สวดมนต์ไม่ถนัด",
      "สวดคนอื่นจัดให้",
      "สาดไปสมาชิก"
    ],
    "image": "/home/events/halloween/cards/16-the-nun.png"
  },
  {
    "id": "17-turbo-granny",
    "name": "ยายสปีด",
    "region": "japanese",
    "tag": "สายซิ่งไม่พัก",
    "quote": [
      "ไม่ได้รีบไปเกิด",
      "รีบไปเผือก"
    ],
    "image": "/home/events/halloween/cards/17-turbo-granny.png"
  },
  {
    "id": "18-taew",
    "name": "เจ๊แต๋ว",
    "region": "thai",
    "tag": "สายจิกตัวแม่",
    "quote": [
      "ห้ะ!",
      "มึงด่ากูหรอ"
    ],
    "image": "/home/events/halloween/cards/18-taew.png"
  },
  {
    "id": "19-jiangshi",
    "name": "เจียงซือ",
    "region": "chinese",
    "tag": "สายกระโดด",
    "quote": [
      "กระโดดข้ามภพได้",
      "แต่ข้ามสถานะเพื่อนไม่ไหว"
    ],
    "image": "/home/events/halloween/cards/19-jiangshi.png"
  },
  {
    "id": "20-red-bride",
    "name": "ผีเจ้าสาวแดง",
    "region": "chinese",
    "tag": "สายรักข้ามภพ",
    "quote": [
      "ชุดพร้อม งานพร้อม",
      "เจ้าบ่าวอยู่ไหนก่อน"
    ],
    "image": "/home/events/halloween/cards/20-red-bride.png"
  },
  {
    "id": "21-chonggak-gwishin",
    "name": "ชองกักควีชิน",
    "region": "korean",
    "tag": "ผีหนุ่มโสด",
    "quote": [
      "เป็นผีธรรมดา ไม่สะดุดตาใคร",
      "ส่วนใหญ่สะดุด",
      "โต๊ะ ตู้ เตียง เก้าอี้"
    ],
    "image": "/home/events/halloween/cards/21-chonggak-gwishin.png"
  },
  {
    "id": "22-cheonyeo-gwishin",
    "name": "ชอเนอกวีชิน",
    "region": "korean",
    "tag": "ผีสาวพรหมจารี",
    "quote": [
      "รอมนุษย์คนแรกเท่านั้น"
    ],
    "image": "/home/events/halloween/cards/22-cheonyeo-gwishin.png"
  },
  {
    "id": "23-mangmee-secret",
    "name": "น้องมั่งมี จอมเวทฟักทอง",
    "region": "secret",
    "tag": "สายป่วนชวนยิ้ม",
    "quote": [
      "เวทมนตร์อาจมีวันหมด",
      "แต่ความน่ารักไม่มีวันหยุด"
    ],
    "image": "/home/events/halloween/cards/23-mangmee-secret.png"
  }
];

export function getGhostCard(id: string | undefined): GhostCard | undefined {
  return GHOST_CARDS.find(card => card.id === id);
}

// 1,000 equally likely buckets: 10 secret, 45 for each of 22 ordinary cards.
export function ghostCardForBucket(bucket: number): GhostCard {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= 1000) throw new RangeError('Invalid draw bucket');
  return GHOST_CARDS[bucket < 10 ? 22 : Math.floor((bucket - 10) / 45)];
}

export function ghostShareUrl(card: GhostCard): string {
  if (!getGhostCard(card.id)) throw new RangeError('Unknown ghost card');
  return `${HALLOWEEN_URL}/${encodeURIComponent(card.id)}`;
}
