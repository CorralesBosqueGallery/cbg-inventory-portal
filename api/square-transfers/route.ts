import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const beginTime = searchParams.get('begin_time')
  const endTime = searchParams.get('end_time')

  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN
  const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID

  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    return NextResponse.json({ error: 'Square credentials not configured' }, { status: 500 })
  }

  try {
    // Fetch settlements (transfers) from Square
    let allSettlements: any[] = []
    let cursor: string | null = null

    do {
      const url = new URL('https://connect.squareup.com/v2/settlements')
      url.searchParams.set('location_id', SQUARE_LOCATION_ID)
      if (beginTime) url.searchParams.set('begin_time', beginTime)
      if (endTime) url.searchParams.set('end_time', endTime)
      if (cursor) url.searchParams.set('cursor', cursor)

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Square-Version': '2024-12-18',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.errors?.[0]?.detail || 'Failed to fetch settlements from Square')
      }

      if (data.settlements) {
        allSettlements = allSettlements.concat(data.settlements)
      }

      cursor = data.cursor || null
    } while (cursor)

    // For each settlement, fetch the detailed entries
    const detailedSettlements = await Promise.all(
      allSettlements.map(async (settlement) => {
        const detailUrl = `https://connect.squareup.com/v2/settlements/${settlement.id}`
        const detailResponse = await fetch(detailUrl, {
          headers: {
            'Square-Version': '2024-12-18',
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        })
        const detailData = await detailResponse.json()
        const s = detailData.settlement || settlement

        // Parse entries into Sales, Tax, Fees
        let grossSales = 0
        let tax = 0
        let fees = 0

        if (s.entries) {
          s.entries.forEach((entry: any) => {
            const amount = (entry.amount_money?.amount || 0) / 100
            const type = entry.type

            if (type === 'TRANSACTION_AMOUNT') grossSales += amount
            else if (type === 'TAX_AMOUNT') tax += amount
            else if (type === 'PROCESSING_FEE') fees += Math.abs(amount)
          })
        }

        const deposited = (s.amount_money?.amount || 0) / 100

        return {
          id: s.id,
          date: s.initiated_at || s.created_at,
          status: s.status,
          grossSales: grossSales,
          tax: tax,
          fees: fees,
          deposited: deposited
        }
      })
    )

    return NextResponse.json({
      success: true,
      settlements: detailedSettlements
    })

  } catch (error: any) {
    console.error('Square Transfers Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
