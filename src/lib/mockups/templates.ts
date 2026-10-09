import { key } from "./motion"
import type { Template } from "./types"

// Built-in animations. Framing is relative to the poster (see Shot), so each
// one works on any room. Loops end where they start; Etsy repeats hover videos.

export const BUILT_IN: Template[] = [
  {
    id: "push-in",
    name: "Push in",
    duration: 8,
    shake: 0,
    keys: [key(0, { frame: 0 }), key(1, { frame: 0.7 })],
  },
  {
    id: "breathe",
    name: "Breathe",
    duration: 8,
    shake: 0,
    keys: [key(0, { frame: 0.15 }), key(0.5, { frame: 0.45 }), key(1, { frame: 0.15 })],
  },
  {
    id: "ken-burns",
    name: "Ken Burns",
    duration: 10,
    shake: 0,
    keys: [key(0, { frame: 0.1, x: -0.35, y: 0.1 }), key(1, { frame: 0.6, x: 0.08, y: -0.04 })],
  },
  {
    id: "glint",
    name: "Glint",
    duration: 6,
    shake: 0,
    keys: [
      key(0, { frame: 0.55, glint: -0.5 }),
      key(0.2, { frame: 0.565, glint: -0.5 }),
      key(0.65, { frame: 0.585, glint: 1.5 }),
      key(1, { frame: 0.55, glint: 1.5 }),
    ],
  },
  {
    id: "close-up",
    name: "Close-up",
    duration: 10,
    shake: 0,
    keys: [
      key(0, { frame: 1, zoom: 2.2, x: -0.22, y: -0.25 }, "linear"),
      key(0.45, { frame: 1, zoom: 2.2, x: 0.16, y: -0.12 }),
      key(1, { frame: 0.85 }),
    ],
  },
  {
    id: "handheld",
    name: "Handheld",
    duration: 8,
    shake: 0.7,
    keys: [key(0, { frame: 0.45 })],
  },
  {
    id: "glide",
    name: "Glide",
    duration: 10,
    shake: 0,
    keys: [key(0, { frame: 0.45, x: -0.6 }), key(1, { frame: 0.45, x: 0.6 })],
  },
  {
    id: "rise",
    name: "Rise",
    duration: 8,
    shake: 0,
    keys: [key(0, { frame: 0.4, y: 0.6 }), key(1, { frame: 0.55, y: 0 })],
  },
  {
    id: "pull-back",
    name: "Pull back",
    duration: 8,
    shake: 0,
    keys: [key(0, { frame: 1 }), key(1, { frame: 0.05 })],
  },
  {
    id: "unveil",
    name: "Unveil",
    duration: 8,
    shake: 0,
    keys: [
      key(0, { frame: 0.45, design: 0 }, "linear"),
      key(0.15, { frame: 0.47, design: 0 }),
      key(0.6, { frame: 0.62, design: 1 }, "out"),
      key(1, { frame: 0.7, design: 1 }),
    ],
  },
  {
    id: "focus-pull",
    name: "Focus pull",
    duration: 7,
    shake: 0,
    keys: [
      key(0, { frame: 0.6, blur: 1 }),
      key(0.45, { frame: 0.62, blur: 0 }, "linear"),
      key(1, { frame: 0.66 }),
    ],
  },
  {
    id: "golden-hour",
    name: "Golden hour",
    duration: 10,
    shake: 0,
    keys: [
      key(0, { frame: 0.25 }),
      key(0.5, { frame: 0.35, warmth: 0.7, exposure: 0.15, vignette: 0.25 }),
      key(1, { frame: 0.25 }),
    ],
  },
  {
    id: "lights-on",
    name: "Lights on",
    duration: 8,
    shake: 0,
    keys: [
      key(0, { frame: 0.2, exposure: -0.8, warmth: 0.35, vignette: 0.5 }, "out"),
      key(0.6, { frame: 0.4 }),
      key(1, { frame: 0.45 }),
    ],
  },
  {
    id: "spotlight",
    name: "Spotlight",
    duration: 8,
    shake: 0,
    keys: [key(0, { frame: 0.1 }), key(1, { frame: 0.6, vignette: 0.75, exposure: 0.1 })],
  },
  {
    id: "drift",
    name: "Drift",
    duration: 10,
    shake: 0,
    keys: [
      key(0, { frame: 0.5, rotate: -1.5, x: -0.15 }),
      key(1, { frame: 0.5, rotate: 1.5, x: 0.15 }),
    ],
  },
].map((t) => ({ ...t, builtIn: true }))
