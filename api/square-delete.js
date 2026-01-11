// API endpoint to delete items from Square
// POST: Delete a catalog item by ID

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

  if (!SQUARE_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Square credentials not configured' });
  }

  try {
    const { itemId } = req.body;

    if (!itemId) {
      return res.status(400).json({ error: 'Item ID is required' });
    }

    // Delete the catalog object from Square
    const response = await fetch(`https://connect.squareup.com/v2/catalog/object/${itemId}`, {
      method: 'DELETE',
      headers: {
        'Square-Version': '2024-12-18',
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Square delete error:', data);
      throw new Error(data.errors?.[0]?.detail || 'Failed to delete from Square');
    }

    return res.status(200).json({
      success: true,
      deletedIds: data.deleted_object_ids || [itemId]
    });

  } catch (error) {
    console.error('Square Delete Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
