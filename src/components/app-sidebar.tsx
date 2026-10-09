"use client"

import * as React from "react"

import { nav } from "@/components/nav-config"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUsage } from "@/components/nav-usage"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { StoreIcon } from "lucide-react"
import Link from "next/link"

export function AppSidebar({
  shopName,
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  shopName: string
  user: { name: string; email: string; avatar?: string }
}) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link href="/dashboard" />}
            >
              <StoreIcon className="size-5! text-(--brand)" />
              <span className="text-base font-semibold">{shopName}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={nav.main} />
        <NavUsage className="mt-auto" />
        <NavSecondary items={nav.secondary} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
