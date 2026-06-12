import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs"
import path from "node:path"

/**
 * Copy assets according to a manifest.
 *
 * @param {Array<{from: string, to: string, type?: 'file' | 'dir' | 'glob', pattern?: string, required?: boolean}>} manifest
 * @param {string} packageRoot
 */
export function copyAssets(manifest, packageRoot) {
  let copiedCount = 0

  for (const entry of manifest) {
    const resolvedRoot = path.resolve(packageRoot)
    const src = path.resolve(packageRoot, entry.from)
    if (!src.startsWith(resolvedRoot)) {
      throw new Error(`Path traversal detected: ${entry.from}`)
    }
    const dst = path.resolve(packageRoot, entry.to)
    // Guard the destination too: `dir`/`glob` entries now wipe `dst` before
    // copying, so a malformed `to` must never resolve outside the package root.
    const dstRelative = path.relative(resolvedRoot, dst)
    if (
      dstRelative === "" ||
      dstRelative.startsWith("..") ||
      path.isAbsolute(dstRelative)
    ) {
      throw new Error(`Path traversal detected in destination: ${entry.to}`)
    }

    if (!existsSync(src)) {
      if (entry.required !== false) {
        console.warn(`Warning: ${entry.from} not found at ${src}`)
      }
      continue
    }

    const type = entry.type || "file"

    if (type === "dir") {
      // Remove the destination dir before copying so renamed/deleted source
      // files cannot persist as orphaned dist assets. `dir` entries own their
      // whole destination tree (e.g. dist/skills), so a full wipe is safe.
      rmSync(dst, { recursive: true, force: true })
      mkdirSync(dst, { recursive: true })
      cpSync(src, dst, { recursive: true })
      console.log(`Copied ${entry.from} → ${entry.to}`)
      copiedCount++
    } else if (type === "glob") {
      const pattern = entry.pattern || ""
      const files = readdirSync(src).filter((f) => f.endsWith(pattern))
      // Same orphan-proofing as `dir`: a glob entry owns its destination dir,
      // so wipe it before re-copying the current matching files.
      rmSync(dst, { recursive: true, force: true })
      mkdirSync(dst, { recursive: true })
      for (const file of files) {
        const srcFile = path.join(src, file)
        const dstFile = path.join(dst, file)
        copyFileSync(srcFile, dstFile)
      }
      console.log(
        `Copied ${files.length} files from ${entry.from} → ${entry.to}`,
      )
      copiedCount += files.length
    } else {
      mkdirSync(path.dirname(dst), { recursive: true })
      copyFileSync(src, dst)
      console.log(`Copied ${entry.from} → ${entry.to}`)
      copiedCount++
    }
  }

  console.log(`Done. ${copiedCount} asset(s) copied.`)
}
