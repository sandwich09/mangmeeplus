import { LLMS_SUMMARY, wikiResponse } from '@/features/public-home/home-wiki';
export function GET() { return wikiResponse(LLMS_SUMMARY); }
