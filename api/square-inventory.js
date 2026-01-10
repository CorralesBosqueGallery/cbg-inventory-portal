// API endpoint to fetch inventory from Square
// GET: Fetch all catalog items
// Filters by artist name in category if artistName query param provided

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

    // Transform Square items to our format
    const items = allItems.map(item => {
      const itemData = item.item_data || {};
      const variation = itemData.variations?.[0];
      const variationData = variation?.item_variation_data || {};
      
      // Get category name from our categories lookup or from item
      let categoryName = 'Unknown';
      if (itemData.category_id && categories[itemData.category_id]) {
        categoryName = categories[itemData.category_id];
      } else if (itemData.categories?.[0]?.id && categories[itemData.categories[0].id]) {
        categoryName = categories[itemData.categories[0].id];
      }
      
      // Parse artist name from category (format: "Artist Name - Type")
      const categoryParts = categoryName.split(' - ');
      const artistFromCategory = categoryParts.length > 1 ? categoryParts.slice(0, -1).join(' - ') : categoryName;
      const typeFromCategory = categoryParts.length > 1 ? categoryParts[categoryParts.length - 1] : '';
      
      // Parse dimensions and medium from description
      const description = itemData.description || '';
      let medium = '';
      let dimensions = '';
      let cleanDescription = description;
      
      const mediumMatch = description.match(/Medium:\s*([^\n]+)/i);
      if (mediumMatch) {
        medium = mediumMatch[1].trim();
        cleanDescription = cleanDescription.replace(/Medium:\s*[^\n]+\n?/i, '');
      }
      
      const dimMatch = description.match(/Dimensions:\s*([^\n]+)/i);
      if (dimMatch) {
        dimensions = dimMatch[1].trim();
        cleanDescription = cleanDescription.replace(/Dimensions:\s*[^\n]+\n?/i, '');
      }
      
      // Remove discounts line from description
      cleanDescription = cleanDescription.replace(/Discounts:\s*[^\n]+\n?/i, '').trim();
      
      // Parse height and width from dimensions
      let height = '';
      let width = '';
      const hwMatch = dimensions.match(/(\d+\.?\d*)\s*["']\s*x\s*(\d+\.?\d*)/i);
      if (hwMatch) {
        height = hwMatch[1];
        width = hwMatch[2];
      }

      return {
        id: item.id,
        squareId: item.id,
        variationId: variation?.id || null,
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
        status: 'live', // All Square items are live
        updatedAt: item.updated_at,
        createdAt: item.created_at
      };
    });

    // Filter by artist if requested
    let filteredItems = items;
    if (artistName) {
      filteredItems = items.filter(item => 
        item.artistName.toLowerCase() === artistName.toLowerCase()
      );
    }

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
