import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function cleanConfigValue(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  // Accept common copy/paste wrappers, but never change the key's actual contents.
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function connection() {
  const url = cleanConfigValue(process.env.SUPABASE_URL);
  const key = cleanConfigValue(process.env.SUPABASE_ANON_KEY);
  if (!url || !key) throw new AppError(503, "Supabase is not configured. Open Setup for instructions.");
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); }
  catch { throw new AppError(503, "The Supabase project URL is invalid. Copy the Project URL from Supabase's Data API settings."); }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
    throw new AppError(503, "Use an HTTPS Supabase Project URL, not a database connection string.");
  }
  if (["supabase.com", "www.supabase.com", "app.supabase.com"].includes(parsedUrl.hostname)) {
    throw new AppError(503, "The saved URL points to the Supabase website or dashboard, not your project's API. In your project, open Settings → Data API and copy Project URL.");
  }
  if (parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash) {
    throw new AppError(503, "The saved Project URL contains an extra path, query, or fragment. Copy the base Project URL from Settings → Data API, without /rest/v1, /auth/v1, or a dashboard path.");
  }
  // Guard against accidentally exposing privileged keys through public config.
  if (key.startsWith("sb_secret_")) throw new AppError(503, "Use a Supabase public anon key, not a secret key.");
  if (/^(?:SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE_KEY)\s*=/.test(key)) {
    throw new AppError(503, "The API key entry includes a variable name. Save only the key value, without SUPABASE_ANON_KEY= or SUPABASE_PUBLISHABLE_KEY=.");
  }
  if (key.startsWith("sb_publishable_") && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new AppError(503, "The publishable key contains unexpected characters or is incomplete. Use Supabase's Copy button to copy the complete value, not the masked preview.");
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    let isAnon = false;
    try {
      const parts = key.split(".");
      const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString());
      isAnon = parts.length === 3 && payload.role === "anon";
    } catch { /* only a validated anon JWT or publishable key may reach the browser */ }
    if (!isAnon) throw new AppError(503, "The saved API key is neither a publishable key starting with sb_publishable_ nor a legacy anon JWT. Copy the full Publishable key value from Supabase, not its name or label.");
  }
  return { url, key };
}

const timedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });

export function supabaseClient(token?: string) {
  const { url, key } = connection();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {}, fetch: timedFetch },
  });
}

export type AuthContext = { client: SupabaseClient; user: User };
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ") || auth.length > 10000) throw new AppError(401, "Sign in to continue.");
    const token = auth.slice(7);
    const client = supabaseClient(token);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) throw new AppError(401, "Your session expired. Please sign in again.");
    const providers = Array.isArray(data.user.app_metadata.providers)
      ? data.user.app_metadata.providers
      : [data.user.app_metadata.provider];
    if (!providers.some((provider) => provider === "google" || provider === "email")) {
      throw new AppError(403, "Use a Local Sathi email/password or Google account.");
    }
    res.locals.auth = { client, user: data.user } satisfies AuthContext;
    next();
  } catch (error) { next(error); }
}

export function context(res: Response): AuthContext { return res.locals.auth as AuthContext; }

type RpcError = { code?: string; message?: string };
export function databaseError(error: RpcError): never {
  if (["PGRST202", "PGRST205", "42P01", "42883", "3F000"].includes(error.code ?? "")) {
    throw new AppError(503, "A required Local Sathi database upgrade is missing. Download and run the setup or upgrade SQL from the Setup page.");
  }
  if (error.code === "P0001" || error.code === "22023") {
    // Our SQL uses explicit user-facing validation messages without private values.
    throw new AppError(400, error.message?.slice(0, 240) || "This action could not be completed.");
  }
  if (error.code === "42501") throw new AppError(403, "You do not have access to this content.");
  if (error.code === "23505") throw new AppError(409, "This action has already been recorded.");
  throw new AppError(503, "The data service could not complete this request. Please try again.");
}

export async function rpc(client: SupabaseClient, name: string, args?: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) databaseError(error);
  return data;
}

type ConfigResult = {
  supabaseUrl: string; supabaseAnonKey: string; databaseReady: boolean; emailAuthReady: boolean;
  googleEnabled: boolean; emailEnabled: boolean; emailSignupEnabled: boolean;
  paymentMode: "simulation"; setupMessage: string;
};
let configCache: { until: number; result: ConfigResult } | undefined;
export async function publicConfig(): Promise<ConfigResult> {
  if (configCache && Date.now() < configCache.until) return configCache.result;
  let url: string;
  let key: string;
  try { ({ url, key } = connection()); }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { supabaseUrl: "", supabaseAnonKey: "", databaseReady: false, emailAuthReady: false, googleEnabled: false, emailEnabled: false, emailSignupEnabled: false, paymentMode: "simulation", setupMessage: error.message };
  }
  const client = supabaseClient();
  const [ready, emailReady, settings] = await Promise.allSettled([
    client.rpc("sathi_ready"),
    client.rpc("sathi_email_ready"),
    timedFetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key } }).then(async r => {
      const websiteRedirect = r.redirected && ["supabase.com", "www.supabase.com"].includes(new URL(r.url).hostname);
      if (!r.ok) return { reachable: false, invalidKey: r.status === 401 || r.status === 403, google: false, email: false, signupDisabled: true, status: r.status, websiteRedirect };
      const data = await r.json() as { external?: { google?: boolean; email?: boolean }; disable_signup?: boolean };
      if (!data || typeof data.external !== "object" || data.external === null) {
        throw new Error("UNEXPECTED_AUTH_SETTINGS");
      }
      return {
        reachable: true,
        invalidKey: false,
        google: !!data.external?.google,
        email: !!data.external?.email,
        signupDisabled: data.disable_signup === true,
        status: r.status,
        websiteRedirect: false,
      };
    }),
  ]);
  const databaseReady = ready.status === "fulfilled" && !ready.value.error && ready.value.data === true;
  const emailAuthReady = emailReady.status === "fulfilled" && !emailReady.value.error && emailReady.value.data === true;
  const reachable = settings.status === "fulfilled" && settings.value.reachable;
  const invalidKey = settings.status === "fulfilled" && settings.value.invalidKey;
  const googleEnabled = settings.status === "fulfilled" && settings.value.google;
  const emailEnabled = settings.status === "fulfilled" && settings.value.email;
  const emailSignupEnabled = emailEnabled && emailAuthReady && settings.status === "fulfilled" && !settings.value.signupDisabled;
  let connectionMessage = "Supabase could not be reached. Check that your project is active and the saved project URL is correct.";
  if (settings.status === "fulfilled" && !settings.value.reachable) {
    const status = settings.value.status;
    connectionMessage = status === 404
      ? "The configured URL returned HTTP 404 for Supabase Authentication. Confirm the Project URL and check whether the project is paused or deleted."
      : status >= 500
      ? `Supabase Authentication returned HTTP ${status}. Check the project's status in Supabase and resume it if paused, then retry.`
      : `Supabase Authentication returned HTTP ${status}. Check the Project URL and project availability.`;
  } else if (settings.status === "rejected") {
    // Classify known failures without exposing URLs, keys, or raw error messages.
    const error = settings.reason as { name?: string; message?: string; cause?: { code?: string } };
    const code = error?.cause?.code;
    if (code === "ENOTFOUND") {
      connectionMessage = "The Supabase project hostname could not be resolved (DNS lookup failed). Confirm the Project URL and check that the project exists and is active.";
    } else if (code === "EAI_AGAIN") {
      connectionMessage = "A temporary DNS lookup failure prevented the Supabase connection. Please retry shortly.";
    } else if (error?.name === "TimeoutError" || error?.name === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT") {
      connectionMessage = "The Supabase connection timed out. Check project availability and retry.";
    } else if (error?.name === "SyntaxError" || error?.message === "UNEXPECTED_AUTH_SETTINGS") {
      connectionMessage = "The configured URL did not return Supabase Authentication settings. Use the Project URL, not a dashboard URL or database connection string.";
    }
  }
  const setupMessage = settings.status === "fulfilled" && settings.value.websiteRedirect
    ? "The configured URL redirects to the Supabase website, not your project's API. Open the active project → Settings → Data API and copy its Project URL (not https://supabase.co). Keep the publishable key from that same project."
    : invalidKey
    ? "Supabase did not accept the saved public API key. Confirm the URL and anon key belong to the same project."
    : !reachable ? connectionMessage
    : !databaseReady
    ? "Finish Supabase setup to activate live features. You can explore sample neighborhood stories now."
    : !googleEnabled && !emailEnabled ? "Enable Email in Supabase Authentication → Sign In / Providers, or configure Google sign-in."
    : !googleEnabled && emailEnabled && !emailAuthReady ? "Run the Email/password upgrade SQL from the Setup page in your existing Supabase project, then refresh status."
    : "";
  const result: ConfigResult = { supabaseUrl: url, supabaseAnonKey: key, databaseReady, emailAuthReady, googleEnabled, emailEnabled, emailSignupEnabled, paymentMode: "simulation", setupMessage };
  configCache = { until: Date.now() + 20000, result };
  return result;
}

export async function signPosts(client: SupabaseClient, posts: Array<Record<string, unknown>>, userId: string) {
  return Promise.all(posts.map(async post => {
    const path = typeof post.mediaUrl === "string" ? post.mediaUrl : "";
    if (!path) return { ...post, mediaUrl: "" };
    // Never sign arbitrary remote URLs or paths outside authenticated media policies.
    if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|mp4)$/.test(path)) return { ...post, mediaUrl: "" };
    const { data, error } = await client.storage.from("sathi-media").createSignedUrl(path, 300);
    if (error) throw new AppError(503, "Media is unavailable. Check Supabase Storage policies and try again.");
    if (post.authorId !== userId || post.isAd === true) return { ...post, mediaUrl: data.signedUrl };
    const extension = path.endsWith(".mp4") ? "mp4" : "jpg";
    const { data: download, error: downloadError } = await client.storage
      .from("sathi-media")
      .createSignedUrl(path, 3600, { download: `local-sathi-post.${extension}` });
    if (downloadError) throw new AppError(503, "Post download is unavailable. Check Supabase Storage policies and try again.");
    return { ...post, mediaUrl: data.signedUrl, downloadUrl: download.signedUrl };
  }));
}