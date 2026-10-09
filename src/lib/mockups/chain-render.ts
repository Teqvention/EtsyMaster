import { chainPhotoName, type MockupChain } from "./chain-types"
import { fetchScene } from "./client"
import { exportScene } from "./export"
import { exportClip } from "./video"

// A chain rendered with one poster, in the browser: the listing photos in
// chain order at export size ("01.jpg" …), then the video ("video.mp4").

export async function renderChain(
  chain: MockupChain,
  poster: ImageBitmap,
  onProgress?: (text: string) => void
): Promise<{ name: string; blob: Blob }[]> {
  const files: { name: string; blob: Blob }[] = []
  for (const [i, id] of chain.scenes.entries()) {
    onProgress?.(`Photo ${i + 1} / ${chain.scenes.length}`)
    const scene = await fetchScene(id)
    files.push({ name: chainPhotoName(i), blob: await exportScene(scene, poster) })
  }
  // A clip deleted from its mockup since is skipped, like a deleted mockup.
  const scene = chain.video && (await fetchScene(chain.video.sceneId))
  const clip = scene && scene.clips?.find((c) => c.id === chain.video!.clipId)
  if (scene && clip) {
    onProgress?.("Video 0 %")
    const blob = await exportClip(scene, clip, poster, undefined, (p) =>
      onProgress?.(`Video ${Math.floor(p * 100)} %`)
    )
    files.push({ name: "video.mp4", blob })
  }
  return files
}
