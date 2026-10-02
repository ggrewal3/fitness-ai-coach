import { Router } from "express";
import { getAvatarMedia } from "./media.controller.js";

const router = Router();

// Authorized by the signed URL's signature, not a JWT (see media.controller).
router.get("/avatars/:file", getAvatarMedia);

export default router;
