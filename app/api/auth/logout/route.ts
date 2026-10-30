import { NextRequest, NextResponse } from 'next/server';
import { deleteSession } from '@/lib/auth';
import { rejectCrossOriginRequest } from '@/lib/auth/route-utils';

export async function POST(request: NextRequest) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;

  await deleteSession();
  return NextResponse.json({ success: true });
}
