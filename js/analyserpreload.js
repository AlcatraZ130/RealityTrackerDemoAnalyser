// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Automatic pre-analysis pass for Vision Heatmap and Analyser Timeline markers.

class AnalyserPreloader {
	constructor() {
		this.isRunning = false;
		this.cellSize = 50;
		this.rayLength = 4000;
		this.rayStep = 50;
	}

	requested() {
		return true; // Always active by default
	}

	resetResults() {
		if (typeof analyserTimeline !== "undefined") analyserTimeline.resetAnalysis();
		if (typeof noLOSKills !== "undefined") noLOSKills.length = 0;
		if (typeof heatmapCache !== "undefined") heatmapCache.clear();
		this.preloaderFocusMap = new Map();
		this.playerMaxFocusMap = new Map();
		this.playerTotalFocusMap = new Map();
	}

	applyFocusToPlayers() {
		if (typeof AllPlayers === "undefined" || !AllPlayers) return;
		if (this.playerMaxFocusMap) {
			for (const [pid, maxSec] of this.playerMaxFocusMap) {
				if (AllPlayers[pid]) {
					AllPlayers[pid].ns_maxFocusSeconds = maxSec;
				}
			}
		}
		if (this.playerTotalFocusMap) {
			for (const [pid, totalSec] of this.playerTotalFocusMap) {
				if (AllPlayers[pid]) {
					AllPlayers[pid].ns_totalFocusSeconds = totalSec;
				}
			}
		}
	}

	run(done) {
		if (this.isRunning || !messageArrayObject) { done(); return; }
		this.isRunning = true;
		this.resetResults();
		const config = { range: Number(options_VisionConeRange), cone: Number(options_VisionConeAngle), speed: Number(options_SnapMinSpeed) };
		const states = new Map(), heatmaps = new Map(), killsByTick = new Map();
		const preloaderFocusMap = this.preloaderFocusMap, playerMaxFocusMap = this.playerMaxFocusMap, playerTotalFocusMap = this.playerTotalFocusMap;
		for (const kill of eventArrays.kills.events) {
			const tick = kill.tick != null ? kill.tick : kill.Tick;
			if (!killsByTick.has(tick)) killsByTick.set(tick, []);
			killsByTick.get(tick).push(kill);
		}
		let index = 0, tick = 0;
		const total = messageArrayObject.messages.length, chunkSize = 100;
		setLoadingOverlayText("Preloading Analyser data: 0%...");

		const part = () => {
			const end = Math.min(index + chunkSize, total);
			for (; index < end; index++) {
				const message = messageArrayObject.getMessageAt(index);
				if (!message) continue;
				if (message.getUint8(0) === MESSAGETYPE.PLAYER_UPDATE) this.readPlayers(message, states);
				else if (message.getUint8(0) === MESSAGETYPE.TICK) {
					this.analyzeTick(tick, states, heatmaps, killsByTick.get(tick) || [], config, preloaderFocusMap, playerMaxFocusMap, playerTotalFocusMap);
					tick++;
				}
			}
			if (index < total) {
				setLoadingOverlayText("Preloading Analyser data: " + Math.floor(index * 100 / total) + "%...");
				setTimeout(part, 0);
			} else {
				for (const [id, data] of heatmaps)
					heatmapCache.set(attentionHeatmap.getCacheKey(id), data);
				if (typeof killfeed_ApplyNoLOSMarkers === "function") killfeed_ApplyNoLOSMarkers();

				this.playerStates = states;
				this.applyFocusToPlayers();
				if (typeof playerRow_UpdateAll === "function") playerRow_UpdateAll();

				this.isRunning = false;
				done();
			}
		};
		setTimeout(part, 0);
	}

	state(states, id) {
		if (!states.has(id)) states.set(id, { id, team: 0, X: 0, Y: 0, Z: 0, rotation: 0, alive: false, position: false, rotationKnown: false, previousRotation: null, history: [] });
		return states.get(id);
	}

	readPlayers(message, states) {
		let pos = 1;
		while (pos < message.byteLength) {
			const flags = message.getUint16(pos, true), id = message.getUint8(pos + 2);
			pos += 3;
			const p = this.state(states, id);
			if (flags & PLAYERUPDATEFLAGS.TEAM) p.team = message.getUint8(pos++);
			if (flags & PLAYERUPDATEFLAGS.SQUAD) pos++;
			if (flags & PLAYERUPDATEFLAGS.VEHICLE) {
				const vehicle = message.getInt16(pos, true); pos += 2;
				if (vehicle >= 0) { const seat = getString(message, pos); pos += seat.length + 2; }
			}
			if (flags & PLAYERUPDATEFLAGS.HEALTH) pos++;
			if (flags & PLAYERUPDATEFLAGS.SCORE) pos += 2;
			if (flags & PLAYERUPDATEFLAGS.TEAMWORKSCORE) pos += 2;
			if (flags & PLAYERUPDATEFLAGS.KILLS) pos += 2;
			if (flags & PLAYERUPDATEFLAGS.DEATHS) pos += 2;
			if (flags & PLAYERUPDATEFLAGS.PING) pos += 2;
			if (flags & PLAYERUPDATEFLAGS.ISALIVE) p.alive = message.getInt8(pos++) === 1;
			if (flags & PLAYERUPDATEFLAGS.ISJOINING) pos++;
			if (flags & PLAYERUPDATEFLAGS.POSITION) {
				p.X = message.getInt16(pos, true); p.Y = message.getInt16(pos + 2, true); p.Z = message.getInt16(pos + 4, true);
				p.position = true; pos += 6;
			}
			if (flags & PLAYERUPDATEFLAGS.ROTATION) { p.rotation = message.getInt16(pos, true); p.rotationKnown = true; pos += 2; }
			if (flags & PLAYERUPDATEFLAGS.KIT) { const kit = getString(message, pos); pos += kit.length + 1; }
		}
	}

	analyzeTick(tick, states, heatmaps, kills, config, preloaderFocusMap, playerMaxFocusMap, playerTotalFocusMap) {
		const activePlayers = [];
		for (const p of states.values()) {
			if (!p.position) continue;
			p.history.push({ tick, X: p.X, Y: p.Y, Z: p.Z, rotation: p.rotation, alive: p.alive });
			if (p.history.length > MO_WINDOW_TICKS) p.history.shift();
			if (p.alive) {
				this.heat(p, heatmaps);
				if (p.rotationKnown) activePlayers.push(p);
			}
			p.previousRotation = p.rotation;
		}

		if (preloaderFocusMap && playerMaxFocusMap && activePlayers.length > 1) {
			for (let i = 0; i < activePlayers.length; i++) {
				const p = activePlayers[i];
				for (let j = 0; j < activePlayers.length; j++) {
					const other = activePlayers[j];
					if (p === other || p.team === other.team) continue;

					const worldDist = Math.hypot(other.X - p.X, other.Z - p.Z);
					if (worldDist <= 10 || worldDist > 4000) continue;

					const result = this.angle(p, other);
					const perpDist = worldDist * Math.sin(result.angle * Math.PI / 180);

					if (perpDist <= 25.0 && result.angle <= (config.cone / 2)) {
						const key = `${p.id}_${other.id}`;
						const ticks = (preloaderFocusMap.get(key) || 0) + 1;
						preloaderFocusMap.set(key, ticks);

						const sec = ticks * 0.04;
						if (!playerMaxFocusMap.has(p.id) || sec > playerMaxFocusMap.get(p.id)) {
							playerMaxFocusMap.set(p.id, sec);
						}

						if (playerTotalFocusMap) {
							const currentTotal = playerTotalFocusMap.get(p.id) || 0;
							playerTotalFocusMap.set(p.id, currentTotal + 0.04);
						}
					}
				}
			}
		}

		for (const kill of kills) { if (typeof analyserTimeline !== "undefined") analyserTimeline.recordKill(kill); this.kill(kill, states, config); }
	}

	angle(a, b) {
		const dx = b.X - a.X, dz = b.Z - a.Z, dist = Math.hypot(dx, dz);
		if (dist < 1) return { dist, angle: 0 };
		const r = a.rotation * Math.PI / 180;
		return { dist, angle: Math.acos(Math.max(-1, Math.min(1, Math.sin(r) * dx / dist + Math.cos(r) * dz / dist))) * 180 / Math.PI };
	}

	kill(kill, states, config) {
		if (kill.isTeamkill) return;
		const a = states.get(kill.AttackerID), v = states.get(kill.VictimID);
		if (!a || !v || a.history.length < NOCONE_WINDOW_TICKS || v.history.length < NOCONE_WINDOW_TICKS) return;
		let inConeWithLOS = false;
		for (const ah of a.history) {
			const vh = v.history.find(h => h.tick === ah.tick);
			if (!vh || !ah.alive || !vh.alive) continue;
			const result = this.angle(ah, vh);
			if (result.dist <= config.range && result.angle <= config.cone / 2) {
				const hasLOS = (typeof hasTerrainLOS === "function") ? hasTerrainLOS(ah.X, ah.Y, ah.Z, vh.X, vh.Y, vh.Z) : true;
				if (hasLOS) { inConeWithLOS = true; break; }
			}
		}
		if (!inConeWithLOS && !kill.isNoLOSKill) {
			kill.isNoLOSKill = true;
			if (typeof noLOSKills !== "undefined") {
				noLOSKills.push({ tick: kill.tick != null ? kill.tick : kill.Tick, attackerId: kill.AttackerID, victimId: kill.VictimID, attackerName: kill.AttackerName, victimName: kill.VictimName, weapon: kill.Weapon, reason: "no_los_kill" });
			}
		}
	}

	heat(p, heatmaps) {
		if (!heatmaps.has(p.id)) heatmaps.set(p.id, { visionGrid: new Map(), maxVisionWeight: 0 });
		const data = heatmaps.get(p.id), add = (grid, x, z) => {
			const key = Math.floor(x / this.cellSize) + "," + Math.floor(z / this.cellSize), value = (grid.get(key) || 0) + 1;
			grid.set(key, value); return value;
		};
		if (!p.rotationKnown) return;
		const r = p.rotation * Math.PI / 180;
		for (let d = this.rayStep; d <= this.rayLength; d += this.rayStep)
			data.maxVisionWeight = Math.max(data.maxVisionWeight, add(data.visionGrid, p.X + Math.sin(r) * d, p.Z + Math.cos(r) * d));
	}
}

var analyserPreloader = new AnalyserPreloader();
