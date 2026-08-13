// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Reality Tracker Demo Analyser Engine
// Vision cone, Threat Lasers, Snap Detector, No-LOS Kill Alerts & BVR Lasers
var options_DrawVisionCone = false;
var options_VisionConeRange = 150;
var options_VisionConeAngle = 94.9;

var options_DrawThreatLasers = false;
var options_ConeRespectsTerrain = true;

var options_HighlightSnaps = false;
var Snap_LockToleranceDegrees = 5;
var options_SnapMinSpeed = 120;

var options_DetectNoLOSKills = false;
var noLOSKills = [];

var options_DetectMicroOscillation = false;
var MO_WINDOW_TICKS = 10;
var NOCONE_WINDOW_TICKS = 5;
var ns_lastMOSnap = {};

var options_DrawBVRLaser = false;
var options_Draw4KmLaser = false;
var options_DrawSpottedIndicators = false;
var options_SpottedZoneRadius = 40;
var options_FobLinkRadius = 18;
var spottedPlayerEntryMap = new Map();
var spottedVehicleEntryMap = new Map();

var options_DrawMovementSoundAuras = false;
var options_DrawShootingSoundShockwaves = false;
var options_ShowSelectionSpeed = true;

var ns_activeShockwaves = [];

function getEntitySpeedKmh(entity) {
	if (!entity || entity.X == null || isNaN(entity.X) || entity.ns_lastX == null || isNaN(entity.ns_lastX)) return 0;
	const dt = typeof DemoTimePerTick !== 'undefined' && DemoTimePerTick > 0 ? DemoTimePerTick : 0.04;
	const lz = entity.ns_lastZ != null && !isNaN(entity.ns_lastZ) ? entity.ns_lastZ : (entity.Z != null ? entity.Z : 0);
	const distM = Math.hypot(entity.X - entity.ns_lastX, (entity.Z != null ? entity.Z : 0) - lz);
	if (isNaN(distM)) return 0;
	const speedMs = distM / dt;
	return isNaN(speedMs) ? 0 : speedMs * 3.6;
}

function triggerShootingShockwave(x, z, radiusM, colorRgba, durationSec = 1.5, shooterId = null, vehicleId = null, victimId = null) {
	if (x == null || isNaN(x) || z == null || isNaN(z)) return;
	const currentTick = typeof Tick_Current !== "undefined" ? Tick_Current : 0;
	ns_activeShockwaves.push({
		x: x,
		z: z,
		maxRadiusM: radiusM,
		color: colorRgba,
		startTick: currentTick,
		durationTicks: Math.max(15, Math.round(durationSec * 20)),
		spawnTime: performance.now(),
		shooterId: shooterId != null ? Number(shooterId) : null,
		vehicleId: vehicleId != null ? Number(vehicleId) : null,
		victimId: victimId != null ? Number(victimId) : null
	});
	if (ns_activeShockwaves.length > 50) ns_activeShockwaves.shift();
}

function drawShootingSoundShockwaves() {
	if (!options_DrawShootingSoundShockwaves || ns_activeShockwaves.length === 0) return;
	if (SelectedPlayer == SELECTED_NOTHING && SelectedVehicle == SELECTED_NOTHING) return;

	const currentTick = typeof Tick_Current !== "undefined" ? Tick_Current : 0;
	const now = performance.now();
	Context.save();

	try {
		for (let i = ns_activeShockwaves.length - 1; i >= 0; i--) {
			const sw = ns_activeShockwaves[i];

			let isForSelected = false;

			if (SelectedPlayer != SELECTED_NOTHING) {
				const p = AllPlayers[SelectedPlayer];
				if (p) {
					const selId = Number(SelectedPlayer);
					if (sw.shooterId === selId || sw.victimId === selId) {
						isForSelected = true;
					} else if (p.vehicleid >= 0 && (sw.vehicleId === Number(p.vehicleid) || sw.vehicleId === p.vehicleid)) {
						isForSelected = true;
					}
				}
			}

			if (!isForSelected && SelectedVehicle != SELECTED_NOTHING) {
				const v = AllVehicles[SelectedVehicle];
				if (v) {
					const selVeh = Number(SelectedVehicle);
					if (sw.vehicleId === selVeh || sw.vehicleId === SelectedVehicle) {
						isForSelected = true;
					} else if (v.Passengers && typeof v.Passengers.has === "function") {
						if (v.Passengers.has(sw.shooterId) || v.Passengers.has(String(sw.shooterId)) || v.Passengers.has(sw.victimId) || v.Passengers.has(String(sw.victimId))) {
							isForSelected = true;
						}
					}
				}
			}

			if (!isForSelected) continue;

			let progress = 0;
			if (sw.startTick > 0 && currentTick >= sw.startTick) {
				const elapsedTicks = currentTick - sw.startTick;
				if (elapsedTicks > sw.durationTicks) {
					ns_activeShockwaves.splice(i, 1);
					continue;
				}
				progress = elapsedTicks / sw.durationTicks;
			} else {
				const elapsedSec = (now - sw.spawnTime) / 1000.0;
				if (elapsedSec >= 1.5) {
					ns_activeShockwaves.splice(i, 1);
					continue;
				}
				progress = elapsedSec / 1.5;
			}

			// Smooth ease-out cubic expansion (fast initial shockwave, smooth dissipation into distance)
			const easeOutProgress = 1 - Math.pow(1 - progress, 2.5);
			const currentRadiusM = sw.maxRadiusM * easeOutProgress;
			const cRadius = lengthtoCanvas(currentRadiusM);
			const cx = XtoCanvas(sw.x);
			const cy = YtoCanvas(sw.z);

			if (isNaN(cx) || isNaN(cy) || isNaN(cRadius) || cRadius <= 0) continue;

			const opacity = Math.pow(1.0 - progress, 1.5) * 0.85;
			const ringLineWidth = (1.0 - progress * 0.6) * (sw.maxRadiusM > 800 ? 3.0 : 2.0);

			// Outer expanding sound pressure wave
			Context.beginPath();
			Context.arc(cx, cy, cRadius, 0, Math.PI * 2);
			Context.strokeStyle = sw.color.replace("OPACITY", opacity.toFixed(2));
			Context.lineWidth = ringLineWidth;
			Context.stroke();

			// Shockwave distance label
			if (cRadius > 15 && opacity > 0.2) {
				Context.font = "bold 9px Arial";
				Context.fillStyle = sw.color.replace("OPACITY", opacity.toFixed(2));
				Context.fillText(`${Math.round(currentRadiusM)}m`, cx + cRadius + 2, cy);
			}
		}
	} catch (err) {
		console.error("Error in drawShootingSoundShockwaves:", err);
	} finally {
		Context.restore();
	}
}

function drawMovementSoundAuras() {
	if (!options_DrawMovementSoundAuras) return;
	if (SelectedPlayer == SELECTED_NOTHING && SelectedVehicle == SELECTED_NOTHING) return;

	Context.save();

	try {
		// 1. If a Player is selected
		if (SelectedPlayer != SELECTED_NOTHING) {
			const p = AllPlayers[SelectedPlayer];
			if (p && !p.isJoining && p.isAlive && p.ns_lastX != null && !isNaN(p.ns_lastX) && p.X != null && !isNaN(p.X)) {
				if (p.vehicleid < 0) {
					const spdKmh = getEntitySpeedKmh(p);
					let targetRadiusM = 0;
					let targetOpacity = 0.0;
					let colorRgba = "rgba(0, 229, 255, OPACITY)";
					let stanceText = "";

					if (spdKmh >= 18.0) {
						targetRadiusM = 35;
						targetOpacity = 0.50;
						colorRgba = "rgba(255, 200, 0, OPACITY)";
						stanceText = `Sprint (${spdKmh.toFixed(0)}km/h - 35m)`;
					} else if (spdKmh >= 10.0) {
						targetRadiusM = 20;
						targetOpacity = 0.45;
						colorRgba = "rgba(0, 229, 255, OPACITY)";
						stanceText = `Walk (${spdKmh.toFixed(0)}km/h - 20m)`;
					} else if (spdKmh >= 1.5) {
						targetRadiusM = 12;
						targetOpacity = 0.30;
						colorRgba = "rgba(0, 229, 255, OPACITY)";
						stanceText = `Crouch (${spdKmh.toFixed(0)}km/h - 12m)`;
					}

					// Acoustic inertia smoothing (expansion vs dissipation)
					if (p.ns_auraRadius == null || isNaN(p.ns_auraRadius)) {
						p.ns_auraRadius = targetRadiusM;
						p.ns_auraOpacity = targetOpacity;
					}

					const lerpFactor = targetRadiusM > p.ns_auraRadius ? 0.20 : 0.08;
					p.ns_auraRadius += (targetRadiusM - p.ns_auraRadius) * lerpFactor;
					p.ns_auraOpacity += (targetOpacity - p.ns_auraOpacity) * lerpFactor;

					if (p.ns_auraRadius > 0.5 && p.ns_auraOpacity > 0.02) {
						const cx = p.getCanvasX();
						const cy = p.getCanvasY();
						const cRadius = lengthtoCanvas(p.ns_auraRadius);

						if (!isNaN(cx) && !isNaN(cy) && !isNaN(cRadius) && cRadius > 0) {
							Context.beginPath();
							Context.arc(cx, cy, cRadius, 0, Math.PI * 2);
							Context.strokeStyle = colorRgba.replace("OPACITY", p.ns_auraOpacity.toFixed(2));
							Context.lineWidth = 1.5;
							Context.stroke();

							if (options_ShowSelectionSpeed && stanceText !== "") {
								Context.font = "bold 9px Arial";
								Context.fillStyle = colorRgba.replace("OPACITY", p.ns_auraOpacity.toFixed(2));
								Context.fillText(stanceText, cx + cRadius + 3, cy);
							}
						}
					}
				} else {
					const v = AllVehicles[p.vehicleid];
					if (v) drawSingleVehicleEngineAura(v);
				}
			}
		}
		// 2. If a Vehicle is selected
		else if (SelectedVehicle != SELECTED_NOTHING) {
			const v = AllVehicles[SelectedVehicle];
			if (v) drawSingleVehicleEngineAura(v);
		}
	} catch (err) {
		console.error("Error in drawMovementSoundAuras:", err);
	} finally {
		Context.restore();
	}
}

function drawSingleVehicleEngineAura(v) {
	if (!v || v.Passengers == null) return;
	const vx = v.getX();
	const vz = v.getZ();
	if (vx == null || isNaN(vx) || vz == null || isNaN(vz)) return;

	let hasDriver = false;
	if (typeof v.Passengers.forEach === "function") {
		v.Passengers.forEach((pid) => {
			const passenger = AllPlayers[pid];
			if (passenger && (passenger.vehicleSlot === 0 || passenger.vehicleSlot == null || passenger.vehicleSlot === "0")) {
				hasDriver = true;
			}
		});
	} else if (Array.isArray(v.Passengers)) {
		for (const pid of v.Passengers) {
			const passenger = AllPlayers[pid];
			if (passenger && (passenger.vehicleSlot === 0 || passenger.vehicleSlot == null || passenger.vehicleSlot === "0")) {
				hasDriver = true;
				break;
			}
		}
	}

	const spdKmh = getEntitySpeedKmh(v);
	const vName = (v.name || "").toLowerCase();
	const isHeavy = vName.includes("tnk") || vName.includes("tank") || vName.includes("apc") || vName.includes("bmp") || vName.includes("btr");
	const isHeli = vName.includes("heli") || vName.includes("uh60") || vName.includes("mi8") || vName.includes("ah1z");

	let targetEngineRadiusM = 0;
	let targetOpacity = 0.0;
	let statusText = "";

	if (hasDriver) {
		targetEngineRadiusM = spdKmh >= 2.0 ? (isHeli ? 800 : isHeavy ? 450 : 250) : (isHeli ? 300 : isHeavy ? 100 : 60);
		targetOpacity = spdKmh >= 2.0 ? 0.50 : 0.25;
		statusText = spdKmh >= 2.0 ? `Driving (${spdKmh.toFixed(0)}km/h - ${targetEngineRadiusM}m)` : `Engine Idle (${targetEngineRadiusM}m)`;
	}

	// Acoustic inertia smoothing (expansion vs dissipation for vehicles)
	if (v.ns_auraRadius == null || isNaN(v.ns_auraRadius)) {
		v.ns_auraRadius = targetEngineRadiusM;
		v.ns_auraOpacity = targetOpacity;
	}

	const lerpFactor = targetEngineRadiusM > v.ns_auraRadius ? 0.18 : 0.06;
	v.ns_auraRadius += (targetEngineRadiusM - v.ns_auraRadius) * lerpFactor;
	v.ns_auraOpacity += (targetOpacity - v.ns_auraOpacity) * lerpFactor;

	if (v.ns_auraRadius > 0.5 && v.ns_auraOpacity > 0.02) {
		const cx = XtoCanvas(vx);
		const cy = YtoCanvas(vz);
		const cRadius = lengthtoCanvas(v.ns_auraRadius);

		if (!isNaN(cx) && !isNaN(cy) && !isNaN(cRadius) && cRadius > 0) {
			Context.beginPath();
			Context.arc(cx, cy, cRadius, 0, Math.PI * 2);
			Context.strokeStyle = spdKmh >= 2.0 ? `rgba(0, 255, 102, ${v.ns_auraOpacity.toFixed(2)})` : `rgba(0, 255, 102, ${v.ns_auraOpacity.toFixed(2)})`;
			Context.lineWidth = spdKmh >= 2.0 ? 2.0 : 1.2;
			Context.setLineDash([4, 4]);
			Context.stroke();
			Context.setLineDash([]);

			if (options_ShowSelectionSpeed && statusText !== "") {
				Context.font = "bold 10px Arial";
				Context.fillStyle = "#00ff66";
				Context.fillText(statusText, cx + cRadius + 4, cy);
			}
		}
	}
}

function angleDiffDeg(a, b) {
	let diff = (a - b) % 360;
	if (diff > 180) diff -= 360;
	if (diff < -180) diff += 360;
	return diff;
}

function headingToCanvasVector(rotationDeg) {
	const rad = rotationDeg / 180 * Math.PI;
	return [Math.sin(rad), -Math.cos(rad)];
}

function angleToTargetDeg(px, py, rotationDeg, tx, ty) {
	const dx = tx - px;
	const dy = ty - py;
	const dist = Math.hypot(dx, dy);
	if (dist === 0) return 0;

	const targetAngleRad = Math.atan2(dy, dx);
	let targetAngleDeg = targetAngleRad * 180 / Math.PI;

	const headingDeg = rotationDeg - 90;
	return Math.abs(angleDiffDeg(targetAngleDeg, headingDeg));
}

function isPlayerFacingTarget(shooter, target, maxAngleDeg = null) {
	if (!shooter || !target) return false;
	const px = typeof shooter.getCanvasX === "function" ? shooter.getCanvasX() : (shooter.X != null ? XtoCanvas(shooter.X) : NaN);
	const py = typeof shooter.getCanvasY === "function" ? shooter.getCanvasY() : (shooter.Z != null ? YtoCanvas(shooter.Z) : NaN);
	const tx = typeof target.getCanvasX === "function" ? target.getCanvasX() : (target.X != null ? XtoCanvas(target.X) : NaN);
	const ty = typeof target.getCanvasY === "function" ? target.getCanvasY() : (target.Z != null ? YtoCanvas(target.Z) : NaN);
	if (isNaN(px) || isNaN(py) || isNaN(tx) || isNaN(ty)) return false;

	const maxAngle = maxAngleDeg != null ? maxAngleDeg : (typeof options_VisionConeAngle !== "undefined" ? options_VisionConeAngle / 2 : 47.45);
	const rot = typeof shooter.getRotation === "function" ? shooter.getRotation() : (shooter.yaw || 0);
	const angle = angleToTargetDeg(px, py, rot, tx, ty);
	return angle <= maxAngle;
}

function isEnemyOf(p, other) {
	return p.team != 0 && other.team != 0 && p.team != other.team;
}

function getPlayersInVisionCone(p) {
	const results = [];
	const px = p.getCanvasX();
	const py = p.getCanvasY();
	const rot = p.getRotation();
	const useTerrain = options_ConeRespectsTerrain && typeof hasTerrainLOS === 'function';

	for (var i in AllPlayers) {
		const other = AllPlayers[i];
		if (other === p || other.isJoining || !other.isAlive || other.ns_lastX == null || isNaN(other.ns_lastX))
			continue;
		if (!isEnemyOf(p, other))
			continue;

		const worldDist = Math.hypot(other.getX() - p.getX(), other.getZ() - p.getZ());
		if (worldDist > options_VisionConeRange)
			continue;

		const angle = angleToTargetDeg(px, py, rot, other.getCanvasX(), other.getCanvasY());
		if (angle > options_VisionConeAngle / 2)
			continue;

		if (useTerrain && !hasTerrainLOS(p.X, p.Y, p.Z, other.X, other.Y, other.Z))
			continue;

		results.push([other, worldDist, angle]);
	}
	return results;
}

function drawVisionCone(p) {
	const x = p.getCanvasX();
	const y = p.getCanvasY();
	const rot = p.getRotation();
	const range = lengthtoCanvas(options_VisionConeRange);
	const half = options_VisionConeAngle / 2;

	Context.save();
	Context.translate(x, y);
	Context.rotate(rot / 180 * Math.PI);
	Context.beginPath();
	Context.moveTo(0, 0);
	Context.arc(0, 0, range, (270 - half) / 180 * Math.PI, (270 + half) / 180 * Math.PI);
	Context.closePath();
	Context.fillStyle = "rgba(255, 255, 0, 0.06)";
	Context.strokeStyle = "rgba(255, 220, 0, 0.7)";
	Context.lineWidth = 1;
	Context.fill();
	Context.stroke();
	Context.restore();
}

function getPlayerById(id) {
	for (const key in AllPlayers) {
		if (AllPlayers[key] && AllPlayers[key].id === id)
			return AllPlayers[key];
	}
	return null;
}

function drawThreatLasers(p) {
	const hits = getPlayersInVisionCone(p);

	const x1 = p.getCanvasX();
	const y1 = p.getCanvasY();

	for (const [other, dist, angle] of hits) {
		const x2 = other.getCanvasX();
		const y2 = other.getCanvasY();

		Context.save();
		Context.beginPath();
		Context.moveTo(x1, y1);
		Context.lineTo(x2, y2);
		Context.strokeStyle = "rgba(255, 60, 0, 0.55)";
		Context.lineWidth = 1.5;
		Context.stroke();
		Context.restore();
	}
}

// Called once per frame from Renderer2d.draw()
function drawDemoAnalyserOverlay() {
	if (options_DrawMovementSoundAuras) {
		try { drawMovementSoundAuras(); } catch (e) { console.error("Error in drawMovementSoundAuras:", e); }
	}
	if (options_DrawShootingSoundShockwaves) {
		try { drawShootingSoundShockwaves(); } catch (e) { console.error("Error in drawShootingSoundShockwaves:", e); }
	}

	if (SelectedPlayer == SELECTED_NOTHING) return;

	const p = AllPlayers[SelectedPlayer];
	if (p == null || p.isJoining || p.ns_lastX == null || isNaN(p.ns_lastX) || !p.isAlive) return;

	if (options_DrawVisionCone)
		drawVisionCone(p);
	if (options_DrawThreatLasers) {
		drawThreatLasers(p);
		drawLineOfSight(p);
	}

	if (options_DrawBVRLaser)
		drawBVRLaser(p);
	if (options_Draw4KmLaser)
		draw4KmLaser(p);
	if (options_DrawSpottedIndicators)
		drawSpottedIndicators();
}

function drawLineOfSight(p) {
	const px = p.getCanvasX();
	const py = p.getCanvasY();
	const range = lengthtoCanvas(options_VisionConeRange);
	const [fx, fy] = headingToCanvasVector(p.getRotation());
	const tx = px + fx * range;
	const ty = py + fy * range;

	let blockedTargetNearLine = false;
	const useTerrain = options_ConeRespectsTerrain && typeof hasTerrainLOS === 'function';

	if (useTerrain) {
		for (var i in AllPlayers) {
			const other = AllPlayers[i];
			if (other === p || other.isJoining || !other.isAlive || other.ns_lastX == null || isNaN(other.ns_lastX)) continue;
			if (!isEnemyOf(p, other)) continue;

			const worldDist = Math.hypot(other.getX() - p.getX(), other.getZ() - p.getZ());
			if (worldDist > options_VisionConeRange) continue;

			const angle = angleToTargetDeg(px, py, p.getRotation(), other.getCanvasX(), other.getCanvasY());
			if (angle <= 5) {
				if (!hasTerrainLOS(p.X, p.Y, p.Z, other.X, other.Y, other.Z)) {
					blockedTargetNearLine = true;
					break;
				}
			}
		}
	}

	Context.save();
	Context.beginPath();
	Context.moveTo(px, py);
	Context.lineTo(tx, ty);
	Context.strokeStyle = blockedTargetNearLine ? "red" : "blue";
	Context.lineWidth = blockedTargetNearLine ? 2 : 1;
	Context.stroke();
	Context.restore();
}

function drawMicroOscillationIndicator(p) {
	const activeMO = ns_lastMOSnap[p.id];
	if (!activeMO) return;

	const now = performance.now();
	if (now > activeMO.expiresAt) return;

	const opacity = (activeMO.expiresAt - now) / 2000;
	const alpha = 0.3 + opacity * 0.7;
	const target = getPlayerById(activeMO.targetId);

	const px = p.getCanvasX();
	const py = p.getCanvasY();

	Context.save();
	Context.strokeStyle = "rgba(202, 50, 242, " + alpha + ")";
	Context.lineWidth = 2;
	Context.shadowColor = "#CA32F2";
	Context.shadowBlur = 6 * opacity;
	Context.beginPath();
	Context.arc(px, py, PlayerCircleSize + 3 + (1 - opacity) * 4, 0, Math.PI * 2);
	Context.stroke();

	if (target && !target.isJoining && target.ns_lastX != null && !isNaN(target.ns_lastX)) {
		const tx = target.getCanvasX();
		const ty = target.getCanvasY();
		Context.setLineDash([4, 4]);
		Context.beginPath();
		Context.moveTo(px, py);
		Context.lineTo(tx, ty);
		Context.stroke();
		Context.setLineDash([]);
	}

	Context.fillStyle = "rgba(202, 50, 242, " + alpha + ")";
	Context.font = "bold 9px Arial";
	Context.fillText("OSC", px + PlayerCircleSize + 4, py - PlayerCircleSize - 2);
	Context.restore();
}

function detectMicroOscillation(p) {
	if (!playerHistory.isWarmedUp(p.id, MO_WINDOW_TICKS)) return;

	const hist = playerHistory.getHistory(p.id, MO_WINDOW_TICKS);
	let mean = 0;
	const diffs = [];

	for (let i = 1; i < hist.length; i++) {
		const diff = Math.abs(angleDiffDeg(hist[i].rotation, hist[i-1].rotation));
		diffs.push(diff);
		mean += diff;
	}
	mean /= diffs.length;

	let variance = 0;
	for (let i = 0; i < diffs.length; i++) {
		variance += Math.pow(diffs[i] - mean, 2);
	}
	variance /= diffs.length;

	const netRotation = Math.abs(angleDiffDeg(hist[hist.length - 1].rotation, hist[0].rotation));

	if (netRotation > 10 && variance < 0.2) {
		const targetHits = getPlayersInVisionCone(p);
		if (targetHits.length > 0) {
			const target = targetHits[0][0];
			if (ns_lastSnapLoggedTick["mo_" + p.id] !== Tick_Current) {
				ns_lastSnapLoggedTick["mo_" + p.id] = Tick_Current;
				ns_lastMOSnap[p.id] = { targetId: target.id, expiresAt: performance.now() + 2000 };
				if (typeof analyserTimeline !== 'undefined') {
					analyserTimeline.recordOscillation(Tick_Current, p.id, target.name, variance.toFixed(2));
				}
				console.log(
					"[demoanalyser] Micro-oscillation detected for " + p.name +
					" at tick " + Tick_Current + " (Var: " + variance.toFixed(2) + " deg\u00b2)"
				);
			}
		}
	}
}

// No-LOS Kill Alert Analyzer
var NOCONE_WINDOW_TICKS = 10;

$(() => {
	if (typeof eventArrays !== 'undefined' && eventArrays.kills) {
		const originalOnNewEvent = eventArrays.kills.onNewEvent;
		eventArrays.kills.onNewEvent = (obj) => {
			if (originalOnNewEvent) originalOnNewEvent(obj);
			if (typeof analyserTimeline !== 'undefined') analyserTimeline.recordKill(obj);
			analyzeKillForNoLOS(obj);
		};
	}
});

function analyzeKillForNoLOS(killObj) {
	if (!options_DetectNoLOSKills) return;
	if (killObj.isTeamkill) return;

	const attackerId = killObj.AttackerID;
	const victimId = killObj.VictimID;

	if (!playerHistory.isWarmedUp(attackerId, NOCONE_WINDOW_TICKS) || !playerHistory.isWarmedUp(victimId, NOCONE_WINDOW_TICKS)) return;

	const attackerHist = playerHistory.getHistory(attackerId, NOCONE_WINDOW_TICKS);
	const victimHist = playerHistory.getHistory(victimId, NOCONE_WINDOW_TICKS);

	let validLOSInConeFound = false;
	const useTerrain = options_ConeRespectsTerrain && typeof hasTerrainLOS === 'function';

	for (let i = 0; i < attackerHist.length; i++) {
		const aTick = attackerHist[i];
		const vTick = victimHist.find(v => v.tick === aTick.tick);
		if (!vTick) continue;

		const worldDist = Math.hypot(vTick.X - aTick.X, vTick.Z - aTick.Z);
		if (worldDist > options_VisionConeRange) continue;

		const px = XtoCanvas(aTick.X);
		const py = YtoCanvas(aTick.Z);
		const vx = XtoCanvas(vTick.X);
		const vy = YtoCanvas(vTick.Z);

		const angle = angleToTargetDeg(px, py, aTick.rotation, vx, vy);
		if (angle <= options_VisionConeAngle / 2) {
			if (useTerrain && !hasTerrainLOS(aTick.X, aTick.Y, aTick.Z, vTick.X, vTick.Y, vTick.Z)) {
				continue; // Vision blocked by wall or hill!
			}
			validLOSInConeFound = true;
			break;
		}
	}

	if (!validLOSInConeFound) {
		killObj.isNoLOSKill = true;
		noLOSKills.push({
			tick: killObj.tick != null ? killObj.tick : killObj.Tick,
			attackerId: attackerId,
			victimId: victimId,
			attackerName: killObj.AttackerName,
			victimName: killObj.VictimName,
			weapon: killObj.Weapon,
			reason: "no_los_kill"
		});
		console.log(`[demoanalyser] No-LOS Kill Alert: ${killObj.AttackerName} killed ${killObj.VictimName} without direct vision (Tick ${killObj.tick || killObj.Tick})`);
	}
}

function drawMultiSnapChain(p) {
	if (!options_HighlightMultiSnapChains || typeof eventArrays === 'undefined' || !eventArrays.kills || !eventArrays.kills.events) return;

	const kills = eventArrays.kills.events.filter(k => k.AttackerID === p.id && !k.isTeamkill);
	if (kills.length < 2) return;

	kills.sort((a, b) => (a.tick != null ? a.tick : a.Tick) - (b.tick != null ? b.tick : b.Tick));

	const currentChain = [];
	for (let i = 0; i < kills.length - 1; i++) {
		const k1 = kills[i];
		const k2 = kills[i + 1];
		const t1 = k1.tick != null ? k1.tick : k1.Tick;
		const t2 = k2.tick != null ? k2.tick : k2.Tick;

		if (t2 - t1 <= 6) {
			if (currentChain.length === 0) currentChain.push({ kill: k1, index: 0 });
			currentChain.push({ kill: k2, index: currentChain.length });
		}
	}

	if (currentChain.length >= 2) {
		for (let i = 0; i < currentChain.length; i++) {
			const item = currentChain[i];
			const t = item.kill.tick != null ? item.kill.tick : item.Tick;

			if (Math.abs(Tick_Current - t) <= 4) {
				const a = AllPlayers[item.kill.AttackerID];
				const v = AllPlayers[item.kill.VictimID];
				if (a && v && a.ns_lastX != null && v.ns_lastX != null) {
					drawSnapHighlight(a, v, 1.0);
					if (typeof analyserTimeline !== 'undefined') {
						analyserTimeline.recordMultiSnapChain(t, a.id, item.index);
					}
				}
			}
		}
	}
}

var ns_bvrFocusMap = new Map();

function drawBVRLaser(p) {
	if (!p || p.isJoining || !p.isAlive || p.ns_lastX == null || isNaN(p.ns_lastX)) return;

	const px = p.getCanvasX();
	const py = p.getCanvasY();
	const rot = p.getRotation();
	const [fx, fy] = headingToCanvasVector(rot);

	const minRange = options_VisionConeRange;
	const maxRange = 4000;

	// Start laser at the edge of the vision cone
	const startCanvasDist = lengthtoCanvas(minRange);
	const endCanvasDist = lengthtoCanvas(maxRange);

	const startX = px + fx * startCanvasDist;
	const startY = py + fy * startCanvasDist;

	const endX = px + fx * endCanvasDist;
	const endY = py + fy * endCanvasDist;

	// Find ALL enemies beyond vision cone within a strict 50m wide gaze corridor (25m half-width)
	const bvrTargets = [];

	for (const other of Object.values(AllPlayers)) {
		if (!other || other === p || other.isJoining || !other.isAlive || other.ns_lastX == null || isNaN(other.ns_lastX)) continue;
		if (!isEnemyOf(p, other)) continue;

		const worldDist = Math.hypot(other.getX() - p.getX(), other.getZ() - p.getZ());
		if (worldDist <= minRange || worldDist > maxRange) continue;

		const angleDeg = angleToTargetDeg(px, py, rot, other.getCanvasX(), other.getCanvasY());
		const perpDist = worldDist * Math.sin(angleDeg * Math.PI / 180);

		// Strict 50m corridor width (25m half-width)
		if (perpDist <= 25.0) {
			bvrTargets.push({ player: other, dist: worldDist });
		}
	}

	const dt = typeof DemoTimePerTick !== 'undefined' && DemoTimePerTick > 0 ? DemoTimePerTick : 0.04;
	let maxTargetOpacity = 0.2;

	// Process accumulated focus time for ALL detected targets across the whole match
	for (const target of bvrTargets) {
		const key = `${p.id}_${target.player.id}`;
		let entry = ns_bvrFocusMap.get(key) || { ticks: 0, lastTick: -1 };

		if (entry.lastTick !== Tick_Current) {
			entry.ticks += 1;
			entry.lastTick = Tick_Current;
		}
		ns_bvrFocusMap.set(key, entry);

		const focusSeconds = entry.ticks * dt;
		if (focusSeconds > (p.ns_maxFocusSeconds || 0)) {
			p.ns_maxFocusSeconds = focusSeconds;
		}
		// Opacity starts at 10% (0.10) and scales to 100% (1.00) after 60 seconds (1 minute) of cumulative focus
		const opacity = Math.min(1.0, 0.10 + (focusSeconds / 60.0) * 0.90);
		target.focusSeconds = focusSeconds;
		target.opacity = opacity;

		if (opacity > maxTargetOpacity) maxTargetOpacity = opacity;
	}

	// Render gaze beam vector (Fluorescent Neon Green)
	Context.save();
	Context.setLineDash([6, 4]);
	Context.beginPath();
	Context.moveTo(startX, startY);
	Context.lineTo(endX, endY);

	if (bvrTargets.length > 0) {
		Context.strokeStyle = `rgba(0, 255, 102, ${maxTargetOpacity.toFixed(2)})`;
		Context.lineWidth = 2.2;
	} else {
		Context.strokeStyle = "rgba(0, 255, 102, 0.25)";
		Context.lineWidth = 1.2;
	}
	Context.stroke();
	Context.setLineDash([]);

	// Render BVR target indicators for ALL matched targets (Fluorescent Neon Green)
	for (const target of bvrTargets) {
		const tx = target.player.getCanvasX();
		const ty = target.player.getCanvasY();
		const op = target.opacity;
		const greenRgba = `rgba(0, 255, 102, ${op.toFixed(2)})`;
		const distRgba = `rgba(180, 255, 210, ${op.toFixed(2)})`;

		// 1. Target Circle around enemy icon
		Context.beginPath();
		Context.arc(tx, ty, PlayerCircleSize + 5, 0, Math.PI * 2);
		Context.strokeStyle = greenRgba;
		Context.lineWidth = 2.0;
		Context.stroke();

		// 2. Distance in top-right above target
		const distText = `${Math.round(target.dist)}m`;
		Context.font = "bold 10px Arial";
		Context.fillStyle = distRgba;
		Context.textAlign = "left";
		Context.textBaseline = "alphabetic";
		Context.fillText(distText, tx + PlayerCircleSize + 4, ty - PlayerCircleSize);

		// 3. Fluorescent Green Seconds Counter Centered Below Target (Literal Engagement Timer Style)
		const timeText = `${target.focusSeconds.toFixed(1)}s`;
		Context.font = "bold 13px Arial";
		Context.fillStyle = greenRgba;
		const timeWidth = Context.measureText(timeText).width;
		Context.fillText(timeText, tx - timeWidth / 2, ty + PlayerCircleSize + 16);
	}

	Context.restore();
}

function updateAllPlayersFocusTracking() {
	if (typeof Tick_Current === 'undefined' || typeof AllPlayers === 'undefined') return;
	const dt = typeof DemoTimePerTick !== 'undefined' && DemoTimePerTick > 0 ? DemoTimePerTick : 0.04;

	for (const pid in AllPlayers) {
		const p = AllPlayers[pid];
		if (!p || p.isJoining || !p.isAlive || p.X == null || isNaN(p.X)) continue;

		const px = typeof p.getCanvasX === "function" ? p.getCanvasX() : (p.X != null ? XtoCanvas(p.X) : NaN);
		const py = typeof p.getCanvasY === "function" ? p.getCanvasY() : (p.Z != null ? YtoCanvas(p.Z) : NaN);
		const rot = typeof p.getRotation === "function" ? p.getRotation() : (p.yaw || 0);
		if (isNaN(px) || isNaN(py)) continue;

		for (const oid in AllPlayers) {
			const other = AllPlayers[oid];
			if (!other || other === p || other.isJoining || !other.isAlive || other.X == null || isNaN(other.X)) continue;
			if (!isEnemyOf(p, other)) continue;

			const worldDist = Math.hypot(other.X - p.X, other.Z - p.Z);
			if (worldDist <= 10 || worldDist > 4000) continue;

			const opx = typeof other.getCanvasX === "function" ? other.getCanvasX() : (other.X != null ? XtoCanvas(other.X) : NaN);
			const opy = typeof other.getCanvasY === "function" ? other.getCanvasY() : (other.Z != null ? YtoCanvas(other.Z) : NaN);
			if (isNaN(opx) || isNaN(opy)) continue;

			const angleDeg = angleToTargetDeg(px, py, rot, opx, opy);
			const perpDist = worldDist * Math.sin(angleDeg * Math.PI / 180);

			if (perpDist <= 25.0 && angleDeg <= (options_VisionConeAngle / 2)) {
				const key = `${p.id}_${other.id}`;
				let entry = ns_bvrFocusMap.get(key) || { ticks: 0, lastTick: -1 };
				if (entry.lastTick !== Tick_Current) {
					entry.ticks += 1;
					entry.lastTick = Tick_Current;
				}
				ns_bvrFocusMap.set(key, entry);

				const focusSec = entry.ticks * dt;
				if (focusSec > (p.ns_maxFocusSeconds || 0)) {
					p.ns_maxFocusSeconds = focusSec;
				}
			}
		}
	}
}

function draw4KmLaser(p) {
	if (!p || p.isJoining || !p.isAlive || p.ns_lastX == null || isNaN(p.ns_lastX)) return;

	const px = p.getCanvasX();
	const py = p.getCanvasY();
	const rot = p.getRotation();
	const [fx, fy] = headingToCanvasVector(rot);

	const maxDistM = 4000;
	const cMaxDist = lengthtoCanvas(maxDistM);

	let x1 = px;
	let y1 = py;
	let x2 = px + fx * cMaxDist;
	let y2 = py + fy * cMaxDist;

	const targetWorldX = XtoWorld(x2);
	const targetWorldZ = YtoWorld(y2);

	let closestFrac = 1.0;
	let hitPoint = null;
	let hitType = null;

	if (typeof buildingHeightmap !== 'undefined' && buildingHeightmap.initialized) {
		const hit = buildingHeightmap.getRayCollision(p.X, p.Y, p.Z, targetWorldX, p.Y, targetWorldZ);
		if (hit) {
			closestFrac = hit.t;
			hitPoint = { x: hit.hitX, z: hit.hitZ };
			hitType = "building";
		}
	}

	if (typeof heightmap !== 'undefined' && heightmap.initialized && heightmap.heightdataview) {
		const eyeY = (p.Y !== undefined ? p.Y : 0) + 1.7;
		const rayDx = targetWorldX - p.X;
		const rayDz = targetWorldZ - p.Z;
		const totalDist = Math.hypot(rayDx, rayDz);

		if (totalDist > 0) {
			const stepM = 4.0;
			const maxSteps = Math.floor((totalDist * closestFrac) / stepM);
			for (let s = 1; s <= maxSteps; s++) {
				const frac = (s * stepM) / totalDist;
				if (frac >= closestFrac) break;
				const sampleX = p.X + rayDx * frac;
				const sampleZ = p.Z + rayDz * frac;
				const terrainH = heightmap.getHeightFromCoords(sampleX, sampleZ);
				if (terrainH !== -Infinity && !isNaN(terrainH)) {
					if (terrainH >= eyeY) {
						closestFrac = frac;
						hitPoint = { x: sampleX, z: sampleZ };
						hitType = "terrain";
						break;
					}
				}
			}
		}
	}

	if (hitPoint) {
		x2 = XtoCanvas(hitPoint.x);
		y2 = YtoCanvas(hitPoint.z);
	}

	Context.save();
	Context.beginPath();
	Context.moveTo(x1, y1);
	Context.lineTo(x2, y2);

	if (hitType === "building") {
		Context.strokeStyle = "rgba(0, 229, 255, 0.95)";
		Context.lineWidth = 2.2;
		Context.shadowColor = "#00e5ff";
		Context.shadowBlur = 8;
	} else if (hitType === "terrain") {
		Context.strokeStyle = "rgba(255, 170, 0, 0.95)";
		Context.lineWidth = 2.2;
		Context.shadowColor = "#ffaa00";
		Context.shadowBlur = 8;
	} else {
		Context.strokeStyle = "rgba(0, 229, 255, 0.55)";
		Context.lineWidth = 1.5;
	}
	Context.stroke();

	if (hitType) {
		Context.beginPath();
		Context.arc(x2, y2, 4.5, 0, Math.PI * 2);
		Context.fillStyle = hitType === "terrain" ? "#ff1744" : "#ffee00";
		Context.strokeStyle = "#000000";
		Context.lineWidth = 1.2;
		Context.fill();
		Context.stroke();
	}

	Context.restore();
}

function drawSpottedIndicators() {
	if (!options_DrawSpottedIndicators || typeof ordersHistory === 'undefined') return;

	const allOrders = ordersHistory.getAllOrders();
	if (!allOrders || allOrders.length === 0) return;

	const spottedFobs = new Set();
	const spottedPlayers = new Set();
	const spottedVehicles = new Set();

	// 1. Enemy FOB Spotting Case (Permanent once linked within 18m, until FOB destroyed)
	if (typeof AllFobs !== 'undefined' && AllFobs) {
		for (const fobId in AllFobs) {
			const fob = AllFobs[fobId];
			if (!fob) continue;

			for (const order of allOrders) {
				if (order.tick > Tick_Current) continue;
				if (order.team === fob.team) continue; // Enemy orders only

				const dist = Math.hypot(fob.X - order.X, fob.Z - order.Z);
				if (dist <= options_FobLinkRadius) {
					spottedFobs.add(fob);
					break;
				}
			}
		}
	}

	// 2. Enemy Player Spotting Case (Dynamic 40m radius, entry window <= 2 min)
	if (typeof AllPlayers !== 'undefined' && AllPlayers) {
		for (const pid in AllPlayers) {
			const player = AllPlayers[pid];
			if (!player || player.isJoining || !player.isAlive || player.ns_lastX == null || isNaN(player.ns_lastX)) continue;

			for (const order of allOrders) {
				if (order.tick > Tick_Current) continue;
				if (order.team === player.team) continue; // Enemy orders only

				const px = typeof player.getX === 'function' ? player.getX() : player.X;
				const pz = typeof player.getZ === 'function' ? player.getZ() : player.Z;
				const dist = Math.hypot(px - order.X, pz - order.Z);
				const key = player.id + ":" + order.id;

				if (dist <= options_SpottedZoneRadius) {
					if (spottedPlayerEntryMap.has(key)) {
						spottedPlayers.add(player);
					} else {
						const dt = typeof DemoTimePerTick !== 'undefined' ? DemoTimePerTick : 0.04;
						const orderAgeSec = (Tick_Current - order.tick) * dt;
						if (orderAgeSec <= 120) { // Entry within 2 minutes window
							spottedPlayerEntryMap.set(key, true);
							spottedPlayers.add(player);
						}
					}
				} else {
					// Exited the 40m radius: spot ends immediately
					spottedPlayerEntryMap.delete(key);
				}
			}
		}
	}

	// 3. Enemy Vehicle Spotting Case (Dynamic 40m radius, entry window <= 2 min)
	if (typeof AllVehicles !== 'undefined' && AllVehicles) {
		for (const vid in AllVehicles) {
			const veh = AllVehicles[vid];
			if (!veh || (typeof isVehicleContainer === 'function' && isVehicleContainer(vid))) continue;

			for (const order of allOrders) {
				if (order.tick > Tick_Current) continue;
				if (order.team === veh.team) continue; // Enemy orders only

				const vx = typeof veh.getX === 'function' ? veh.getX() : veh.X;
				const vz = typeof veh.getZ === 'function' ? veh.getZ() : veh.Z;
				const dist = Math.hypot(vx - order.X, vz - order.Z);
				const key = veh.id + ":" + order.id;

				if (dist <= options_SpottedZoneRadius) {
					if (spottedVehicleEntryMap.has(key)) {
						spottedVehicles.add(veh);
					} else {
						const dt = typeof DemoTimePerTick !== 'undefined' ? DemoTimePerTick : 0.04;
						const orderAgeSec = (Tick_Current - order.tick) * dt;
						if (orderAgeSec <= 120) { // Entry within 2 minutes window
							spottedVehicleEntryMap.set(key, true);
							spottedVehicles.add(veh);
						}
					}
				} else {
					// Exited the 40m radius: spot ends immediately
					spottedVehicleEntryMap.delete(key);
				}
			}
		}
	}

	// Render red pulsing Spotted indicators on map with compact badges
	const pulse = Math.sin(performance.now() / 150) * 2;
	const pRadius = typeof PlayerCircleSize !== 'undefined' ? PlayerCircleSize : 8;

	const renderSpottedBadge = (x, y, radius, title) => {
		if (x == null || y == null || isNaN(x) || isNaN(y)) return;
		Context.save();
		// Ring
		Context.strokeStyle = "#ff1744";
		Context.lineWidth = 1.5;
		Context.shadowColor = "#ff1744";
		Context.shadowBlur = 6;
		Context.beginPath();
		Context.arc(x, y, radius + pulse, 0, Math.PI * 2);
		Context.stroke();

		// Compact Label
		Context.font = "bold 9px Arial";
		const label = "Spotted";
		const tw = Context.measureText(label).width;

		Context.fillStyle = "rgba(30, 0, 10, 0.55)";
		Context.fillRect(x - tw / 2 - 2, y - radius - 11, tw + 4, 10);
		Context.strokeStyle = "#ff1744";
		Context.lineWidth = 0.8;
		Context.strokeRect(x - tw / 2 - 2, y - radius - 11, tw + 4, 10);

		Context.fillStyle = "#ff1744";
		Context.fillText(label, x - tw / 2, y - radius - 3);
		Context.restore();
	};

	for (const fob of spottedFobs) {
		if (typeof fob.getCanvasX === 'function') renderSpottedBadge(fob.getCanvasX(), fob.getCanvasY(), 14, "FOB");
	}
	for (const player of spottedPlayers) {
		if (typeof player.getCanvasX === 'function') renderSpottedBadge(player.getCanvasX(), player.getCanvasY(), pRadius + 4, "Player");
	}
	for (const veh of spottedVehicles) {
		if (typeof veh.getCanvasX === 'function') renderSpottedBadge(veh.getCanvasX(), veh.getCanvasY(), 16, "Vehicle");
	}
}

var MAP_VIEW_DISTANCES = {
  "adak": 425,
  "albasrah_2": 500,
  "asad_khal": 200,
  "ascheberg": 1050,
  "assault_on_grozny": 390,
  "assault_on_mestia": 390,
  "bamyan": 850,
  "battle_of_debrecen": 650,
  "battle_of_ia_drang": 500,
  "battle_of_kerch": 750,
  "beirut": 690,
  "belyaevo": 325,
  "black_gold": 900,
  "brecourt_assault": 390,
  "burning_sands": 550,
  "carentan": 670,
  "charlies_point": 400,
  "deagle5": 200,
  "donbas": 400,
  "dovre": 450,
  "dovre_winter": 270,
  "dragon_fly": 500,
  "fallujah_west": 490,
  "fields_of_kassel": 750,
  "fools_road": 600,
  "gaza_2": 400,
  "goose_green": 380,
  "grostok": 400,
  "hades_peak": 945,
  "hill_488": 400,
  "icebreaker": 1200,
  "iron_ridge": 500,
  "kafar_halab": 300,
  "karbala": 425,
  "kashan_desert": 1000,
  "khamisiyah": 1100,
  "kokan": 490,
  "korbach_offensive": 750,
  "korengal": 750,
  "kozelsk": 400,
  "krivaja_valley": 700,
  "kunar_province": 1000,
  "lashkar_valley": 800,
  "masirah": 990,
  "merville": 300,
  "musa_qala": 400,
  "muttrah_city_2": 700,
  "nuijamaa": 750,
  "omaha_beach": 750,
  "op_barracuda": 500,
  "operation_bobcat": 840,
  "operation_brunswick": 750,
  "operation_falcon": 480,
  "operation_marlin": 250,
  "operation_soul_rebel": 1000,
  "operation_thunder": 750,
  "outpost": 440,
  "pavlovsk_bay": 990,
  "ramiel": 500,
  "ras_el_masri_2": 500,
  "reichswald": 300,
  "road_to_damascus": 900,
  "route": 550,
  "rzhev": 450,
  "saaremaa": 1000,
  "sahel": 650,
  "sbeneh_outskirts": 400,
  "shahadah": 550,
  "shijiavalley": 500,
  "shipment": 200,
  "silent_eagle": 1300,
  "stalingrad": 125,
  "stalingrad_summer": 400,
  "tad_sae": 275,
  "talbisah": 480,
  "test_airfield": 4000,
  "test_bootcamp": 900,
  "the_falklands": 2900,
  "ulyanovsk": 600,
  "vadso_city": 500,
  "vung_ro": 550,
  "wanda_shan": 800,
  "xiangshan": 590,
  "yamalia": 650,
  "zakho": 390
};

function syncConeRangeSlider(val) {
	let num = parseFloat(val);
	if (isNaN(num)) return;
	num = Math.max(50, Math.min(4000, Math.round(num)));
	options_VisionConeRange = num;

	const slider = document.getElementById("options_VisionConeRange");
	if (slider && parseFloat(slider.value) !== num) slider.value = num;

	const valSpan = document.getElementById("lblConeRangeVal");
	if (valSpan) valSpan.textContent = `Cone Range ${num}m`;

	if (typeof requestUpdate === "function") requestUpdate();
}

function resetConeRangeToMapDefault() {
	let mapKey = "";
	if (typeof MapName !== "undefined" && MapName) {
		mapKey = MapName.toLowerCase();
	} else if (typeof ServerName !== "undefined" && ServerName) {
		mapKey = ServerName.toLowerCase();
	}
	const defaultDist = MAP_VIEW_DISTANCES[mapKey] || 500;
	syncConeRangeSlider(defaultDist);
}

function updateAnalyserSliderLabels() {
	let mapKey = "";
	if (typeof MapName !== "undefined" && MapName) {
		mapKey = MapName.toLowerCase();
	} else if (typeof ServerName !== "undefined" && ServerName) {
		mapKey = ServerName.toLowerCase();
	}

	const dist = MAP_VIEW_DISTANCES[mapKey] || 500;
	const titleName = mapKey ? mapKey.charAt(0).toUpperCase() + mapKey.slice(1) : "Default";

	const textSpan = document.getElementById("valMapViewRangeText");
	if (textSpan) {
		if (currentAnalyserLang === "ES") {
			textSpan.textContent = `Rango de Visi\u00f3n Predeterminado ${dist}m`;
		} else if (currentAnalyserLang === "PT") {
			textSpan.textContent = `Alcance de Vis\u00e3o Padr\u00e3o ${dist}m`;
		} else {
			textSpan.textContent = `${titleName} View range ${dist}m`;
		}
		const container = document.getElementById("mapViewRangeContainer");
		if (container) container.style.display = "block";
	}

	// Update Engagement Timer range text indicator below View range
	const timerRadius = typeof getAdaptiveFlankRadius === "function" ? getAdaptiveFlankRadius() : 100;
	let mapScaleStr = "2km";
	if (timerRadius === 50) mapScaleStr = "1km";
	else if (timerRadius === 150) mapScaleStr = "4km+";

	const timerTextSpan = document.getElementById("valEngagementTimerRangeText");
	if (timerTextSpan) {
		if (currentAnalyserLang === "ES") {
			timerTextSpan.textContent = `Rango de Tiempo de Combate ${timerRadius}m (Mapa ${mapScaleStr})`;
		} else if (currentAnalyserLang === "PT") {
			timerTextSpan.textContent = `Alcance do Tempo de Engajamento ${timerRadius}m (Mapa ${mapScaleStr})`;
		} else {
			timerTextSpan.textContent = `Engagement Timer range ${timerRadius}m (${mapScaleStr} map)`;
		}
		const timerContainer = document.getElementById("engagementTimerRangeContainer");
		if (timerContainer) timerContainer.style.display = "block";
	}

	// Synchronize options_VisionConeRange and both UI controls to the map's view distance
	if (typeof syncConeRangeSlider === "function") {
		syncConeRangeSlider(dist);
	}
}

// Multi-Language Switcher for Demo Analyser (EN, ES, PT)
var currentAnalyserLang = "EN";

var ANALYSER_I18N = {
	EN: {
		header: "Demo Analyser",
		toolsHeader: "Analyser Tools & Debug",
		coneRangeLabel: "Cone Range:",
		btnHeatmap: "Compute Vision Heatmap",
		opts: {
			options_DrawVisionCone: {
				label: "Vision Cone",
				title: "Draws a field of view cone representing the player's screen. If an enemy is inside this cone, they are considered visible."
			},
			options_DrawThreatLasers: {
				label: "Threat Lasers",
				title: "Draws a main blue gaze laser in the player's view direction. The laser turns red whenever the player is aiming at an enemy that is blocked by terrain or buildings. Also draws orange threat lasers to enemies that are visible inside the vision cone."
			},
			options_ConeRespectsTerrain: {
				label: "Terrain/Building LOS",
				title: "Makes the vision cone, gaze laser, and threat lasers respect terrain and building line-of-sight."
			},
			options_DetectNoLOSKills: {
				label: "No-LOS Kill Alert",
				title: "Alerts when a kill occurs without direct Line-of-Sight (outside vision cone or blocked by building wall/terrain)."
			},
			options_DrawBVRLaser: {
				label: "BVR Laser",
				title: "Extends the gaze laser beyond the map's view range/fog distance to analyze aiming focus toward targets out of visual rendering range."
			},
			options_DrawSpottedIndicators: {
				label: "Orders & Spotted Tracking",
				title: "Tracks enemy FOBs, players, and vehicles marked by squad leader orders within time and distance thresholds."
			},
			options_DrawFlankChronometer: {
				label: "Engagement Timer",
				title: "Creates a 150m radius zone around the selected player and shows a timer in seconds above nearby enemies to measure response time."
			},
			options_DrawAttentionHeatmap: {
				label: "Vision Heatmap",
				title: "Shows a heatmap overlay of where the player spent most of their time looking."
			},
			options_DrawTimeline: {
				label: "Timeline",
				title: "Displays a timeline track of engagements and events for the selected player at the bottom of the screen."
			},
			options_DrawBuildingWireframes: {
				label: "Building Footprints",
				title: "Shows real 2D vector footprints of static objects (buildings, walls, structures) extracted from the game's 3D collision meshes."
			},
			options_DrawHeightmapOverlay: {
				label: "Heightmap Overlay",
				title: "Superimposes a colorized heightmap terrain grid over the map to verify elevation."
			},
			options_Draw4KmLaser: {
				label: "4km Independent LOS Laser",
				title: "Projects an independent 4km Raycast laser from the selected player that detects and stops at exact 2D building walls and terrain heightmap elevations."
			}
		}
	},
	ES: {
		header: "Demo Analyser",
		toolsHeader: "Herramientas de An\u00e1lisis",
		coneRangeLabel: "Rango del Cono:",
		btnHeatmap: "Calcular Mapa de Calor",
		opts: {
			options_DrawVisionCone: {
				label: "Cono de Visi\u00f3n",
				title: "Proyecta el cono del campo de visi\u00f3n en pantalla del jugador seleccionado para determinar qu\u00e9 enemigos entran en su encuadre."
			},
			options_DrawThreatLasers: {
				label: "L\u00e1seres de Amenaza",
				title: "Dibuja la l\u00ednea azul de la mirada del jugador (que pasa a rojo si apunta tras cobertura) y traza l\u00edneas naranjas de alerta hacia enemigos visibles en su cono."
			},
			options_ConeRespectsTerrain: {
				label: "L\u00ednea de Visi\u00f3n (LOS)",
				title: "Calcula en tiempo real el bloqueo de visi\u00f3n producido por el relieve del terreno y los muros vectoriales de los edificios."
			},
			options_DetectNoLOSKills: {
				label: "Alerta de Baja sin Visibilidad (No-LOS)",
				title: "Registra y resalta en el feed las bajas que ocurren sin l\u00ednea de visi\u00f3n directa (de espaldas o bloqueadas por paredes/terreno)."
			},
			options_DrawBVRLaser: {
				label: "L\u00e1ser BVR (M\u00e1s all\u00e1 del Rango Visual)",
				title: "Extiende el l\u00e1ser de mirada m\u00e1s all\u00e1 de la distancia l\u00edmite de renderizado/niebla del mapa para analizar si el jugador mantiene el foco en objetivos fuera de su alcance visual."
			},
			options_DrawSpottedIndicators: {
				label: "Rastreo de \u00d3rdenes y Marcas",
				title: "Resalta los objetivos (FOBs, tropas y veh\u00edculos enemigos) marcados oficialmente por las \u00f3rdenes del l\u00edder de escuadra."
			},
			options_DrawFlankChronometer: {
				label: "Tiempo de Reacci\u00f3n en Combate",
				title: "Crea un \u00e1rea t\u00e1ctica alrededor del jugador y mide en segundos su tiempo de respuesta tras encarar o detectar a un enemigo."
			},
			options_DrawAttentionHeatmap: {
				label: "Mapa de Calor de Visi\u00f3n",
				title: "Genera una capa t\u00e9rmica que muestra las zonas del mapa donde el jugador concentr\u00f3 su mirada durante m\u00e1s tiempo."
			},
			options_DrawTimeline: {
				label: "L\u00ednea de Tiempo T\u00e1ctica",
				title: "Muestra una barra de eventos cronol\u00f3gica en la parte inferior para navegar instant\u00e1neamente entre combates y enfrentamientos."
			},
			options_DrawBuildingWireframes: {
				label: "Huellas Vectoriales 2D",
				title: "Muestra el contorno poligonal real de todos los edificios y muros del mapa extra\u00eddos de las mallas 3D del juego."
			},
			options_DrawHeightmapOverlay: {
				label: "Malla de Elevaci\u00f3n del Terreno",
				title: "Superpone una cuadr\u00edcula coloreada con las alturas del relieve para verificar la elevaci\u00f3n del mapa."
			},
			options_Draw4KmLaser: {
				label: "L\u00e1ser Independiente de 4km",
				title: "Lanza un rayo vectorial continuo de 4,000 metros en la direcci\u00f3n exacta de la mira para detectar colisiones lejanas con edificios o colinas."
			}
		}
	},
	PT: {
		header: "Demo Analyser",
		toolsHeader: "Ferramentas de An\u00e1lise",
		coneRangeLabel: "Alcance do Cone:",
		btnHeatmap: "Calcular Mapa de Calor",
		opts: {
			options_DrawVisionCone: {
				label: "Cone de Vis\u00e3o",
				title: "Projeta o cone do campo de vis\u00e3o da tela do jogador para determinar quais inimigos est\u00e3o vis\u00edveis."
			},
			options_DrawThreatLasers: {
				label: "Lasers de Amea\u00e7a",
				title: "Desenha a linha azul da vis\u00e3o do jogador (que fica vermelha atr\u00e1s de cobertura) e tra\u00e7a linhas laranjas para inimigos vis\u00edveis no cone."
			},
			options_ConeRespectsTerrain: {
				label: "Linha de Vis\u00e3o (LOS)",
				title: "Calcula em tempo real o bloqueio de vis\u00e3o produzido pelo relevo do terreno e paredes dos edif\u00edcios."
			},
			options_DetectNoLOSKills: {
				label: "Alerta de Abate sem Vis\u00e3o (No-LOS)",
				title: "Notifica e destaca no feed os abates que ocorrem sem linha de vis\u00e3o direta (fora do cone ou bloqueados por paredes/terreno)."
			},
			options_DrawBVRLaser: {
				label: "Laser BVR (Al\u00e9m do Alcance Visual)",
				title: "Estende o laser de vis\u00e3o al\u00e9m da dist\u00e2ncia limite de renderiza\u00e7\u00e3o/neblina do mapa para analisar se o jogador mant\u00e9m o foco em alvos fora do seu alcance visual."
			},
			options_DrawSpottedIndicators: {
				label: "Rastreamento de Ordens e Marcas",
				title: "Destaca os alvos (FOBs, tropas e ve\u00edculos inimigos) marcados oficialmente pelas ordens do l\u00edder de esquadr\u00e3o."
			},
			options_DrawFlankChronometer: {
				label: "Tempo de Rea\u00e7\u00e3o em Combate",
				title: "Cria uma \u00e1rea t\u00e1tica ao redor do jogador e calcula em segundos o tempo de resposta ap\u00f3s detectar um inimigo."
			},
			options_DrawAttentionHeatmap: {
				label: "Mapa de Calor de Vis\u00e3o",
				title: "Gera uma camada t\u00e9rmica que mostra as \u00e1reas do mapa onde o jogador concentrou a vis\u00e3o por mais tempo."
			},
			options_DrawTimeline: {
				label: "Linha do Tempo T\u00e1tica",
				title: "Exibe uma barra cronol\u00f3gica de eventos na parte inferior para navegar instantaneamente entre engajamentos."
			},
			options_DrawBuildingWireframes: {
				label: "Pegadas Vetoriais 2D",
				title: "Mostra o contorno poligonal real de todos os edif\u00edcios e paredes do mapa extra\u00eddos das malhas 3D do jogo."
			},
			options_DrawHeightmapOverlay: {
				label: "Grade de Eleva\u00e7\u00e3o do Terreno",
				title: "Superp\u00f5e uma grade colorida com as alturas do relevo para verificar a eleva\u00e7\u00e3o do mapa."
			},
			options_Draw4KmLaser: {
				label: "Laser Independente de 4km",
				title: "Lan\u00e7a um raio vetorial cont\u00ednuo de 4.000 metros na dire\u00e7\u00e3o exata da vis\u00e3o para detectar colis\u00f5es distantes com edif\u00edcios ou colinas."
			}
		}
	}
};

function setAnalyserLanguage(lang) {
	if (!ANALYSER_I18N[lang]) lang = "EN";
	currentAnalyserLang = lang;
	const data = ANALYSER_I18N[lang];

	const lblHeader = document.getElementById("lblDemoAnalyserHeader");
	if (lblHeader) lblHeader.textContent = data.header;

	const lblTools = document.getElementById("lblAnalyserToolsHeader");
	if (lblTools) lblTools.textContent = data.toolsHeader;

	const lblCone = document.getElementById("lblConeRange");
	if (lblCone) lblCone.textContent = data.coneRangeLabel;

	const btnHeat = document.getElementById("btnComputeVisionHeatmap");
	if (btnHeat) btnHeat.textContent = data.btnHeatmap;

	for (const [optId, info] of Object.entries(data.opts)) {
		const elem = document.getElementById(optId);
		if (elem) {
			const label = elem.closest("label");
			if (label) {
				label.title = info.title;
				let textNode = null;
				for (let node of label.childNodes) {
					if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0) {
						textNode = node;
						break;
					}
				}
				if (textNode) {
					textNode.nodeValue = " " + info.label;
				}
			}
		}
	}

	["EN", "ES", "PT"].forEach(l => {
		const btn = document.getElementById("btnLang" + l);
		if (btn) {
			if (l === lang) {
				btn.style.background = "#00e5ff";
				btn.style.color = "#000";
				btn.style.borderColor = "#00e5ff";
			} else {
				btn.style.background = "rgba(255,255,255,0.1)";
				btn.style.color = "#fff";
				btn.style.borderColor = "#555";
			}
		}
	});
}

var currentBVRFocusMode = "individual";

function switchBVRFocusMode(mode) {
	currentBVRFocusMode = mode;
	const btnInd = document.getElementById("btnBvrModeIndividual");
	const btnAcu = document.getElementById("btnBvrModeAcumulado");
	if (btnInd && btnAcu) {
		if (mode === "individual") {
			btnInd.style.background = "#00e5ff";
			btnInd.style.color = "#000";
			btnAcu.style.background = "transparent";
			btnAcu.style.color = "#aaa";
		} else {
			btnAcu.style.background = "#00e5ff";
			btnAcu.style.color = "#000";
			btnInd.style.background = "transparent";
			btnInd.style.color = "#aaa";
		}
	}
	openBVRFocusModal();
}

function openBVRFocusModal() {
	const modal = document.getElementById("bvrFocusModal");
	const body = document.getElementById("bvrFocusModalBody");
	if (!modal || !body) return;

	modal.style.display = "flex";

	const btnInd = document.getElementById("btnBvrModeIndividual");
	const btnAcu = document.getElementById("btnBvrModeAcumulado");
	if (btnInd && btnAcu) {
		if (currentBVRFocusMode === "individual") {
			btnInd.style.background = "#00e5ff";
			btnInd.style.color = "#000";
			btnAcu.style.background = "transparent";
			btnAcu.style.color = "#aaa";
		} else {
			btnAcu.style.background = "#00e5ff";
			btnAcu.style.color = "#000";
			btnInd.style.background = "transparent";
			btnInd.style.color = "#aaa";
		}
	}

	if (typeof analyserPreloader !== "undefined") {
		analyserPreloader.applyFocusToPlayers();
	}

	const focusPlayerMap = new Map();

	// 1. Gather preloaded states from analyserPreloader (available immediately on load)
	if (typeof analyserPreloader !== "undefined" && analyserPreloader.playerStates) {
		for (const [id, s] of analyserPreloader.playerStates) {
			const maxSec = analyserPreloader.playerMaxFocusMap ? (analyserPreloader.playerMaxFocusMap.get(id) || 0) : 0;
			const totalSec = analyserPreloader.playerTotalFocusMap ? (analyserPreloader.playerTotalFocusMap.get(id) || 0) : 0;
			const pObj = (typeof AllPlayers !== "undefined" && AllPlayers[id]) ? AllPlayers[id] : null;
			const pName = pObj && pObj.name ? pObj.name : `Player #${id}`;
			const pTeam = pObj && pObj.team ? pObj.team : (s.team || 0);

			focusPlayerMap.set(id, {
				id: id,
				name: pName,
				team: pTeam,
				maxSec: maxSec,
				totalSec: totalSec
			});
		}
	}

	// 2. Gather or update from AllPlayers
	if (typeof AllPlayers !== "undefined" && AllPlayers) {
		for (const pid in AllPlayers) {
			const p = AllPlayers[pid];
			if (!p || p.isJoining) continue;
			const id = p.id != null ? p.id : Number(pid);
			let entry = focusPlayerMap.get(id) || { id: id, name: p.name || `Player #${id}`, team: p.team || 0, maxSec: 0, totalSec: 0 };
			if (p.name) entry.name = p.name;
			if (p.team) entry.team = p.team;
			const maxSec = p.ns_maxFocusSeconds || 0;
			if (maxSec > entry.maxSec) entry.maxSec = maxSec;
			const totalSec = p.ns_totalFocusSeconds || 0;
			if (totalSec > entry.totalSec) entry.totalSec = totalSec;
			focusPlayerMap.set(id, entry);
		}
	}

	const allFocusPlayers = Array.from(focusPlayerMap.values());
	const isIndividual = currentBVRFocusMode === "individual";

	if (isIndividual) {
		allFocusPlayers.sort((a, b) => b.maxSec - a.maxSec);
	} else {
		allFocusPlayers.sort((a, b) => b.totalSec - a.totalSec);
	}

	if (allFocusPlayers.length === 0) {
		body.innerHTML = '<div style="text-align: center; color: #aaa; padding: 20px; font-family: Arial, sans-serif;">No hay datos de telemetría disponibles.</div>';
		return;
	}

	const colTitle = isIndividual ? "Tiempo Max. Enfoque" : "Tiempo Total Acumulado";
	const modeSubTitle = isIndividual ? "Ráfaga Máxima Continua" : "Enfoque Acumulado en la Partida";

	let html = `
		<div style="margin-bottom: 8px; font-size: 11px; color: #aaa; display: flex; justify-content: space-between; align-items: center; font-family: Arial, sans-serif;">
			<span>Escalafón BVR - ${modeSubTitle} (Total: <b>${allFocusPlayers.length}</b> jugadores):</span>
			<span style="font-size: 10px; color: #00e5ff;">Haz clic en "Seleccionar" para centrar en el mapa</span>
		</div>
		<table style="width: 100%; border-collapse: collapse; font-size: 11px; font-family: Arial, sans-serif; background: #2c2f34; color: rgb(239, 238, 241); border: 1px solid #34313a;">
			<thead>
				<tr style="background: #433f4a; color: #fff; text-align: left; height: 24px;">
					<th style="padding: 2px 8px; border-bottom: 1px solid #34313a; width: 40px;">#</th>
					<th style="padding: 2px 8px; border-bottom: 1px solid #34313a;">Jugador</th>
					<th style="padding: 2px 8px; border-bottom: 1px solid #34313a;">Bando</th>
					<th style="padding: 2px 8px; border-bottom: 1px solid #34313a; text-align: right;">${colTitle}</th>
					<th style="padding: 2px 8px; border-bottom: 1px solid #34313a; text-align: center; width: 90px;">Acción</th>
				</tr>
			</thead>
			<tbody>
	`;

	allFocusPlayers.forEach((p, idx) => {
		const targetSec = isIndividual ? p.maxSec : p.totalSec;
		const mins = Math.floor(targetSec / 60);
		const secs = Math.floor(targetSec % 60);
		const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${targetSec.toFixed(1)}s`;
		const teamColor = p.team === 1 ? "#FF3300" : p.team === 2 ? "#2299FF" : "#aaaaaa";
		const teamLabel = p.team === 1 ? "Equipo 1" : p.team === 2 ? "Equipo 2" : "Espectador";
		const rowBg = idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.15)";
		const highlightColor = targetSec >= 60 ? "#ffcc00" : targetSec >= 30 ? "#00e5ff" : "#ffffff";

		html += `
			<tr style="background: ${rowBg}; height: 22px; border-bottom: 1px solid #34313a; transition: background 0.15s;" onmouseover="this.style.background='#393c43'" onmouseout="this.style.background='${rowBg}'">
				<td style="padding: 2px 8px; color: #888; text-align: center;">${idx + 1}</td>
				<td style="padding: 2px 8px; font-weight: bold; color: #fff;">${p.name}</td>
				<td style="padding: 2px 8px;"><span style="color: ${teamColor}; font-weight: bold;">● ${teamLabel}</span></td>
				<td style="padding: 2px 8px; text-align: right; color: ${highlightColor}; font-weight: bold;">${timeStr}</td>
				<td style="padding: 2px 8px; text-align: center;">
					<button onclick="selectPlayerFromBVRModal(${p.id})" style="background: #00e5ff; color: #000; border: none; border-radius: 2px; font-size: 10px; font-weight: bold; padding: 2px 8px; cursor: pointer;">Seleccionar</button>
				</td>
			</tr>
		`;
	});

	html += `
			</tbody>
		</table>
	`;

	body.innerHTML = html;
}

function closeBVRFocusModal() {
	const modal = document.getElementById("bvrFocusModal");
	if (modal) modal.style.display = "none";
}

function selectPlayerFromBVRModal(pid) {
	if (typeof selectPlayer === "function") {
		selectPlayer(pid);
	} else if (typeof SelectedPlayer !== "undefined") {
		SelectedPlayer = pid;
	}
	closeBVRFocusModal();
}

window.addEventListener("click", (e) => {
	const modal = document.getElementById("bvrFocusModal");
	if (modal && e.target === modal) {
		modal.style.display = "none";
	}
});

