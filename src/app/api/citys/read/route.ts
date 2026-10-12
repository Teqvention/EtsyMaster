import { respond } from "@/lib/mockups/respond"
import { readJob, startReading, stopReading } from "@/lib/citys/job"

// The run that reads the city shops' titles for places: how far it is,
// start one (POST), stop it (DELETE).
export async function GET() {
  return respond(readJob)
}

export async function POST() {
  return respond(startReading)
}

export async function DELETE() {
  return respond(stopReading)
}
