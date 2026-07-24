import { describe, test, expect } from "bun:test";
import { main } from "../src/cli";

async function invoke(argv: string[]): Promise<{ exitCode: number; error: { error: string; code: string } }> {
  let stderr = "";
  const originalWrite = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    const exitCode = await main(argv);
    return { exitCode, error: JSON.parse(stderr) as { error: string; code: string } };
  } finally {
    process.stderr.write = originalWrite;
  }
}

describe("CLI validation", () => {
  test("rejects malformed usage with exit 2 and INVALID_ARGUMENT", async () => {
    const cases = [
      ["search", "--country"],
      ["search", "--format", "xml"],
      ["search", "--unknown", "value"],
      ["search", "--limit", "12junk"],
      ["search", "--query"],
      ["search", "--page", "0"],
      ["search", "--limit", "21"],
    ];

    for (const argv of cases) {
      const result = await invoke(argv);
      expect(result.exitCode).toBe(2);
      expect(result.error.code).toBe("INVALID_ARGUMENT");
      expect(result.error.error.length).toBeGreaterThan(0);
    }

    const negativeLimit = await invoke(["search", "-q", "x", "--limit", "-1"]);
    expect(negativeLimit.exitCode).toBe(2);
    expect(negativeLimit.error.code).toBe("INVALID_ARGUMENT");
    expect(negativeLimit.error.error).toContain("range 1..20");
    expect(negativeLimit.error.error).not.toContain("requires a value");
  });

  test("requires at least one of -q / -l", async () => {
    const result = await invoke(["search"]);
    expect(result.exitCode).toBe(2);
    expect(result.error.code).toBe("INVALID_ARGUMENT");
    expect(result.error.error).toContain("missing search criteria");
  });

  test("rejects an unknown command", async () => {
    const result = await invoke(["detail", "abc123"]);
    expect(result.exitCode).toBe(2);
    expect(result.error.code).toBe("INVALID_ARGUMENT");
    expect(result.error.error).toContain('unknown command "detail"');
  });
});
