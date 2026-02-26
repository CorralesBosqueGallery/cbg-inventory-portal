// API endpoint to fetch inventory from Square
// GET: Fetch all catalog items with inventory counts
// Filters by artist name in category if artistName query param provided
// Category format expected: "Artist Name - Type"

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;

  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    return res.status(500).json({ error: 'Square credentials not configured' });
  }

  try {
    const { artistName } = req.query;
    
    // Fetch all catalog items from Square
    let allItems = [];
    let cursor = null;
    
    do {
      const url = new URL('https://connect.squareup.com/v2/catalog/list');
      url.searchParams.set('types', 'ITEM');
      if (cursor) url.searchParams.set('cursor', cursor);
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Square-Version': '2024-12-18',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.errors?.[0]?.detail || 'Failed to fetch from Square');
      }

      if (data.objects) {
        allItems = allItems.concat(data.objects);
      }
      
      cursor = data.cursor;
    } while (cursor);

    // Also fetch categories to get category names
    let categories = {};
    let catCursor = null;
    
    do {
      const catUrl = new URL('https://connect.squareup.com/v2/catalog/list');
      catUrl.searchParams.set('types', 'CATEGORY');
      if (catCursor) catUrl.searchParams.set('cursor', catCursor);
      
      const catResponse = await fetch(catUrl.toString(), {
        method: 'GET',
        headers: {
          'Square-Version': '2024-12-18',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      const catData = await catResponse.json();
      
      if (catResponse.ok && catData.objects) {
        catData.objects.forEach(cat => {
          categories[cat.id] = cat.category_data?.name || 'Unknown';
        });
      }
      
      catCursor = catData.cursor;
    } while (catCursor);

    // Collect all variation IDs to fetch inventory counts
    const variationIds = allItems
      .map(item => item.item_data?.variations?.[0]?.id)
      .filter(id => id);

    // Fetch inventory counts for all variations
    let inventoryCounts = {};
    if (variationIds.length > 0) {
      // Square API allows up to 100 catalog object IDs per request
      const batchSize = 100;
      for (let i = 0; i < variationIds.length; i += batchSize) {
        const batch = variationIds.slice(i, i + batchSize);
        
        const invResponse = await fetch('https://connect.squareup.com/v2/inventory/counts/batch-retrieve', {
          method: 'POST',
          headers: {
            'Square-Version': '2024-12-18',
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            catalog_object_ids: batch,
            location_ids: [SQUARE_LOCATION_ID]
          })
        });

        const invData = await invResponse.json();
        
        if (invResponse.ok && invData.counts) {
          invData.counts.forEach(count => {
            if (count.state === 'IN_STOCK') {
              inventoryCounts[count.catalog_object_id] = parseInt(count.quantity) || 0;
            }
          });
        }
      }
    }

    // Transform Square items to our format
    const items = allItems.map(item => {
      const itemData = item.item_data || {};
      const variation = itemData.variations?.[0];
      const variationData = variation?.item_variation_data || {};
      const variationId = variation?.id;
      
      // Get category name - check multiple possible locations
      let categoryName = '';
      
      // Try category_id first
      if (itemData.category_id && categories[itemData.category_id]) {
        categoryName = categories[itemData.category_id];
      } 
      // Then try categories array
      else if (itemData.categories?.[0]?.id && categories[itemData.categories[0].id]) {
        categoryName = categories[itemData.categories[0].id];
      }
      // Then try reporting_category
      else if (itemData.reporting_category?.id && categories[itemData.reporting_category.id]) {
        categoryName = categories[itemData.reporting_category.id];
      }
      
      // Parse artist name from category (format: "Artist Name - Type")
      let artistFromCategory = '';
      let typeFromCategory = '';
      
      if (categoryName.includes(' - ')) {
        const dashIndex = categoryName.lastIndexOf(' - ');
        artistFromCategory = categoryName.substring(0, dashIndex);
        typeFromCategory = categoryName.substring(dashIndex + 3);
      } else {
        artistFromCategory = categoryName;
        typeFromCategory = '';
      }
      
      // Parse dimensions and medium from description
      // Square's catalog/list may return description_html instead of description
      let rawDescription = itemData.description || itemData.description_plaintext || '';
      if (!rawDescription && itemData.description_html) {
        rawDescription = itemData.description_html
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<p>/gi, '')
          .replace(/<[^>]*>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .trim();
      }
      const description = rawDescription;
      let medium = '';
      let dimensions = '';
      let cleanDescription = description;
      
      const mediumMatch = description.match(/Medium:[^\S\n]*([^\n]*)/i);
      if (mediumMatch) {
        medium = mediumMatch[1].trim();
        cleanDescription = cleanDescription.replace(/Medium:[^\S\n]*[^\n]*\n?/i, '');
      }

      const dimMatch = description.match(/Dimensions:[^\S\n]*([^\n]*)/i);
      if (dimMatch) {
        dimensions = dimMatch[1].trim();
        cleanDescription = cleanDescription.replace(/Dimensions:[^\S\n]*[^\n]*\n?/i, '');
      }

      cleanDescription = cleanDescription.replace(/Discounts:[^\S\n]*[^\n]*\n?/i, '').trim();
      
      let height = '';
      let width = '';
      const hwMatch = dimensions.match(/(\d+\.?\d*)\s*["']\s*x\s*(\d+\.?\d*)/i);
      if (hwMatch) {
        height = hwMatch[1];
        width = hwMatch[2];
      }

      // Get inventory quantity for this variation
      const quantity = variationId ? (inventoryCounts[variationId] || 0) : 0;

      return {
        id: item.id,
        squareId: item.id,
        variationId: variationId || null,
        version: item.version,
        variationVersion: variation?.version || null,
        title: itemData.name || 'Untitled',
        artistName: artistFromCategory,
        category: categoryName,
        type: typeFromCategory,
        medium: medium,
        description: cleanDescription,
        dimensions: dimensions,
        height: height,
        width: width,
        price: variationData.price_money ? (variationData.price_money.amount / 100).toFixed(2) : '0.00',
        sku: variationData.sku || item.id,
        quantity: quantity,
        status: 'live',
        updatedAt: item.updated_at,
        createdAt: item.created_at
      };
    });

    // Filter by artist if requested
    let filteredItems = items;
    if (artistName) {
      const searchName = artistName.toLowerCase().trim();
      filteredItems = items.filter(item => {
        const itemArtist = (item.artistName || '').toLowerCase().trim();
        return itemArtist === searchName || 
               itemArtist.startsWith(searchName) ||
               (item.category || '').toLowerCase().startsWith(searchName);
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      items: filteredItems,
      totalCount: filteredItems.length,
      allCount: items.length
    });

  } catch (error) {
    console.error('Square Inventory Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
