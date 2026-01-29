// API endpoint to update inventory quantity in Square
// POST: Set inventory count for a variation

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;

  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    return res.status(500).json({ error: 'Square credentials not configured' });
  }

  try {
    const { variationId, quantity } = req.body;

    if (!variationId) {
      return res.status(400).json({ error: 'variationId is required' });
    }

    if (quantity === undefined || quantity === null) {
      return res.status(400).json({ error: 'quantity is required' });
    }

    const response = await fetch('https://connect.squareup.com/v2/inventory/changes/batch-create', {
      method: 'POST',
      headers: {
        'Square-Version': '2024-12-18',
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        idempotency_key: `inv-update-${variationId}-${Date.now()}`,
        changes: [{
          type: 'PHYSICAL_COUNT',
          physical_count: {
            catalog_object_id: variationId,
            location_id: SQUARE_LOCATION_ID,
            quantity: String(quantity),
            state: 'IN_STOCK',
            occurred_at: new Date().toISOString()
          }
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Square inventory update error:', data.errors);
      return res.status(500).json({ 
        success: false, 
        error: data.errors?.[0]?.detail || 'Failed to update inventory' 
      });
    }

    return res.status(200).json({ 
      success: true, 
      quantity: quantity 
    });

  } catch (error) {
    console.error('Square Inventory Update Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}
