-- Opaque private storage key of the processed profile photo (ADR-024).
-- Nullable and without a default: every existing user stays valid with no avatar.
ALTER TABLE "User" ADD COLUMN     "avatarKey" TEXT;
