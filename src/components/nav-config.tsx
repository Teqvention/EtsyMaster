import {
  CircleHelpIcon,
  FrameIcon,
  Settings2Icon,
  TelescopeIcon,
} from "lucide-react"

export type NavItem = {
  title: string
  url: string
  /** Sub-items under a section go without. */
  icon?: React.ReactNode
  /** Opens outside the app, in a new tab. */
  external?: boolean
}

/** A collapsible parent in the sidebar; its items sit indented beneath it. */
export type NavSection = {
  title: string
  icon: React.ReactNode
  items: NavItem[]
}

export type NavEntry = NavItem | NavSection

export function isSection(entry: NavEntry): entry is NavSection {
  return "items" in entry
}

// Single source of truth for the sidebar links and the header's page title.
export const nav = {
  main: [
    {
      title: "Research",
      icon: <TelescopeIcon />,
      items: [
        { title: "Products", url: "/search" },
        { title: "Shops", url: "/shops" },
        { title: "Saved", url: "/liked" },
      ],
    },
    { title: "Mockups", url: "/mockups", icon: <FrameIcon /> },
  ] satisfies NavEntry[],
  secondary: [
    { title: "Settings", url: "/settings", icon: <Settings2Icon /> },
    {
      title: "Seller Handbook",
      url: "https://www.etsy.com/seller-handbook",
      icon: <CircleHelpIcon />,
      external: true,
    },
  ],
}

export function isActive(item: NavItem, pathname: string) {
  return (
    !item.external &&
    (pathname === item.url || pathname.startsWith(`${item.url}/`))
  )
}

/** The page's title, and the section it sits in, if any. */
export function getPageTitle(pathname: string): { title: string; section?: string } {
  for (const entry of [...nav.main, ...nav.secondary] as NavEntry[]) {
    if (isSection(entry)) {
      const item = entry.items.find((i) => isActive(i, pathname))
      if (item) return { title: item.title, section: entry.title }
    } else if (isActive(entry, pathname)) {
      return { title: entry.title }
    }
  }
  return { title: "Dashboard" }
}
