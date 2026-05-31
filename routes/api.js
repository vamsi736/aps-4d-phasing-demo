// routes/api.js
// Patched to use APS Authentication v2 (v1 endpoint deprecated 2024).

const express = require('express');
const axios = require('axios');

const { FORGE_CLIENT_ID, FORGE_CLIENT_SECRET } = process.env;
if (!FORGE_CLIENT_ID || !FORGE_CLIENT_SECRET) {
  console.error('ERROR: FORGE_CLIENT_ID or FORGE_CLIENT_SECRET missing in .env');
  process.exit(1);
}

const router = express.Router();

// GET /api/auth/token — provides a viewer access token (2-legged, viewables:read)
router.get('/api/auth/token', async (req, res) => {
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
    res.json({
      access_token: response.data.access_token,
      expires_in: response.data.expires_in,
    });
  } catch (err) {
    console.error('Token error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to get APS token' });
  }
});

module.exports = router;
