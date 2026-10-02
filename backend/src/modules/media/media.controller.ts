import type { Request, Response } from "express";
import { getObjectStorage } from "../../lib/storage/index.js";
import { LocalObjectStorage } from "../../lib/storage/localObjectStorage.js";
import { AVATAR_FILE_PATTERN } from "../../lib/storage/objectStorage.js";
import { verifyMediaSignature } from "../../lib/storage/signedMediaUrl.js";

// GET /api/media/avatars/:file?expires=…&signature=…
//
// Serves privately stored avatars for LocalObjectStorage (ADR-024). There is no
// JWT here (an <img> cannot send one): the signed, expiring URL issued by
// GET /api/account is the authorization. A future S3 adapter would return its
// own presigned URLs and this endpoint would not be used.

function sendForbidden(res: Response) {
  // Same response for a bad signature, a modified key/expiry and an expired
  // URL, so failures reveal nothing about which part was wrong.
  return res.status(403).json({ message: "This media link is invalid or has expired." });
}

export async function getAvatarMedia(req: Request, res: Response) {
  const file = req.params.file;

  // Only server-generated "<uuid>.webp" names; rejects traversal and any
  // other path before signatures or storage are consulted.
  if (typeof file !== "string" || !AVATAR_FILE_PATTERN.test(file)) {
    return res.status(404).json({ message: "Not found." });
  }

  const key = `avatars/${file}`;
  const { expires, signature } = req.query;

  if (!verifyMediaSignature(key, expires, signature)) {
    return sendForbidden(res);
  }

  const storage = getObjectStorage();

  if (!(storage instanceof LocalObjectStorage)) {
    return res.status(404).json({ message: "Not found." });
  }

  try {
    const body = await storage.read(key);

    if (!body) {
      return res.status(404).json({ message: "Not found." });
    }

    const remainingSeconds = Math.max(0, Number(expires) - Math.floor(Date.now() / 1000));

    res.set({
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      // An image response needs no active content.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": 'inline; filename="avatar.webp"',
      // Private to this browser, and never cached past the URL's expiry.
      "Cache-Control": `private, max-age=${remainingSeconds}`,
    });

    return res.status(200).send(body);
  } catch {
    console.error({ event: "media.read.failed" });
    return res.status(500).json({ message: "Internal Server Error" });
  }
}
