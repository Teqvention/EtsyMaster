import {
  ChartNoAxesCombinedIcon,
  LayoutListIcon,
  PaletteIcon,
  PackageCheckIcon,
  Settings2Icon,
  TagIcon,
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
        { title: "Keywords", url: "/keywords" },
      ],
    },
    {
      title: "Studio",
      icon: <PaletteIcon />,
      items: [
        { title: "Generation", url: "/generation" },
        { title: "Styles", url: "/styles" },
        { title: "Mockups", url: "/mockups" },
      ],
    },
    { title: "Uploads", url: "/uploads", icon: <PackageCheckIcon /> },
    { title: "Artikel", url: "/artikel", icon: <LayoutListIcon /> },
    { title: "Performance", url: "/performance", icon: <ChartNoAxesCombinedIcon /> },
    { title: "Prices", url: "/prices", icon: <TagIcon /> },
  ] satisfies NavEntry[],
  secondary: [
    { title: "Settings", url: "/settings", icon: <Settings2Icon /> },
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
