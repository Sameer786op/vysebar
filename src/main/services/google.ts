// Sign in with Google: your name and photo in VyseBar.
// Google's flow for desktop apps: the browser opens Google's sign-in page, Google sends the
// answer back to a one-time listener on 127.0.0.1, and VyseBar trades it (with PKCE) for an ID
// token that carries your name, email and photo. Only the basic profile scopes are asked for,
// so Google shows no "unverified app" screen and the sign-in doesn't expire after a week.
// The OAuth client is your own (Settings › Accounts explains how to make one); the refresh
// token is encrypted with Windows' data protection and only ever sent to Google.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { app, ipcMain, net, safeStorage, shell } from "electron";
import type { GoogleProfile } from "@shared/types";
import { settings } from "../store";
import { defineTopic, publish } from "../topics";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const SCOPES = "openid profile email";

const dir = app.getPath("userData");
const profileFile = join(dir, "google-profile.json");
const tokenFile = join(dir, "google-token.bin");

let profile: GoogleProfile | null = null;
try {
  if (existsSync(profileFile)) profile = JSON.parse(readFileSync(profileFile, "utf8")) as GoogleProfile;
} catch {
  profile = null;
}

function saveProfile(p: GoogleProfile | null): void {
  profile = p;
  if (p) writeFileSync(profileFile, JSON.stringify(p));
  else rmSync(profileFile, { force: true });
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

type Tokens = { id_token?: string; refresh_token?: string; access_token?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await net.fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
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
    // Google's picture links end in a size; ask for one sharp enough for a 2x tile
    const sized = /=s\d+(-c)?$/.test(url) ? url.replace(/=s\d+(-c)?$/, "=s192-c") : url;
    const res = await net.fetch(sized);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
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
function signIn(): Promise<{ ok: true } | { error: string }> {
  pending ??= run().finally(() => (pending = null));
  return pending;
}

async function run(): Promise<{ ok: true } | { error: string }> {
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
    url.search = new URLSearchParams({
      client_id: clientId.trim(),
      redirect_uri: redirect,
      response_type: "code",
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent select_account",
    }).toString();
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
    saveProfile(await profileFrom(t.id_token));
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
  if (settings.value.startTile === "google") settings.set({ startTile: "windows" });
  if (token) await net.fetch(`${REVOKE}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
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

export function initGoogle(): void {
  defineTopic("profile", { start: (pub) => pub(profile) });
  ipcMain.handle("google:signIn", () => signIn());
  ipcMain.handle("google:signOut", () => signOut());
  let last = 0;
  const daily = () => {
    if (Date.now() - last < 23 * 3600_000) return;
    last = Date.now();
    void refreshProfile();
  };
  setTimeout(daily, 30_000);
  setInterval(daily, 3600_000);
}
