// API endpoint to upload/update items in Square
// POST: Create new items or update existing ones

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
    const items = req.body;
    const results = [];

    for (const item of items) {
      const category = item.category || `${item.artistName} - ${item.type}`;
      const dimensions = item.dimensions || `${item.height}" x ${item.width}"`;
      
      // Build description with metadata
      let description = item.description || '';
      description += `\n\nMedium: ${item.medium}`;
      description += `\nDimensions: ${dimensions}`;
      if (item.discounts) {
        description += `\nDiscounts: ${item.discounts}`;
      }
      description = description.trim();

      // Check if this is an update (has squareId) or new item
      if (item.squareId) {
        // UPDATE existing item
        const updateData = {
          idempotency_key: `update-${item.squareId}-${Date.now()}`,
          object: {
            type: 'ITEM',
            id: item.squareId,
            version: item.version, // Square requires version for updates
            item_data: {
              name: item.title,
              description: description
            }
          }
        };

        // If we have a variation to update price
        if (item.variationId && item.price) {
          updateData.object.item_data.variations = [{
            type: 'ITEM_VARIATION',
            id: item.variationId,
            item_variation_data: {
              name: 'Regular',
              pricing_type: 'FIXED_PRICING',
              price_money: {
                amount: Math.round(parseFloat(item.price) * 100),
                currency: 'USD'
              }
            }
          }];
        }

        const response = await fetch('https://connect.squareup.com/v2/catalog/object', {
          method: 'POST',
          headers: {
            'Square-Version': '2024-12-18',
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updateData)
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('Square update error:', data);
          results.push({
            originalId: item.id,
            squareId: item.squareId,
            success: false,
            error: data.errors?.[0]?.detail || 'Failed to update'
          });
        } else {
          results.push({
            originalId: item.id,
            squareId: data.catalog_object?.id || item.squareId,
            sku: data.catalog_object?.item_data?.variations?.[0]?.item_variation_data?.sku || item.sku,
            success: true,
            action: 'updated'
          });
        }

      } else {
        // CREATE new item
        const itemData = {
          idempotency_key: `item-${item.id}-${Date.now()}`,
          object: {
            type: 'ITEM',
            id: `#item-${item.id}`,
            item_data: {
              name: item.title,
              description: description,
              categories: [], // Will be set after we find/create category
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

        // First, find or create the category
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
                attribute_value: category
              }
            }
          })
        });

        const searchData = await searchResponse.json();
        let categoryId = searchData.objects?.[0]?.id;

        // Create category if it doesn't exist
        if (!categoryId) {
          const catResponse = await fetch('https://connect.squareup.com/v2/catalog/object', {
            method: 'POST',
            headers: {
              'Square-Version': '2024-12-18',
              'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              idempotency_key: `cat-${category}-${Date.now()}`,
              object: {
                type: 'CATEGORY',
                id: `#cat-${item.id}`,
                category_data: {
                  name: category
                }
              }
            })
          });

          const catData = await catResponse.json();
          categoryId = catData.catalog_object?.id;
        }

        // Add category to item if we have one
        if (categoryId) {
          itemData.object.item_data.categories = [{ id: categoryId }];
        }

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
          console.error('Square create error:', data);
          throw new Error(data.errors?.[0]?.detail || 'Failed to upload to Square');
        }

        const sku = data.catalog_object?.item_data?.variations?.[0]?.item_variation_data?.sku || 
                    data.catalog_object?.id || 'NO_SKU';

        results.push({
          originalId: item.id,
          squareId: data.catalog_object?.id,
          variationId: data.catalog_object?.item_data?.variations?.[0]?.id,
          sku: sku,
          category: category,
          success: true,
          action: 'created'
        });
      }
    }

    return res.status(200).json({
      success: true,
      results: results
    });

  } catch (error) {
    console.error('Square Upload Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
