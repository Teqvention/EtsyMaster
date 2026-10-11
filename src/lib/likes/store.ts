import { readDoc, updateDoc } from "@/lib/db/documents"

import { applyLikeOps, mergeLikes, type LikeOp, type Likes } from "./ops"

// Liked listings in the document "liked": each change applied in one
// transaction, so likes from every tab and address land.
const FILE = "liked"

export const getLikes = () => readDoc<Likes>(FILE, {})

export const changeLikes = (ops: LikeOp[]) => updateDoc<Likes>(FILE, {}, (likes) => applyLikeOps(likes, ops))

/** Folds a copy (an older browser's) in; nothing is removed. */
export const importLikes = (copy: Likes) => updateDoc<Likes>(FILE, {}, (likes) => mergeLikes(likes, copy))
