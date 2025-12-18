

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const items = req.body;
    const results = [];

    const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
    const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;

    if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
      throw new Error('Square credentials not configured');
    }

    for (const item of items) {
      const category = `${item.artistName} - ${item.type}`;
      const dimensions = `${item.height}" x ${item.width}"`;
      
      const itemData = {
        idempotency_key: `item-${item.id}-${Date.now()}`,
        object: {
          type: 'ITEM',
          id: `#item-${item.id}`,
          item_data: {
            name: item.title,
            description: `${item.description || ''}\n\nMedium: ${item.medium}\nDimensions: ${dimensions}${item.discounts ? '\nDiscounts: ' + item.discounts : ''}`.trim(),
            category_name: category,
            variations: [
              {
                type: 'ITEM_VARIATION',
                id: `#variation-${item.id}`,
                item_variation_data: {
                  name: 'Regular',
                  pricing_type: 'FIXED_PRICING',
                  price_money: {
                    amount: Math.round(parseFloat(item.price) * 100),
                    currency: 'USD'
                  },
                  track_inventory: true
                }
              }
            ]
          }
        }
      };

      const response = await fetch('https://connect.squareup.com/v2/catalog/object', {
        method: 'POST',
        headers: {
          'Square-Version': '2024-12-18',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(itemData)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.errors?.[0]?.detail || 'Failed to upload to Square');
      }

      const sku = data.catalog_object?.item_data?.variations?.[0]?.item_variation_data?.sku || 
                  data.catalog_object?.id || 'NO_SKU';

      results.push({
        originalId: item.id,
        squareId: data.catalog_object?.id,
        sku: sku,
        category: category,
        success: true
      });
    }

    return res.status(200).json({
      success: true,
      results: results
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
