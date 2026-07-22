import {
  apiGet,
  offerFromDetailResponse,
  requireCredentials,
  toDetail,
  writeError,
  INFOJOBS_API_BASE,
  type ApiGetOptions,
  type Credentials,
  type Environment,
  type ErrorWriter,
  type JobResult,
} from "../helpers.js"
import { renderTable } from "./search.js"

export interface DetailOpts {
  id: string
  format: "json" | "table" | "plain"
}

export interface DetailDependencies {
  writeError?: ErrorWriter
  credentials?: Credentials
  env?: Environment
  fetchFn?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
  retryDelayMs?: number
  timeoutMs?: number
}

export function buildDetailUrl(id: string): string {
  return `${INFOJOBS_API_BASE}/${encodeURIComponent(id)}`
}

function apiOptions(dependencies: DetailDependencies, credentials: Credentials): ApiGetOptions {
  return {
    credentials,
    fetchFn: dependencies.fetchFn,
    sleepFn: dependencies.sleepFn,
    retryDelayMs: dependencies.retryDelayMs,
    timeoutMs: dependencies.timeoutMs,
  }
}

function remoteLabel(remote: boolean | null): string {
  return remote === true ? "yes" : remote === false ? "no" : "-"
}

function renderPlain(job: JobResult): string {
  return [
    job.title,
    `  ${job.company ?? "-"} | ${job.location ?? "-"}`,
    `  date: ${job.date ?? "-"} | remote: ${remoteLabel(job.remote)}`,
    `  salary: ${job.salary ?? "-"}`,
    "",
    job.description || "(no description)",
    "",
    `URL: ${job.url}`,
    `id: ${job.id}`,
  ].join("\n")
}

export async function runDetail(opts: DetailOpts, dependencies: DetailDependencies = {}): Promise<number> {
  const emitError = dependencies.writeError ?? writeError
  if (!opts.id.trim()) {
    emitError("detail requires a non-empty <id>", "INVALID_ARGUMENT")
    return 2
  }

  try {
    const credentials = dependencies.credentials ?? requireCredentials(dependencies.env)
    const response = await apiGet<unknown>(buildDetailUrl(opts.id), apiOptions(dependencies, credentials))
    const offer = offerFromDetailResponse(response)
    const job = offer === null ? null : toDetail(offer, opts.id)
    if (job === null) throw new Error("InfoJobs API returned an invalid offer detail")

    if (opts.format === "table") process.stdout.write(renderTable([job]) + "\n")
    else if (opts.format === "plain") process.stdout.write(renderPlain(job) + "\n")
    else process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    return 0
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "NO_CREDENTIALS") {
      emitError(error.message, "NO_CREDENTIALS")
      return 2
    }
    emitError(error instanceof Error ? error.message : String(error), "DETAIL_FAILED")
    return 1
  }
}
