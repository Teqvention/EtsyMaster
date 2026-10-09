"use client"

import * as React from "react"
import {
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  FlexRender,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type SortingState,
} from "@tanstack/react-table"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCurrency, formatDate } from "@/lib/etsy/format"
import type { Order, OrderStatus } from "@/lib/etsy/types"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BanIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CircleCheckIcon,
  ClockIcon,
  Columns3Icon,
  EllipsisVerticalIcon,
  SearchIcon,
  TruckIcon,
} from "lucide-react"

const features = tableFeatures({
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
})

const columnHelper = createColumnHelper<typeof features, Order>()

// Status always ships with an icon + label, never color alone.
const statusDisplay: Record<
  OrderStatus,
  { label: string; icon: React.ReactNode }
> = {
  paid: {
    label: "To ship",
    icon: <ClockIcon className="text-amber-600 dark:text-amber-400" />,
  },
  shipped: { label: "Shipped", icon: <TruckIcon /> },
  completed: {
    label: "Completed",
    icon: <CircleCheckIcon className="fill-green-500 dark:fill-green-400" />,
  },
  canceled: { label: "Canceled", icon: <BanIcon /> },
}

const views = [
  { value: "all", label: "All orders" },
  { value: "paid", label: "To ship" },
  { value: "shipped", label: "Shipped" },
  { value: "completed", label: "Completed" },
] as const

type View = (typeof views)[number]["value"]

function SortableHeader({
  label,
  sorted,
  onToggle,
  align = "left",
}: {
  label: string
  sorted: false | "asc" | "desc"
  onToggle?: (event: unknown) => void
  align?: "left" | "right"
}) {
  const Icon =
    sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : ArrowUpDownIcon
  return (
    <Button
      variant="ghost"
      size="sm"
      className={align === "right" ? "-mr-2 ml-auto flex" : "-ml-2"}
      onClick={onToggle}
    >
      {label}
      <Icon data-icon="inline-end" className="text-muted-foreground" />
    </Button>
  )
}

function getColumns(currency: string) {
  return columnHelper.columns([
    columnHelper.display({
      id: "select",
      header: ({ table }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={
              table.getIsSomePageRowsSelected() &&
              !table.getIsAllPageRowsSelected()
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    }),
    columnHelper.accessor("id", {
      header: "Order",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground">#{row.original.id}</span>
      ),
      enableSorting: false,
      enableHiding: false,
    }),
    columnHelper.accessor("buyerName", {
      header: ({ column }) => (
        <SortableHeader
          label="Buyer"
          sorted={column.getIsSorted()}
          onToggle={column.getToggleSortingHandler()}
        />
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.buyerName}</span>
          <span className="text-xs text-muted-foreground">
            {row.original.country}
          </span>
        </div>
      ),
      sortFn: "text",
      enableHiding: false,
    }),
    columnHelper.accessor("createdAt", {
      header: ({ column }) => (
        <SortableHeader
          label="Date"
          sorted={column.getIsSorted()}
          onToggle={column.getToggleSortingHandler()}
        />
      ),
      cell: ({ row }) => formatDate(row.original.createdAt),
      sortFn: "text",
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ row }) => {
        const { label, icon } = statusDisplay[row.original.status]
        return (
          <Badge variant="outline" className="px-1.5 text-muted-foreground">
            {icon}
            {label}
          </Badge>
        )
      },
      enableSorting: false,
    }),
    columnHelper.accessor("shipBy", {
      header: "Ship by",
      cell: ({ row }) =>
        row.original.status === "paid" ? (
          formatDate(row.original.shipBy)
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      enableSorting: false,
    }),
    columnHelper.accessor("itemCount", {
      header: () => <div className="w-full text-right">Items</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{row.original.itemCount}</div>
      ),
      enableSorting: false,
    }),
    columnHelper.accessor("totalCents", {
      header: ({ column }) => (
        <SortableHeader
          label="Total"
          align="right"
          sorted={column.getIsSorted()}
          onToggle={column.getToggleSortingHandler()}
        />
      ),
      cell: ({ row }) => (
        <div className="text-right font-medium tabular-nums">
          {formatCurrency(row.original.totalCents, currency)}
        </div>
      ),
      sortFn: "basic",
    }),
    columnHelper.display({
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="flex size-8 text-muted-foreground data-open:bg-muted"
                size="icon"
              />
            }
          >
            <EllipsisVerticalIcon />
            <span className="sr-only">Open menu</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              render={
                <a
                  href={`https://www.etsy.com/your/orders/sold?order_id=${row.original.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              View on Etsy
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={row.original.status !== "paid"}
              onClick={() =>
                toast.success(`Order #${row.original.id} marked as shipped`)
              }
            >
              Mark as shipped
            </DropdownMenuItem>
            <DropdownMenuItem>Message buyer</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={row.original.status === "canceled"}
            >
              Cancel order
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }),
  ])
}

const columnLabels: Record<string, string> = {
  createdAt: "Date",
  status: "Status",
  shipBy: "Ship by",
  itemCount: "Items",
  totalCents: "Total",
}

export function OrdersTable({
  orders,
  currency,
}: {
  orders: Order[]
  currency: string
}) {
  const [view, setView] = React.useState<View>("all")
  const [query, setQuery] = React.useState("")
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({})
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })

  const columns = React.useMemo(() => getColumns(currency), [currency])

  const counts = React.useMemo(() => {
    const result: Partial<Record<OrderStatus, number>> = {}
    for (const order of orders) {
      result[order.status] = (result[order.status] ?? 0) + 1
    }
    return result
  }, [orders])

  const data = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter(
      (order) =>
        (view === "all" || order.status === view) &&
        (!q ||
          order.buyerName.toLowerCase().includes(q) ||
          String(order.id).includes(q))
    )
  }, [orders, view, query])

  const table = useTable({
    features,
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
  })

  function changeView(next: View) {
    setView(next)
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }

  return (
    <Tabs
      value={view}
      onValueChange={(value) => changeView(value as View)}
      className="w-full flex-col justify-start gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 lg:px-6">
        <Label htmlFor="view-selector" className="sr-only">
          View
        </Label>
        <Select
          value={view}
          onValueChange={(value) => {
            if (value !== null) changeView(value as View)
          }}
          items={[...views]}
        >
          <SelectTrigger
            className="flex w-fit @4xl/main:hidden"
            size="sm"
            id="view-selector"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {views.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <TabsList className="hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:px-1 @4xl/main:flex">
          {views.map((v) => (
            <TabsTrigger key={v.value} value={v.value}>
              {v.label}
              {v.value === "paid" && counts.paid ? (
                <Badge variant="secondary">{counts.paid}</Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPagination((p) => ({ ...p, pageIndex: 0 }))
              }}
              placeholder="Search buyer or order #"
              aria-label="Search orders"
              className="h-7 w-48 pl-8 lg:w-64"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
            >
              <Columns3Icon data-icon="inline-start" />
              <span className="hidden lg:inline">Columns</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {table
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== "undefined" &&
                    column.getCanHide()
                )
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {columnLabels[column.id] ?? column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* The tab value only drives filtering, so every tab shares one table. */}
      <TabsContent
        value={view}
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
      >
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder ? null : (
                        <FlexRender header={header} />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="**:data-[slot=table-cell]:first:w-8">
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    No orders found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-4">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {table.getRowCount()} order(s) selected.
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Rows per page
              </Label>
              <Select
                value={`${table.state.pagination.pageSize}`}
                onValueChange={(value) => {
                  table.setPageSize(Number(value))
                }}
                items={[10, 20, 30, 40, 50].map((pageSize) => ({
                  label: `${pageSize}`,
                  value: `${pageSize}`,
                }))}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue placeholder={table.state.pagination.pageSize} />
                </SelectTrigger>
                <SelectContent side="top">
                  <SelectGroup>
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>
                        {pageSize}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Page {table.state.pagination.pageIndex + 1} of{" "}
              {Math.max(table.getPageCount(), 1)}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to first page</span>
                <ChevronsLeftIcon />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to previous page</span>
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRightIcon />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to last page</span>
                <ChevronsRightIcon />
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}
