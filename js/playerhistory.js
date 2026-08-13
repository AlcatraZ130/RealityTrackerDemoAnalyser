// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Player History Ring Buffer + Terrain Line-of-Sight (Phase 1)
//
// Provides multi-tick history per player for Demo Analyser features that
// need to look backwards in time (Phases 2, 5).
//
// Note  -  Why this lives OUTSIDE player objects:
//   parser.js's shallowCopy() skips all "ns_" prefixed fields and
//   saveState/loadState only persists the shallow-copied snapshot. After a
//   loadState the player objects have no history beyond the single
//   current-tick values.  Keeping the buffer in a separate Map<playerId,
//   RingBuffer> avoids that: we explicitly invalidate() on seek, then let
//   the buffer refill during the fast-forward catch-up ticks that goTo()
//   runs before arriving at the target tick.
//
// LIMITATIONS:
//   - History is INVALIDATED on any seek (goTo / loadState / Reset). After a
//     seek the buffer refills during fast-forward, but features needing N
//     ticks of lookback may briefly show "insufficient data".
//   - Only stores raw per-tick values (not interpolated render-frame values).
//   - Terrain LOS only checks the heightmap mesh. Buildings, walls, and
//     static geometry are NOT checked (future Phase 1.5).
//   - Tick rate (DemoTimePerTick) limits temporal resolution.

var HISTORY_SIZE = 60  // ring buffer capacity: ~30s at default 0.5s/tick


// ──────────────────────────────────────────────────────────────────────────────
// Ring buffer
// ──────────────────────────────────────────────────────────────────────────────

class PlayerHistoryBuffer {
	constructor() {
		/** @type {Map<number, {entries: Array, writeIdx: number, count: number}>} */
		this._buffers = new Map()
	}

	/** Clear all history (call on seek / reset). */
	invalidate() {
		this._buffers.clear()
	}

	/**
	 * Record one tick of state for a player.
	 * Call from Update() for every player, including during isFastForwarding
	 * (positions are valid during fast-forward; only ns_last* are stale).
	 */
	recordTick(playerId, player) {
		const id = Number(playerId)
		let buf = this._buffers.get(id)
		if (!buf) {
			buf = { entries: new Array(HISTORY_SIZE), writeIdx: 0, count: 0 }
			this._buffers.set(id, buf)
		}

		buf.entries[buf.writeIdx] = {
			tick:     Tick_Current,
			X:        player.X,
			Y:        player.Y,
			Z:        player.Z,
			rotation: player.rotation,
			isAlive:  player.isAlive
		}
		buf.writeIdx = (buf.writeIdx + 1) % HISTORY_SIZE
		if (buf.count < HISTORY_SIZE) buf.count++
	}

	/**
	 * Return the last `windowTicks` entries for a player, oldest-first.
	 * Returns fewer entries if not enough history is available yet.
	 *
	 * @param {number} playerId
	 * @param {number} [windowTicks]  -  defaults to entire buffer
	 * @returns {Array<{tick, X, Y, Z, rotation, isAlive}>}
	 */
	getHistory(playerId, windowTicks) {
		const buf = this._buffers.get(Number(playerId))
		if (!buf || buf.count === 0) return []

		const count = Math.min(windowTicks || buf.count, buf.count)
		const result = new Array(count)

		for (let i = 0; i < count; i++) {
			const idx = ((buf.writeIdx - count + i) % HISTORY_SIZE + HISTORY_SIZE) % HISTORY_SIZE
			result[i] = buf.entries[idx]
		}
		return result
	}

	/**
	 * True if the player has at least `requiredTicks` entries recorded
	 * since the last invalidation.
	 */
	isWarmedUp(playerId, requiredTicks) {
		const buf = this._buffers.get(Number(playerId))
		if (!buf) return false
		return buf.count >= (requiredTicks || 2)
	}

	/** How many ticks of history this player currently has. */
	getCount(playerId) {
		const buf = this._buffers.get(Number(playerId))
		return buf ? buf.count : 0
	}

	/** Most recent entry for a player, or null. */
	getLatest(playerId) {
		const buf = this._buffers.get(Number(playerId))
		if (!buf || buf.count === 0) return null
		const idx = ((buf.writeIdx - 1) % HISTORY_SIZE + HISTORY_SIZE) % HISTORY_SIZE
		return buf.entries[idx]
	}
}

var playerHistory = new PlayerHistoryBuffer()


// ──────────────────────────────────────────────────────────────────────────────
// Terrain Line-of-Sight (heightmap only  -  NO buildings)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Check if there is an unobstructed line of sight between two world positions,
 * considering ONLY the terrain heightmap.  Buildings and static objects are
 * NOT checked  -  that requires Phase 1.5 (geometry raycasting).
 *
 * @param {number} x1  Horizontal X of position 1 (world coords)
 * @param {number} y1  Height (vertical) of position 1
 * @param {number} z1  Horizontal Z of position 1
 * @param {number} x2  Horizontal X of position 2
 * @param {number} y2  Height (vertical) of position 2
 * @param {number} z2  Horizontal Z of position 2
 * @param {number} [eyeHeight=1.7]  Added to Y of both positions (standing eye)
 * @returns {boolean} true if LOS exists (or if heightmap not yet loaded)
 */
function hasTerrainLOS(x1, y1, z1, x2, y2, z2, eyeHeight) {
	// Guard: if heightmap not ready, assume LOS (permissive fallback)
	if (!heightmap || !heightmap.initialized) return true

	if (isNaN(x1) || isNaN(y1) || isNaN(z1) || isNaN(x2) || isNaN(y2) || isNaN(z2)) return true;

	if (eyeHeight === undefined) eyeHeight = 1.7

	const dx = x2 - x1
	const dz = z2 - z1
	const horizontalDist = Math.hypot(dx, dz)

	// Trivially close  -  no terrain can block at <1m
	if (horizontalDist < 1) return true

	// Eye heights at both endpoints
	const eyeY1 = y1 + eyeHeight
	const eyeY2 = y2 + eyeHeight

	// Phase 1.5: building heightmap available?
	const hasBldg = (typeof buildingHeightmap !== 'undefined') && buildingHeightmap.initialized

	// March along the XZ segment in fixed steps (~3m apart)
	var STEP_SIZE = 3 // meters between samples
	const steps = Math.max(2, Math.ceil(horizontalDist / STEP_SIZE))

	// 1. Terrain Heightmap Check
	for (let i = 1; i < steps; i++) {
		const t = i / steps
		const sx = x1 + dx * t
		const sz = z1 + dz * t

		// Interpolated LOS height at this sample point
		const losY = eyeY1 + (eyeY2 - eyeY1) * t

		// Terrain height at this XZ position
		const terrainY = heightmap.getHeightFromCoords(sx, sz)

		if (terrainY > losY) {
			if (typeof options_DrawLOSCollisionPoints !== 'undefined' && options_DrawLOSCollisionPoints && typeof devTestCollisionPoints !== 'undefined') {
				devTestCollisionPoints.push({ x: sx, y: terrainY, z: sz, type: "terrain" });
			}
			return false; // Terrain blocks line of sight
		}
	}

	// 2. High-Precision 3D Building OBB Raycast Check (Option 1 + 2 + 3)
	if (hasBldg) {
		const buildingOk = buildingHeightmap.hasBuildingLOS(x1, y1, z1, x2, y2, z2, eyeHeight);
		if (!buildingOk) return false; // 3D Building OBB blocks line of sight
	}

	return true
}
