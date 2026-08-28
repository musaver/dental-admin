import {
  BriefcaseMedicalIcon,
  CalendarDaysIcon,
  ChartNoAxesColumnIcon,
  ClipboardListIcon,
  ConciergeBellIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  type LucideIcon,
  MessageSquareIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  TagsIcon,
  TrendingUpIcon,
  UsersIcon,
} from 'lucide-react';
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
  /** A lucide-react component, the same icon set the shadcn primitives use. */
  icon: LucideIcon;
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
      { label: 'Dashboard', href: '/', icon: LayoutDashboardIcon, permission: null },
      {
        label: 'Diary',
        href: '/schedule',
        icon: CalendarDaysIcon,
        permission: PERMISSIONS.APPOINTMENTS_VIEW,
        matchPrefix: true,
      },
      {
        label: 'Front desk',
        href: '/queue',
        icon: ConciergeBellIcon,
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
        icon: UsersIcon,
        permission: PERMISSIONS.PATIENTS_VIEW,
        matchPrefix: true,
      },
      {
        label: 'Treatment plans',
        href: '/treatment-plans',
        icon: ClipboardListIcon,
        permission: PERMISSIONS.TREATMENT_PLANS_VIEW,
        matchPrefix: true,
      },
      {
        label: 'Recalls',
        href: '/recalls',
        icon: RefreshCwIcon,
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
        icon: ReceiptTextIcon,
        permission: PERMISSIONS.BILLING_VIEW,
        matchPrefix: true,
      },
      {
        label: 'Payments',
        href: '/payments',
        icon: CreditCardIcon,
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
        icon: TrendingUpIcon,
        permission: PERMISSIONS.LEADS_VIEW,
        matchPrefix: true,
      },
      {
        label: 'Messages',
        href: '/communications',
        icon: MessageSquareIcon,
        permission: PERMISSIONS.LEADS_VIEW,
      },
      { label: 'Tasks', href: '/tasks', icon: ListChecksIcon, permission: null, matchPrefix: true },
    ],
  },
  {
    key: 'insight',
    label: 'Reports',
    items: [
      {
        label: 'Clinical',
        href: '/reports/clinical',
        icon: StethoscopeIcon,
        permission: PERMISSIONS.REPORTS_CLINICAL,
      },
      {
        label: 'Financial',
        href: '/reports/financial',
        icon: ChartNoAxesColumnIcon,
        permission: PERMISSIONS.REPORTS_FINANCIAL,
      },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    items: [
      {
        label: 'Staff',
        href: '/admins',
        icon: BriefcaseMedicalIcon,
        permission: PERMISSIONS.STAFF_MANAGE,
        matchPrefix: true,
      },
      {
        label: 'Roles',
        href: '/roles',
        icon: ShieldCheckIcon,
        permission: PERMISSIONS.ROLES_MANAGE,
        matchPrefix: true,
      },
      {
        label: 'Procedures',
        href: '/procedures',
        icon: TagsIcon,
        permission: PERMISSIONS.PROCEDURES_MANAGE,
        matchPrefix: true,
      },
      {
        label: 'Settings',
        href: '/settings',
        icon: SettingsIcon,
        permission: PERMISSIONS.SETTINGS_MANAGE,
        matchPrefix: true,
      },
      {
        label: 'Audit log',
        href: '/audit',
        icon: ScrollTextIcon,
        permission: PERMISSIONS.AUDIT_VIEW,
        matchPrefix: true,
      },
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
