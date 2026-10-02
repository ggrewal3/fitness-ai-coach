import sharp from "sharp";

// Authoritative server-side processing for profile photos (ADR-024). The
// original upload is never stored: only the re-encoded output below.

export const AVATAR_SIZE = 512;
export const AVATAR_WEBP_QUALITY = 82;
export const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_DIMENSION = 8000;
export const AVATAR_MAX_PIXELS = 40_000_000;

export const AVATAR_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarInputType = (typeof AVATAR_INPUT_TYPES)[number];

// The decoded format must match the declared type.
const FORMAT_FOR_TYPE: Record<AvatarInputType, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

// Don't keep decoded user images in sharp's in-process operation cache.
sharp.cache(false);

/** The upload is not an acceptable image. The message is safe to show users. */
export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImageError";
  }
}

/**
 * Validates and re-encodes an uploaded image into the stored avatar format:
 *
 * 1. Read only the header (cheap) and require a JPEG/PNG/WebP whose actual
 *    format matches the declared Content-Type, so disguised files fail.
 * 2. Reject unreasonable dimensions before decoding pixels: at most 8000 px per
 *    side and 40 MP (decompression-bomb guard). `limitInputPixels` enforces the
 *    same pixel limit again during decoding.
 * 3. Decode (failing on corrupt or truncated data), apply EXIF orientation,
 *    centre-crop to a 512×512 square, encode WebP quality 82. sharp writes no
 *    input metadata (EXIF incl. GPS, XMP, IPTC, ICC) unless asked to, so all of
 *    it is dropped.
 *
 * Centre crop (not sharp's "attention" strategy): attention is deterministic
 * but follows bright/saturated regions, which can pull a centred face out of
 * frame; centre crop is predictable and lets the client preview exactly what
 * will be stored.
 */
export async function processAvatarImage(input: Buffer, declaredType: AvatarInputType): Promise<Buffer> {
  if (input.length === 0) {
    throw new InvalidImageError("The upload was empty.");
  }

  const metadata = await sharp(input, { limitInputPixels: AVATAR_MAX_PIXELS })
    .metadata()
    .catch(() => null);

  if (!metadata || metadata.format !== FORMAT_FOR_TYPE[declaredType]) {
    throw new InvalidImageError("The file isn’t a valid JPEG, PNG or WebP image.");
  }

  const { width, height } = metadata;

  if (!width || !height) {
    throw new InvalidImageError("The file isn’t a valid JPEG, PNG or WebP image.");
  }

  if (width > AVATAR_MAX_DIMENSION || height > AVATAR_MAX_DIMENSION || width * height > AVATAR_MAX_PIXELS) {
    throw new InvalidImageError("Images must be at most 8000 pixels on each side and 40 megapixels in total.");
  }

  try {
    return await sharp(input, { limitInputPixels: AVATAR_MAX_PIXELS, failOn: "warning" })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: AVATAR_WEBP_QUALITY })
      .toBuffer();
  } catch {
    throw new InvalidImageError("The image couldn’t be processed. It may be damaged.");
  }
}
