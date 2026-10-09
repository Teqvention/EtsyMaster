"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense } from "react"

import type { NavItem } from "@/components/nav-config"
import { isActive } from "@/components/nav-config"
import { SidebarMenuButton } from "@/components/ui/sidebar"

// Routes with dynamic params (e.g. /mockups/[id]) only know the pathname at
// request time, so the active state streams in; the link itself prerenders.
export function NavLink({ item }: { item: NavItem }) {
  return (
    <Suspense fallback={<NavLinkButton item={item} active={false} />}>
      <ActiveNavLink item={item} />
    </Suspense>
  )
}

function ActiveNavLink({ item }: { item: NavItem }) {
  const pathname = usePathname()
  return <NavLinkButton item={item} active={isActive(item, pathname)} />
}

function NavLinkButton({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <SidebarMenuButton
      tooltip={item.title}
      isActive={active}
      render={
        item.external ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" />
        ) : (
          <Link href={item.url} />
        )
      }
    >
      {item.icon}
      <span>{item.title}</span>
    </SidebarMenuButton>
  )
}
