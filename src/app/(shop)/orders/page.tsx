import { Suspense } from "react"
import { connection } from "next/server"

import { OrdersTable } from "@/components/orders-table"
import { Skeleton } from "@/components/ui/skeleton"
import { getOrders, getShop } from "@/lib/etsy/data"

export default async function OrdersPage() {
  const shop = await getShop()

  return (
    <Suspense
      fallback={
        <div className="px-4 lg:px-6">
          <Skeleton className="h-[640px] rounded-xl" />
        </div>
      }
    >
      <Orders currency={shop.currency} />
    </Suspense>
  )
}

async function Orders({ currency }: { currency: string }) {
  await connection()
  const orders = await getOrders(120)

  return <OrdersTable orders={orders} currency={currency} />
}
