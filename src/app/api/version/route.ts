// The commit the running server was built from; UpdateReloader compares it
// with the one baked into the page and reloads when they differ.
export function GET() {
  return Response.json({ version: process.env.APP_VERSION })
}
