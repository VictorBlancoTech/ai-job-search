import { afterEach, describe, expect, test } from "bun:test"
import { main } from "../src/cli"

const originalClientId = process.env.INFOJOBS_CLIENT_ID
const originalClientSecret = process.env.INFOJOBS_CLIENT_SECRET

function setMissingCredentials(): void {
  process.env.INFOJOBS_CLIENT_ID = ""
  process.env.INFOJOBS_CLIENT_SECRET = ""
}

async function invoke(argv: string[]): Promise<{ exitCode: number; error: { error: string; code: string } }> {
  let stderr = ""
  const originalWrite = process.stderr.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
    return true
  }) as typeof process.stderr.write

  try {
    const exitCode = await main(argv)
    return { exitCode, error: JSON.parse(stderr) as { error: string; code: string } }
  } finally {
    process.stderr.write = originalWrite
  }
}

afterEach(() => {
  if (originalClientId === undefined) delete process.env.INFOJOBS_CLIENT_ID
  else process.env.INFOJOBS_CLIENT_ID = originalClientId
  if (originalClientSecret === undefined) delete process.env.INFOJOBS_CLIENT_SECRET
  else process.env.INFOJOBS_CLIENT_SECRET = originalClientSecret
})

describe("InfoJobs CLI validation", () => {
  test("rejects missing query, unknown flags, invalid formats, and out-of-range numbers", async () => {
    const cases = [
      ["search"],
      ["search", "--query"],
      ["search", "--query", "role", "--where"],
      ["search", "--query", "role", "--format", "xml"],
      ["search", "--query", "role", "--unknown", "value"],
      ["search", "--query", "role", "--page", "0"],
      ["search", "--query", "role", "--page", "-1"],
      ["search", "--query", "role", "--limit", "0"],
      ["search", "--query", "role", "--limit", "51"],
      ["search", "--query", "role", "--limit", "12junk"],
      ["detail"],
      ["detail", "id", "extra"],
    ]

    for (const argv of cases) {
      const result = await invoke(argv)
      expect(result.exitCode).toBe(2)
      expect(result.error.code).toBe("INVALID_ARGUMENT")
      expect(result.error.error.length).toBeGreaterThan(0)
    }
  })

  test("accepts the teleworking boolean and aliases before credential validation", async () => {
    setMissingCredentials()
    const result = await invoke(["search", "-q", "role", "-l", "Madrid", "--teleworking", "-n", "1"])
    expect(result.exitCode).toBe(2)
    expect(result.error.code).toBe("NO_CREDENTIALS")
  })

  test("reports missing credentials with exit 2 and never attempts the API", async () => {
    setMissingCredentials()
    const search = await invoke(["search", "-q", "role"])
    expect(search.exitCode).toBe(2)
    expect(search.error.code).toBe("NO_CREDENTIALS")

    const detail = await invoke(["detail", "abc123remote"])
    expect(detail.exitCode).toBe(2)
    expect(detail.error.code).toBe("NO_CREDENTIALS")
  })
})
