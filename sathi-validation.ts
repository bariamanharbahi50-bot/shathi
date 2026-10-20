import { z } from "zod/v4";

const id = z.string().uuid();
const geo = z.object({
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(1000),
  capturedAt: z.iso.datetime().refine(value => {
    const age = Date.now() - Date.parse(value);
    return age >= -30000 && age <= 300000;
  }, "Refresh your GPS location and try again."),
});
// Empty filters mean automatic GPS-derived region; a manual selection may only
// narrow discovery and cannot define the user's geographic authorization.
const region = z.object({ city: z.string().trim().max(100), state: z.string().trim().max(100) });
const mediaPath = z.string().regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|mp4)$/);
const text = z.string().trim().min(1).max(2000);
export const feedInput = geo.extend({
  ...region.shape, area: z.string().max(100).optional(),
  country: z.string().max(100).optional(), category: z.string().max(60).optional(),
  search: z.string().max(100).optional(), mediaType: z.enum(["image", "video", "text", "all"]).optional(),
});
export const actions: Record<string, z.ZodType> = {
  updateProfile: z.object({
    name: z.string().trim().min(1).max(80).optional(), bio: z.string().max(300).optional(),
    city: z.string().max(100).optional(), state: z.string().max(100).optional(), area: z.string().max(100).optional(),
    language: z.enum(["en", "hi", "gu", "mr", "ta", "te", "bn", "kn", "ml", "pa"]).optional(),
    ringtone: z.boolean().optional(),
  }),
  heartbeat: geo.extend(region.shape),
  createPost: geo.extend({
    ...region.shape, area: z.string().max(100), caption: text,
    category: z.string().trim().min(1).max(60), mediaType: z.enum(["text", "image", "video"]),
    mediaPath: mediaPath.optional(),
  }).refine(p => p.mediaType === "text" || !!p.mediaPath, "Attach media before posting."),
  deletePost: z.object({ id }), likePost: z.object({ id }), getComments: z.object({ id }),
  addComment: z.object({ id, text: z.string().trim().min(1).max(500) }),
  getMessages: z.object({ userId: id }), sendMessage: z.object({ userId: id, text }),
  getAlerts: geo, createAlert: geo.extend({ message: z.string().trim().max(300).default("I need help nearby.") }),
  resolveAlert: z.object({ id }),
  mockVerify: z.object({ aadhaarPath: mediaPath, selfiePath: mediaPath, consent: z.literal(true) }),
  createAd: geo.extend({
    ...region.shape, planId: z.string().regex(/^(3|7|15|30)-(local|state|national)$/),
    title: z.string().trim().min(3).max(100), description: z.string().trim().min(5).max(1000),
    targetUrl: z.url().max(1000).refine(value => ["https:", "http:"].includes(new URL(value).protocol)),
    mediaPath: mediaPath.optional(),
  }),
  simulatePayment: z.object({ adId: id }), adEvent: z.object({ id, event: z.enum(["view", "click"]) }),
};