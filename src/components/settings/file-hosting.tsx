"use client"

import * as React from "react"
import { CircleCheckIcon, FlaskConicalIcon, LoaderCircleIcon } from "lucide-react"

import { Note, Row, Rows, Section, Status } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { StorageStatus } from "@/lib/storage"

// Where print files are put for Gelato to fetch: an S3 bucket set up in the
// environment. The test writes a small file, reads it back from its public
// address and deletes it; it only runs when asked.

type TestResult = { ok: boolean; url?: string; error?: string; ms: number }

export function FileHosting() {
  const [status, setStatus] = React.useState<StorageStatus | "unavailable" | null>(null)
  const [test, setTest] = React.useState<TestResult | null>(null)
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    let live = true
    fetch("/api/storage", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as StorageStatus) : "unavailable" as const))
      .catch(() => "unavailable" as const)
      .then((next) => {
        if (live) setStatus(next)
      })
    return () => {
      live = false
    }
  }, [])

  async function runTest() {
    setTesting(true)
    try {
      const response = await fetch("/api/storage/test", { method: "POST" })
      const result = (await response.json().catch(() => ({}))) as Partial<TestResult>
      setTest(
        typeof result.ok === "boolean"
          ? { ok: result.ok, url: result.url, error: result.error, ms: result.ms ?? 0 }
          : { ok: false, error: result.error ?? `The test answered ${response.status}`, ms: 0 }
      )
    } catch (error) {
      setTest({ ok: false, error: (error as Error).message, ms: 0 })
    } finally {
      setTesting(false)
    }
  }

  const configured = typeof status === "object" && status?.configured

  return (
    <Section
      title="Print file hosting"
      aside={
        <Button
          variant="ghost"
          size="xs"
          onClick={runTest}
          disabled={!configured || testing}
          className="-mr-1 text-muted-foreground active:scale-[0.97]"
        >
          {testing ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <FlaskConicalIcon />}
          Test
        </Button>
      }
    >
      {status === null ? (
        <Skeleton className="h-24 rounded-md" />
      ) : status === "unavailable" ? (
        <p className="text-sm text-muted-foreground">The hosting status isn&apos;t available.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1 text-[13px]">
            <Status tone={status.configured ? "ok" : "warn"}>{status.configured ? "Set up" : "Not set up"}</Status>
            {!status.configured && (
              <Note>
                Live uploads wait for it: Gelato fetches every print file from here. Missing in .env.local:{" "}
                {status.missing.map((name, i) => (
                  <React.Fragment key={name}>
                    {i > 0 && ", "}
                    <code className="font-mono text-[11px] text-foreground">{name}</code>
                  </React.Fragment>
                ))}
                .
              </Note>
            )}
          </div>
          <Rows className="gap-y-1.5">
            <Row label="Endpoint">
              <Value text={status.endpoint} />
            </Row>
            <Row label="Bucket">
              <Value text={status.bucket} />
            </Row>
            <Row label="Public at">
              <Value text={status.publicUrl} />
            </Row>
          </Rows>
          {test &&
            (test.ok ? (
              <Note tone="ok">
                <CircleCheckIcon />
                Works: written, read back from its public address and deleted in {(test.ms / 1000).toFixed(1)} s
              </Note>
            ) : (
              <Note tone="error">{test.error}</Note>
            ))}
        </>
      )}
    </Section>
  )
}

function Value({ text }: { text: string | null }) {
  return text ? (
    <span className="max-w-full truncate font-mono text-xs" title={text}>
      {text}
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  )
}
