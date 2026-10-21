import { LLMS_FULL, wikiResponse } from '@/features/public-home/home-wiki';
export function GET() { return wikiResponse(LLMS_FULL); }
