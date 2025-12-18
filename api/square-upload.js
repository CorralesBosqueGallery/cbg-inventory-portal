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

    // Cache for category IDs we've already created/found
    const categoryCache = {};

    for (const item of items) {
      const categoryName = `${item.artistName} - ${item.type}`;
      const dimensions = `${item.height}" x ${item.width}"`;

      // Step 1: Get or create the category
      let categoryId = categoryCache[categoryName];
      
      if (!categoryId) {
        // Search for existing category
        const searchResponse = await fetch('https://connect.squareup.com/v2/catalog/search', {
          method: 'POST',
          headers: {
            'Square-Version': '2024-12-18',
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            object_types: ['CATEGORY'],
            query: {
              exact_query: {
                attribute_name: 'name',
                attribute_value: categoryName
              }
            }
          })
        });

        const searchData = await searchResponse.json();
        
        if (searchData.objects && searchData.objects.length > 0) {
          // Category exists
          categoryId = searchData.objects[0].id;
        } else {
          // Create new category
          const categoryResponse = await fetch('https://connect.squareup.com/v2/catalog/object', {
            method: 'POST',
            headers: {
              'Square-Version': '2024-12-18',
              'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              idempotency_key: `category-${categoryName}-${Date.now()}`,
              object: {
                type: 'CATEGORY',
                id: `#category-${item.id}`,
                category_data: {
                  name: categoryName
                }
              }
            })
          });

          const categoryData = await categoryResponse.json();
          
          if (!categoryResponse.ok) {
            console.error('Category creation error:', categoryData);
            throw new Error(categoryData.errors?.[0]?.detail || 'Failed to create category');
          }
          
          categoryId = categoryData.catalog_object?.id;
        }
        
        // Cache it for future items with same category
        categoryCache[categoryName] = categoryId;
      }

      // Step 2: Create the item with the category ID
      const itemData = {
        idempotency_key: `item-${item.id}-${Date.now()}`,
        object: {
          type: 'ITEM',
          id: `#item-${item.id}`,
          item_data: {
            name: item.title,
            description: `${item.description || ''}\n\nMedium: ${item.medium}\nDimensions: ${dimensions}${item.discounts ? '\nDiscounts: ' + item.discounts : ''}`.trim(),
            categories: [{ id: categoryId }],
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
                  track_inventory: true,
                  location_overrides: [
                    {
                      location_id: SQUARE_LOCATION_ID,
                      track_inventory: true
                    }
                  ]
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
        console.error('Item creation error:', data);
        throw new Error(data.errors?.[0]?.detail || 'Failed to upload to Square');
      }

      // Step 3: Set initial inventory count
      const variationId = data.catalog_object?.item_data?.variations?.[0]?.id;
      
      if (variationId && item.quantity) {
        const inventoryResponse = await fetch('https://connect.squareup.com/v2/inventory/changes/batch-create', {
          method: 'POST',
          headers: {
            'Square-Version': '2024-12-18',
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            idempotency_key: `inventory-${item.id}-${Date.now()}`,
            changes: [
              {
                type: 'ADJUSTMENT',
                adjustment: {
                  catalog_object_id: variationId,
                  location_id: SQUARE_LOCATION_ID,
                  quantity: String(item.quantity || 1),
                  from_state: 'NONE',
                  to_state: 'IN_STOCK',
                  occurred_at: new Date().toISOString()
                }
              }
            ]
          })
        });

        if (!inventoryResponse.ok) {
          const invError = await inventoryResponse.json();
          console.error('Inventory error:', invError);
          // Don't throw - item was created, just inventory failed
        }
      }

      const sku = data.catalog_object?.item_data?.variations?.[0]?.item_variation_data?.sku || 
                  data.catalog_object?.id || 'NO_SKU';

      results.push({
        originalId: item.id,
        squareId: data.catalog_object?.id,
        variationId: variationId,
        sku: sku,
        category: categoryName,
        categoryId: categoryId,
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
};
