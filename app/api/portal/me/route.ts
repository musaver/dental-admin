import { NextResponse } from 'next/server';
import { requirePortalContext } from '@/lib/portal-auth';
import { toErrorResponse } from '@/lib/rbac';

/** Who am I, and which records can I see? */
export async function GET() {
  try {
    const ctx = await requirePortalContext();
    return NextResponse.json({
      email: ctx.email,
      name: ctx.name,
      patients: ctx.patients,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
