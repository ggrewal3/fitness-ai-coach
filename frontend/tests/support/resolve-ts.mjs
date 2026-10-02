// Lets `node --test` run the app's pure TypeScript modules directly.
//
// Node strips TypeScript types natively, but the app (bundled by Vite) imports
// relative modules without extensions. This hook retries such imports with
// ".ts". It only applies to tests; no dependency is needed.
import { registerHooks } from "node:module"

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
})
