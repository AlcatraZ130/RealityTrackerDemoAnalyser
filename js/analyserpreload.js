// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Automatic pre-analysis pass for BVR Focus Timers (session-aware) and Tactical Timeline indexing.

class AnalyserPreloader {
	constructor() {
		this.isRunning = false;
		this.sessionFocusList = [];
	}

	requested() {
		return true;
	}

	resetResults() {
		if (typeof analyserTimeline !== "undefined") analyserTimeline.resetAnalysis();
		this.preloaderFocusMap = new Map();
		this.playerMaxFocusMap = new Map();
		this.playerTotalFocusMap = new Map();
		this.sessionFocusList = [];
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

		const config = {
			range: Number(options_VisionConeRange) || 150,
			cone: Number(options_VisionConeAngle) || 94.9
		};
		const states = new Map();
		const activeSessionsBySlot = new Map();
		const allSessions = [];
		let sessionSeq = 0;

		const preloaderFocusMap = this.preloaderFocusMap;
		const playerMaxFocusMap = this.playerMaxFocusMap;
		const playerTotalFocusMap = this.playerTotalFocusMap;

		// Timeline collection structures
		const ticketsHistory = [];
		const flagMeta = new Map();
		const flagEvents = [];
		const activeFobs = new Map();
		const fobEvents = [];
		const activeCaches = new Map();
		const cacheEvents = [];

		let curTickets1 = null;
		let curTickets2 = null;

		const hz = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0) ? DetectedDemoHz : 3.0;
		const stride = Math.max(1, Math.round(hz / 1.5));
		const timePerSampleSec = (1.0 / hz) * stride;

		let index = 0, tick = 0;
		const total = messageArrayObject.messages.length;
		setLoadingOverlayText("Analysing Tactical Data: 0%...");

		const startNewSession = (slotId, name, hash, curTick) => {
			if (activeSessionsBySlot.has(slotId)) {
				const prev = activeSessionsBySlot.get(slotId);
				if (prev && prev.leaveTick == null) prev.leaveTick = curTick;
			}
			sessionSeq++;
			const sess = {
				sessionKey: `${slotId}_${sessionSeq}`,
				slotId: slotId,
				name: name || `Player #${slotId}`,
				hash: hash || "",
				team: 0,
				squad: 0,
				joinTick: curTick,
				leaveTick: null,
				peakTick: curTick,
				maxSec: 0,
				totalSec: 0
			};
			activeSessionsBySlot.set(slotId, sess);
			allSessions.push(sess);
			return sess;
		};

		const part = () => {
			const batchStart = performance.now();
			while (index < total) {
				const message = messageArrayObject.getMessageAt(index);
				if (message) {
					const mType = message.getUint8(0);
					if (mType === MESSAGETYPE.PLAYER_ADD) {
						this.readPlayerAdd(message, states, activeSessionsBySlot, startNewSession, tick);
					} else if (mType === MESSAGETYPE.PLAYER_REMOVE) {
						this.readPlayerRemove(message, states, activeSessionsBySlot, tick);
					} else if (mType === MESSAGETYPE.PLAYER_UPDATE) {
						this.readPlayers(message, states, activeSessionsBySlot, startNewSession, tick);
					} else if (mType === MESSAGETYPE.TICKETS_TEAM1) {
						curTickets1 = message.getInt16(1, true);
						ticketsHistory.push({
							tick: tick,
							t1: curTickets1,
							t2: curTickets2 != null ? curTickets2 : curTickets1
						});
					} else if (mType === MESSAGETYPE.TICKETS_TEAM2) {
						curTickets2 = message.getInt16(1, true);
						ticketsHistory.push({
							tick: tick,
							t1: curTickets1 != null ? curTickets1 : curTickets2,
							t2: curTickets2
						});
					} else if (mType === MESSAGETYPE.FLAG_LIST) {
						this.readFlagList(message, flagMeta);
					} else if (mType === MESSAGETYPE.FLAG_UPDATE) {
						this.readFlagUpdate(message, flagMeta, flagEvents, tick + 1);
					} else if (mType === MESSAGETYPE.FOB_ADD) {
						this.readFobAdd(message, activeFobs, fobEvents, tick + 1);
					} else if (mType === MESSAGETYPE.FOB_REMOVE) {
						this.readFobRemove(message, activeFobs, fobEvents, tick + 1);
					} else if (mType === MESSAGETYPE.CACHE_ADD) {
						this.readCacheAdd(message, activeCaches, cacheEvents, tick + 1);
					} else if (mType === MESSAGETYPE.CACHE_REVEAL) {
						this.readCacheReveal(message, activeCaches, cacheEvents, tick + 1);
					} else if (mType === MESSAGETYPE.CACHE_REMOVE) {
						this.readCacheRemove(message, activeCaches, cacheEvents, tick + 1);
					} else if (mType === MESSAGETYPE.TICK) {
						this.analyzeTick(
							tick,
							states,
							activeSessionsBySlot,
							config,
							preloaderFocusMap,
							playerMaxFocusMap,
							playerTotalFocusMap,
							stride,
							timePerSampleSec
						);
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
				for (const sess of activeSessionsBySlot.values()) {
					if (sess && sess.leaveTick == null) {
						sess.leaveTick = tick;
					}
				}

				this.playerStates = states;
				this.sessionFocusList = allSessions.filter(s => s.name && (s.maxSec > 0 || s.totalSec > 0 || s.team > 0));
				this.applyFocusToPlayers();

				if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.setPreloadedData === "function") {
					analyserTimeline.setPreloadedData({
						ticketsHistory: ticketsHistory,
						flagEvents: flagEvents,
						fobEvents: fobEvents,
						cacheEvents: cacheEvents,
						kills: (typeof eventArrays !== "undefined" && eventArrays.kills) ? eventArrays.kills.events : [],
						revives: (typeof eventArrays !== "undefined" && eventArrays.revives) ? eventArrays.revives.events : [],
						vehicleDestroyers: (typeof eventArrays !== "undefined" && eventArrays.vehicleDestroyers) ? eventArrays.vehicleDestroyers.events : [],
						kitAllocations: (typeof eventArrays !== "undefined" && eventArrays.kitAllocations) ? eventArrays.kitAllocations.events : [],
						playerSessions: allSessions
					});
				}

				if (typeof playerRow_UpdateAll === "function") playerRow_UpdateAll();

				this.isRunning = false;
				done();
			}
		};
		setTimeout(part, 0);
	}

	state(states, id) {
		if (!states.has(id)) {
			states.set(id, {
				id,
				name: "",
				hash: "",
				team: 0,
				squad: 0,
				X: 0,
				Y: 0,
				Z: 0,
				rotation: 0,
				alive: false,
				position: false,
				rotationKnown: false,
				joinTick: 0,
				leaveTick: null,
				peakTick: 0
			});
		}
		return states.get(id);
	}

	readPlayerAdd(message, states, activeSessionsBySlot, startNewSession, tick) {
		let pos = 1;
		const len = message.byteLength;
		while (pos < len) {
			const unpacked = message.unPack(pos, "Bsss");
			pos += unpacked[0];
			const parsed = unpacked[1];
			const id = parsed[0];
			const name = parsed[1];
			const hash = parsed[2];

			const p = this.state(states, id);
			p.name = name;
			p.hash = hash;
			p.alive = false;
			p.position = false;
			p.rotationKnown = false;
			p.joinTick = tick;
			p.leaveTick = null;

			startNewSession(id, name, hash, tick);
		}
	}

	readPlayerRemove(message, states, activeSessionsBySlot, tick) {
		let pos = 1;
		const len = message.byteLength;
		while (pos < len) {
			const unpacked = message.unPack(pos, "B");
			pos += unpacked[0];
			const id = unpacked[1][0];
			const p = states.get(id);
			if (p) {
				p.alive = false;
				p.position = false;
				p.leaveTick = tick;
			}
			const sess = activeSessionsBySlot.get(id);
			if (sess && sess.leaveTick == null) {
				sess.leaveTick = tick;
			}
			activeSessionsBySlot.delete(id);
		}
	}

	readPlayers(message, states, activeSessionsBySlot, startNewSession, tick) {
		let pos = 1;
		while (pos < message.byteLength) {
			const flags = message.getUint16(pos, true), id = message.getUint8(pos + 2);
			pos += 3;
			const p = this.state(states, id);
			let sess = activeSessionsBySlot.get(id);
			if (!sess) {
				sess = startNewSession(id, p.name || `Player #${id}`, p.hash || "", tick);
			}
			if (flags & PLAYERUPDATEFLAGS.TEAM) {
				p.team = message.getUint8(pos++);
				if (p.team > 0) sess.team = p.team;
			}
			if (flags & PLAYERUPDATEFLAGS.SQUAD) {
				const sqd = message.getUint8(pos++);
				p.squad = sqd % 128;
				sess.squad = p.squad;
			}
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

	readFlagList(message, flagMeta) {
		let pos = 1;
		const len = message.byteLength;
		while (pos < len) {
			const res = message.unPack(pos, "HBhhhH");
			const parsed = res[1];
			flagMeta.set(parsed[0], {
				id: parsed[0],
				team: parsed[1],
				X: parsed[2],
				Y: parsed[3],
				Z: parsed[4],
				radius: parsed[5]
			});
			pos += res[0];
		}
	}

	readFlagUpdate(message, flagMeta, flagEvents, tick) {
		const unpacked = message.unPack(1, "HB");
		const parsed = unpacked[1];
		const flagId = parsed[0];
		const newTeam = parsed[1];
		const meta = flagMeta.get(flagId);
		const prevTeam = meta ? meta.team : null;
		if (meta) {
			meta.team = newTeam;
		}
		if (prevTeam !== newTeam) {
			flagEvents.push({
				tick: tick,
				flagId: flagId,
				prevTeam: prevTeam,
				team: newTeam,
				X: meta ? meta.X : null,
				Y: meta ? meta.Y : null,
				Z: meta ? meta.Z : null
			});
		}
	}

	readFobAdd(message, activeFobs, fobEvents, tick) {
		let pos = 1;
		const len = message.byteLength;
		while (pos < len) {
			const unpacked = message.unPack(pos, "iBhhh");
			pos += unpacked[0];
			const parsed = unpacked[1];
			const fob = {
				id: parsed[0],
				team: parsed[1],
				X: parsed[2],
				Y: parsed[3],
				Z: parsed[4],
				tick: tick
			};
			activeFobs.set(fob.id, fob);
			fobEvents.push({
				tick: tick,
				action: "add",
				id: fob.id,
				team: fob.team,
				X: fob.X,
				Y: fob.Y,
				Z: fob.Z
			});
		}
	}

	readFobRemove(message, activeFobs, fobEvents, tick) {
		let pos = 1;
		const len = message.byteLength;
		while (pos < len) {
			const unpacked = message.unPack(pos, "i");
			pos += unpacked[0];
			const id = unpacked[1][0];
			const existing = activeFobs.get(id);
			activeFobs.delete(id);
			fobEvents.push({
				tick: tick,
				action: "remove",
				id: id,
				team: existing ? existing.team : 0,
				X: existing ? existing.X : null,
				Y: existing ? existing.Y : null,
				Z: existing ? existing.Z : null
			});
		}
	}

	readCacheAdd(message, activeCaches, cacheEvents, tick) {
		let pos = 1;
		const len = message.byteLength;
		while (pos < len) {
			const id = message.getUint8(pos, true);
			const X = message.getInt16(pos + 1, true);
			const Y = message.getInt16(pos + 3, true);
			const Z = message.getInt16(pos + 5, true);
			pos += 7;
			const cache = { id, X, Y, Z, revealed: false };
			activeCaches.set(id, cache);
			if (tick > 5) {
				cacheEvents.push({
					tick: tick,
					action: "add",
					id: id,
					X: X,
					Y: Y,
					Z: Z
				});
			}
		}
	}

	readCacheReveal(message, activeCaches, cacheEvents, tick) {
		let pos = 1;
		const len = message.byteLength;
		while (pos < len) {
			const id = message.getUint8(pos, true);
			pos += 1;
			const existing = activeCaches.get(id);
			if (existing) existing.revealed = true;
			cacheEvents.push({
				tick: tick,
				action: "reveal",
				id: id,
				X: existing ? existing.X : null,
				Y: existing ? existing.Y : null,
				Z: existing ? existing.Z : null
			});
		}
	}

	readCacheRemove(message, activeCaches, cacheEvents, tick) {
		let pos = 1;
		const len = message.byteLength;
		while (pos < len) {
			const id = message.getUint8(pos, true);
			pos += 1;
			const existing = activeCaches.get(id);
			activeCaches.delete(id);
			cacheEvents.push({
				tick: tick,
				action: "remove",
				id: id,
				X: existing ? existing.X : null,
				Y: existing ? existing.Y : null,
				Z: existing ? existing.Z : null
			});
		}
	}

	analyzeTick(tick, states, activeSessionsBySlot, config, preloaderFocusMap, playerMaxFocusMap, playerTotalFocusMap, stride, timePerSampleSec) {
		const shouldSampleFocus = (tick % stride === 0);
		if (!shouldSampleFocus) return;

		const activePlayers = [];
		for (const p of states.values()) {
			if (p.position && p.alive && p.rotationKnown) {
				activePlayers.push(p);
			}
		}

		if (preloaderFocusMap && playerMaxFocusMap && activePlayers.length > 1) {
			const halfConeDeg = config.cone / 2;
			for (let i = 0; i < activePlayers.length; i++) {
				const p = activePlayers[i];
				const r = p.rotation * (Math.PI / 180);
				const sinR = Math.sin(r);
				const cosR = Math.cos(r);
				const sessP = activeSessionsBySlot.get(p.id);
				const sessKeyP = sessP ? sessP.sessionKey : String(p.id);

				for (let j = 0; j < activePlayers.length; j++) {
					const other = activePlayers[j];
					if (p === other || p.team === other.team) continue;

					const dx = other.X - p.X;
					const dz = other.Z - p.Z;
					const worldDist = Math.hypot(dx, dz);
					if (worldDist <= 10 || worldDist > 4000) continue;

					const dot = (sinR * dx + cosR * dz) / worldDist;
					if (dot <= 0) continue;

					const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
					if (angleDeg > halfConeDeg) continue;

					const perpDist = worldDist * Math.sin(angleDeg * (Math.PI / 180));
					if (perpDist <= 25.0) {
						const sessO = activeSessionsBySlot.get(other.id);
						const sessKeyO = sessO ? sessO.sessionKey : String(other.id);
						const pairKey = `${sessKeyP}__${sessKeyO}`;
						const currentSec = (preloaderFocusMap.get(pairKey) || 0) + timePerSampleSec;
						preloaderFocusMap.set(pairKey, currentSec);

						if (sessP) {
							if (currentSec > sessP.maxSec) {
								sessP.maxSec = currentSec;
								sessP.peakTick = tick;
							}
							sessP.totalSec += timePerSampleSec;
						}

						if (!playerMaxFocusMap.has(p.id) || currentSec > playerMaxFocusMap.get(p.id)) {
							playerMaxFocusMap.set(p.id, currentSec);
							p.peakTick = tick;
						}

						if (playerTotalFocusMap) {
							const currentTotal = playerTotalFocusMap.get(p.id) || 0;
							playerTotalFocusMap.set(p.id, currentTotal + timePerSampleSec);
						}
					}
				}
			}
		}
	}
}

var analyserPreloader = new AnalyserPreloader();
