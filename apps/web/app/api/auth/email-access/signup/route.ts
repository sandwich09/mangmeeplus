import type { NextRequest } from 'next/server';
import { emailAccessBff } from '@/features/auth/email-access-bff.server';
export function POST(request: NextRequest) { return emailAccessBff(request, 'signup'); }
