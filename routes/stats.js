const express = require('express');
const router = express.Router();
const statsStorage = require('../utils/statsStorage');

// In-memory active client sessions: Map<string, number> (clientId -> lastSeenTimestamp)
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
  return Math.max(activeClients.size, 1); // Minimum 1 active when viewed or running
}

function touchClient(clientId, isInit = false) {
  if (!clientId) return;
  activeClients.set(clientId, Date.now());
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
 * Heartbeat & injection counter endpoint called by Roblox clients
 */
const handlePing = (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const clientId = req.query.cid || req.body?.cid || req.headers['x-client-id'] || ip;
    const isInit = req.query.init === '1' || req.body?.init === true || req.headers['x-infinity-init'] === '1';

    touchClient(clientId, isInit);

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
