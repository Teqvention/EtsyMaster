import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getShop } from "@/lib/etsy/data"

// App shell shared by every shop page. The sidebar and the inset content
// surface are pinned to the viewport; only the area below the header scrolls,
// so navigating between pages swaps the content without moving the frame.
export default async function ShopLayout({ children }: LayoutProps<"/">) {
  const shop = await getShop()

  return (
    <SidebarProvider
      className="h-svh overflow-hidden"
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar
        variant="inset"
        shopName={shop.name}
        user={{ name: shop.ownerName, email: shop.ownerEmail }}
      />
      <SidebarInset className="min-h-0 overflow-hidden">
        <SiteHeader />
        {/* The fade stays shallower than the 24px inset of sticky panels
            (e.g. the listing detail), so they never dissolve at the edges. */}
        <div className="@container/main min-h-0 flex-1 scroll-fade scroll-fade-5 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
