// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Reality Tracker Demo Analyser Engine
// Vision cone, Threat Lasers, Snap Detector, No-LOS Kill Alerts & BVR Lasers
var options_DrawVisionCone = false;
var options_VisionConeRespectsLOS = true;
var options_VisionConeRange = 150;
var options_VisionConeAngle = 94.9;
var options_VisionConeXRay = false;
var options_Wallhack = false;
var options_VisionConeQuality = "normal"; // "normal" (64 steps), "high" (128 steps), "ultra" (256 steps), "extreme" (512 steps)

function setVisionConeQuality(qual) {
    options_VisionConeQuality = qual;
    try {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("options_VisionConeQuality", qual);
        }
    } catch (e) {}
    const btnN = document.getElementById("btnConeQualNormal");
    const btnH = document.getElementById("btnConeQualHigh");
    const btnU = document.getElementById("btnConeQualUltra");
    const btnE = document.getElementById("btnConeQualExtreme");

    const inactiveStyle = "background: rgba(255,255,255,0.08); color: #bbb; border: 1px solid #555; border-radius: 2px; font-weight: bold; font-size: 9px; padding: 1px 4px; cursor: pointer;";
    const activeStyle = "background: #3a5250; color: #fff; border: 1px solid #8fa3a1; border-radius: 2px; font-weight: bold; font-size: 9px; padding: 1px 4px; cursor: pointer;";

    if (btnN) btnN.style.cssText = (qual === "normal") ? activeStyle : inactiveStyle;
    if (btnH) btnH.style.cssText = (qual === "high") ? activeStyle : inactiveStyle;
    if (btnU) btnU.style.cssText = (qual === "ultra") ? activeStyle : inactiveStyle;
    if (btnE) btnE.style.cssText = (qual === "extreme") ? activeStyle : inactiveStyle;

    if (typeof renderer3d !== "undefined" && renderer3d.initialized && typeof renderer3d.updateVisionConeQuality === "function") {
        renderer3d.updateVisionConeQuality(qual);
    }
}

var options_DrawThreatLasers = false;
var options_ConeRespectsTerrain = true;
var options_CameraTracking = false;

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
	if (!entity || entity.X == null || isNaN(entity.X)) return 0;

	const isPlayer = (typeof PlayerObject !== "undefined" && entity instanceof PlayerObject) || (entity.isAlive !== undefined);
	const isVehicle = (typeof VehicleObject !== "undefined" && entity instanceof VehicleObject) || (entity.Passengers !== undefined);

	// Multi-sample regression / rolling window over ~0.75s (optimal for integer meter grids)
	if (entity.ns_posHistory && entity.ns_posHistory.length >= 2) {
		const history = entity.ns_posHistory;
		const newest = history[history.length - 1];

		// Find sample ~0.70s to 0.90s in the past
		let targetSample = history[0];
		for (let i = history.length - 2; i >= 0; i--) {
			if (newest.time - history[i].time >= 0.75) {
				targetSample = history[i];
				break;
			}
		}

		const dt = newest.time - targetSample.time;
		const distM = Math.hypot(newest.x - targetSample.x, newest.z - targetSample.z);

		// Teleport / Respawn check
		if ((isPlayer && (!entity.vehicleid || entity.vehicleid < 0) && distM > 15.0) ||
			(isVehicle && distM > 150.0)) {
			entity.ns_smoothedSpeedKmh = 0;
			entity.ns_stance = "stationary";
			return 0;
		}

		if (dt >= 0.08 && !isNaN(distM)) {
			let rawSpeedKmh = (distM / dt) * 3.6;

			// Human sprint physical cap (max 28 km/h on foot with kit)
			if (isPlayer && (!entity.vehicleid || entity.vehicleid < 0)) {
				rawSpeedKmh = Math.min(28.0, rawSpeedKmh);
			}

			// Clean zero threshold (under 0.8 km/h or less than 0.35m moved)
			if (rawSpeedKmh < 0.8 || distM < 0.35) {
				rawSpeedKmh = 0;
			}

			// Exponential moving average filter for continuous smooth readout (tau = 220ms)
			if (entity.ns_smoothedSpeedKmh == null || isNaN(entity.ns_smoothedSpeedKmh)) {
				entity.ns_smoothedSpeedKmh = rawSpeedKmh;
			} else {
				entity.ns_smoothedSpeedKmh = 0.820397 * entity.ns_smoothedSpeedKmh + 0.179603 * rawSpeedKmh;
			}

			if (entity.ns_smoothedSpeedKmh < 0.4 && rawSpeedKmh === 0) {
				entity.ns_smoothedSpeedKmh = 0;
			}

			return entity.ns_smoothedSpeedKmh;
		}
	}

	// Fallback for single tick
	const lx = entity.ns_lastX != null && !isNaN(entity.ns_lastX) ? entity.ns_lastX : entity.X;
	const lz = entity.ns_lastZ != null && !isNaN(entity.ns_lastZ) ? entity.ns_lastZ : (entity.Z != null ? entity.Z : 0);
	const distM = Math.hypot(entity.X - lx, (entity.Z != null ? entity.Z : 0) - lz);
	const dt = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0) ? (1.0 / DetectedDemoHz) : (typeof DemoTimePerTick !== "undefined" ? DemoTimePerTick : 0.04);
	let instantSpeedKmh = (distM / dt) * 3.6;
	if (isNaN(instantSpeedKmh)) instantSpeedKmh = 0;
	if (isPlayer && (!entity.vehicleid || entity.vehicleid < 0)) instantSpeedKmh = Math.min(28.0, instantSpeedKmh);
	return instantSpeedKmh;
}

// Stance classification with Hysteresis (prevents flickering between walk/sprint)
function getPlayerStance(p, spdKmh) {
	if (!p || p.vehicleid >= 0) {
		return { stance: "vehicle", radiusM: 0, opacity: 0, text: "Inside Vehicle", color: "rgba(0, 229, 255, OPACITY)" };
	}

	const currentStance = p.ns_stance || "stationary";
	let newStance = currentStance;

	// Hysteresis transition rules
	if (currentStance === "sprint") {
		if (spdKmh < 13.5) newStance = spdKmh >= 6.0 ? "walk" : (spdKmh >= 1.2 ? "crouch" : "stationary");
	} else if (currentStance === "walk") {
		if (spdKmh >= 16.5) newStance = "sprint";
		else if (spdKmh < 4.5) newStance = spdKmh >= 1.2 ? "crouch" : "stationary";
	} else if (currentStance === "crouch") {
		if (spdKmh >= 16.5) newStance = "sprint";
		else if (spdKmh >= 7.0) newStance = "walk";
		else if (spdKmh < 0.8) newStance = "stationary";
	} else { // stationary
		if (spdKmh >= 16.5) newStance = "sprint";
		else if (spdKmh >= 7.0) newStance = "walk";
		else if (spdKmh >= 1.5) newStance = "crouch";
	}

	p.ns_stance = newStance;

	switch (newStance) {
		case "sprint":
			return { stance: "sprint", radiusM: 35, opacity: 0.50, text: `Sprinting (${spdKmh.toFixed(0)}km/h - 35m)`, color: "rgba(255, 200, 0, OPACITY)" };
		case "walk":
			return { stance: "walk", radiusM: 20, opacity: 0.45, text: `Walking (${spdKmh.toFixed(0)}km/h - 20m)`, color: "rgba(0, 229, 255, OPACITY)" };
		case "crouch":
			return { stance: "crouch", radiusM: 12, opacity: 0.30, text: `Crouching (${spdKmh.toFixed(0)}km/h - 12m)`, color: "rgba(0, 229, 255, OPACITY)" };
		default:
			return { stance: "stationary", radiusM: 0, opacity: 0, text: "Stationary (0m sound)", color: "rgba(0, 229, 255, OPACITY)" };
	}
}

function triggerShootingShockwave(x, z, radiusM, colorRgba, durationSec = 1.5, shooterId = null, vehicleId = null, victimId = null) {
	if (x == null || isNaN(x) || z == null || isNaN(z)) return;
	const currentTick = typeof Tick_Current !== "undefined" ? Tick_Current : 0;
	const effectiveDt = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0) ? (1.0 / DetectedDemoHz) : (typeof DemoTimePerTick !== 'undefined' && DemoTimePerTick > 0 ? DemoTimePerTick : 0.04);
	ns_activeShockwaves.push({
		x: x,
		z: z,
		maxRadiusM: radiusM,
		color: colorRgba,
		startTick: currentTick,
		durationTicks: Math.max(10, Math.round(durationSec / effectiveDt)),
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
					const st = getPlayerStance(p, spdKmh);
					const targetRadiusM = st.radiusM;
					const targetOpacity = st.opacity;
					const colorRgba = st.color;
					const stanceText = st.text;

					// Acoustic inertia smoothing (expansion vs dissipation)
					if (p.ns_auraRadius == null || isNaN(p.ns_auraRadius)) {
						p.ns_auraRadius = targetRadiusM;
						p.ns_auraOpacity = targetOpacity;
					}

					if (typeof isPlaying !== "undefined" && isPlaying) {
						const lerpFactor = targetRadiusM > p.ns_auraRadius ? 0.20 : 0.08;
						p.ns_auraRadius += (targetRadiusM - p.ns_auraRadius) * lerpFactor;
						p.ns_auraOpacity += (targetOpacity - p.ns_auraOpacity) * lerpFactor;
					}

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

	if (typeof isPlaying !== "undefined" && isPlaying) {
		const lerpFactor = targetEngineRadiusM > v.ns_auraRadius ? 0.18 : 0.06;
		v.ns_auraRadius += (targetEngineRadiusM - v.ns_auraRadius) * lerpFactor;
		v.ns_auraOpacity += (targetOpacity - v.ns_auraOpacity) * lerpFactor;
	}

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

function getPlayerWorldPos(p) {
	if (!p) return { x: 0, y: 0, z: 0, rot: 0 };
	if (p.vehicleid >= 0 && typeof AllVehicles !== 'undefined' && AllVehicles[p.vehicleid]) {
		const v = AllVehicles[p.vehicleid];
		const vx = typeof v.getX === "function" ? v.getX() : (v.X || 0);
		const vy = typeof v.getY === "function" ? v.getY() : (v.Y || 0);
		const vz = typeof v.getZ === "function" ? v.getZ() : (v.Z || 0);
		const vRot = typeof v.getRotation === "function" ? v.getRotation() : (v.rotation || 0);
		const pRot = typeof p.getRotation === "function" ? p.getRotation() : (p.rotation || 0);

		// If driver or unrotated gunner, follow vehicle rotation; otherwise use gunner rotation
		const rot = (p.vehicleSlot === 0 || p.rotation == null || p.rotation === 0) ? vRot : pRot;
		return { x: vx, y: vy, z: vz, rot: rot };
	}
	return {
		x: typeof p.getX === "function" ? p.getX() : (p.X || 0),
		y: typeof p.getY === "function" ? p.getY() : (p.Y || 0),
		z: typeof p.getZ === "function" ? p.getZ() : (p.Z || 0),
		rot: typeof p.getRotation === "function" ? p.getRotation() : (p.rotation || 0)
	};
}

function drawDynamicLOSVisionCone(p) {
	if (!p) return;
	const pInfo = getPlayerWorldPos(p);
	const worldPx = pInfo.x;
	const worldPz = pInfo.z;
	const worldPy = (pInfo.y !== undefined && !isNaN(pInfo.y) ? pInfo.y : 0) + 1.65;
	const rot = pInfo.rot;

	const px = XtoCanvas(worldPx);
	const py = YtoCanvas(worldPz);
	const rangeM = options_VisionConeRange;
	const halfAngle = options_VisionConeAngle / 2;

	// 64 radial ray slices for ultra-smooth circular profile
	const numSlices = 64;
	const angleStep = options_VisionConeAngle / numSlices;
	const startAngle = rot - halfAngle;

	const polyPoints = [];
	const hasBuildings = (typeof buildingHeightmap !== 'undefined' && buildingHeightmap.initialized && buildingHeightmap.obbs.length > 0);
	const hasTerrain = (typeof heightmap !== 'undefined' && heightmap.initialized && heightmap.heightdataview);

	for (let i = 0; i <= numSlices; i++) {
		const currentAngleDeg = startAngle + i * angleStep;
		const rad = currentAngleDeg / 180 * Math.PI;

		// Correct world direction vector: +X is East, +Z is North
		const dirX = Math.sin(rad);
		const dirZ = Math.cos(rad);

		const targetWorldX = worldPx + dirX * rangeM;
		const targetWorldZ = worldPz + dirZ * rangeM;

		let closestFrac = 1.0;
		let hitWorldX = targetWorldX;
		let hitWorldZ = targetWorldZ;

		// 1. Raycast against 2D building collision boxes / walls
		if (hasBuildings) {
			const bHit = buildingHeightmap.getRayCollision(worldPx, worldPy, worldPz, targetWorldX, worldPy, targetWorldZ, 0);
			if (bHit && bHit.t < closestFrac) {
				closestFrac = bHit.t;
				hitWorldX = bHit.hitX;
				hitWorldZ = bHit.hitZ;
			}
		}

		// 2. Smooth Raymarching against terrain heightmap with continuous sub-meter interpolation
		if (hasTerrain) {
			const maxDist = rangeM * closestFrac;
			const stepM = 3.0;
			const steps = Math.floor(maxDist / stepM);
			let prevDist = 0;
			let prevTerrainH = heightmap.getHeightFromCoords(worldPx, worldPz);

			for (let s = 1; s <= steps; s++) {
				const dist = s * stepM;
				const frac = dist / rangeM;
				if (frac >= closestFrac) break;

				const sampleX = worldPx + dirX * dist;
				const sampleZ = worldPz + dirZ * dist;
				const terrainH = heightmap.getHeightFromCoords(sampleX, sampleZ);

				if (terrainH !== -Infinity && !isNaN(terrainH) && terrainH >= worldPy) {
					// Continuous linear interpolation for sub-meter smoothness (no discrete jumping!)
					const diffCurr = terrainH - worldPy;
					const diffPrev = worldPy - (prevTerrainH !== -Infinity && !isNaN(prevTerrainH) ? prevTerrainH : (worldPy - 0.5));
					const weight = (diffPrev + diffCurr > 0) ? (diffPrev / (diffPrev + diffCurr)) : 0.5;
					const exactDist = prevDist + stepM * weight;

					closestFrac = exactDist / rangeM;
					hitWorldX = worldPx + dirX * exactDist;
					hitWorldZ = worldPz + dirZ * exactDist;
					break;
				}

				prevDist = dist;
				prevTerrainH = terrainH;
			}
		}

		polyPoints.push({
			x: XtoCanvas(hitWorldX),
			y: YtoCanvas(hitWorldZ)
		});
	}

	Context.save();
	Context.beginPath();
	Context.moveTo(px, py);
	for (let i = 0; i < polyPoints.length; i++) {
		Context.lineTo(polyPoints[i].x, polyPoints[i].y);
	}
	Context.closePath();

	Context.fillStyle = "rgba(255, 255, 0, 0.06)";
	Context.strokeStyle = "rgba(255, 220, 0, 0.7)";
	Context.lineWidth = 1;
	Context.fill();
	Context.stroke();
	Context.restore();
}

function drawVisionCone(p) {
	if (options_VisionConeRespectsLOS) {
		drawDynamicLOSVisionCone(p);
		return;
	}

	const pInfo = getPlayerWorldPos(p);
	const x = XtoCanvas(pInfo.x);
	const y = YtoCanvas(pInfo.z);
	const rot = pInfo.rot;
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

function toggleCameraTracking(forceState = null) {
	if (forceState !== null) {
		options_CameraTracking = !!forceState;
	} else {
		options_CameraTracking = !options_CameraTracking;
	}
	const chk = document.getElementById("options_CameraTracking");
	if (chk) chk.checked = options_CameraTracking;
	if (typeof changeSetting === "function") {
		changeSetting("options_CameraTracking", options_CameraTracking);
	}
	requestUpdate();
}

function updateCameraTracking() {
	if (!options_CameraTracking) return;
	if (typeof is3DMode !== 'undefined' && is3DMode) return;
	let worldX = null, worldZ = null;
	if (typeof SelectedPlayer !== 'undefined' && SelectedPlayer != SELECTED_NOTHING && typeof AllPlayers !== "undefined") {
		const p = AllPlayers[SelectedPlayer];
		if (p && !p.isJoining) {
			const pInfo = getPlayerWorldPos(p);
			worldX = pInfo.x;
			worldZ = pInfo.z;
		}
	} else if (typeof SelectedVehicle !== 'undefined' && SelectedVehicle != SELECTED_NOTHING && typeof AllVehicles !== "undefined") {
		const v = AllVehicles[SelectedVehicle];
		if (v) {
			worldX = (typeof v.getX === "function") ? v.getX() : v.X;
			worldZ = (typeof v.getZ === "function") ? v.getZ() : v.Z;
		}
	}
	if (worldX == null || isNaN(worldX) || worldZ == null || isNaN(worldZ)) return;

	// Calculate un-offset zoomed coordinate
	const uX = (worldX / MapSize) + 512;
	const uY = (worldZ / -MapSize) + 512;
	const zX = uX * CameraZoom;
	const zY = uY * CameraZoom;

	const scale = (typeof options_canvasScale !== "undefined" && options_canvasScale > 0) ? options_canvasScale : 1.0;

	// Exact target camera offset accounting for UI scaling
	const targetCameraX = ((Canvas.width / 2) / scale) - zX;
	const targetCameraY = ((Canvas.height / 2) / scale) - zY;

	const dx = targetCameraX - CameraX;
	const dy = targetCameraY - CameraY;

	// Smooth silky glide (0.15 lerp factor)
	if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
		const lerpFactor = 0.15;
		CameraX += dx * lerpFactor;
		CameraY += dy * lerpFactor;
		if (typeof clampCamera === "function") clampCamera();
		requestUpdate();
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
	if (options_DrawSpottedIndicators) {
		try { drawSpottedIndicators(); } catch (e) { console.error("Error in drawSpottedIndicators:", e); }
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
}

function drawLineOfSight(p) {
	const pInfo = getPlayerWorldPos(p);
	const px = XtoCanvas(pInfo.x);
	const py = YtoCanvas(pInfo.z);
	const range = lengthtoCanvas(options_VisionConeRange);
	const [fx, fy] = headingToCanvasVector(pInfo.rot);
	const tx = px + fx * range;
	const ty = py + fy * range;

	let blockedTargetNearLine = false;
	const useTerrain = options_ConeRespectsTerrain && typeof hasTerrainLOS === 'function';

	if (useTerrain) {
		for (var i in AllPlayers) {
			const other = AllPlayers[i];
			if (other === p || other.isJoining || !other.isAlive || other.ns_lastX == null || isNaN(other.ns_lastX)) continue;
			if (!isEnemyOf(p, other)) continue;

			const worldDist = Math.hypot(other.getX() - pInfo.x, other.getZ() - pInfo.z);
			if (worldDist > options_VisionConeRange) continue;

			const angle = angleToTargetDeg(px, py, pInfo.rot, other.getCanvasX(), other.getCanvasY());
			if (angle <= 5) {
				if (!hasTerrainLOS(pInfo.x, pInfo.y, pInfo.z, other.X, other.Y, other.Z)) {
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

	const pInfo = getPlayerWorldPos(p);
	const worldPx = pInfo.x;
	const worldPy = (pInfo.y !== undefined && !isNaN(pInfo.y) ? pInfo.y : 0);
	const worldPz = pInfo.z;
	const rot = pInfo.rot;

	const px = XtoCanvas(worldPx);
	const py = YtoCanvas(worldPz);
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
		const hit = buildingHeightmap.getRayCollision(worldPx, worldPy, worldPz, targetWorldX, worldPy, targetWorldZ, 1.7);
		if (hit) {
			closestFrac = hit.t;
			hitPoint = { x: hit.hitX, z: hit.hitZ };
			hitType = "building";
		}
	}

	if (typeof heightmap !== 'undefined' && heightmap.initialized && heightmap.heightdataview) {
		const eyeY = worldPy + 1.7;
		const rayDx = targetWorldX - worldPx;
		const rayDz = targetWorldZ - worldPz;
		const totalDist = Math.hypot(rayDx, rayDz);

		if (totalDist > 0) {
			const stepM = 4.0;
			const maxSteps = Math.floor((totalDist * closestFrac) / stepM);
			for (let s = 1; s <= maxSteps; s++) {
				const frac = (s * stepM) / totalDist;
				if (frac >= closestFrac) break;
				const sampleX = worldPx + rayDx * frac;
				const sampleZ = worldPz + rayDz * frac;
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

	// Render compact tactical Spotted indicators on 2D map (same slow 4-arc segmented reticle as 3D)
	const nowSec = performance.now() * 0.001;
	const rotRad = nowSec * 0.28; // Calm, slow rotation (~22s/rev)
	const pulse = (0.5 + 0.5 * Math.sin(nowSec * 1.1)) * 1.4; // Gentle slow breath (~5.7s cycle)
	const pRadius = typeof PlayerCircleSize !== 'undefined' ? PlayerCircleSize : 8;

	const renderSpottedBadge = (x, y, radius, title) => {
		if (x == null || y == null || isNaN(x) || isNaN(y)) return;
		Context.save();
		// 4-arc segmented tactical reticle (identical shape & cadence to 3D)
		const arcCount = 4;
		const arcSpan = (Math.PI * 2) / arcCount;
		const drawSpan = arcSpan * 0.62;
		const rCur = radius + pulse;
		Context.strokeStyle = "rgba(209, 77, 77, 0.85)";
		Context.lineWidth = 1.5;
		for (let k = 0; k < arcCount; k++) {
			const a0 = rotRad + k * arcSpan - drawSpan * 0.5;
			Context.beginPath();
			Context.arc(x, y, rCur, a0, a0 + drawSpan);
			Context.stroke();
		}

		// Compact dark HUD pill
		Context.font = "bold 7.5px Arial, sans-serif";
		const label = "SPOTTED";
		const tw = Context.measureText(label).width;
		const padX = 3;
		const pillW = tw + padX * 2;
		const pillH = 10;
		const pillX = Math.round(x - pillW * 0.5);
		const pillY = Math.round(y - rCur - pillH - 2);

		Context.fillStyle = "rgba(23, 35, 34, 0.88)";
		Context.fillRect(pillX, pillY, pillW, pillH);
		Context.strokeStyle = "#c94a4a";
		Context.lineWidth = 0.85;
		Context.strokeRect(pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1);

		Context.fillStyle = "#f2b8b8";
		Context.textAlign = "center";
		Context.textBaseline = "middle";
		Context.fillText(label, Math.round(x), pillY + pillH * 0.5 + 0.5);
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

var _mapViewDistancesLoaded = false;

function loadDynamicMapViewDistances() {
	if (_mapViewDistancesLoaded || typeof fetch !== "function") return;
	_mapViewDistancesLoaded = true;

	fetch("map_fog_view_data.json")
		.then(r => (r && r.ok) ? r.json() : null)
		.then(data => {
			if (data && typeof data === "object") {
				for (const [k, info] of Object.entries(data)) {
					if (!info || typeof info !== "object") continue;
					const fogEnd = Number(info.fog_end);
					const maxView = Number(info.max_view);
					let eff = NaN;
					if (!isNaN(fogEnd) && fogEnd > 0 && !isNaN(maxView) && maxView > 0) {
						eff = Math.min(fogEnd, maxView);
					} else if (!isNaN(maxView) && maxView > 0) {
						eff = maxView;
					} else if (!isNaN(fogEnd) && fogEnd > 0) {
						eff = fogEnd;
					}
					if (!isNaN(eff) && eff > 0) {
						MAP_VIEW_DISTANCES[k.toLowerCase()] = eff;
					}
				}
				if (typeof MapName !== "undefined" && MapName && typeof updateAnalyserSliderLabels === "function") {
					try { updateAnalyserSliderLabels(); } catch (e) {}
				}
				return true;
			}
			return false;
		})
		.catch(() => false)
		.then(ok => {
			if (ok) return;
			return fetch("view_distances.txt")
				.then(r => (r && r.ok) ? r.text() : "")
				.then(txt => {
					if (!txt) return;
					for (const line of txt.split(/\r?\n/)) {
						const parts = line.trim().split(/\s+/);
						if (parts.length >= 2) {
							const dist = Number(parts[1]);
							const key = parts[0].toLowerCase();
							if (!isNaN(dist) && dist > 0 && !(key in MAP_VIEW_DISTANCES)) {
								MAP_VIEW_DISTANCES[key] = dist;
							}
						}
					}
					if (typeof MapName !== "undefined" && MapName && typeof updateAnalyserSliderLabels === "function") {
						try { updateAnalyserSliderLabels(); } catch (e) {}
					}
				})
				.catch(() => {});
		});
}

// Computes the exact physical distance (meters) where Project Reality's Ra_GetFogValue
// reaches opaque fog (<= 0.5% visibility), capped by MaximumLevelViewDistance.
function computeEffectiveFogVisibility(fogParams, viewDist) {
	if (!Array.isArray(fogParams) || fogParams.length < 4) {
		return (typeof viewDist === "number" && viewDist > 0) ? Math.round(viewDist) : null;
	}
	const f0 = Number(fogParams[0]) || 0.0;
	const f1 = Math.max(f0 + 1.0, Number(fogParams[1]) || 700.0);
	const f2 = Math.max(0.0, Number(fogParams[2]) || 0.0);
	const f3 = Math.max(0.0, Math.min(1.0, Number(fogParams[3]) || 0.0));
	const span = Math.max(1.0, f1 - f0);
	const visAt = (d) => {
		const t = (d - f0) / span;
		const closeFog = Math.max(1.0 - f2 * t, f3);
		const fx = Math.max(0.0, t);
		const x = Math.max(0.0, Math.min(1.0, closeFog - fx * fx * fx));
		return x * x * (3.0 - 2.0 * x);
	};
	const threshold = 0.00500073; // 99.5% fogged = silhouette no longer visible
	let lo = 0.0;
	let hi = Math.max(f1, (typeof viewDist === "number" && viewDist > 0) ? viewDist : f1);
	if (visAt(hi) <= threshold) {
		for (let i = 0; i < 32; i++) {
			const mid = 0.5 * (lo + hi);
			if (visAt(mid) > threshold) lo = mid;
			else hi = mid;
		}
	}
	let eff = hi;
	if (typeof viewDist === "number" && viewDist > 0) {
		eff = Math.min(eff, viewDist);
	}
	return Math.max(50, Math.round(eff));
}

function getEffectiveMapViewDistance(mapName) {
	const key = mapName ? String(mapName).toLowerCase() : "";
	if (key && typeof SKY_DB !== "undefined" && SKY_DB && SKY_DB[key]) {
		const entry = SKY_DB[key];
		const mode = (typeof GameMode !== "undefined" && GameMode) ? String(GameMode).toLowerCase() : "";
		const layer = (typeof Layer !== "undefined" && Layer != null) ? String(Layer) : "";
		const layerOv = (entry.layers && mode && layer) ? (entry.layers[mode + ":" + layer] || entry.layers[mode + ":*"]) : null;
		const fp = (layerOv && Array.isArray(layerOv.fogParams)) ? layerOv.fogParams : entry.fogParams;
		const vd = (layerOv && typeof layerOv.viewDist === "number") ? layerOv.viewDist : entry.viewDist;
		const eff = computeEffectiveFogVisibility(fp, vd);
		if (eff !== null && !isNaN(eff)) return eff;
	}
	if (key && (key in MAP_VIEW_DISTANCES)) {
		return MAP_VIEW_DISTANCES[key];
	}
	return null;
}

function applyMapDefaultViewDistance(mapName) {
	if (!mapName) return;
	window._userEditedConeRange = false;
	loadDynamicMapViewDistances();
	const rangeVal = getEffectiveMapViewDistance(mapName);
	if (rangeVal !== null && !isNaN(rangeVal) && typeof syncConeRangeSlider === "function") {
		syncConeRangeSlider(rangeVal, false, false);
	}
}

loadDynamicMapViewDistances();

function syncConeRangeSlider(val, skipUpdate, isUserInput = true) {
	let num = parseFloat(val);
	if (isNaN(num)) return;
	if (isUserInput && !skipUpdate) {
		window._userEditedConeRange = true;
	}
	num = Math.max(50, Math.min(4000, Math.round(num)));
	options_VisionConeRange = num;

	const slider = document.getElementById("options_VisionConeRange");
	if (slider && parseFloat(slider.value) !== num) slider.value = num;

	const valSpan = document.getElementById("lblConeRangeVal");
	if (valSpan) {
		const prefix = (typeof ANALYSER_I18N !== "undefined" && ANALYSER_I18N[currentAnalyserLang] && ANALYSER_I18N[currentAnalyserLang].coneRangePrefix) || "Cone Range";
		valSpan.textContent = `${prefix} ${num}m`;
	}

	if (!skipUpdate && typeof requestUpdate === "function") requestUpdate();
}

function resetConeRangeToMapDefault() {
	window._userEditedConeRange = false;
	let mapKey = "";
	if (typeof MapName !== "undefined" && MapName) {
		mapKey = MapName.toLowerCase();
	} else if (typeof ServerName !== "undefined" && ServerName) {
		mapKey = ServerName.toLowerCase();
	}
	const defaultDist = getEffectiveMapViewDistance(mapKey) || 500;
	syncConeRangeSlider(defaultDist, false, false);
}

function updateAnalyserSliderLabels(skipRangeSync) {
	let mapKey = "";
	if (typeof MapName !== "undefined" && MapName) {
		mapKey = MapName.toLowerCase();
	} else if (typeof ServerName !== "undefined" && ServerName) {
		mapKey = ServerName.toLowerCase();
	}

	const dist = getEffectiveMapViewDistance(mapKey) || 500;
	const titleName = mapKey ? mapKey.charAt(0).toUpperCase() + mapKey.slice(1) : "Default";

	const textSpan = document.getElementById("valMapViewRangeText");
	if (textSpan) {
		if (currentAnalyserLang === "ES") {
			textSpan.textContent = `Rango de visi\u00f3n del mapa: ${dist}m`;
		} else if (currentAnalyserLang === "PT") {
			textSpan.textContent = `Alcance de vis\u00e3o do mapa: ${dist}m`;
		} else {
			textSpan.textContent = `Map View Range (${titleName}): ${dist}m`;
		}
		const container = document.getElementById("mapViewRangeContainer");
		if (container) container.style.display = "block";
	}

	// Update Reaction Zone range text indicator below View range
	const timerRadius = typeof getAdaptiveFlankRadius === "function" ? getAdaptiveFlankRadius() : 100;
	let mapScaleStr = "2km";
	if (timerRadius === 50) mapScaleStr = "1km";
	else if (timerRadius === 150) mapScaleStr = "4km+";

	const timerTextSpan = document.getElementById("valEngagementTimerRangeText");
	if (timerTextSpan) {
		if (currentAnalyserLang === "ES") {
			timerTextSpan.textContent = `Zona de reacci\u00f3n: ${timerRadius}m (mapa ${mapScaleStr})`;
		} else if (currentAnalyserLang === "PT") {
			timerTextSpan.textContent = `Zona de rea\u00e7\u00e3o: ${timerRadius}m (mapa ${mapScaleStr})`;
		} else {
			timerTextSpan.textContent = `Reaction Zone: ${timerRadius}m (${mapScaleStr} map)`;
		}
		const timerContainer = document.getElementById("engagementTimerRangeContainer");
		if (timerContainer) timerContainer.style.display = "block";
	}

	// Synchronize options_VisionConeRange and both UI controls to the map's view distance unless edited by user
	if (!skipRangeSync && !window._userEditedConeRange && typeof syncConeRangeSlider === "function") {
		syncConeRangeSlider(dist, false, false);
	}
}

// Multi-Language Switcher for HUD & Demo Analyser (EN, ES, PT)
var currentAnalyserLang = (typeof localStorage !== "undefined" && localStorage.getItem("rt_hud_lang")) || "EN";

var ANALYSER_I18N = {
	EN: {
		mode3dBtnFree: "3D FREE",
		mode3dBtnTop: "3D TOP",
		mode2dTitle: "Viewport: 2D Map \u2014 Click or press [G] for 3D Free Camera",
		mode3dFreeTitle: "Viewport: 3D Free Camera \u2014 Click or press [G] for 3D Top-Down",
		mode3dTopTitle: "Viewport: 3D Top-Down \u2014 Click or press [G] to return to 2D Map",
		mode2dToast: "2D Map",
		mode3dFreeToast: "3D Free Camera",
		mode3dTopToast: "3D Top-Down",
		copyLinkTitle: "Copy link with timestamp",
		bookmarksTitle: "Bookmarks",
		menuMapTitle: "Map & HUD Options",
		menu3DTitle: "3D Visuals & Textures",
		menuAnalyserTitle: "Demo Analyser & Tools",
		mapMenuTitle: "Map & HUD Options",
		secMapLayers: "Map Layers",
		secUnits: "Units & Health",
		secPlayback: "Playback & Scale",
		uiScaleTitle: "UI Scale",
		menu3dTitle: "3D Visuals",
		hint2dOnly: "Applies in 3D view",
		btnSwitch3d: "Switch to 3D",
		sec3dTerrain: "Terrain & Sky",
		sec3dStructures: "Structures & Units",
		sec3dLighting: "Lighting & Shadows",
		ssaoQualTitle: "AO Quality",
		ssaoQualTip: "Controls SSAO resolution and sample count. Full-res Balanced/High gives much sharper contact shadows.",
		aaTitle: "Anti-Aliasing",
		aaTip: "Smooths jagged 3D edges. Ordered from highest performance (Off / FXAA) to highest quality (MSAA 4x / MSAA + FXAA).",
		lodDistTitle: "Detail Distance",
		lodDistTip: "Sets how far detailed buildings and small props are drawn (Very Low to Ultra) to balance visual detail and FPS.",
		lodDistPresets: ["Very Low", "Low", "Balanced", "High", "Ultra"],
		mapViewRangeTip: "Effective visibility distance calculated from the active map and layer's authentic PR fog preset and max view distance.",
		reactionZoneTip: "Adaptive reaction zone radius based on map size: 50m for 1km maps, 100m for 2km maps, 150m for 4km/8km maps.",
		structureColorsHint: "Solid color by type, or tints textures when Building Textures is ON.",
		sec3dControls: "3D Controls",
		ctrlMove: "Move",
		ctrlVert: "Up / Down",
		ctrlZoomKey: "V (+ Wheel)",
		ctrlZoom: "Optical Zoom",
		ctrlBoost: "Boost",
		ctrlCycle: "Cycle 2D / 3D",
		header: "Demo Analyser",
		toolsHeader: "Map Inspection",
		tabVision: "Vision & Aim",
		tabTactical: "Tactical & Audio",
		tabDebug: "Clip & Map",
		secTacIntel: "Intel & Timers",
		secTacAudio: "Audio & Movement",
		secTacCam: "Camera & Visibility",
		secClipRec: "Clip Recorder",
		clipFpsLabel: "Framerate:",
		clipFmtLabel: "Format:",
		clipBitrateLabel: "Bitrate:",
		coneRangePrefix: "Vision Range",
		coneRangeLabel: "Vision Range:",
		cameraSpeedPrefix: "3D Camera Speed:",
		resetConeBtnText: "Default",
		resetConeBtnTitle: "Reset Vision Range to map's default view range",
		bvrBtnText: "Focus List",
		bvrBtnTitle: "View long-range aiming focus leaderboard for all players",
		bvrModalTitle: "Long-Range Aim Focus List",
		bvrModeIndividual: "Individual",
		bvrModeCumulative: "Cumulative",
		bvrModalClose: "Close",
		bvrNoData: "No telemetry data available.",
		bvrSubIndividual: "Max Continuous Burst",
		bvrSubCumulative: "Cumulative Match Focus",
		bvrRankingPrefix: "Aim Focus Leaderboard",
		bvrTotalPlayers: "Total:",
		bvrPlayersWord: "players",
		bvrHintText: 'Click "Select" to focus on map',
		bvrColRank: "#",
		bvrColPlayer: "Player",
		bvrColTeam: "Team",
		bvrColTimeMax: "Max Focus Time",
		bvrColTimeTotal: "Total Cumulative Time",
		bvrColAction: "Action",
		bvrTeam1: "Team 1",
		bvrTeam2: "Team 2",
		bvrTeamSpectator: "Spectator",
		bvrBtnSelect: "Select",
		timeline: {
			tracksLabel: "Tracks:",
			zoomLabel: "Zoom:",
			prev: "Prev",
			next: "Next",
			tickets: "Tickets",
			flags: "Flags",
			fobs: "FOBs",
			caches: "Caches",
			vehs: "Vehicles",
			bookmarks: "Bookmarks",
			marksBtn: "Marks",
			selected: "Selected",
			full: "Full",
			loopIn: "[In A",
			loopOut: "Out B]",
			clear: "Clear",
			selectHint: "Select a player or squad to view Kills, Deaths & Revives"
		},
		opts: {
			options_DrawDOD: { label: "DOD", title: "Draw DOD (out-of-bounds / restricted) areas on the map" },
			options_DrawFlagRadius: { label: "Flag Capture Radius", title: "Draw capture radius circles around flags" },
			options_DrawKillLines: { label: "Kill Lines", title: "Draw arrows between attacker and victim on kills" },
			options_drawAllOrderIcons: { label: "Squad Orders", title: "Show squad leader orders on the map" },
			options_DrawEmptyVehicles: { label: "Empty Vehicles", title: "Show unoccupied vehicles" },
			options_DrawKitIcons: { label: "Unit & Kit Icons", title: "Show player kit icons and vehicle icons" },
			options_health_vehicles: { label: "Vehicle Health", title: "Show health bars under vehicles" },
			options_health_players: { label: "Player Health", title: "Show health bars under players" },
			options_ClampVehiclesToMap: { label: "Keep Off-Map Vehicles Visible", title: "Keep out-of-bounds vehicles pinned to the 2D map edges" },
			options_DrawVehicleHeight: { label: "Aircraft Altitude", title: "Display altitude above helicopters and jets" },
			options_Interpolation: { label: "Smooth Movement", title: "Smoothly interpolates positions and angles between server ticks. Turn off to inspect raw server frames." },
			options_UseFallbackRenderer: { label: "Classic 2D Map", title: "Uses the legacy single-image 2D map instead of tiled zoom atlas." },
			options_RealTerrain: { label: "Terrain Textures", title: "Uses baked 3D lighting & colormap terrain textures instead of the 2D minimap." },
			options_TerrainDetail: { label: "Ground Detail Textures", title: "Requires Terrain Textures. Adds close-range high-res ground detail." },
			options_DrawSkybox: { label: "Sky Dome", title: "Renders the map and layer's authentic atmospheric sky dome (day, night, overcast, or storm) blended with horizon fog." },
			options_3dFog: { label: "Fog", title: "Applies Project Reality distance fog matching each map and layer preset." },
			options_3dFogOnPlayer: { label: "Center Fog on Player", title: "Requires Fog. Centers the fog visibility sphere on the selected player instead of the camera so you can see their exact visibility radius." },
			options_StructureTextures: { label: "Building Textures", title: "Loads authentic game building textures and high-detail meshes." },
			options_LodFade: { label: "Smooth Distance Fade", title: "Requires Building Textures. Smoothly fades building detail transitions and small props instead of hard pop-in." },
			options_TreeTextures: { label: "Tree Textures", title: "Loads bark and leaf cutout textures for trees (higher GPU cost in dense forests)." },
			options_BushTextures: { label: "Detailed Bushes", title: "Renders authentic PR textured bushes when close, instead of lightweight volumetric bushes." },
			options_StructureColors: { label: "Color by Building Type", title: "Assigns each building template a consistent distinct color. When Building Textures is ON, tints textures with that color." },
			options_FactionTextures: { label: "Soldier & Vehicle Textures", title: "Loads authentic PR faction soldier & vehicle textures in 3D." },
			options_3dShadows: { label: "Dynamic Shadows", title: "Real-time directional sun shadows aligned with each map's sun direction." },
			options_3dAoSsao: { label: "Ambient Occlusion", title: "Combines baked building Vertex AO with real-time screen-space ambient occlusion (SSAO)." },
			options_DrawVisionCone: {
				label: "Vision Cone",
				title: "Draws the selected player's field of view cone (94.9 deg horizontal FOV), calibrated to the map's visibility distance and respecting fog in 3D."
			},
			options_VisionConeRespectsLOS: {
				label: "Block by Walls & Terrain",
				title: "Clips the vision cone dynamically against building walls and terrain hills."
			},
			options_DrawThreatLasers: {
				label: "Aim & Threat Lines",
				title: "Draws the player's aim line (turns red when aiming at a covered enemy) and orange lines to visible enemies inside the vision cone."
			},
			options_ConeRespectsTerrain: {
				label: "Check Wall & Terrain Cover",
				title: "Checks terrain and building cover for Aim & Threat Lines and Reaction Timer."
			},
			options_DrawBVRLaser: {
				label: "Long-Range Aim Line",
				title: "Extends the aim line beyond the map's view range/fog distance to analyze focus on distant targets."
			},
			options_DrawSpottedIndicators: {
				label: "Spotted Targets",
				title: "Highlights enemy FOBs, players, and vehicles marked by squad leader orders."
			},
			options_DrawFlankChronometer: {
				label: "Reaction Timer",
				title: "Creates a radius zone around the selected player and shows a timer in seconds above nearby enemies to measure reaction time."
			},
			options_DrawMovementSoundAuras: {
				label: "Footstep & Engine Range",
				title: "Draws a dynamic sound radius around the selected player or vehicle that expands and fades smoothly with movement speed, stance, or engine activity."
			},
			options_DrawShootingSoundShockwaves: {
				label: "Heavy Weapon Sound Waves",
				title: "Displays expanding sound waves for heavy weapons and projectiles fired by the selected player or vehicle (AT launchers, autocannons, tanks, mortars, and artillery)."
			},
			options_ShowSelectionSpeed: {
				label: "Show Speed & Stance",
				title: "Shows real-time speed (km/h) and estimated stance or engine sound state for the selected unit in the Selection window and 2D sound rings."
			},
			options_CameraTracking: {
				label: "Follow Selected [T]",
				title: "Smoothly follows the selected player or vehicle with the camera in 2D and 3D. Press 'T' to toggle."
			},
			options_DrawBuildingWireframes: {
				label: "Building Outlines",
				title: "Shows 2D vector outlines of buildings and walls extracted from the game's 3D collision meshes."
			},
			options_DrawHeightmapOverlay: {
				label: "Elevation Map",
				title: "Overlays a colorized terrain elevation grid on the 2D map."
			},
			options_Draw4KmLaser: {
				label: "Direct Sight Ray (4km)",
				title: "Projects an independent 4km sight ray from the selected unit that stops at exact building walls and terrain hills."
			},
			options_VisionConeXRay: {
				label: "Show Through Walls",
				title: "Renders the 3D vision cone visible through walls and terrain geometry."
			},
			options_Wallhack: {
				label: "X-Ray Units",
				title: "Shows occluded parts of soldiers, vehicles, deployables, and FOBs as team-colored silhouettes through walls and terrain in 3D."
			}
		}
	},
	ES: {
		mode3dBtnFree: "3D LIBRE",
		mode3dBtnTop: "3D CENIT",
		mode2dTitle: "Vista: Mapa 2D \u2014 Clic o pulsa [G] para C\u00e1mara Libre 3D",
		mode3dFreeTitle: "Vista: C\u00e1mara Libre 3D \u2014 Clic o pulsa [G] para Vista Cenital 3D",
		mode3dTopTitle: "Vista: Vista Cenital 3D \u2014 Clic o pulsa [G] para volver al Mapa 2D",
		mode2dToast: "Mapa 2D",
		mode3dFreeToast: "C\u00e1mara Libre 3D",
		mode3dTopToast: "Vista Cenital 3D",
		copyLinkTitle: "Copiar enlace con marca de tiempo",
		bookmarksTitle: "Marcadores",
		menuMapTitle: "Opciones de Mapa y HUD",
		menu3DTitle: "Gr\u00e1ficos y Texturas 3D",
		menuAnalyserTitle: "Demo Analyser y Herramientas",
		mapMenuTitle: "Mapa y HUD",
		secMapLayers: "Capas del Mapa",
		secUnits: "Unidades y Salud",
		secPlayback: "Reproducci\u00f3n y Escala",
		uiScaleTitle: "Escala de Interfaz",
		menu3dTitle: "Gr\u00e1ficos 3D",
		hint2dOnly: "Aplica en vista 3D",
		btnSwitch3d: "Activar 3D",
		sec3dTerrain: "Terreno y Cielo",
		sec3dStructures: "Estructuras y Unidades",
		sec3dLighting: "Iluminaci\u00f3n y Sombras",
		ssaoQualTitle: "Calidad de AO",
		ssaoQualTip: "Controla la resoluci\u00f3n y muestras de SSAO. En Balanced/High (resoluci\u00f3n completa) elimina el difuminado en sombras de contacto.",
		aaTitle: "Anti-Aliasing",
		aaTip: "Suaviza los bordes dentados en 3D. Ordenado de mayor rendimiento (Off / FXAA) a mayor calidad (MSAA 4x / MSAA + FXAA).",
		lodDistTitle: "Distancia de Detalle",
		lodDistTip: "Define la distancia de dibujado de edificios detallados y objetos peque\u00f1os (Muy Bajo a Ultra) para equilibrar detalle visual y FPS.",
		lodDistPresets: ["Muy Bajo", "Bajo", "Medio", "Alto", "Ultra"],
		mapViewRangeTip: "Alcance visual efectivo calculado a partir del preset real de niebla y distancia m\u00e1xima de visi\u00f3n de PR para el mapa y capa activos.",
		reactionZoneTip: "Radio adaptativo de la zona de reacci\u00f3n seg\u00fan el tama\u00f1o del mapa: 50m en mapas de 1km, 100m en 2km y 150m en 4km/8km.",
		structureColorsHint: "Color s\u00f3lido por tipo, o ti\u00f1e texturas si Texturas de Edificios est\u00e1 activo.",
		sec3dControls: "Controles 3D",
		ctrlMove: "Mover",
		ctrlVert: "Subir / Bajar",
		ctrlZoomKey: "V (+ Rueda)",
		ctrlZoom: "Zoom \u00d3ptico",
		ctrlBoost: "Impulso",
		ctrlCycle: "Alternar 2D / 3D",
		header: "Demo Analyser",
		toolsHeader: "Inspecci\u00f3n de Mapa",
		tabVision: "Visi\u00f3n y Mira",
		tabTactical: "T\u00e1ctica y Audio",
		tabDebug: "Clips y Mapa",
		secTacIntel: "Inteligencia y Tiempos",
		secTacAudio: "Audio y Movimiento",
		secTacCam: "C\u00e1mara y Visibilidad",
		secClipRec: "Grabador de Clips",
		clipFpsLabel: "FPS:",
		clipFmtLabel: "Formato:",
		clipBitrateLabel: "Bitrate:",
		coneRangePrefix: "Alcance de Visi\u00f3n",
		coneRangeLabel: "Alcance de Visi\u00f3n:",
		cameraSpeedPrefix: "Velocidad C\u00e1mara 3D:",
		resetConeBtnText: "Defecto",
		resetConeBtnTitle: "Restablecer al rango de visi\u00f3n predeterminado del mapa",
		bvrBtnText: "Lista Enfoque",
		bvrBtnTitle: "Ver escalaf\u00f3n de tiempos de enfoque a larga distancia de todos los jugadores",
		bvrModalTitle: "Lista de Enfoque a Larga Distancia",
		bvrModeIndividual: "Individual",
		bvrModeCumulative: "Acumulado",
		bvrModalClose: "Cerrar",
		bvrNoData: "No hay datos de telemetr\u00eda disponibles.",
		bvrSubIndividual: "R\u00e1faga M\u00e1xima Continua",
		bvrSubCumulative: "Enfoque Acumulado en la Partida",
		bvrRankingPrefix: "Escalaf\u00f3n de Enfoque",
		bvrTotalPlayers: "Total:",
		bvrPlayersWord: "jugadores",
		bvrHintText: 'Haz clic en "Seleccionar" para centrar en el mapa',
		bvrColRank: "#",
		bvrColPlayer: "Jugador",
		bvrColTeam: "Bando",
		bvrColTimeMax: "Tiempo Max. Enfoque",
		bvrColTimeTotal: "Tiempo Total Acumulado",
		bvrColAction: "Acci\u00f3n",
		bvrTeam1: "Equipo 1",
		bvrTeam2: "Equipo 2",
		bvrTeamSpectator: "Espectador",
		bvrBtnSelect: "Seleccionar",
		timeline: {
			tracksLabel: "Pistas:",
			zoomLabel: "Zoom:",
			prev: "Ant.",
			next: "Sig.",
			tickets: "Tickets",
			flags: "Banderas",
			fobs: "FOBs",
			caches: "Caches",
			vehs: "Veh\u00edculos",
			bookmarks: "Marcadores",
			marksBtn: "Marcas",
			selected: "Selecci\u00f3n",
			full: "Todo",
			loopIn: "[Inicio A",
			loopOut: "Fin B]",
			clear: "Limpiar",
			selectHint: "Selecciona un jugador o escuadra para ver Bajas, Muertes y Reanimaciones"
		},
		opts: {
			options_DrawDOD: { label: "DOD", title: "Mostrar zonas DOD (fuera de combate) en el mapa" },
			options_DrawFlagRadius: { label: "Radio de Captura", title: "Mostrar radio de captura alrededor de las banderas" },
			options_DrawKillLines: { label: "L\u00edneas de Bajas", title: "Dibujar flechas entre atacante y v\u00edctima" },
			options_drawAllOrderIcons: { label: "\u00d3rdenes de Escuadra", title: "Mostrar \u00f3rdenes de l\u00edderes de escuadra en el mapa" },
			options_DrawEmptyVehicles: { label: "Veh\u00edculos Vac\u00edos", title: "Mostrar veh\u00edculos sin ocupantes" },
			options_DrawKitIcons: { label: "Iconos de Kits y Veh\u00edculos", title: "Mostrar iconos de kits e iconos de veh\u00edculos" },
			options_health_vehicles: { label: "Salud de Veh\u00edculos", title: "Mostrar barra de vida bajo los veh\u00edculos" },
			options_health_players: { label: "Salud de Jugadores", title: "Mostrar barra de vida bajo los jugadores" },
			options_ClampVehiclesToMap: { label: "Fijar Veh\u00edculos al Borde", title: "Mantener veh\u00edculos fuera del mapa visibles en el borde 2D" },
			options_DrawVehicleHeight: { label: "Altitud de Aeronaves", title: "Mostrar altitud sobre helic\u00f3pteros y aviones" },
			options_Interpolation: { label: "Movimiento Suave", title: "Interpola posiciones y \u00e1ngulos suavemente entre ticks del servidor. Desact\u00edvalo para inspeccionar frames puros." },
			options_UseFallbackRenderer: { label: "Mapa 2D Cl\u00e1sico", title: "Usa el mapa 2D cl\u00e1sico de imagen \u00fanica en lugar del atlas de tiles." },
			options_RealTerrain: { label: "Texturas del Terreno", title: "Usa las texturas e iluminaci\u00f3n 3D del juego en lugar del minimapa 2D." },
			options_TerrainDetail: { label: "Detalle del Suelo", title: "Requiere Texturas del Terreno. A\u00f1ade texturas de suelo de alta resoluci\u00f3n a corta distancia." },
			options_DrawSkybox: { label: "Cielo Atmosf\u00e9rico", title: "Renderiza el domo atmosf\u00e9rico aut\u00e9ntico del mapa y capa (d\u00eda, noche, nublado o tormenta) integrado con la niebla del horizonte." },
			options_3dFog: { label: "Niebla", title: "Aplica la niebla de distancia de Project Reality seg\u00fan el mapa y la capa." },
			options_3dFogOnPlayer: { label: "Centrar Niebla en Jugador", title: "Requiere Niebla. Centra la esfera de visibilidad de la niebla en el jugador seleccionado en lugar de la c\u00e1mara para ver su radio exacto de visi\u00f3n." },
			options_StructureTextures: { label: "Texturas de Edificios", title: "Carga las texturas reales de edificios y mallas de alto detalle." },
			options_LodFade: { label: "Transici\u00f3n Suave (Fade)", title: "Requiere Texturas de Edificios. Suaviza las transiciones de detalle y objetos peque\u00f1os evitando el pop-in brusco." },
			options_TreeTextures: { label: "Texturas de \u00c1rboles", title: "Carga texturas de corteza y hojas para los \u00e1rboles (mayor carga de GPU en bosques densos)." },
			options_BushTextures: { label: "Arbustos Detallados", title: "Renderiza arbustos 3D con texturas reales de cerca, en lugar de arbustos volum\u00e9tricos ligeros." },
			options_StructureColors: { label: "Colorear por Tipo de Edificio", title: "Asigna un color consistente a cada tipo de edificio. Con Texturas activas, aplica tinte de color." },
			options_FactionTextures: { label: "Texturas de Soldados y Veh\u00edculos", title: "Carga modelos y texturas reales de soldados y veh\u00edculos de PR en 3D." },
			options_3dShadows: { label: "Sombras Din\u00e1micas", title: "Sombras direccionales en tiempo real alineadas con la direcci\u00f3n real del sol de cada mapa." },
			options_3dAoSsao: { label: "Oclusi\u00f3n Ambiental (AO)", title: "Combina Vertex AO cocinado en edificios con oclusi\u00f3n ambiental en tiempo real (SSAO)." },
			options_DrawVisionCone: {
				label: "Cono de Visi\u00f3n",
				title: "Proyecta el cono del campo de visi\u00f3n del jugador seleccionado (94.9 grados FOV horizontal), calibrado al alcance visual del mapa y respetando la niebla en 3D."
			},
			options_VisionConeRespectsLOS: {
				label: "Bloqueo por Muros y Terreno",
				title: "Recorta en tiempo real la geometr\u00eda del cono de visi\u00f3n (2D y 3D) contra muros de edificios y colinas."
			},
			options_DrawThreatLasers: {
				label: "L\u00edneas de Mira y Amenaza",
				title: "Dibuja la l\u00ednea azul de la mirada del jugador (pasa a rojo si apunta tras cobertura) y l\u00edneas naranjas hacia enemigos visibles en su cono."
			},
			options_ConeRespectsTerrain: {
				label: "Comprobar Cobertura",
				title: "Comprueba el bloqueo por terreno y edificios en L\u00edneas de Mira y Amenaza y en Tiempo de Reacci\u00f3n."
			},
			options_DrawBVRLaser: {
				label: "Mira a Larga Distancia",
				title: "Extiende la l\u00ednea de mira m\u00e1s all\u00e1 del alcance visual/niebla del mapa para analizar el enfoque hacia objetivos lejanos."
			},
			options_DrawSpottedIndicators: {
				label: "Objetivos Marcados",
				title: "Resalta FOBs, tropas y veh\u00edculos enemigos marcados por las \u00f3rdenes del l\u00edder de escuadra."
			},
			options_DrawFlankChronometer: {
				label: "Tiempo de Reacci\u00f3n",
				title: "Crea una zona alrededor del jugador y mide en segundos su tiempo de respuesta tras detectar a un enemigo cercano."
			},
			options_DrawMovementSoundAuras: {
				label: "Radio de Pasos y Motores",
				title: "Dibuja un radio de sonido din\u00e1mico alrededor del jugador o veh\u00edculo seleccionado que se expande y disipa seg\u00fan su velocidad, postura o motor."
			},
			options_DrawShootingSoundShockwaves: {
				label: "Ondas de Armas Pesadas",
				title: "Muestra ondas ac\u00fasticas expansivas de armas pesadas y proyectiles disparados por el jugador o veh\u00edculo seleccionado (lanzadores AT, ca\u00f1ones autom\u00e1ticos, tanques, morteros y artiller\u00eda)."
			},
			options_ShowSelectionSpeed: {
				label: "Mostrar Velocidad y Postura",
				title: "Muestra la velocidad en tiempo real (km/h) y el estado estimado de postura o motor de la unidad seleccionada en la ventana Selection y en los radios 2D."
			},
			options_CameraTracking: {
				label: "Seguir Selecci\u00f3n [T]",
				title: "Sigue fluidamente al jugador o veh\u00edculo seleccionado con la c\u00e1mara en 2D y 3D. Pulsa 'T' para activar o desactivar."
			},
			options_DrawBuildingWireframes: {
				label: "Contornos de Edificios",
				title: "Muestra el contorno vectorial 2D de edificios y muros extra\u00eddos de las mallas 3D del juego."
			},
			options_DrawHeightmapOverlay: {
				label: "Mapa de Elevaci\u00f3n",
				title: "Superpone una cuadr\u00edcula coloreada con las alturas del relieve sobre el mapa 2D."
			},
			options_Draw4KmLaser: {
				label: "Rayo de Visi\u00f3n Directa (4km)",
				title: "Lanza un rayo independiente de hasta 4km en la direcci\u00f3n exacta de la mira que se detiene en edificios y colinas."
			},
			options_VisionConeXRay: {
				label: "Ver a Trav\u00e9s de Muros",
				title: "Dibuja el cono de visi\u00f3n 3D visible a trav\u00e9s de muros y terreno."
			},
			options_Wallhack: {
				label: "Rayos X de Unidades",
				title: "Muestra las partes ocultas de soldados, veh\u00edculos y FOBs como siluetas del color del equipo a trav\u00e9s de muros y terreno en 3D."
			}
		}
	},
	PT: {
		mode3dBtnFree: "3D LIVRE",
		mode3dBtnTop: "3D TOPO",
		mode2dTitle: "Vis\u00e3o: Mapa 2D \u2014 Clique ou pressione [G] para C\u00e2mera Livre 3D",
		mode3dFreeTitle: "Vis\u00e3o: C\u00e2mera Livre 3D \u2014 Clique ou pressione [G] para Vis\u00e3o Superior 3D",
		mode3dTopTitle: "Vis\u00e3o: Vis\u00e3o Superior 3D \u2014 Clique ou pressione [G] para voltar ao Mapa 2D",
		mode2dToast: "Mapa 2D",
		mode3dFreeToast: "C\u00e2mera Livre 3D",
		mode3dTopToast: "Vis\u00e3o Superior 3D",
		copyLinkTitle: "Copiar link com tempo atual",
		bookmarksTitle: "Marcadores",
		menuMapTitle: "Op\u00e7\u00f5es de Mapa e HUD",
		menu3DTitle: "Gr\u00e1ficos e Texturas 3D",
		menuAnalyserTitle: "Demo Analyser e Ferramentas",
		mapMenuTitle: "Mapa e HUD",
		secMapLayers: "Camadas do Mapa",
		secUnits: "Unidades e Sa\u00fade",
		secPlayback: "Reprodu\u00e7\u00e3o e Escala",
		uiScaleTitle: "Escala da Interface",
		menu3dTitle: "Gr\u00e1ficos 3D",
		hint2dOnly: "Aplica na vis\u00e3o 3D",
		btnSwitch3d: "Ativar 3D",
		sec3dTerrain: "Terreno e C\u00e9u",
		sec3dStructures: "Estruturas e Unidades",
		sec3dLighting: "Ilumina\u00e7\u00e3o e Sombras",
		ssaoQualTitle: "Qualidade de AO",
		ssaoQualTip: "Controla a resolu\u00e7\u00e3o e amostras do SSAO. Em Balanced/High (resolu\u00e7\u00e3o total) elimina o borrado nas sombras de contato.",
		aaTitle: "Anti-Aliasing",
		aaTip: "Suaviza bordas serrilhadas em 3D. Ordenado de maior desempenho (Off / FXAA) a maior qualidade (MSAA 4x / MSAA + FXAA).",
		lodDistTitle: "Dist\u00e2ncia de Detalhe",
		lodDistTip: "Define a dist\u00e2ncia de desenho de edif\u00edcios detalhados e objetos pequenos (Muito Baixo a Ultra) para equilibrar detalhe visual e FPS.",
		lodDistPresets: ["Muito Baixo", "Baixo", "M\u00e9dio", "Alto", "Ultra"],
		mapViewRangeTip: "Alcance visual efetivo calculado a partir do preset real de neblina e dist\u00e2ncia m\u00e1xima de vis\u00e3o do PR para o mapa e camada ativos.",
		reactionZoneTip: "Raio adaptativo da zona de rea\u00e7\u00e3o conforme o tamanho do mapa: 50m em mapas de 1km, 100m em 2km e 150m em 4km/8km.",
		structureColorsHint: "Cor s\u00f3lida por tipo, ou tinge texturas se Texturas de Edif\u00edcios estiver ativo.",
		sec3dControls: "Controles 3D",
		ctrlMove: "Mover",
		ctrlVert: "Subir / Descer",
		ctrlZoomKey: "V (+ Roda)",
		ctrlZoom: "Zoom \u00d3ptico",
		ctrlBoost: "Impulso",
		ctrlCycle: "Alternar 2D / 3D",
		header: "Demo Analyser",
		toolsHeader: "Inspe\u00e7\u00e3o de Mapa",
		tabVision: "Vis\u00e3o e Mira",
		tabTactical: "T\u00e1tica e \u00c1udio",
		tabDebug: "Clipes e Mapa",
		secTacIntel: "Intelig\u00eancia e Tempos",
		secTacAudio: "\u00c1udio e Movimento",
		secTacCam: "C\u00e2mera e Visibilidade",
		secClipRec: "Gravador de Clipes",
		clipFpsLabel: "FPS:",
		clipFmtLabel: "Formato:",
		clipBitrateLabel: "Bitrate:",
		coneRangePrefix: "Alcance de Vis\u00e3o",
		coneRangeLabel: "Alcance de Vis\u00e3o:",
		cameraSpeedPrefix: "Velocidade C\u00e2mera 3D:",
		resetConeBtnText: "Padr\u00e3o",
		resetConeBtnTitle: "Redefinir para o alcance padr\u00e3o do mapa",
		bvrBtnText: "Lista de Foco",
		bvrBtnTitle: "Ver classifica\u00e7\u00e3o de tempos de foco a longa dist\u00e2ncia de todos os jogadores",
		bvrModalTitle: "Lista de Foco a Longa Dist\u00e2ncia",
		bvrModeIndividual: "Individual",
		bvrModeCumulative: "Acumulado",
		bvrModalClose: "Fechar",
		bvrNoData: "Nenhum dado de telemetria dispon\u00edvel.",
		bvrSubIndividual: "Rajada M\u00e1xima Cont\u00ednua",
		bvrSubCumulative: "Foco Acumulado na Partida",
		bvrRankingPrefix: "Classifica\u00e7\u00e3o de Foco",
		bvrTotalPlayers: "Total:",
		bvrPlayersWord: "jogadores",
		bvrHintText: 'Clique em "Selecionar" para focar no mapa',
		bvrColRank: "#",
		bvrColPlayer: "Jogador",
		bvrColTeam: "Equipe",
		bvrColTimeMax: "Tempo M\u00e1x. Foco",
		bvrColTimeTotal: "Tempo Total Acumulado",
		bvrColAction: "A\u00e7\u00e3o",
		bvrTeam1: "Equipe 1",
		bvrTeam2: "Equipe 2",
		bvrTeamSpectator: "Espectador",
		bvrBtnSelect: "Selecionar",
		timeline: {
			tracksLabel: "Faixas:",
			zoomLabel: "Zoom:",
			prev: "Ant.",
			next: "Pr\u00f3x.",
			tickets: "Tickets",
			flags: "Bandeiras",
			fobs: "FOBs",
			caches: "Caches",
			vehs: "Ve\u00edculos",
			bookmarks: "Marcadores",
			marksBtn: "Marcas",
			selected: "Sele\u00e7\u00e3o",
			full: "Tudo",
			loopIn: "[In\u00edcio A",
			loopOut: "Fim B]",
			clear: "Limpar",
			selectHint: "Selecione um jogador ou esquadr\u00e3o para ver Abates, Mortes e Reanima\u00e7\u00f5es"
		},
		opts: {
			options_DrawDOD: { label: "DOD", title: "Mostrar zonas DOD (fora de combate) no mapa" },
			options_DrawFlagRadius: { label: "Raio de Captura", title: "Mostrar raio de captura das bandeiras" },
			options_DrawKillLines: { label: "Linhas de Abate", title: "Desenhar setas entre atacante e v\u00edtima" },
			options_drawAllOrderIcons: { label: "Ordens de Esquadr\u00e3o", title: "Mostrar ordens de l\u00edderes de esquadr\u00e3o" },
			options_DrawEmptyVehicles: { label: "Ve\u00edculos Vazios", title: "Mostrar ve\u00edculos desocupados" },
			options_DrawKitIcons: { label: "\u00cdcones de Kits e Ve\u00edculos", title: "Mostrar \u00edcones de kits e ve\u00edculos" },
			options_health_vehicles: { label: "Vida de Ve\u00edculos", title: "Mostrar barra de vida nos ve\u00edculos" },
			options_health_players: { label: "Vida de Jogadores", title: "Mostrar barra de vida nos jogadores" },
			options_ClampVehiclesToMap: { label: "Fixar Ve\u00edculos na Borda", title: "Manter ve\u00edculos fora do mapa vis\u00edveis na borda 2D" },
			options_DrawVehicleHeight: { label: "Altitude de Aeronaves", title: "Mostrar altitude acima de helic\u00f3pteros e avi\u00f5es" },
			options_Interpolation: { label: "Movimento Suave", title: "Interpola posi\u00e7\u00f5es e \u00e2ngulos suavemente entre ticks do servidor. Desative para inspecionar frames puros." },
			options_UseFallbackRenderer: { label: "Mapa 2D Cl\u00e1ssico", title: "Usa o mapa 2D cl\u00e1ssico de imagem \u00fanica em vez do atlas de zoom." },
			options_RealTerrain: { label: "Texturas do Terreno", title: "Usa texturas e ilumina\u00e7\u00e3o 3D reais em vez do minimapa 2D." },
			options_TerrainDetail: { label: "Detalhe do Solo", title: "Requer Texturas do Terreno. Adiciona detalhes de solo de alta resolu\u00e7\u00e3o de perto." },
			options_DrawSkybox: { label: "C\u00e9u Atmosf\u00e9rico", title: "Renderiza a c\u00fapula atmosf\u00e9rica aut\u00eantica do mapa e camada (dia, noite, nublado ou tempestade) integrada \u00e0 neblina do horizonte." },
			options_3dFog: { label: "Neblina", title: "Aplica a neblina de dist\u00e2ncia do Project Reality conforme o mapa e a camada." },
			options_3dFogOnPlayer: { label: "Centralizar Neblina no Jogador", title: "Requer Neblina. Centraliza a esfera de visibilidade da neblina no jogador selecionado em vez da c\u00e2mera para ver o raio exato de vis\u00e3o." },
			options_StructureTextures: { label: "Texturas de Edif\u00edcios", title: "Carrega texturas reais de edif\u00edcios e malhas detalhadas." },
			options_LodFade: { label: "Transi\u00e7\u00e3o Suave (Fade)", title: "Requer Texturas de Edif\u00edcios. Suaviza transi\u00e7\u00f5es de detalhe e objetos pequenos evitando pop-in brusco." },
			options_TreeTextures: { label: "Texturas de \u00c1rvores", title: "Carrega texturas de casca e folhas para as \u00e1rvores (maior custo de GPU em florestas densas)." },
			options_BushTextures: { label: "Arbustos Detalhados", title: "Renderiza arbustos 3D com texturas reais de perto, em vez de arbustos volum\u00e9tricos leves." },
			options_StructureColors: { label: "Colorir por Tipo de Edif\u00edcio", title: "Atribui uma cor consistente a cada tipo de edif\u00edcio. Com Texturas ativas, tinge as texturas." },
			options_FactionTextures: { label: "Texturas de Soldados e Ve\u00edculos", title: "Carrega modelos e texturas reais de soldados e ve\u00edculos do PR em 3D." },
			options_3dShadows: { label: "Sombras Din\u00e2micas", title: "Sombras direcionais em tempo real alinhadas com a dire\u00e7\u00e3o real do sol de cada mapa." },
			options_3dAoSsao: { label: "Oclus\u00e3o Ambiental (AO)", title: "Combina Vertex AO cozido nos edif\u00edcios com oclus\u00e3o ambiental em tempo real (SSAO)." },
			options_DrawVisionCone: {
				label: "Cone de Vis\u00e3o",
				title: "Projeta o cone do campo de vis\u00e3o do jogador selecionado (94.9 graus FOV horizontal), calibrado ao alcance visual do mapa e respeitando a neblina em 3D."
			},
			options_VisionConeRespectsLOS: {
				label: "Bloqueio por Muros e Terreno",
				title: "Recorta em tempo real o cone de vis\u00e3o (2D e 3D) contra paredes de edif\u00edcios e eleva\u00e7\u00f5es do terreno."
			},
			options_DrawThreatLasers: {
				label: "Linhas de Mira e Amea\u00e7a",
				title: "Desenha a linha azul da mira do jogador (fica vermelha atr\u00e1s de cobertura) e linhas laranjas para inimigos vis\u00edveis no cone."
			},
			options_ConeRespectsTerrain: {
				label: "Verificar Cobertura",
				title: "Verifica bloqueio por terreno e edif\u00edcios em Linhas de Mira e Amea\u00e7a e no Tempo de Rea\u00e7\u00e3o."
			},
			options_DrawBVRLaser: {
				label: "Mira a Longa Dist\u00e2ncia",
				title: "Estende a linha de mira al\u00e9m do alcance visual/neblina do mapa para analisar o foco em alvos distantes."
			},
			options_DrawSpottedIndicators: {
				label: "Alvos Marcados",
				title: "Destaca FOBs, tropas e ve\u00edculos inimigos marcados pelas ordens do l\u00edder de esquadr\u00e3o."
			},
			options_DrawFlankChronometer: {
				label: "Tempo de Rea\u00e7\u00e3o",
				title: "Cria uma zona ao redor do jogador e mede em segundos o tempo de resposta ao detectar um inimigo pr\u00f3ximo."
			},
			options_DrawMovementSoundAuras: {
				label: "Raio de Passos e Motores",
				title: "Desenha um raio de som din\u00e2mico ao redor do jogador ou ve\u00edculo selecionado que se expande e dissipa conforme velocidade, postura ou motor."
			},
			options_DrawShootingSoundShockwaves: {
				label: "Ondas de Armas Pesadas",
				title: "Exibe ondas ac\u00fasticas expansivas de armas pesadas e proj\u00e9teis disparados pelo jogador ou ve\u00edculo selecionado (lan\u00e7adores AT, canh\u00f5es autom\u00e1ticos, tanques, morteiros e artilharia)."
			},
			options_ShowSelectionSpeed: {
				label: "Mostrar Velocidade e Postura",
				title: "Exibe a velocidade em tempo real (km/h) e o estado estimado de postura ou motor da unidade selecionada na janela Selection e nos raios 2D."
			},
			options_CameraTracking: {
				label: "Seguir Sele\u00e7\u00e3o [T]",
				title: "Segue suavemente o jogador ou ve\u00edculo selecionado com a c\u00e2mera em 2D e 3D. Pressione 'T' para alternar."
			},
			options_DrawBuildingWireframes: {
				label: "Contornos de Edif\u00edcios",
				title: "Mostra o contorno vetorial 2D de edif\u00edcios e paredes extra\u00eddos das malhas 3D do jogo."
			},
			options_DrawHeightmapOverlay: {
				label: "Mapa de Eleva\u00e7\u00e3o",
				title: "Superp\u00f5e uma grade colorida com as alturas do relevo no mapa 2D."
			},
			options_Draw4KmLaser: {
				label: "Raio de Vis\u00e3o Direta (4km)",
				title: "Lan\u00e7a um raio independente de at\u00e9 4km na dire\u00e7\u00e3o exata da mira que para em edif\u00edcios e colinas."
			},
			options_VisionConeXRay: {
				label: "Ver Atrav\u00e9s de Muros",
				title: "Desenha o cone de vis\u00e3o 3D vis\u00edvel atrav\u00e9s de paredes e terreno."
			},
			options_Wallhack: {
				label: "Raio-X de Unidades",
				title: "Mostra partes ocultas de soldados, ve\u00edculos e FOBs como silhuetas na cor da equipe atrav\u00e9s de paredes e terreno em 3D."
			}
		}
	}
};

function _setText(id, val) {
	if (val == null) return;
	const el = document.getElementById(id);
	if (el) el.textContent = val;
}

function _setTitle(id, val) {
	if (val == null) return;
	const el = document.getElementById(id);
	if (el) el.title = val;
}

function setAnalyserLanguage(lang) {
	if (!ANALYSER_I18N[lang]) lang = "EN";
	currentAnalyserLang = lang;
	try {
		if (typeof localStorage !== "undefined") localStorage.setItem("rt_hud_lang", lang);
	} catch (e) {}
	const data = ANALYSER_I18N[lang];

	// Toolbar tooltips
	_setTitle("copyLink", data.copyLinkTitle);
	_setTitle("toggleBookmarks", data.bookmarksTitle);
	_setTitle("btnMenuMap", data.menuMapTitle);
	_setTitle("btnMenu3DVisuals", data.menu3DTitle);
	_setTitle("btnMenuAnalyser", data.menuAnalyserTitle);

	// Menu 1: Map & HUD
	_setText("lblMapMenuTitle", data.mapMenuTitle);
	_setText("lblSecMapLayers", data.secMapLayers);
	_setText("lblSecUnits", data.secUnits);
	_setText("lblSecPlayback", data.secPlayback);
	_setText("lblUIScaleTitle", data.uiScaleTitle);

	// Menu 2: 3D Visuals
	_setText("lbl3DMenuTitle", data.menu3dTitle);
	_setText("lbl2dOnlyHint", data.hint2dOnly);
	_setText("btnQuickEnable3D", data.btnSwitch3d);
	_setText("lblSec3DTerrain", data.sec3dTerrain);
	_setText("lblSec3DStructures", data.sec3dStructures);
	_setText("lblSec3DLighting", data.sec3dLighting);
	_setText("lblSsaoQualTitle", data.ssaoQualTitle);
	_setTitle("rowSsaoQuality", data.ssaoQualTip);
	_setText("lblAATitle", data.aaTitle);
	_setTitle("rowAntiAliasing", data.aaTip);
	_setText("lblLodDistTitle", data.lodDistTitle);
	_setTitle("rowLodDistance", data.lodDistTip);
	if (typeof updateLodDistanceLabel === "function") updateLodDistanceLabel();
	_setText("lblStructureColorsHint", data.structureColorsHint);
	_setText("lblSec3DControls", data.sec3dControls);
	_setText("lblCtrlMove", data.ctrlMove);
	_setText("lblCtrlVert", data.ctrlVert);
	_setText("lblCtrlZoomKey", data.ctrlZoomKey);
	_setText("lblCtrlZoom", data.ctrlZoom);
	_setText("lblCtrlBoost", data.ctrlBoost);
	_setText("lblCtrlCycle", data.ctrlCycle);

	// Menu 3: Demo Analyser
	_setText("lblDemoAnalyserHeader", data.header);
	_setText("lblAnalyserToolsHeader", data.toolsHeader);
	_setText("tabBtnVision", data.tabVision);
	_setText("tabBtnTactical", data.tabTactical);
	_setText("tabBtnDebug", data.tabDebug);
	_setText("lblSecTacIntel", data.secTacIntel);
	_setText("lblSecTacAudio", data.secTacAudio);
	_setText("lblSecTacCam", data.secTacCam);
	_setText("lblSecClipRec", data.secClipRec);
	_setText("lblClipFps", data.clipFpsLabel);
	_setText("lblClipFmt", data.clipFmtLabel);
	_setText("lblClipBitrate", data.clipBitrateLabel);
	_setText("btnResetConeRange", data.resetConeBtnText);
	_setTitle("btnResetConeRange", data.resetConeBtnTitle);
	_setTitle("mapViewRangeContainer", data.mapViewRangeTip);
	_setTitle("engagementTimerRangeContainer", data.reactionZoneTip);

	const btnBvr = document.getElementById("btnBVRFocusAlerts");
	if (btnBvr) {
		btnBvr.textContent = data.bvrBtnText;
		btnBvr.title = data.bvrBtnTitle;
	}

	_setText("lblBvrModalTitle", data.bvrModalTitle);
	_setText("btnBvrModeIndividual", data.bvrModeIndividual);
	_setText("btnBvrModeAcumulado", data.bvrModeCumulative);
	_setText("btnBvrModalClose", data.bvrModalClose);

	// Timeline toolbar & track translations
	if (data.timeline) {
		const tl = data.timeline;
		_setText("lblTlTracks", tl.tracksLabel);
		_setText("lblTlZoom", tl.zoomLabel);
		_setText("btnTlPrev", tl.prev);
		_setText("btnTlNext", tl.next);
		_setText("btnTlLayer_tickets", tl.tickets);
		_setText("btnTlLayer_flags", tl.flags);
		_setText("btnTlLayer_fobs", tl.fobs);
		_setText("btnTlLayer_caches", tl.caches);
		_setText("btnTlLayer_vehs", tl.vehs);
		_setText("btnTlLayer_bookmarks", tl.marksBtn);
		_setText("btnTlLayer_selected", tl.selected);
		_setText("btnTlZoom_full", tl.full);
		_setText("btnTlLoopIn", tl.loopIn);
		_setText("btnTlLoopOut", tl.loopOut);
		_setText("btnTlLoopClear", tl.clear);
	}
	if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.draw === "function") {
		analyserTimeline.draw(true);
	}
	if (typeof clipRecorder !== "undefined" && typeof clipRecorder.updateUI === "function") {
		clipRecorder.updateUI();
	}

	for (const [optId, info] of Object.entries(data.opts)) {
		const elem = document.getElementById(optId);
		if (elem) {
			const label = elem.closest("label");
			if (label) {
				label.title = info.title;
				const optSpan = label.querySelector(".hud-opt-label");
				if (optSpan) {
					optSpan.textContent = info.label;
				} else {
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
	}

	document.querySelectorAll(".hud-lang-btn").forEach((btn) => {
		const bLang = btn.getAttribute("data-lang");
		btn.classList.toggle("active", bLang === lang);
	});

	if (typeof syncConeRangeSlider === "function") {
		syncConeRangeSlider(options_VisionConeRange, true);
	}
	if (typeof updateAnalyserSliderLabels === "function") {
		updateAnalyserSliderLabels(true);
	}
	if (typeof updateViewportModeButton === "function") {
		updateViewportModeButton();
	}

	const bvrModal = document.getElementById("bvrFocusModal");
	if (bvrModal && bvrModal.style.display !== "none") {
		openBVRFocusModal();
	}
}

$(() => {
	setAnalyserLanguage(currentAnalyserLang);
});

var currentBVRFocusMode = "individual";

function _styleBvrModeButtons(btnInd, btnAcu, mode) {
	if (!btnInd || !btnAcu) return;
	if (mode === "individual") {
		btnInd.style.background = "#3a5250";
		btnInd.style.color = "#fff";
		btnInd.style.borderColor = "#8fa3a1";
		btnAcu.style.background = "transparent";
		btnAcu.style.color = "#aaa";
		btnAcu.style.borderColor = "transparent";
	} else {
		btnAcu.style.background = "#3a5250";
		btnAcu.style.color = "#fff";
		btnAcu.style.borderColor = "#8fa3a1";
		btnInd.style.background = "transparent";
		btnInd.style.color = "#aaa";
		btnInd.style.borderColor = "transparent";
	}
}

function switchBVRFocusMode(mode) {
	currentBVRFocusMode = mode;
	_styleBvrModeButtons(document.getElementById("btnBvrModeIndividual"), document.getElementById("btnBvrModeAcumulado"), mode);
	openBVRFocusModal();
}

function openBVRFocusModal() {
	const modal = document.getElementById("bvrFocusModal");
	const body = document.getElementById("bvrFocusModalBody");
	if (!modal || !body) return;

	modal.style.display = "flex";

	const i18n = ANALYSER_I18N[currentAnalyserLang] || ANALYSER_I18N.EN;

	const btnInd = document.getElementById("btnBvrModeIndividual");
	const btnAcu = document.getElementById("btnBvrModeAcumulado");
	if (btnInd && btnAcu) {
		btnInd.textContent = i18n.bvrModeIndividual;
		btnAcu.textContent = i18n.bvrModeCumulative;
		_styleBvrModeButtons(btnInd, btnAcu, currentBVRFocusMode);
	}

	const lblBvrTitle = document.getElementById("lblBvrModalTitle");
	if (lblBvrTitle) lblBvrTitle.textContent = i18n.bvrModalTitle;

	const btnBvrClose = document.getElementById("btnBvrModalClose");
	if (btnBvrClose) btnBvrClose.textContent = i18n.bvrModalClose;

	if (typeof analyserPreloader !== "undefined") {
		analyserPreloader.applyFocusToPlayers();
	}

	const focusPlayerList = [];

	// 1. Prefer session-aware BVR records from analyserPreloader (never merges recycled Slot IDs)
	if (typeof analyserPreloader !== "undefined" && Array.isArray(analyserPreloader.sessionFocusList) && analyserPreloader.sessionFocusList.length > 0) {
		for (const sess of analyserPreloader.sessionFocusList) {
			if (!sess) continue;
			focusPlayerList.push({
				id: sess.slotId,
				name: sess.name || `Player #${sess.slotId}`,
				team: sess.team || 0,
				maxSec: sess.maxSec || 0,
				totalSec: sess.totalSec || 0,
				joinTick: sess.joinTick || 0,
				leaveTick: sess.leaveTick || null,
				peakTick: sess.peakTick || sess.joinTick || 0
			});
		}
	} else {
		const focusPlayerMap = new Map();
		if (typeof analyserPreloader !== "undefined" && analyserPreloader.playerStates) {
			for (const [id, s] of analyserPreloader.playerStates) {
				const maxSec = analyserPreloader.playerMaxFocusMap ? (analyserPreloader.playerMaxFocusMap.get(id) || 0) : 0;
				const totalSec = analyserPreloader.playerTotalFocusMap ? (analyserPreloader.playerTotalFocusMap.get(id) || 0) : 0;
				const pObj = (typeof AllPlayers !== "undefined" && AllPlayers[id]) ? AllPlayers[id] : null;
				const pName = (s && s.name) ? s.name : (pObj && pObj.name ? pObj.name : `Player #${id}`);
				const pTeam = (s && s.team) ? s.team : (pObj && pObj.team ? pObj.team : 0);

				focusPlayerMap.set(id, {
					id: id,
					name: pName,
					team: pTeam,
					maxSec: maxSec,
					totalSec: totalSec,
					joinTick: (s && s.joinTick) || 0,
					leaveTick: (s && s.leaveTick) || null,
					peakTick: (s && s.peakTick) || 0
				});
			}
		}
		if (typeof AllPlayers !== "undefined" && AllPlayers) {
			for (const pid in AllPlayers) {
				const p = AllPlayers[pid];
				if (!p || p.isJoining) continue;
				const id = p.id != null ? p.id : Number(pid);
				let entry = focusPlayerMap.get(id) || { id: id, name: p.name || `Player #${id}`, team: p.team || 0, maxSec: 0, totalSec: 0, joinTick: 0, leaveTick: null, peakTick: 0 };
				if (p.name) entry.name = p.name;
				if (p.team) entry.team = p.team;
				const maxSec = p.ns_maxFocusSeconds || 0;
				if (maxSec > entry.maxSec) entry.maxSec = maxSec;
				const totalSec = p.ns_totalFocusSeconds || 0;
				if (totalSec > entry.totalSec) entry.totalSec = totalSec;
				focusPlayerMap.set(id, entry);
			}
		}
		focusPlayerList.push(...focusPlayerMap.values());
	}

	const allFocusPlayers = focusPlayerList;
	const isIndividual = currentBVRFocusMode === "individual";

	if (isIndividual) {
		allFocusPlayers.sort((a, b) => b.maxSec - a.maxSec);
	} else {
		allFocusPlayers.sort((a, b) => b.totalSec - a.totalSec);
	}

	if (allFocusPlayers.length === 0) {
		body.innerHTML = `<div style="text-align: center; color: #aaa; padding: 20px; font-family: Arial, sans-serif;">${i18n.bvrNoData}</div>`;
		return;
	}

	const colTitle = isIndividual ? i18n.bvrColTimeMax : i18n.bvrColTimeTotal;
	const modeSubTitle = isIndividual ? i18n.bvrSubIndividual : i18n.bvrSubCumulative;

	let html = `
		<div style="margin-bottom: 8px; font-size: 11px; color: #aaa; display: flex; justify-content: space-between; align-items: center; font-family: Arial, sans-serif;">
			<span>${i18n.bvrRankingPrefix} - ${modeSubTitle} (${i18n.bvrTotalPlayers} <b>${allFocusPlayers.length}</b> ${i18n.bvrPlayersWord}):</span>
			<span style="font-size: 10px; color: #b7c0bf;">${i18n.bvrHintText}</span>
		</div>
		<table style="width: 100%; border-collapse: collapse; font-size: 11px; font-family: Arial, sans-serif; background: #2c2f34; color: rgb(239, 238, 241); border: 1px solid #34313a;">
			<thead>
				<tr style="background: #433f4a; color: #fff; text-align: left; height: 24px;">
					<th style="padding: 2px 8px; border-bottom: 1px solid #34313a; width: 40px;">${i18n.bvrColRank}</th>
					<th style="padding: 2px 8px; border-bottom: 1px solid #34313a;">${i18n.bvrColPlayer}</th>
					<th style="padding: 2px 8px; border-bottom: 1px solid #34313a;">${i18n.bvrColTeam}</th>
					<th style="padding: 2px 8px; border-bottom: 1px solid #34313a; text-align: right;">${colTitle}</th>
					<th style="padding: 2px 8px; border-bottom: 1px solid #34313a; text-align: center; width: 90px;">${i18n.bvrColAction}</th>
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
		const teamLabel = p.team === 1 ? i18n.bvrTeam1 : p.team === 2 ? i18n.bvrTeam2 : i18n.bvrTeamSpectator;
		const rowBg = idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.15)";
		const highlightColor = targetSec >= 60 ? "#e2c87a" : targetSec >= 30 ? "#d0dedc" : "#ffffff";
		const safeName = typeof escapeHtml === "function" ? escapeHtml(String(p.name || "")) : String(p.name || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		const seekTick = p.peakTick || p.joinTick || 0;

		html += `
			<tr style="background: ${rowBg}; height: 22px; border-bottom: 1px solid #34313a; transition: background 0.15s;" onmouseover="this.style.background='#393c43'" onmouseout="this.style.background='${rowBg}'">
				<td style="padding: 2px 8px; color: #888; text-align: center;">${idx + 1}</td>
				<td style="padding: 2px 8px; font-weight: bold; color: #fff;">${safeName}</td>
				<td style="padding: 2px 8px;"><span style="color: ${teamColor}; font-weight: bold;">${teamLabel}</span></td>
				<td style="padding: 2px 8px; text-align: right; color: ${highlightColor}; font-weight: bold;">${timeStr}</td>
				<td style="padding: 2px 8px; text-align: center;">
					<button onclick="selectPlayerFromBVRModal(${Number(p.id)}, ${Number(p.joinTick || 0)}, ${p.leaveTick != null ? Number(p.leaveTick) : -1}, ${Number(seekTick)})" style="background: #3a5250; color: #fff; border: 1px solid #8fa3a1; border-radius: 2px; font-size: 10px; font-weight: bold; padding: 2px 8px; cursor: pointer;">${i18n.bvrBtnSelect}</button>
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

function focusCameraOnSelectedEntity() {
	let worldX = null, worldY = null, worldZ = null;
	if (typeof SelectedPlayer !== "undefined" && SelectedPlayer != SELECTED_NOTHING && typeof AllPlayers !== "undefined" && AllPlayers[SelectedPlayer]) {
		const p = AllPlayers[SelectedPlayer];
		if (!p.isJoining) {
			const pInfo = getPlayerWorldPos(p);
			worldX = pInfo.x;
			worldY = pInfo.y;
			worldZ = pInfo.z;
		}
	} else if (typeof SelectedVehicle !== "undefined" && SelectedVehicle != SELECTED_NOTHING && typeof AllVehicles !== "undefined" && AllVehicles[SelectedVehicle]) {
		const v = AllVehicles[SelectedVehicle];
		worldX = typeof v.getX === "function" ? v.getX() : v.X;
		worldY = typeof v.getY === "function" ? v.getY() : v.Y;
		worldZ = typeof v.getZ === "function" ? v.getZ() : v.Z;
	}
	if (worldX != null && !isNaN(worldX) && worldZ != null && !isNaN(worldZ)) {
		focusCameraOnWorldPos(worldX, worldZ, worldY);
	}
}

function focusCameraOnWorldPos(worldX, worldZ, worldY = null) {
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return;
	if (typeof is3DMode !== "undefined" && is3DMode && typeof renderer3d !== "undefined" && renderer3d && renderer3d.cameraPos) {
		const groundH = (worldY != null && Number.isFinite(worldY)) ? worldY : ((typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(worldX, worldZ) : 0);
		if (renderer3d.isTopDown) {
			renderer3d.cameraPos[0] = worldX;
			renderer3d.cameraPos[2] = -worldZ;
		} else {
			const yawRad = ((renderer3d.cameraYaw || 0) * Math.PI) / 180.0;
			const dist = 28;
			renderer3d.cameraPos[0] = worldX - Math.sin(yawRad) * dist;
			renderer3d.cameraPos[2] = -worldZ + Math.cos(yawRad) * dist;
			renderer3d.cameraPos[1] = Math.max(groundH + 14, renderer3d.cameraPos[1] || (groundH + 18));
			renderer3d.cameraPitch = -24;
		}
	} else if (typeof Canvas !== "undefined" && typeof MapSize !== "undefined") {
		const uX = (worldX / MapSize) + 512;
		const uY = (worldZ / -MapSize) + 512;
		const zX = uX * CameraZoom;
		const zY = uY * CameraZoom;
		const scale = (typeof options_canvasScale !== "undefined" && options_canvasScale > 0) ? options_canvasScale : 1.0;
		CameraX = ((Canvas.width / 2) / scale) - zX;
		CameraY = ((Canvas.height / 2) / scale) - zY;
		if (typeof clampCamera === "function") clampCamera();
	}
	if (typeof requestUpdate === "function") requestUpdate();
}

function selectPlayerFromBVRModal(pid, joinTick = 0, leaveTick = -1, peakTick = 0) {
	const curTick = typeof Tick_Current !== "undefined" ? Tick_Current : 0;
	const pCur = (typeof AllPlayers !== "undefined" && AllPlayers[pid]) ? AllPlayers[pid] : null;
	const outOfSpan = (joinTick > 0 && curTick < joinTick) || (leaveTick > 0 && curTick > leaveTick) || !pCur || pCur.isJoining;
	if (outOfSpan && typeof goTo === "function") {
		const targetT = peakTick > 0 ? peakTick : (joinTick > 0 ? joinTick + 5 : curTick);
		if (targetT > 0) goTo(targetT);
	}
	if (typeof selection_SelectPlayer === "function") {
		selection_SelectPlayer(pid, true);
	} else if (typeof SelectedPlayer !== "undefined") {
		SelectedPlayer = pid;
	}
	focusCameraOnSelectedEntity();
	closeBVRFocusModal();
}

window.addEventListener("click", (e) => {
	const modal = document.getElementById("bvrFocusModal");
	if (modal && e.target === modal) {
		modal.style.display = "none";
	}
});

