// API endpoint to upload/update items in Square
// POST: Create new items or update existing ones
// Generates SKUs like JFP1234 (artist initials + 4-digit number)
// Sets inventory quantity after creating items
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    return res.status(500).json({ error: 'Square credentials not configured' });
  }
  const getInitials = (name) => {
    if (!name) return 'XXX';
    const words = name.trim().split(/[\s\-]+/);
    let initials = '';
    for (const word of words) {
      if (word.length > 0) initials += word[0].toUpperCase();
    }
    if (initials.length < 2) initials = name.substring(0, 3).toUpperCase();
    return initials.substring(0, 4);
  };
  
  // Helper function to generate a short unique SKU number
  const getSkuNumber = () => {
    const timestamp = Date.now().toString();
    return timestamp.slice(-4);
  };

  // Helper function to set inventory quantity
  const setInventoryQuantity = async (variationId, quantity) => {
    try {
      const response = await fetch('https://connect.squareup.com/v2/inventory/changes/batch-create', {
        method: 'POST',
        headers: {
          'Square-Version': '2024-12-18',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          idempotency_key: `inv-${variationId}-${Date.now()}`,
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
        console.error('Inventory set error:', data.errors);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Inventory set exception:', error);
      return false;
    }
  };

  try {
    const items = req.body;
    const results = [];
    
    for (const item of items) {
      console.log('Processing item - squareId:', item.squareId, 'artistName:', item.artistName);
      const categoryName = `${item.artistName} - ${item.type}`;
      const reportingCategoryName = item.artistName;
      const dimensions = item.dimensions || (item.height && item.width ? `${item.height}" x ${item.width}"` : '');

      let description = item.description || '';
      const extraLines = [];
      if (item.medium) extraLines.push(`Medium: ${item.medium}`);
      if (dimensions) extraLines.push(`Dimensions: ${dimensions}`);
      if (item.discounts) extraLines.push(`Discounts: ${item.discounts}`);
      if (extraLines.length > 0) description += '\n\n' + extraLines.join('\n');
      description = description.trim();

      if (item.squareId) {
        let categoryId = null;
        if (item.artistName && item.type) {
          const catName = `${item.artistName} - ${item.type}`;
          const catSearch = await fetch('https://connect.squareup.com/v2/catalog/search', { method: 'POST', headers: { 'Square-Version': '2024-12-18', 'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ object_types: ['CATEGORY'], query: { exact_query: { attribute_name: 'name', attribute_value: catName } } }) });
          const catData = await catSearch.json();
          categoryId = catData.objects?.[0]?.id;
          if (!categoryId) {
            const catCreate = await fetch('https://connect.squareup.com/v2/catalog/object', { method: 'POST', headers: { 'Square-Version': '2024-12-18', 'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: `cat-${catName.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`, object: { type: 'CATEGORY', id: `#cat-edit-${item.squareId}`, category_data: { name: catName } } }) });
            const catCreateData = await catCreate.json();
            categoryId = catCreateData.catalog_object?.id;
          }
        }
        const updateObject = { type: 'ITEM', id: item.squareId, version: item.version, item_data: { name: item.title, description: description } };
        if (categoryId) { updateObject.item_data.categories = [{ id: categoryId }]; }
        if (item.variationId && item.price) {
          updateObject.item_data.variations = [{ type: 'ITEM_VARIATION', id: item.variationId, version: item.variationVersion, item_variation_data: { item_id: item.squareId, name: 'Regular', sku: item.sku, pricing_type: 'FIXED_PRICING', price_money: { amount: Math.round(parseFloat(item.price) * 100), currency: 'USD' } } }];
        }
        console.log('Attempting update with:', JSON.stringify({ squareId: item.squareId, version: item.version, variationVersion: item.variationVersion }));
        const response = await fetch('https://connect.squareup.com/v2/catalog/object', { method: 'POST', headers: { 'Square-Version': '2024-12-18', 'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: `update-${item.squareId}-${Date.now()}`, object: updateObject }) });
        const data = await response.json();
        console.log('Square update response:', JSON.stringify(data));
        if (!response.ok) { 
          console.error('Square update failed:', data.errors);
          results.push({ originalId: item.id, squareId: item.squareId, success: false, error: data.errors?.[0]?.detail || 'Failed to update' }); 
        }
        else { results.push({ originalId: item.id, squareId: data.catalog_object?.id || item.squareId, sku: data.catalog_object?.item_data?.variations?.[0]?.item_variation_data?.sku || item.sku, success: true, action: 'updated' }); }
        continue;
      } else {
        const initials = getInitials(item.artistName);
        const skuNum = getSkuNumber();
        const sku = `${initials}${skuNum}`;
        let categoryId = null;
        const searchResponse = await fetch('https://connect.squareup.com/v2/catalog/search', { method: 'POST', headers: { 'Square-Version': '2024-12-18', 'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ object_types: ['CATEGORY'], query: { exact_query: { attribute_name: 'name', attribute_value: categoryName } } }) });
        const searchData = await searchResponse.json();
        categoryId = searchData.objects?.[0]?.id;
        if (!categoryId) {
          const catResponse = await fetch('https://connect.squareup.com/v2/catalog/object', { method: 'POST', headers: { 'Square-Version': '2024-12-18', 'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: `cat-${categoryName.replace(/\s/g, '-')}-${Date.now()}`, object: { type: 'CATEGORY', id: `#cat-${item.id}`, category_data: { name: categoryName } } }) });
          const catData = await catResponse.json();
          categoryId = catData.catalog_object?.id;
        }
        let reportingCategoryId = null;
        const reportingSearchResponse = await fetch('https://connect.squareup.com/v2/catalog/search', { method: 'POST', headers: { 'Square-Version': '2024-12-18', 'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ object_types: ['CATEGORY'], query: { exact_query: { attribute_name: 'name', attribute_value: reportingCategoryName } } }) });
        const reportingSearchData = await reportingSearchResponse.json();
        reportingCategoryId = reportingSearchData.objects?.[0]?.id;
        if (!reportingCategoryId) {
          const reportingCatResponse = await fetch('https://connect.squareup.com/v2/catalog/object', { method: 'POST', headers: { 'Square-Version': '2024-12-18', 'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: `repcat-${reportingCategoryName.replace(/\s/g, '-')}-${Date.now()}`, object: { type: 'CATEGORY', id: `#repcat-${item.id}`, category_data: { name: reportingCategoryName } } }) });
          const reportingCatData = await reportingCatResponse.json();
          reportingCategoryId = reportingCatData.catalog_object?.id;
        }
        const itemData = { idempotency_key: `item-${item.id}-${Date.now()}`, object: { type: 'ITEM', id: `#item-${item.id}`, item_data: { name: item.title, description: description, categories: categoryId ? [{ id: categoryId }] : [], reporting_category: reportingCategoryId ? { id: reportingCategoryId } : undefined, variations: [{ type: 'ITEM_VARIATION', id: `#variation-${item.id}`, item_variation_data: { name: 'Regular', sku: sku, pricing_type: 'FIXED_PRICING', price_money: { amount: Math.round(parseFloat(item.price) * 100), currency: 'USD' }, track_inventory: true } }] } } };
        const response = await fetch('https://connect.squareup.com/v2/catalog/object', { method: 'POST', headers: { 'Square-Version': '2024-12-18', 'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(itemData) });
        const data = await response.json();
        if (!response.ok) { console.error('Square create error:', data); throw new Error(data.errors?.[0]?.detail || 'Failed to upload to Square'); }
        
        const variationId = data.catalog_object?.item_data?.variations?.[0]?.id;
        const quantity = item.quantity || 1;
        
        // Set inventory quantity after creating item
        if (variationId && quantity > 0) {
          console.log(`Setting inventory for ${variationId} to ${quantity}`);
          const inventorySet = await setInventoryQuantity(variationId, quantity);
          if (!inventorySet) {
            console.warn('Failed to set inventory quantity, but item was created');
          }
        }
        
        results.push({ originalId: item.id, squareId: data.catalog_object?.id, variationId: variationId, sku: data.catalog_object?.item_data?.variations?.[0]?.item_variation_data?.sku || sku, category: categoryName, quantity: quantity, success: true, action: 'created' });
      }
    }
    return res.status(200).json({ success: true, results: results });
  } catch (error) {
    console.error('Square Upload Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
