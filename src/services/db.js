// ═══════════════════════════════════════════════════════════
// IndexedDB Cache — offline-first data persistence via Dexie
// ═══════════════════════════════════════════════════════════

import Dexie from 'dexie';

export const db = new Dexie('RelishMarketIntel');

db.version(1).stores({
  // Trade data snapshots
  tradeSnapshots: '++id, fetchedAt',
  // Price data snapshots
  priceSnapshots: '++id, fetchedAt',
  // Buyer data snapshots
  buyerSnapshots: '++id, fetchedAt',
  // Spec data snapshots
  specSnapshots: '++id, fetchedAt',
  // Generic key-value cache with TTL
  cache: 'key',
});

// ── Generic TTL cache ──────────────────────────────────────

/**
 * Get a cached value by key (returns null if expired or missing)
 */
export async function getCached(key) {
  try {
    const entry = await db.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      await db.cache.delete(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Store a value in cache with TTL
 * @param {string} key
 * @param {*} data
 * @param {number} ttlMs - Time-to-live in milliseconds (default: 1 hour)
 */
export async function setCache(key, data, ttlMs = 3600000) {
  try {
    await db.cache.put({
      key,
      data,
      expiresAt: Date.now() + ttlMs,
      storedAt: Date.now(),
    });
  } catch {
    // IndexedDB not available (e.g. private mode) — fail silently
  }
}

// ── Snapshot persistence (survives page refresh) ───────────

export async function saveTradeSnapshot(data) {
  await db.tradeSnapshots.add({ data, fetchedAt: Date.now() });
  // Keep only last 5 snapshots
  const all = await db.tradeSnapshots.orderBy('fetchedAt').reverse().toArray();
  if (all.length > 5) {
    const toDelete = all.slice(5).map((r) => r.id);
    await db.tradeSnapshots.bulkDelete(toDelete);
  }
}

export async function getLatestTradeSnapshot() {
  const latest = await db.tradeSnapshots.orderBy('fetchedAt').last();
  return latest?.data || null;
}

export async function savePriceSnapshot(data) {
  await db.priceSnapshots.add({ data, fetchedAt: Date.now() });
  const all = await db.priceSnapshots.orderBy('fetchedAt').reverse().toArray();
  if (all.length > 5) await db.priceSnapshots.bulkDelete(all.slice(5).map((r) => r.id));
}

export async function getLatestPriceSnapshot() {
  return (await db.priceSnapshots.orderBy('fetchedAt').last())?.data || null;
}

export async function saveBuyerSnapshot(data) {
  await db.buyerSnapshots.add({ data, fetchedAt: Date.now() });
  const all = await db.buyerSnapshots.orderBy('fetchedAt').reverse().toArray();
  if (all.length > 5) await db.buyerSnapshots.bulkDelete(all.slice(5).map((r) => r.id));
}

export async function getLatestBuyerSnapshot() {
  return (await db.buyerSnapshots.orderBy('fetchedAt').last())?.data || null;
}

export async function saveSpecSnapshot(data) {
  await db.specSnapshots.add({ data, fetchedAt: Date.now() });
  const all = await db.specSnapshots.orderBy('fetchedAt').reverse().toArray();
  if (all.length > 5) await db.specSnapshots.bulkDelete(all.slice(5).map((r) => r.id));
}

export async function getLatestSpecSnapshot() {
  return (await db.specSnapshots.orderBy('fetchedAt').last())?.data || null;
}
