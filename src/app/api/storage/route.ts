import { connection } from "next/server"

import { storageStatus } from "@/lib/storage"

// Whether print file hosting is set up (read from the environment, nothing
// sent anywhere), for Settings and the Uploads page.
export async function GET() {
  await connection()
  return Response.json(await storageStatus())
}
