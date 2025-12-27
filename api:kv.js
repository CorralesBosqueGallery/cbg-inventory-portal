export default async function handler(req, res) {
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    console.error('KV not configured - URL:', !!KV_URL, 'TOKEN:', !!KV_TOKEN);
    return res.status(500).json({ error: 'KV not configured' });
  }

  const headers = { Authorization: `Bearer ${KV_TOKEN}` };

  try {
    if (req.method === 'GET') {
      const { key } = req.query;
      if (!key) return res.status(400).json({ error: 'Key required' });
      
      const response = await fetch(`${KV_URL}/get/${key}`, { headers });
      const data = await response.json();
      console.log('KV GET', key, '- result exists:', !!data.result);
      return res.status(200).json({ value: data.result });
    }

    if (req.method === 'POST') {
      const { key, value } = req.body;
      if (!key) return res.status(400).json({ error: 'Key required' });
      
      // Value comes in as a string already, send it directly
      const response = await fetch(`${KV_URL}/set/${key}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'text/plain' },
        body: value
      });
      const data = await response.json();
      console.log('KV SET', key, '- success:', data.result === 'OK');
      
      if (data.result !== 'OK') {
        console.error('KV SET failed:', data);
        return res.status(500).json({ error: 'Failed to save', details: data });
      }
      
      return res.status(200).json({ success: true, result: data.result });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('KV Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
