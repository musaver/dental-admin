import { PERMISSIONS, type Permission } from '@/lib/permissions';

/**
 * The clinic's navigation, arranged around how a day actually runs rather
 * than around the database tables.
 *
 * Every entry declares the permission that reveals it. A receptionist should
 * not see a "Reports" section they cannot open, and an assistant should not
 * see Billing at all — hiding what someone cannot use is most of what makes a
 * role feel coherent.
 *
 * Hiding is presentation only. The authorisation boundary is
 * requirePermission() on the server; a hidden link is not a protected one.
 */

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  /** null means every signed-in staff member sees it. */
  permission: Permission | null;
  /** Highlight for /patients/123 as well as /patients. */
  matchPrefix?: boolean;
}

export interface NavSection {
  key: string;
  label: string | null;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    key: 'today',
    label: null,
    items: [
      { label: 'Dashboard', href: '/', icon: '📊', permission: null },
      {
        label: 'Diary',
        href: '/schedule',
        icon: '📅',
        permission: PERMISSIONS.APPOINTMENTS_VIEW,
        matchPrefix: true,
      },
      {
        label: 'Front desk',
        href: '/queue',
        icon: '🔔',
        permission: PERMISSIONS.APPOINTMENTS_VIEW,
      },
    ],
  },
  {
    key: 'care',
    label: 'Patient care',
    items: [
      {
        label: 'Patients',
        href: '/patients',
        icon: '🦷',
        permission: PERMISSIONS.PATIENTS_VIEW,
        matchPrefix: true,
      },
      {
        label: 'Treatment plans',
        href: '/treatment-plans',
        icon: '📋',
        permission: PERMISSIONS.TREATMENT_PLANS_VIEW,
        matchPrefix: true,
      },
      {
        label: 'Recalls',
        href: '/recalls',
        icon: '🔄',
        permission: PERMISSIONS.RECALLS_MANAGE,
      },
    ],
  },
  {
    key: 'money',
    label: 'Billing',
    items: [
      {
        label: 'Invoices',
        href: '/billing',
        icon: '💰',
        permission: PERMISSIONS.BILLING_VIEW,
        matchPrefix: true,
      },
      {
        label: 'Payments',
        href: '/payments',
        icon: '💳',
        permission: PERMISSIONS.PAYMENTS_RECORD,
        matchPrefix: true,
      },
    ],
  },
  {
    key: 'growth',
    label: 'Growth',
    items: [
      {
        label: 'Leads',
        href: '/leads',
        icon: '📈',
        permission: PERMISSIONS.LEADS_VIEW,
        matchPrefix: true,
      },
      {
        label: 'Messages',
        href: '/communications',
        icon: '✉️',
        permission: PERMISSIONS.LEADS_VIEW,
      },
      { label: 'Tasks', href: '/tasks', icon: '✅', permission: null, matchPrefix: true },
    ],
  },
  {
    key: 'insight',
    label: 'Reports',
    items: [
      {
        label: 'Clinical',
        href: '/reports/clinical',
        icon: '🩺',
        permission: PERMISSIONS.REPORTS_CLINICAL,
      },
      {
        label: 'Financial',
        href: '/reports/financial',
        icon: '📉',
        permission: PERMISSIONS.REPORTS_FINANCIAL,
      },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    items: [
      { label: 'Staff', href: '/admins', icon: '👥', permission: PERMISSIONS.STAFF_MANAGE, matchPrefix: true },
      { label: 'Roles', href: '/roles', icon: '🔐', permission: PERMISSIONS.ROLES_MANAGE, matchPrefix: true },
      {
        label: 'Procedures',
        href: '/procedures',
        icon: '🧾',
        permission: PERMISSIONS.PROCEDURES_MANAGE,
        matchPrefix: true,
      },
      {
        label: 'Settings',
        href: '/settings',
        icon: '⚙️',
        permission: PERMISSIONS.SETTINGS_MANAGE,
        matchPrefix: true,
      },
      { label: 'Audit log', href: '/audit', icon: '🛡️', permission: PERMISSIONS.AUDIT_VIEW, matchPrefix: true },
    ],
  },
];

/** Sections the caller can actually use. Empty sections are dropped entirely. */
export function visibleNavigation(permissions: readonly string[]): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.permission === null || permissions.includes(item.permission)
    ),
  })).filter((section) => section.items.length > 0);
}

/**
 * Is this nav item the current page?
 *
 * The previous implementation compared for exact equality, so /patients/123
 * left "Patients" unhighlighted and the sidebar looked broken on every detail
 * page. Prefix matching fixes that, while '/' stays exact so it does not match
 * everything.
 */
export function isActiveNavItem(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/';
  if (item.matchPrefix) {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return pathname === item.href;
}
