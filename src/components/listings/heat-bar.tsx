import { cn } from "@/lib/utils"

// Sales velocity as a meter: the estimate's 0–100 heat, filled in the brand
// hue over a lighter step of the same hue.
export function HeatBar({ heat, className }: { heat: number; className?: string }) {
  return (
    <div
      role="meter"
      aria-label="Sales velocity"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={heat}
      className={cn("h-0.75 overflow-hidden rounded-full bg-brand/15", className)}
    >
      <div
        className="h-full rounded-full bg-brand"
        style={{ width: `${Math.max(heat, 2)}%` }}
      />
    </div>
  )
}
