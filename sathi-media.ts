import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "./sathi-supabase";

const exec = promisify(execFile);

export async function storeMedia(
  client: SupabaseClient, userId: string, file: Express.Multer.File, purpose: string,
) {
  const isVideo = file.mimetype.startsWith("video/");
  const isImage = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.mimetype);
  if (!isVideo && !isImage) throw new AppError(400, "Please upload a JPEG, PNG, WebP image, or a short video.");
  if (!["post", "aadhaar", "selfie"].includes(purpose)) throw new AppError(400, "Invalid upload purpose.");
  if (purpose !== "post" && !isImage) throw new AppError(400, "Identity-check images must be photos.");
  if (!isVideo && file.size > 10 * 1024 * 1024) throw new AppError(413, "Please choose an image smaller than 10 MB.");

  let buffer: Buffer;
  if (isVideo) {
    const directory = await mkdtemp(path.join(tmpdir(), "sathi-video-"));
    await chmod(directory, 0o700);
    try {
      const input = path.join(directory, "input");
      const output = path.join(directory, "output.mp4");
      await writeFile(input, file.buffer, { mode: 0o600 });
      const { stdout } = await exec("ffprobe", [
        "-v", "error", "-protocol_whitelist", "file,pipe",
        "-show_entries", "format=duration:stream=codec_type", "-of", "json", input,
      ], { timeout: 10000, maxBuffer: 256 * 1024 });
      const probe = JSON.parse(stdout);
      const duration = Number(probe.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 60 || !probe.streams?.some((s: { codec_type: string }) => s.codec_type === "video")) {
        throw new AppError(400, "Choose a video between 1 and 60 seconds long.");
      }
      await exec("ffmpeg", [
        "-y", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", input,
        "-map", "0:v:0", "-map", "0:a:0?", "-t", "60", "-map_metadata", "-1",
        "-vf", "scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
        "-r", "30", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-threads", "2", output,
      ], { timeout: 90000, maxBuffer: 256 * 1024 });
      buffer = await readFile(output);
      if (buffer.length > 30 * 1024 * 1024) throw new AppError(413, "The compressed video is too large. Try a shorter clip.");
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, "This video could not be converted to H.264. Try a shorter MP4 or MOV file.");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else {
    try {
      // Decode actual bytes, normalize rotation, and strip GPS/EXIF metadata.
      buffer = await sharp(file.buffer, { limitInputPixels: 40000000 })
        .rotate().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    } catch {
      throw new AppError(400, "This image could not be opened. Please try a JPEG or PNG photo.");
    }
  }
  const objectPath = `${userId}/${randomUUID()}.${isVideo ? "mp4" : "jpg"}`;
  const bucket = purpose === "post" ? "sathi-media" : "sathi-identity";
  const { error } = await client.storage.from(bucket).upload(objectPath, buffer, {
    contentType: isVideo ? "video/mp4" : "image/jpeg", upsert: false, cacheControl: "300",
  });
  if (error) throw new AppError(503, "Upload failed. Check the Supabase storage setup and your connection.");
  return { path: objectPath, mediaType: isVideo ? "video" : "image", compressed: true };
}