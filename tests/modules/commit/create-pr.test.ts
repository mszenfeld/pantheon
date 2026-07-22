import { describe, expect, it } from "vitest"
import { detectProvider } from "../../../src/modules/commit/pr-provider.js"

describe("detectProvider (§5.4 normative vectors)", () => {
  it("recognizes github.com in all three URL shapes, case-insensitively", () => {
    expect(detectProvider("git@github.com:AppVerk/av-opencode-plugins.git")).toBe("github")
    expect(detectProvider("https://github.com/AppVerk/av-opencode-plugins")).toBe("github")
    expect(detectProvider("ssh://git@github.com/AppVerk/x.git")).toBe("github")
    expect(detectProvider("https://GITHUB.COM/a/b.git")).toBe("github")
  })

  it("returns undefined for every non-github / non-https / local shape", () => {
    expect(detectProvider("git@gitlab.com:a/b.git")).toBeUndefined()
    expect(detectProvider("https://github.enterprise.corp/a/b")).toBeUndefined()
    expect(detectProvider("file:///tmp/bare-remote.git")).toBeUndefined()
    expect(detectProvider("/tmp/bare-remote.git")).toBeUndefined()
    expect(detectProvider("http://github.com/a/b")).toBeUndefined()
  })

  it("does NOT trim: the raw-trailing-newline vector is a caller-path row (AC-2)", () => {
    expect(detectProvider("git@github.com:AppVerk/av-opencode-plugins.git\n")).toBeUndefined()
  })
})
