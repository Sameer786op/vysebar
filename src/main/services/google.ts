// Sign in with Google: your name and photo in VyseBar, and Gmail and Search Console widgets.
// Google's flow for desktop apps: the browser opens Google's sign-in page, Google sends the
// answer back to a one-time listener on 127.0.0.1, and VyseBar trades it (with PKCE) for an ID
// token that carries your name, email and photo. Only the basic profile scopes are asked for,
// so Google shows no "unverified app" screen and the sign-in doesn't expire after a week.
// The Gmail and Search Console widgets ask for one more read-only scope each, only when you
// allow it on their card (Google's incremental consent: the same sign-in, one more permission).
// The OAuth client is your own (Settings › Accounts explains how to make one); the refresh
// token is encrypted with Windows' data protection and only ever sent to Google.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { app, ipcMain, safeStorage, shell } from "electron";
import type { GoogleProfile } from "@shared/types";
import { settings } from "../store";
import { defineTopic, poller, publish, refreshTopic } from "../topics";
import { getJson, request } from "./online";
import { removeFileSoon, writeFileAtomicSoon } from "../files";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const SCOPES = "openid profile email";
/** extra read-only access, asked for one at a time */
const EXTRA = {
  gmail: "https://www.googleapis.com/auth/gmail.metadata",
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
} as const;
type Extra = keyof typeof EXTRA;
const EXTRA_NAME: Record<Extra, string> = { gmail: "Gmail", searchConsole: "Search Console" };
const API_PAGE: Record<Extra, string> = {
  gmail: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
  searchConsole: "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com",
};

const dir = app.getPath("userData");
const profileFile = join(dir, "google-profile.json");
const tokenFile = join(dir, "google-token.bin");
const scopesFile = join(dir, "google-scopes.json");

// which scopes Google has granted, as its last token answer listed them
let granted: string[] = [];
try {
  if (existsSync(scopesFile)) granted = JSON.parse(readFileSync(scopesFile, "utf8")) as string[];
} catch {
  granted = [];
}
function saveScopes(scope: string | undefined): void {
  if (!scope) return;
  granted = scope.split(/\s+/).filter(Boolean);
  writeFileSync(scopesFile, JSON.stringify(granted));
}

// a 192 px photo is some 20-40 KB; anything far bigger isn't what was asked for
const MAX_PHOTO = 256 * 1024;
let profile: GoogleProfile | null = null;
try {
  if (existsSync(profileFile)) profile = JSON.parse(readFileSync(profileFile, "utf8")) as GoogleProfile;
  // a full-size original kept from before the size was always asked for (megabytes, read,
  // written and sent to every window): the daily refresh brings a small one
  if (profile?.photo && profile.photo.length > MAX_PHOTO) profile = { ...profile, photo: null };
} catch {
  profile = null;
}

function saveProfile(p: GoogleProfile | null): void {
  profile = p;
  if (p) writeFileAtomicSoon(profileFile, JSON.stringify(p));
  else removeFileSoon(profileFile);
  publish("profile", p);
}

function saveToken(refresh: string | null): void {
  if (!refresh) return void rmSync(tokenFile, { force: true });
  // Windows' DPAPI under the hood: readable only by this Windows account on this PC
  writeFileSync(tokenFile, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(refresh) : Buffer.from(refresh, "utf8"));
}

function loadToken(): string | null {
  try {
    const raw = readFileSync(tokenFile);
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8");
  } catch {
    return null;
  }
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

type Tokens = { id_token?: string; refresh_token?: string; access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await request(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const j = (await res.json().catch(() => ({}))) as Tokens;
  if (!res.ok || j.error) throw Object.assign(new Error(j.error_description || j.error || `${res.status} ${res.statusText}`), { code: j.error });
  return j;
}

/** the ID token came straight from Google over TLS, so its claims can be read as they are */
function claims(idToken: string): Record<string, unknown> {
  const part = idToken.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
}

async function photoOf(url: unknown): Promise<string | null> {
  if (typeof url !== "string" || !/^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(url)) return null;
  try {
    // Google's picture links take a size after "=" (=s96-c, =s96-c-mo, =w100-h100), and one
    // without gives the full original, megabytes: always ask for one sharp enough for a 2x tile
    const sized = `${url.replace(/=[swh]\d[\w-]*$/, "")}=s192-c`;
    const res = await request(sized);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    const photo = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    return photo.length <= MAX_PHOTO ? photo : null;
  } catch {
    return null;
  }
}

async function profileFrom(idToken: string): Promise<GoogleProfile> {
  const c = claims(idToken);
  const name = String(c.name ?? c.given_name ?? c.email ?? "Google account");
  return {
    name,
    givenName: String(c.given_name ?? name.split(" ")[0]),
    email: String(c.email ?? ""),
    photo: (await photoOf(c.picture)) ?? profile?.photo ?? null,
    valid: true,
  };
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>VyseBar</title><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#111113;color:#f5f5f7;font:15px/1.5 "Segoe UI Variable","Segoe UI",system-ui,sans-serif}
  div{text-align:center;max-width:380px;padding:24px}h1{font-size:22px;font-weight:600;margin:0 0 6px}p{margin:0;color:#a1a1a6}
  </style><div><h1>${title}</h1><p>${body}</p></div>`;

let pending: Promise<{ ok: true } | { error: string }> | null = null;

/** opens Google's sign-in page in the browser and waits (up to five minutes) for the answer */
function signIn(extra?: Extra): Promise<{ ok: true } | { error: string }> {
  pending ??= run(extra).finally(() => (pending = null));
  return pending;
}

async function run(extra?: Extra): Promise<{ ok: true } | { error: string }> {
  const { clientId, clientSecret } = settings.value.google;
  if (!clientId.trim()) return { error: "Add your OAuth client ID first." };
  const verifier = b64url(randomBytes(48));
  const state = b64url(randomBytes(16));
  const challenge = b64url(createHash("sha256").update(verifier).digest());

  let finish: (r: { code?: string; error?: string }) => void = () => {};
  const answered = new Promise<{ code?: string; error?: string }>((r) => (finish = r));
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname !== "/") {
      res.writeHead(404).end();
      return;
    }
    const code = u.searchParams.get("code");
    const err = u.searchParams.get("error");
    const ok = !!code && u.searchParams.get("state") === state;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ok ? page("You're signed in", "You can close this tab and go back to VyseBar.") : page("Sign-in didn't finish", err === "access_denied" ? "You cancelled it. You can try again from VyseBar's settings." : "Try again from VyseBar's settings."));
    finish(ok ? { code: code! } : { error: err === "access_denied" ? "Sign-in was cancelled." : "Google didn't sign you in." });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const timer = setTimeout(() => finish({ error: "Sign-in timed out." }), 5 * 60_000);
  try {
    const url = new URL(AUTH);
    const params: Record<string, string> = {
      client_id: clientId.trim(),
      redirect_uri: redirect,
      response_type: "code",
      scope: extra ? `${SCOPES} ${EXTRA[extra]}` : SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      // keeps what was granted before, so adding Gmail doesn't drop Search Console
      include_granted_scopes: "true",
      prompt: extra ? "consent" : "consent select_account",
    };
    if (extra && profile?.email) params.login_hint = profile.email;
    url.search = new URLSearchParams(params).toString();
    await shell.openExternal(url.toString());
    const a = await answered;
    if (!a.code) return { error: a.error ?? "Google didn't sign you in." };
    const t = await tokenRequest({
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      code: a.code,
      code_verifier: verifier,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    });
    if (!t.id_token) return { error: "Google sent no profile." };
    const first = !profile;
    if (t.refresh_token) saveToken(t.refresh_token);
    saveScopes(t.scope);
    access = null;
    saveProfile(await profileFrom(t.id_token));
    if (extra && !granted.includes(EXTRA[extra])) return { error: `Google didn't give ${EXTRA_NAME[extra]} access: tick its box on Google's page.` };
    // the first time, the Start tile shows your photo (Appearance › Start tile changes it back)
    if (first && settings.value.startTile === "windows" && profile?.photo) settings.set({ startTile: "google" });
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "invalid_client" || code === "unauthorized_client") return { error: "Google didn't accept the client ID or secret. Check that both were copied whole, from a Desktop app client." };
    return { error: (e as Error).message };
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

async function signOut(): Promise<void> {
  const token = loadToken();
  saveToken(null);
  saveProfile(null);
  granted = [];
  access = null;
  rmSync(scopesFile, { force: true });
  if (settings.value.startTile === "google") settings.set({ startTile: "windows" });
  if (token) await request(`${REVOKE}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
}

/** a changed name or photo comes through once a day */
async function refreshProfile(): Promise<void> {
  const token = loadToken();
  const { clientId, clientSecret } = settings.value.google;
  if (!token || !profile || !clientId) return;
  try {
    const t = await tokenRequest({ client_id: clientId.trim(), client_secret: clientSecret.trim(), refresh_token: token, grant_type: "refresh_token" });
    if (t.id_token) saveProfile(await profileFrom(t.id_token));
  } catch (e) {
    // revoked from the Google account page, or the client was deleted: keep the cached name
    if ((e as { code?: string }).code === "invalid_grant") saveProfile({ ...profile, valid: false });
  }
}

// ---------- Gmail and Search Console ----------

type Need = { error: string; connect?: "signin" | "grant"; enable?: string };
let access: { token: string; until: number } | null = null;
let refreshing: Promise<string | Need> | null = null;

/** a short-lived access token for an extra scope, or what the card should ask for */
async function accessFor(extra: Extra): Promise<string | Need> {
  if (!profile || !loadToken()) return { error: "Sign in with Google first", connect: "signin" };
  if (!granted.includes(EXTRA[extra])) return { error: `Allow ${EXTRA_NAME[extra]} access`, connect: "grant" };
  if (access && access.until > Date.now() + 60_000) return access.token;
  refreshing ??= (async (): Promise<string | Need> => {
    const { clientId, clientSecret } = settings.value.google;
    try {
      const t = await tokenRequest({ client_id: clientId.trim(), client_secret: clientSecret.trim(), refresh_token: loadToken()!, grant_type: "refresh_token" });
      if (!t.access_token) return { error: "Google sent no access token" };
      saveScopes(t.scope);
      access = { token: t.access_token, until: Date.now() + (t.expires_in ?? 3600) * 1000 };
      return access.token;
    } catch (e) {
      if ((e as { code?: string }).code === "invalid_grant") {
        if (profile) saveProfile({ ...profile, valid: false });
        return { error: "Google ended the sign-in: sign in again in Settings", connect: "signin" };
      }
      return { error: (e as Error).message };
    } finally {
      refreshing = null;
    }
  })();
  const r = await refreshing;
  // permission taken back on the Google account page
  if (typeof r === "string" && !granted.includes(EXTRA[extra])) return { error: `Allow ${EXTRA_NAME[extra]} access`, connect: "grant" };
  return r;
}

function googleError(e: unknown, extra: Extra): Need {
  const msg = (e as Error).message;
  if (/^401/.test(msg)) access = null;
  // the API isn't switched on for the OAuth client's Cloud project
  if (/^403/.test(msg)) return { error: `Google refused: turn on the ${EXTRA_NAME[extra]} API in your Cloud project`, enable: API_PAGE[extra] };
  return { error: `Couldn't reach ${EXTRA_NAME[extra]}: ${msg}` };
}

const header = (m: any, name: string): string => m?.payload?.headers?.find((h: any) => String(h.name).toLowerCase() === name)?.value ?? "";
/** "Name" <someone@example.com> -> Name */
const sender = (from: string) => from.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || from.replace(/[<>]/g, "");

async function gmail() {
  const a = await accessFor("gmail");
  if (typeof a !== "string") return a;
  const init = { headers: { Authorization: `Bearer ${a}` } };
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  try {
    const [inbox, list] = await Promise.all([getJson<any>(`${base}/labels/INBOX`, init), getJson<any>(`${base}/messages?labelIds=INBOX&labelIds=UNREAD&maxResults=8`, init)]);
    const msgs = await Promise.all((list.messages ?? []).map((m: any) => getJson<any>(`${base}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, init).catch(() => null)));
    return {
      unread: Number(inbox.messagesUnread ?? 0),
      email: profile?.email ?? "",
      messages: msgs.filter(Boolean).map((m: any) => ({ id: m.id, thread: m.threadId, from: sender(header(m, "from")), subject: header(m, "subject") || "(no subject)", at: Number(m.internalDate) || 0 })),
    };
  } catch (e) {
    return googleError(e, "gmail");
  }
}

const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function searchConsole() {
  const a = await accessFor("searchConsole");
  if (typeof a !== "string") return a;
  const auth = { Authorization: `Bearer ${a}` };
  try {
    const entries: any[] = (await getJson<any>("https://www.googleapis.com/webmasters/v3/sites", { headers: auth })).siteEntry ?? [];
    const sites = entries.filter((x) => x.permissionLevel !== "siteUnverifiedUser").map((x) => String(x.siteUrl));
    if (!sites.length) return { error: "No verified sites in Search Console yet" };
    const want = settings.value.google.searchSite;
    const site = want && sites.includes(want) ? want : sites[0];
    const ago = (n: number) => localDay(Date.now() - n * 86400_000);
    const res = await request(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: ago(33), endDate: ago(0), dimensions: ["date"], rowLimit: 100 }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    // Google's numbers trail by two or three days: the last 28 days it has
    const rows: { date: string; clicks: number; impressions: number; position: number }[] = (((await res.json()) as any).rows ?? [])
      .map((r: any) => ({ date: String(r.keys?.[0] ?? ""), clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0), position: Number(r.position ?? 0) }))
      .sort((x: { date: string }, y: { date: string }) => x.date.localeCompare(y.date))
      .slice(-28);
    const sum = (k: "clicks" | "impressions", list = rows) => list.reduce((s, r) => s + r[k], 0);
    const clicks = sum("clicks");
    const impressions = sum("impressions");
    const position = impressions ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : 0;
    const week = sum("clicks", rows.slice(-7));
    const prev = sum("clicks", rows.slice(-14, -7));
    return { sites, site, clicks, impressions, ctr: impressions ? (clicks / impressions) * 100 : 0, position, days: rows, change: prev ? ((week - prev) / prev) * 100 : null, through: rows[rows.length - 1]?.date ?? null };
  } catch (e) {
    return googleError(e, "searchConsole");
  }
}

export function initGoogle(): void {
  defineTopic("profile", { start: (pub) => pub(profile) });
  defineTopic("gmail", poller(gmail, 3 * 60_000));
  defineTopic("searchConsole", poller(searchConsole, 60 * 60_000));
  const refreshExtras = () => {
    refreshTopic("gmail");
    refreshTopic("searchConsole");
  };
  ipcMain.handle("google:signIn", async () => {
    const r = await signIn();
    refreshExtras();
    return r;
  });
  ipcMain.handle("google:grant", async (_e, extra: string) => {
    if (!(extra in EXTRA)) return { error: "Unknown permission" };
    if (!profile) return { error: "Sign in with Google in Settings first" };
    const r = await signIn(extra as Extra);
    refreshExtras();
    return r;
  });
  ipcMain.handle("google:signOut", async () => {
    await signOut();
    refreshExtras();
  });
  settings.onChange((v, prev) => {
    if (v.google.searchSite !== prev.google.searchSite) refreshTopic("searchConsole");
  });
  let last = 0;
  const daily = () => {
    if (Date.now() - last < 23 * 3600_000) return;
    last = Date.now();
    void refreshProfile();
  };
  setTimeout(daily, 30_000);
  setInterval(daily, 3600_000);
}
