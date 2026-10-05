// Lets `node --test` run the app's pure TypeScript modules directly.
//
// Node strips TypeScript types natively, but the app (bundled by Vite) imports
// relative modules without extensions. This hook retries such imports with
// ".ts". It only applies to tests; no dependency is needed.
//
// Vite replaces `import.meta.env` at build time; under Node it is undefined.
// For app sources, the load hook points it at `globalThis.__VITE_ENV__` (an
// object a test may set before importing a module), so modules that read Vite
// configuration (e.g. services/api.ts) can be imported in tests.
import { registerHooks } from "node:module"

const APP_SOURCE = /\/frontend\/src\/.*\.tsx?$/

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../")

      if (isRelative && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context)
      }

      throw error
    }
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)

    if (!APP_SOURCE.test(url) || result.source == null) {
      return result
    }

    const source = String(result.source)
    return source.includes("import.meta.env")
      ? { ...result, source: source.replaceAll("import.meta.env", "(globalThis.__VITE_ENV__ ?? {})") }
      : result
  },
})
