"use client"

import { usePathname } from "next/navigation"
import { Suspense } from "react"

import { getPageTitle } from "@/components/nav-config"

// Suspends on routes with dynamic params until the pathname is known.
export function PageTitle() {
  return (
    <h1 className="text-base font-medium">
      <Suspense>
        <Title />
      </Suspense>
    </h1>
  )
}

function Title() {
  const { title, section } = getPageTitle(usePathname())
  return (
    <>
      {section && <span className="text-muted-foreground">{section} / </span>}
      {title}
    </>
  )
}
