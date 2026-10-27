import "server-only";

import { createSupabaseServiceClient } from "./service";

/**
 * Uploads a file into a private Supabase Storage bucket. Only ever call
 * this with a bucket that has no public-read policy (e.g.
 * "community-livestream-photos") — this app has no notion of a "public"
 * upload helper; use Cloudinary (src/lib/cloudinary or similar) for that.
 */
export async function uploadPrivateFile(
  bucket: string,
  path: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.storage.from(bucket).upload(path, data, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
}

/**
 * Creates a time-limited signed URL for a private object. Returns null
 * (rather than throwing) on failure so callers that just want a "best
 * effort" thumbnail don't need their own try/catch.
 */
export async function createSignedUrl(
  bucket: string,
  path: string,
  expiresInSeconds: number,
): Promise<string | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Best-effort delete of one or more private objects. Never throws — callers
 * that are cleaning up orphaned files (e.g. 連線代購下單 clearing staged
 * photos when a session ends) should not fail their main operation just
 * because storage cleanup didn't fully succeed.
 */
export async function deletePrivateFiles(bucket: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const supabase = createSupabaseServiceClient();
  await supabase.storage.from(bucket).remove(paths).catch(() => {});
}
