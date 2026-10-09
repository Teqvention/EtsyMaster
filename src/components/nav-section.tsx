"use client"

import { ChevronRightIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense } from "react"

import type { NavItem, NavSection as Section } from "@/components/nav-config"
import { isActive } from "@/components/nav-config"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

// A parent that folds its pages away. It starts open: these are the pages the
// app is used for, and hiding them by default would cost a click every visit.
export function NavSection({ section }: { section: Section }) {
  return (
    <Collapsible defaultOpen render={<SidebarMenuItem />}>
      <CollapsibleTrigger
        render={<SidebarMenuButton tooltip={section.title} />}
        className="group/section"
      >
        {section.icon}
        <span>{section.title}</span>
        <ChevronRightIcon className="ml-auto transition-transform duration-200 ease-out-strong group-data-panel-open/section:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {section.items.map((item) => (
            <SidebarMenuSubItem key={item.url}>
              <Suspense fallback={<SubLink item={item} active={false} />}>
                <ActiveSubLink item={item} />
              </Suspense>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ActiveSubLink({ item }: { item: NavItem }) {
  const pathname = usePathname()
  return <SubLink item={item} active={isActive(item, pathname)} />
}

function SubLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <SidebarMenuSubButton isActive={active} render={<Link href={item.url} />}>
      {item.icon}
      <span>{item.title}</span>
    </SidebarMenuSubButton>
  )
}
