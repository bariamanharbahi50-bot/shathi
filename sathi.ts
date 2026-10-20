import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import {
  GetSathiConfigResponse, GetPlacesQueryParams, GetPlacesResponse, GetAdPlansResponse,
  GetExploreFeedResponse, LoadNearbyFeedBody, LoadNearbyFeedResponse, GetAccountResponse,
  SathiActionBody, SathiActionResponse, UploadMediaResponse,
} from "@workspace/api-zod";
import { adPlans, exploreFeed, places } from "../lib/sathi-data";
import { AppError, authenticate, context, databaseError, publicConfig, rpc, signPosts } from "../lib/sathi-supabase";
import { actions, feedInput } from "../lib/sathi-validation";
import { storeMedia } from "../lib/sathi-media";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

router.get("/config", async (_req, res) => {
  res.json(GetSathiConfigResponse.parse(await publicConfig()));
});
router.get("/places", (req, res) => {
  const query = GetPlacesQueryParams.parse(req.query);
  const countryValid = !query.country || query.country === "India";
  const states = countryValid ? Object.keys(places) : [];
  const cities = countryValid && query.state ? Object.keys(places[query.state] ?? {}) : [];
  const areas = countryValid && query.state && query.city ? places[query.state]?.[query.city] ?? [] : [];
  res.json(GetPlacesResponse.parse({ countries: ["India"], states, cities, areas }));
});
router.get("/plans", (_req, res) => { res.json(GetAdPlansResponse.parse(adPlans)); });
router.get("/explore", (_req, res) => { res.json(GetExploreFeedResponse.parse(exploreFeed)); });

// The browser receives only a public key; every operation still runs under its
// verified Supabase user token and database-level authorization.
router.use(authenticate);
const windows = new Map<string, { until: number; count: number }>();
router.use((_req, res, next) => {
  const now = Date.now();
  if (windows.size > 10000) {
    for (const [key, item] of windows) if (item.until < now) windows.delete(key);
    if (windows.size > 10000) { next(new AppError(503, "The service is busy. Please try again shortly.")); return; }
  }
  const { user } = context(res);
  const window = windows.get(user.id);
  if (!window || window.until < now) windows.set(user.id, { until: now + 60000, count: 1 });
  else if (++window.count > 100) { next(new AppError(429, "Too many requests. Please wait a minute.")); return; }
  next();
});

router.post("/feed", async (req, res) => {
  const payload = feedInput.parse(LoadNearbyFeedBody.parse(req.body));
  const { client, user } = context(res);
  const result = await rpc(client, "sathi_feed", { p_payload: payload });
  result.posts = await signPosts(client, result.posts ?? [], user.id);
  res.json(LoadNearbyFeedResponse.parse(result));
});
router.get("/account", async (_req, res) => {
  const { client, user } = context(res);
  const result = await rpc(client, "sathi_account");
  result.posts = await signPosts(client, result.posts ?? [], user.id);
  res.json(GetAccountResponse.parse(result));
});
router.post("/action", async (req, res) => {
  const body = SathiActionBody.parse(req.body);
  const payload = actions[body.operation]!.parse(body.payload) as Record<string, unknown>;
  const { client, user } = context(res);
  for (const key of ["mediaPath", "aadhaarPath", "selfiePath"]) {
    if (payload[key] && !String(payload[key]).startsWith(`${user.id}/`)) throw new AppError(403, "This upload does not belong to your account.");
  }
  let data: unknown;
  if (body.operation === "deletePost") {
    const { data: deleted, error: deleteError } = await client.rpc("sathi_delete_post", { p_post_id: payload.id });
    if (deleteError && ["PGRST202", "42883"].includes(deleteError.code ?? "")) {
      await rpc(client, "sathi_action", { p_operation: body.operation, p_payload: payload });
      req.log.warn({ category: "post_media_upgrade_missing" }, "Post deleted without storage cleanup because the media upgrade is not installed");
      data = {
        deleted: true,
        mediaDeleted: false,
        message: "The post was deleted, but attached media may remain in storage. Run the post-media upgrade from Setup to enable cleanup.",
      };
    } else if (deleteError) {
      databaseError(deleteError);
    } else {
      const deleteResult = deleted as { mediaPath?: unknown } | null;
      const mediaPath = typeof deleteResult?.mediaPath === "string" ? deleteResult.mediaPath : "";
      let mediaDeleted = !mediaPath;
      let message: string | undefined;
      if (mediaPath) {
        const safeOwnedPath = mediaPath.startsWith(`${user.id}/`)
          && /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|mp4)$/.test(mediaPath);
        if (!safeOwnedPath) {
          message = "The post was deleted, but its attached media could not be safely removed. Contact support for cleanup.";
        } else {
          try {
            const { error } = await client.storage.from("sathi-media").remove([mediaPath]);
            mediaDeleted = !error;
            if (error) message = "The post was deleted, but its attached media could not be removed. Contact support for cleanup.";
          } catch {
            message = "The post was deleted, but its attached media could not be removed. Contact support for cleanup.";
          }
        }
        if (!mediaDeleted) req.log.warn({ category: "post_media_cleanup_failed" }, "Post was deleted but its media could not be removed");
      }
      data = { deleted: true, mediaDeleted, ...(message ? { message } : {}) };
    }
  } else {
    data = await rpc(client, "sathi_action", { p_operation: body.operation, p_payload: payload });
  }
  if (body.operation === "mockVerify") {
    const paths = [String(payload.aadhaarPath), String(payload.selfiePath)];
    const { error } = await client.storage.from("sathi-identity").remove(paths);
    // Do not silently claim deletion if Storage failed.
    if (error) {
      const resultData = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : {};
      res.json(SathiActionResponse.parse({ success: true, data: {
        ...resultData, message: "Demo verification completed. Temporary images could not be removed; contact the app administrator for deletion.",
      } }));
      return;
    }
  }
  res.json(SathiActionResponse.parse({ success: true, data }));
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 1, fieldSize: 100 } });
let inflightUploads = 0;
router.post("/media", (req, res, next) => {
  if (inflightUploads >= 2) { next(new AppError(503, "Uploads are busy. Please try again shortly.")); return; }
  inflightUploads++;
  let released = false;
  const release = () => { if (!released) { released = true; inflightUploads--; } };
  res.once("close", release);
  upload.single("file")(req, res, async error => {
    try {
      if (error) throw new AppError(413, "Upload too large or invalid. Maximum video size: 50 MB.");
      if (!req.file) throw new AppError(400, "Please choose a file to upload.");
      const { client, user } = context(res);
      const result = await storeMedia(client, user.id, req.file, req.body.purpose);
      res.json(UploadMediaResponse.parse(result));
    } catch (error) { next(error); }
    finally { release(); }
  });
});

router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AppError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof Error && error.name === "ZodError") {
    res.status(400).json({ error: "Some details are invalid. Check required fields and refresh your GPS location." });
    return;
  }
  req.log.error({ category: "sathi_request_failed" }, "Local Sathi request failed");
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

export default router;