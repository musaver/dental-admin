// Brevo (Sendinblue) email helpers for the admin project.
// Uses the transactional email REST API with BREVO_API_KEY (already in admin/.env).

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const SENDER = { name: 'School of Islam', email: 'support@schoolofislam.net' };

export async function sendHtmlEmail(to: string, subject: string, html: string) {
  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    console.error('Brevo Error:', error);
    throw new Error(error.message || 'Failed to send email');
  }

  return res.json();
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Builds a simple, safe HTML body for an announcement and sends it.
export async function sendAnnouncementEmail(
  to: string,
  announcement: { title: string; description?: string | null; url?: string | null }
) {
  const { title, description, url } = announcement;

  const safeTitle = escapeHtml(title);
  const safeBody = description ? escapeHtml(description).replace(/\n/g, '<br>') : '';

  const button = url
    ? `<p style="margin:24px 0;">
         <a href="${escapeHtml(url)}" target="_blank"
            style="background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;display:inline-block;font-weight:600;">
           View details
         </a>
       </p>`
    : '';

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
      <h2 style="color:#111827;margin-bottom:8px;">${safeTitle}</h2>
      <div style="font-size:15px;line-height:1.6;color:#374151;">${safeBody}</div>
      ${button}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="font-size:12px;color:#9ca3af;">You are receiving this because you are enrolled with School of Islam.</p>
    </div>`;

  return sendHtmlEmail(to, title, html);
}
