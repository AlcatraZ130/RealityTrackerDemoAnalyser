// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Automatic pre-analysis pass for BVR Focus Timers, Timeline markers and No-LOS Kills.

class AnalyserPreloader {
	constructor() {
		this.isRunning = false;
	}

	requested() {
		return true;
	}

	resetResults() {
		if (typeof analyserTimeline !== "undefined") analyserTimeline.resetAnalysis();
		if (typeof noLOSKills !== "undefined") noLOSKills.length = 0;
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
		const states = new Map(), killsByTick = new Map();
		const preloaderFocusMap = this.preloaderFocusMap, playerMaxFocusMap = this.playerMaxFocusMap, playerTotalFocusMap = this.playerTotalFocusMap;
		for (const kill of eventArrays.kills.events) {
			const tick = kill.tick != null ? kill.tick : kill.Tick;
			if (!killsByTick.has(tick)) killsByTick.set(tick, []);
			killsByTick.get(tick).push(kill);
		}

		const hz = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0) ? DetectedDemoHz : 3.0;
		// Sample focus at ~1.5 Hz regardless of demo tickrate
		const stride = Math.max(1, Math.round(hz / 1.5));
		const timePerSampleSec = (1.0 / hz) * stride;

		let index = 0, tick = 0;
		const total = messageArrayObject.messages.length;
		setLoadingOverlayText("Analysing Tactical Data: 0%...");

		const part = () => {
			const batchStart = performance.now();
			while (index < total) {
				const message = messageArrayObject.getMessageAt(index);
				if (message) {
					const mType = message.getUint8(0);
					if (mType === MESSAGETYPE.PLAYER_UPDATE) {
						this.readPlayers(message, states);
					} else if (mType === MESSAGETYPE.TICK) {
						this.analyzeTick(tick, states, killsByTick.get(tick) || [], config, preloaderFocusMap, playerMaxFocusMap, playerTotalFocusMap, stride, timePerSampleSec);
						tick++;
					}
				}
				index++;

				if ((index & 2047) === 0 && (performance.now() - batchStart > 24)) {
					break;
				}
			}

			if (index < total) {
				const pct = Math.floor(index * 100 / total);
				setLoadingOverlayText(`Analysing Tactical Data: ${pct}%...`);
				setTimeout(part, 0);
			} else {
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
		if (!states.has(id)) states.set(id, { id, team: 0, X: 0, Y: 0, Z: 0, rotation: 0, alive: false, position: false, rotationKnown: false, history: [] });
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

	analyzeTick(tick, states, kills, config, preloaderFocusMap, playerMaxFocusMap, playerTotalFocusMap, stride, timePerSampleSec) {
		const shouldSampleFocus = (tick % stride === 0);
		const activePlayers = [];

		for (const p of states.values()) {
			if (!p.position) continue;
			p.history.push({ tick, X: p.X, Y: p.Y, Z: p.Z, rotation: p.rotation, alive: p.alive });
			if (p.history.length > MO_WINDOW_TICKS) p.history.shift();

			if (p.alive && shouldSampleFocus && p.rotationKnown) {
				activePlayers.push(p);
			}
		}

		if (shouldSampleFocus && preloaderFocusMap && playerMaxFocusMap && activePlayers.length > 1) {
			for (let i = 0; i < activePlayers.length; i++) {
				const p = activePlayers[i];
				const r = p.rotation * (Math.PI / 180);
				const sinR = Math.sin(r);
				const cosR = Math.cos(r);
				const halfConeDeg = config.cone / 2;

				for (let j = 0; j < activePlayers.length; j++) {
					const other = activePlayers[j];
					if (p === other || p.team === other.team) continue;

					const dx = other.X - p.X;
					const dz = other.Z - p.Z;
					const worldDist = Math.hypot(dx, dz);
					if (worldDist <= 10 || worldDist > 4000) continue;

					const dot = (sinR * dx + cosR * dz) / worldDist;
					if (dot <= 0) continue; // Enemy is behind

					const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
					if (angleDeg > halfConeDeg) continue;

					const perpDist = worldDist * Math.sin(angleDeg * (Math.PI / 180));
					if (perpDist <= 25.0) {
						const key = `${p.id}_${other.id}`;
						const currentSec = (preloaderFocusMap.get(key) || 0) + timePerSampleSec;
						preloaderFocusMap.set(key, currentSec);

						if (!playerMaxFocusMap.has(p.id) || currentSec > playerMaxFocusMap.get(p.id)) {
							playerMaxFocusMap.set(p.id, currentSec);
						}

						if (playerTotalFocusMap) {
							const currentTotal = playerTotalFocusMap.get(p.id) || 0;
							playerTotalFocusMap.set(p.id, currentTotal + timePerSampleSec);
						}
					}
				}
			}
		}

		// Kills evaluated with 100% full precision
		for (const kill of kills) {
			if (typeof analyserTimeline !== "undefined") analyserTimeline.recordKill(kill);
			this.kill(kill, states, config);
		}
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
}

var analyserPreloader = new AnalyserPreloader();
