const express = require('express');
const router = express.Router();
const statsStorage = require('../utils/statsStorage');

// In-memory active Roblox client sessions: Map<string, number> (clientId -> lastSeenTimestamp)
const activeClients = new Map();
const ACTIVE_TIMEOUT_MS = 25000; // 25 seconds rolling window

// Helper to clean up expired sessions
function getActiveCount() {
  const now = Date.now();
  for (const [id, lastSeen] of activeClients.entries()) {
    if (now - lastSeen > ACTIVE_TIMEOUT_MS) {
      activeClients.delete(id);
    }
  }
  return activeClients.size;
}

function touchClient(req, isInit = false) {
  // Only register actual Roblox game clients
  const src = req.query?.src || req.headers?.['x-infinity-source'];
  const cid = req.query?.cid || req.headers?.['x-client-id'] || req.body?.cid;
  const ua = (req.headers?.['user-agent'] || '').toLowerCase();

  const isRoblox = src === 'roblox' || ua.includes('roblox') || ua.includes('synapse') || ua.includes('fluxus');

  if (!isRoblox || !cid) {
    return; // Ignore regular web browser visits, curl, and Render health checks
  }

  activeClients.set(String(cid), Date.now());

  if (isInit) {
    statsStorage.recordExecution();
  }
}

/**
 * GET /api/stats
 * Public endpoint returning current active players and execution statistics
 */
router.get('/', (req, res) => {
  try {
    const stats = statsStorage.getStats();
    const activeNow = getActiveCount();

    return res.status(200).json({
      success: true,
      activeNow,
      executionsToday: stats.todayCount,
      thisMonth: stats.monthCount,
      allTime: stats.allTime,
      lastUpdated: stats.lastUpdated || new Date().toISOString()
    });
  } catch (err) {
    console.error('[statsRoute] Error fetching stats:', err);
    return res.status(500).json({ error: 'Failed to retrieve telemetry stats' });
  }
});

/**
 * GET/POST /api/stats/ping
 * Heartbeat & injection counter endpoint called exclusively by Roblox scripts
 */
const handlePing = (req, res) => {
  try {
    const isInit = req.query.init === '1' || req.body?.init === true || req.headers['x-infinity-init'] === '1';

    touchClient(req, isInit);

    const stats = statsStorage.getStats();
    const activeNow = getActiveCount();

    return res.status(200).json({
      success: true,
      activeNow,
      executionsToday: stats.todayCount,
      thisMonth: stats.monthCount,
      allTime: stats.allTime
    });
  } catch (err) {
    console.error('[statsRoute] Error handling ping:', err);
    return res.status(500).json({ error: 'Ping processing error' });
  }
};

router.get('/ping', handlePing);
router.post('/ping', handlePing);

module.exports = {
  router,
  touchClient,
  getActiveCount
};
