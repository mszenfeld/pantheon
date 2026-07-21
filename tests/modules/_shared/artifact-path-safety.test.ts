import {
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  PLANNING_ARTIFACT_DIRECTORIES,
  containsTraversalSegment,
  isWithin,
  matchesNoFollowFileDescriptor,
  verifiesNoFollowFileDescriptor,
} from "../../../src/modules/_shared/artifact-path-safety.js"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(): string {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "artifact-path-safety-")))
  temporaryDirectories.push(directory)
  return directory
}

afterEach((): void => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("PLANNING_ARTIFACT_DIRECTORIES", () => {
  it("names exactly the planning artifact directories", () => {
    expect(PLANNING_ARTIFACT_DIRECTORIES).toEqual(["docs/specs", "docs/plans"])
  })
})

describe("isWithin", () => {
  it("accepts the directory itself and descendants", () => {
    expect(isWithin("/work/docs/specs", "/work/docs/specs")).toBe(true)
    expect(isWithin("/work/docs/specs", "/work/docs/specs/feature.md")).toBe(true)
    expect(isWithin("/work/docs/specs", "/work/docs/specs/nested/feature.md")).toBe(true)
  })

  it("rejects parents, siblings, and sibling-prefix directories", () => {
    expect(isWithin("/work/docs/specs", "/work/docs")).toBe(false)
    expect(isWithin("/work/docs/specs", "/work/docs/plans/feature.md")).toBe(false)
    expect(isWithin("/work/docs/specs", "/work/docs/specs-evil/feature.md")).toBe(false)
    expect(isWithin("/work/docs/specs", "/work/docs/specs/..")).toBe(false)
    expect(isWithin("/work/docs/specs", "/elsewhere/feature.md")).toBe(false)
  })
})

describe("containsTraversalSegment", () => {
  it("accepts clean relative paths", () => {
    expect(containsTraversalSegment("docs/specs")).toBe(false)
    expect(containsTraversalSegment("docs/specs/feature.md")).toBe(false)
    expect(containsTraversalSegment("feature.md")).toBe(false)
  })

  it("rejects dot and dot-dot segments on either separator", () => {
    expect(containsTraversalSegment("docs/../secrets")).toBe(true)
    expect(containsTraversalSegment("./docs/specs")).toBe(true)
    expect(containsTraversalSegment("docs/./specs")).toBe(true)
    expect(containsTraversalSegment("..")).toBe(true)
    expect(containsTraversalSegment("docs\\..\\secrets")).toBe(true)
  })

  it("rejects empty segments from doubled, leading, or trailing separators", () => {
    expect(containsTraversalSegment("docs//specs")).toBe(true)
    expect(containsTraversalSegment("/docs/specs")).toBe(true)
    expect(containsTraversalSegment("docs/specs/")).toBe(true)
    expect(containsTraversalSegment("")).toBe(true)
    expect(containsTraversalSegment("docs\\\\specs")).toBe(true)
  })
})

describe("NOFOLLOW descriptor verification", () => {
  function openNoFollow(filePath: string): number {
    return openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  }

  it("accepts a descriptor that still matches its regular file", () => {
    const directory = createTemporaryDirectory()
    const filePath = path.join(directory, "artifact.md")
    writeFileSync(filePath, "content")
    const descriptor = openNoFollow(filePath)
    try {
      expect(matchesNoFollowFileDescriptor(descriptor, filePath, directory)).toBe(true)
      expect(verifiesNoFollowFileDescriptor(descriptor, filePath, directory)).toBe(true)
    } finally {
      closeSync(descriptor)
    }
  })

  it("rejects when the name was swapped for a symlink after opening", () => {
    const directory = createTemporaryDirectory()
    const filePath = path.join(directory, "artifact.md")
    const targetPath = path.join(directory, "target.md")
    writeFileSync(filePath, "content")
    writeFileSync(targetPath, "other")
    const descriptor = openNoFollow(filePath)
    try {
      rmSync(filePath)
      symlinkSync(targetPath, filePath)
      expect(matchesNoFollowFileDescriptor(descriptor, filePath, directory)).toBe(false)
      expect(verifiesNoFollowFileDescriptor(descriptor, filePath, directory)).toBe(false)
    } finally {
      closeSync(descriptor)
    }
  })

  it("rejects when the name points at a different inode", () => {
    const directory = createTemporaryDirectory()
    const filePath = path.join(directory, "artifact.md")
    writeFileSync(filePath, "content")
    const descriptor = openNoFollow(filePath)
    try {
      rmSync(filePath)
      writeFileSync(filePath, "replacement")
      expect(matchesNoFollowFileDescriptor(descriptor, filePath, directory)).toBe(false)
      expect(verifiesNoFollowFileDescriptor(descriptor, filePath, directory)).toBe(false)
    } finally {
      closeSync(descriptor)
    }
  })

  it("rejects when the parent does not resolve to the trusted directory", () => {
    const directory = createTemporaryDirectory()
    const other = createTemporaryDirectory()
    const filePath = path.join(directory, "artifact.md")
    writeFileSync(filePath, "content")
    const descriptor = openNoFollow(filePath)
    try {
      expect(matchesNoFollowFileDescriptor(descriptor, filePath, other)).toBe(false)
      expect(verifiesNoFollowFileDescriptor(descriptor, filePath, other)).toBe(false)
    } finally {
      closeSync(descriptor)
    }
  })

  it("propagates filesystem errors only from the throwing core", () => {
    const directory = createTemporaryDirectory()
    const filePath = path.join(directory, "artifact.md")
    writeFileSync(filePath, "content")
    const descriptor = openNoFollow(filePath)
    try {
      rmSync(filePath)
      expect((): boolean => matchesNoFollowFileDescriptor(descriptor, filePath, directory)).toThrow()
      expect(verifiesNoFollowFileDescriptor(descriptor, filePath, directory)).toBe(false)
    } finally {
      closeSync(descriptor)
    }
  })
})
