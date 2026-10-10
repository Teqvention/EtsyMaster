// Runs once when a server starts: the background work that goes on with no
// page open. The upload worker picks up jobs where they stopped; the daily
// sync pulls our shops' listings, sales, fees and Gelato costs; batch jobs
// painting posters are asked after until their images are in.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { startBackground } = await import("./instrumentation-node")
  startBackground()
}
