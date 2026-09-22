const express = require('express');
const router = express.Router();
const statsStorage = require('../utils/statsStorage');

// In-memory active Roblox client sessions: Map<string, { lastSeen: number, username: string, game: string }>
const activeClients = new Map();
const ACTIVE_TIMEOUT_MS = 10000; // 10 seconds rolling window (polls every 4s)

function getActiveUsers() {
  const now = Date.now();
  const list = [];
  for (const [id, data] of activeClients.entries()) {
    if (now - data.lastSeen > ACTIVE_TIMEOUT_MS) {
      activeClients.delete(id);
    } else {
      list.push({
        id,
        username: data.username || 'Roblox Player',
        game: data.game || 'Infinity Hub'
      });
    }
  }
  return list;
}

function touchClient(req, isInit = false) {
  const src = req.query?.src || req.headers?.['x-infinity-source'];
  const cid = req.query?.cid || req.headers?.['x-client-id'] || req.body?.cid;
  const isLeave = req.query?.leave === '1' || req.body?.leave === true || req.headers?.['x-infinity-leave'] === '1';

  if (isLeave && cid) {
    activeClients.delete(String(cid));
    return;
  }

  const ua = (req.headers?.['user-agent'] || '').toLowerCase();
  const isRoblox = src === 'roblox' || ua.includes('roblox') || ua.includes('synapse') || ua.includes('fluxus');

  if (!isRoblox || !cid) {
    return; // Ignore regular web browser visits, curl, and Render health checks
  }

  const existing = activeClients.get(String(cid));
  const rawUser = req.query?.user || req.body?.user;
  const rawGame = req.query?.game || req.body?.game;

  const username = (rawUser && rawUser !== 'undefined' && rawUser !== 'null') 
    ? rawUser 
    : (existing ? existing.username : 'Roblox Player');
  const game = (rawGame && rawGame !== 'undefined' && rawGame !== 'null') 
    ? rawGame 
    : (existing ? existing.game : 'Infinity Hub');

  activeClients.set(String(cid), {
    lastSeen: Date.now(),
    username: String(username),
    game: String(game)
  });

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
    const activeUsers = getActiveUsers();

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json({
      success: true,
      activeNow: activeUsers.length,
      activeUsers,
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
 * Heartbeat, injection counter & player leave endpoint called exclusively by Roblox scripts
 */
const handlePing = (req, res) => {
  try {
    const isInit = req.query.init === '1' || req.body?.init === true || req.headers['x-infinity-init'] === '1';

    touchClient(req, isInit);

    const stats = statsStorage.getStats();
    const activeUsers = getActiveUsers();

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json({
      success: true,
      activeNow: activeUsers.length,
      activeUsers,
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
  getActiveUsers
};
