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

    // Cache for category IDs and reporting category IDs
    const categoryCache = {};
    const reportingCategoryCache = {};

    // Helper function to sanitize strings for Square IDs (only alphanumeric and hyphens)
    const sanitizeForId = (str) => {
      return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special chars except spaces and hyphens
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Collapse multiple hyphens
        .substring(0, 50); // Limit length
    };

    // Helper function to generate SKU
    const generateSKU = (artistName, itemId) => {
      // Get initials from artist name (e.g., "Joan Findley-Perls" -> "JFP")
      const initials = artistName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .split(/[\s-]+/)
        .map(word => word.charAt(0).toUpperCase())
        .filter(char => /[A-Z]/.test(char))
        .join('');
      // Add timestamp portion for uniqueness
      const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
      return `CBG-${initials || 'X'}-${timestamp}`;
    };

    // Helper function to get or create reporting category (artist name)
    const getOrCreateReportingCategory = async (artistName) => {
      if (reportingCategoryCache[artistName]) {
        return reportingCategoryCache[artistName];
      }

      // Search for existing category with artist name
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
              attribute_value: artistName
            }
          }
        })
      });

      const searchData = await searchResponse.json();

      if (searchData.objects && searchData.objects.length > 0) {
        // Category exists
        reportingCategoryCache[artistName] = searchData.objects[0].id;
        return searchData.objects[0].id;
      }

      // Create new category for artist (reporting category)
      const categoryResponse = await fetch('https://connect.squareup.com/v2/catalog/object', {
        method: 'POST',
        headers: {
          'Square-Version': '2024-12-18',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          idempotency_key: `reporting-category-${sanitizeForId(artistName)}-${Date.now()}`,
          object: {
            type: 'CATEGORY',
            id: `#reporting-category-${sanitizeForId(artistName)}`,
            category_data: {
              name: artistName
            }
          }
        })
      });

      const categoryData = await categoryResponse.json();

      if (!categoryResponse.ok) {
        console.error('Reporting category creation error:', categoryData);
        return null;
      }

      const categoryId = categoryData.catalog_object?.id;
      if (categoryId) {
        reportingCategoryCache[artistName] = categoryId;
      }
      return categoryId;
    };

    for (const item of items) {
      const categoryName = `${item.artistName} - ${item.type}`;
      const dimensions = `${item.height}" x ${item.width}"`;
      const sku = generateSKU(item.artistName, item.id);

      // Step 1: Get or create the reporting category (artist name only)
      const reportingCategoryId = await getOrCreateReportingCategory(item.artistName);

      // Step 2: Get or create the regular category (Artist - Type)
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
              idempotency_key: `category-${sanitizeForId(categoryName)}-${Date.now()}`,
              object: {
                type: 'CATEGORY',
                id: `#category-${sanitizeForId(categoryName)}-${item.id}`,
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

      // Step 3: Create the item with the category ID, SKU, and reporting category
      const itemVariationData = {
        name: 'Regular',
        pricing_type: 'FIXED_PRICING',
        price_money: {
          amount: Math.round(parseFloat(item.price) * 100),
          currency: 'USD'
        },
        sku: sku,
        track_inventory: true,
        location_overrides: [
          {
            location_id: SQUARE_LOCATION_ID,
            track_inventory: true
          }
        ]
      };

      // Build item_data with reporting_category if available
      const itemDataContent = {
        name: item.title,
        description: `${item.description || ''}\n\nMedium: ${item.medium}\nDimensions: ${dimensions}\nArtist: ${item.artistName}${item.discounts ? '\nDiscounts: ' + item.discounts : ''}`.trim(),
        categories: [{ id: categoryId }],
        variations: [
          {
            type: 'ITEM_VARIATION',
            id: `#variation-${item.id}`,
            item_variation_data: itemVariationData
          }
        ]
      };

      // Add reporting category (artist name) if we have it
      if (reportingCategoryId) {
        itemDataContent.reporting_category = { id: reportingCategoryId };
      }

      const itemData = {
        idempotency_key: `item-${item.id}-${Date.now()}`,
        object: {
          type: 'ITEM',
          id: `#item-${item.id}`,
          item_data: itemDataContent
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

      const variationId = data.catalog_object?.item_data?.variations?.[0]?.id;

      // Step 4: Set initial inventory count
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

      results.push({
        originalId: item.id,
        squareId: data.catalog_object?.id,
        variationId: variationId,
        sku: sku,
        category: categoryName,
        categoryId: categoryId,
        reportingCategoryId: reportingCategoryId,
        artistName: item.artistName,
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
