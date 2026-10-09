"use client"

import * as React from "react"

// The editor's playhead. Lives outside React so playback redraws the canvas
// without re-rendering the editor; components that show the time subscribe.
export class Player {
  time = 0
  playing = false
  private duration = 1
  private frame = 0
  private last = 0
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setDuration(duration: number) {
    this.duration = Math.max(0.1, duration)
    if (this.time > this.duration) this.seek(this.duration)
  }

  seek(time: number) {
    this.time = Math.min(this.duration, Math.max(0, time))
    this.emit()
  }

  play() {
    if (this.playing) return
    if (this.time >= this.duration) this.time = 0
    this.playing = true
    this.last = performance.now()
    this.frame = requestAnimationFrame(this.tick)
    this.emit()
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.frame)
    this.emit()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  private tick = (now: number) => {
    // Loops, as Etsy does on hover.
    this.time = (this.time + (now - this.last) / 1000) % this.duration
    this.last = now
    this.emit()
    this.frame = requestAnimationFrame(this.tick)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}

export function usePlayer() {
  const [player] = React.useState(() => new Player())
  React.useEffect(() => () => player.pause(), [player])
  return player
}

export function usePlayerTime(player: Player) {
  return React.useSyncExternalStore(player.subscribe, () => player.time, () => 0)
}

export function usePlaying(player: Player) {
  return React.useSyncExternalStore(player.subscribe, () => player.playing, () => false)
}
