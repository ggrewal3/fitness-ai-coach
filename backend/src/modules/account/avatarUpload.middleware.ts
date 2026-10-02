import express, { type NextFunction, type Request, type Response } from "express";
import { AVATAR_INPUT_TYPES, AVATAR_MAX_UPLOAD_BYTES } from "../../lib/images/avatarImage.js";

// Route-scoped body handling for PUT /api/account/avatar. The global
// express.json() parser is unchanged; only this route accepts raw image bytes.

/** 415 unless the request declares a JPEG, PNG or WebP body. */
export function requireAvatarContentType(req: Request, res: Response, next: NextFunction) {
  if (!req.is([...AVATAR_INPUT_TYPES])) {
    return res.status(415).json({ message: "Profile photos must be JPEG, PNG or WebP images." });
  }

  next();
}

const rawImageParser = express.raw({ type: [...AVATAR_INPUT_TYPES], limit: AVATAR_MAX_UPLOAD_BYTES });

/** Reads the raw body (max 5 MB) into a Buffer, answering parser errors as JSON. */
export function parseAvatarBody(req: Request, res: Response, next: NextFunction) {
  rawImageParser(req, res, (error?: unknown) => {
    if (!error) {
      return next();
    }

    const { status, type } = error as { status?: number; type?: string };

    if (status === 413 || type === "entity.too.large") {
      return res.status(413).json({ message: "Profile photos must be 5 MB or smaller." });
    }

    return res.status(400).json({ message: "The upload couldn’t be read." });
  });
}
