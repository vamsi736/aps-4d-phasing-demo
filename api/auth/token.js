// Vercel serverless function: GET /api/auth/token
// Generates 2-legged APS access token (viewables:read scope).

const axios = require('axios');

module.exports = async (req, res) => {
  const { FORGE_CLIENT_ID, FORGE_CLIENT_SECRET } = process.env;

  if (!FORGE_CLIENT_ID || !FORGE_CLIENT_SECRET) {
    console.error('Missing FORGE_CLIENT_ID or FORGE_CLIENT_SECRET env vars');
    return res.status(500).json({ error: 'Server misconfigured — APS credentials missing' });
  }

  try {
    const response = await axios.post(
      'https://developer.api.autodesk.com/authentication/v2/token',
      new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'viewables:read',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization:
            'Basic ' +
            Buffer.from(`${FORGE_CLIENT_ID}:${FORGE_CLIENT_SECRET}`).toString('base64'),
        },
      }
    );

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      access_token: response.data.access_token,
      expires_in: response.data.expires_in,
    });
  } catch (err) {
    console.error('Token error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to get APS token' });
  }
};
