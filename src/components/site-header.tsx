import { ModeToggle } from "@/components/mode-toggle"
import { PageTitle } from "@/components/page-title"
import { BackgroundAnalyses } from "@/components/shops/background-analyses"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ExternalLinkIcon } from "lucide-react"

export function SiteHeader() {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <PageTitle />
        <div className="ml-auto flex items-center gap-2">
          <BackgroundAnalyses />
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:flex"
            nativeButton={false}
            render={
              <a
                href="https://www.etsy.com/your/shops/me/dashboard"
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            Etsy Shop Manager
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
