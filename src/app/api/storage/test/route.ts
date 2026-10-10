import { testStorage } from "@/lib/storage"

// Settings' "Test" button: uploads a small file, reads it back from its
// public address and deletes it. Always 200; `ok` says how it went.
export async function POST() {
  return Response.json(await testStorage())
}
