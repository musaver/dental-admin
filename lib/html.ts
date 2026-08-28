/**
 * HTML escaping for anything interpolated into an email template.
 *
 * Promoted out of lib/email.ts, where it existed but was not exported and so
 * invited a copy-paste. Every template variable goes through here — a
 * patient's name is user-supplied data landing in someone's inbox.
 */
export function escapeHtml(text: string | number | null | undefined): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Escape, then turn newlines into <br> for a free-text note. */
export function nl2br(text: string | null | undefined): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}
