"use client"

import { isSection, type NavEntry } from "@/components/nav-config"
import { NavLink } from "@/components/nav-link"
import { NavSection } from "@/components/nav-section"
import { Button } from "@/components/ui/button"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { CirclePlusIcon, MessageSquareIcon } from "lucide-react"

export function NavMain({ items }: { items: NavEntry[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              tooltip="Add a listing"
              className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
              render={
                <a
                  href="https://www.etsy.com/your/shops/me/listing-editor/create"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <CirclePlusIcon />
              <span>Add a listing</span>
            </SidebarMenuButton>
            <Button
              size="icon"
              className="size-8 group-data-[collapsible=icon]:opacity-0"
              variant="outline"
            >
              <MessageSquareIcon />
              <span className="sr-only">Messages</span>
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((entry) =>
            isSection(entry) ? (
              <NavSection key={entry.title} section={entry} />
            ) : (
              <SidebarMenuItem key={entry.title}>
                <NavLink item={entry} />
              </SidebarMenuItem>
            )
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
