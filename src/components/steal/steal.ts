"use client"

import { toast } from "sonner"

import { refreshCategories } from "@/hooks/use-mockup-categories"
import { fileInFolders, toSaveRequest } from "@/hooks/use-saved"
import type { Listing } from "@/lib/etsy/types"

// Stealing a listing files it into a category on the Saved page (the folders
// are the mockup categories). Every steal says what happened and can be undone.

type Navigate = (href: string) => void

export const savedHref = (folder?: string) =>
  folder ? `/liked?folder=${encodeURIComponent(folder)}` : "/liked"

/** Files each group into its category, one request per category, and toasts the result. */
export async function steal(groups: { folder: string; listings: Listing[] }[], navigate: Navigate) {
  const requests = groups
    .map(({ folder, listings }) => ({
      folder,
      listings: listings.filter((l) => l.images[0]).map(toSaveRequest),
    }))
    .filter((g) => g.listings.length)
  const total = requests.reduce((n, g) => n + g.listings.length, 0)
  if (!total) return false

  try {
    const undo = await fileInFolders(requests)
    // Categories new to the server came with the listings.
    refreshCategories()
    const folders = requests.map((g) => g.folder)
    const what = total === 1 ? "" : ` ${total} listings`
    toast.success(
      folders.length === 1 ? `Stolen${what} into ${folders[0]}` : `Stolen${what} into ${folders.length} categories`,
      {
        action: {
          label: "Open",
          onClick: () => navigate(savedHref(folders.length === 1 ? folders[0] : undefined)),
        },
        cancel: {
          label: "Undo",
          onClick: () =>
            undo().then(
              () => toast(total === 1 ? "Steal undone" : `Put ${total} listings back`),
              (error: Error) => toast.error(`Couldn't undo: ${error.message}`)
            ),
        },
      }
    )
    return true
  } catch (error) {
    toast.error(`Couldn't steal: ${(error as Error).message}`)
    return false
  }
}
