import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { messageTemplates } from '@/lib/schema';
import { TEMPLATES } from '@/lib/comm-templates';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';

/**
 * The template catalogue: the code-defined defaults, annotated with whether a
 * database override is active. (The catalogue lives in code and cannot be
 * imported by a client component — lib/comm-templates pulls in the database.)
 */
export const GET = withAuth(PERMISSIONS.SETTINGS_MANAGE, async () => {
  const overrides = await db.select().from(messageTemplates);

  return NextResponse.json(
    TEMPLATES.map((template) => ({
      key: template.key,
      name: template.name,
      description: template.description,
      variables: template.variables,
      overridden: overrides.some((o) => o.templateKey === template.key && o.isActive),
    }))
  );
});
