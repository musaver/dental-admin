// Zoom Server-to-Server OAuth API client (server-only).
// Used by the attendance sync route to pull who actually attended a live class.

const ZOOM_OAUTH_URL = "https://zoom.us/oauth/token";
const ZOOM_API_BASE = "https://api.zoom.us/v2";

export interface ZoomMeetingInstance {
  uuid: string;
  start_time: string; // ISO string
}

export interface ZoomParticipant {
  name: string;
  user_email: string;
  join_time: string; // ISO
  leave_time: string; // ISO
  duration: number; // seconds
}

// Cache the account access token in module scope (~1h lifetime) to avoid
// re-authenticating on every API call within the same server instance.
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getZoomAccessToken(): Promise<string> {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error(
      "Zoom credentials missing. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET."
    );
  }

  // Reuse the cached token until ~1 minute before it expires.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(
    `${ZOOM_OAUTH_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoom OAuth failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

async function zoomGet(path: string): Promise<any> {
  const token = await getZoomAccessToken();
  const res = await fetch(`${ZOOM_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoom GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

// A meeting UUID must be double-URL-encoded when it starts with "/" or contains "//".
function encodeMeetingId(id: string): string {
  if (id.startsWith("/") || id.includes("//")) {
    return encodeURIComponent(encodeURIComponent(id));
  }
  return encodeURIComponent(id);
}

// Returns past occurrences of a (recurring) meeting, most recent first.
// For one-off meetings this typically returns a single instance.
export async function getPastMeetingInstances(
  meetingId: string
): Promise<ZoomMeetingInstance[]> {
  try {
    const data = await zoomGet(`/past_meetings/${encodeMeetingId(meetingId)}/instances`);
    const meetings: ZoomMeetingInstance[] = data.meetings || [];
    // Sort newest-first by start_time.
    return meetings.sort(
      (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    );
  } catch (err) {
    // No past instances yet (meeting never started / not ended) -> empty list.
    return [];
  }
}

// Fetches the full participant report for a past meeting instance, following
// pagination. `meetingIdOrUuid` may be a numeric meeting id or an instance UUID.
export async function getMeetingParticipants(
  meetingIdOrUuid: string
): Promise<ZoomParticipant[]> {
  const participants: ZoomParticipant[] = [];
  let nextPageToken = "";

  do {
    const qs = new URLSearchParams({ page_size: "300" });
    if (nextPageToken) qs.set("next_page_token", nextPageToken);

    const data = await zoomGet(
      `/report/meetings/${encodeMeetingId(meetingIdOrUuid)}/participants?${qs.toString()}`
    );

    for (const p of data.participants || []) {
      participants.push({
        name: p.name || "",
        user_email: p.user_email || "",
        join_time: p.join_time,
        leave_time: p.leave_time,
        duration: p.duration || 0,
      });
    }
    nextPageToken = data.next_page_token || "";
  } while (nextPageToken);

  return participants;
}

// Extracts the numeric meeting id from a Zoom join URL, e.g.
// https://us02web.zoom.us/j/85812345678?pwd=abc -> "85812345678".
// Returns null if no id can be parsed.
export function parseZoomMeetingId(url: string): string | null {
  if (!url) return null;
  // /j/{id}, /s/{id}, /w/{id} (webinar), or /my/{vanity} (not numeric -> skip)
  const match = url.match(/\/(?:j|s|w)\/(\d+)/);
  if (match) return match[1];
  return null;
}
