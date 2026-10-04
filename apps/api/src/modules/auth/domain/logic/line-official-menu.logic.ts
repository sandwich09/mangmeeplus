import contact from './line-official-contact-card.json';
import social from './line-official-social-card.json';

export function officialOaReplyForText(text: string, webBaseUrl: string) {
  const keyword = text.trim().toLowerCase();
  if (['ติดต่อมั่งมีทีม', 'ติดต่อเรา', 'contact us'].includes(keyword)) {
    return structuredClone(contact);
  }
  if (!['social media', 'โซเชียล', 'ติดตามน้องมั่งมี'].includes(keyword)) return null;
  const reply = structuredClone(social);
  for (const row of reply.contents.footer.contents) {
    const icon = row.contents[0];
    if (icon.url) icon.url = new URL(new URL(icon.url).pathname, webBaseUrl).href;
  }
  return reply;
}
