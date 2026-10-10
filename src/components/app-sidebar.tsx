"use client"

import * as React from "react"

import { nav } from "@/components/nav-config"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavBatch } from "@/components/nav-batch"
import { NavUsage } from "@/components/nav-usage"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { StoreIcon } from "lucide-react"
import Link from "next/link"

export function AppSidebar({
  shopName,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  shopName: string
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
        <div className="mt-auto flex flex-col">
          <NavBatch className="pb-0" />
          <NavUsage />
        </div>
        <NavSecondary items={nav.secondary} />
      </SidebarContent>
    </Sidebar>
  )
}
