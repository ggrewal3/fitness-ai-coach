// Resolves a URL returned by the backend (such as Account.avatarUrl) for use in
// the browser, using the same rule request() uses for API paths:
//
// - root-relative ("/api/media/...") → appended to the configured API base,
//   keeping any path the base has (e.g. "https://host/backend" + "/api/...")
// - absolute ("https://...", or protocol-relative "//cdn...") → unchanged, so
//   a future S3/CDN URL works as-is
//
// The page origin (window.location) is never used: the API may live elsewhere.
export function resolveApiUrl(apiBaseUrl: string, url: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//")) {
    return url
  }

  const base = apiBaseUrl.replace(/\/$/, "")
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`
}
