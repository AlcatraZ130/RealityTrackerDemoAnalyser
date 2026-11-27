// Part of RealityTracker Demo Analyser 3D ALPHA - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// High-Definition Screen-Space 2D Overlay HUD for 3D Viewport (World-to-Screen Projection)
// Renders: Player & Vehicle Health Bars, Floating Kit Icons (auto-hidden in vehicles),
// Air Altitude Labels, SPOTTED Markers with countdowns, and UI Scaling.

var hud3d;

class Hud3d extends Initializable {
    canvas = null;
    ctx = null;
    initialized = false;
    dataReady = true;
    hitboxes = [];
    hudHitboxes = [];
    _lastDrawTime = 0;
    _lastTick = null;

    constructor() {
        super();
    }

    init() {
        if (this.initialized) return true;

        this.canvas = document.getElementById("map3dHud");
        if (!this.canvas) {
            this.canvas = document.createElement("canvas");
            this.canvas.id = "map3dHud";
            this.canvas.style.cssText = "position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10; display: none;";
            const container = document.getElementById("renderers") || document.getElementById("mapDiv");
            if (container) container.appendChild(this.canvas);
        }

        if (this.canvas) {
            this.ctx = this.canvas.getContext("2d");
            this.initialized = true;
        }

        return this.initialized;
    }

    worldToScreen(worldX, worldY, worldZ) {
        if (typeof renderer3d === "undefined" || !renderer3d.initialized || !this.canvas) return null;

        const vMat = renderer3d.getCurrentViewMatrix();
        const pMat = renderer3d.getCurrentProjectionMatrix();

        // Project coordinate into Clip Space (Z is inverted in WebGL rendering space)
        const v = vec4.fromValues(worldX, worldY, -worldZ, 1.0);
        vec4.transformMat4(v, v, vMat);
        vec4.transformMat4(v, v, pMat);

        // Discard points behind camera near plane
        if (v[3] <= 0.05) return null;

        // Normalized Device Coordinates (NDC) [-1, 1]
        const ndcX = v[0] / v[3];
        const ndcY = v[1] / v[3];

        // Frustum bounds culling (with margin for icons/bars)
        if (ndcX < -1.3 || ndcX > 1.3 || ndcY < -1.3 || ndcY > 1.3) return null;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const screenX = (ndcX * 0.5 + 0.5) * w;
        const screenY = (-ndcY * 0.5 + 0.5) * h;

        return {
            x: screenX,
            y: screenY,
            dist: v[3] // Distance from camera in meters
        };
    }

    draw() {
        if (!this.initialized && !this.init()) return;
        if (!this.ctx || !this.canvas) return;

        const glCanvas = renderer3d.canvas;
        if (!glCanvas) return;

        // Ensure canvas matches viewport size exactly
        const targetW = glCanvas.width || glCanvas.clientWidth;
        const targetH = glCanvas.height || glCanvas.clientHeight;
        if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
            this.canvas.width = targetW;
            this.canvas.height = targetH;
        }

        // Ensure canvas is visible when in 3D mode
        if (typeof is3DMode !== "undefined" && is3DMode) {
            if (this.canvas.style.display !== "block") {
                this.canvas.style.display = "block";
            }
        }

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.hitboxes = [];
        this.hudHitboxes = [];

        const fpvState = (typeof renderer3d !== "undefined" && typeof renderer3d.getActive1PVState === "function")
            ? renderer3d.getActive1PVState()
            : null;

        const nowMs = performance.now();
        const dt = (this._lastDrawTime > 0) ? Math.min(0.1, Math.max(0.001, (nowMs - this._lastDrawTime) / 1000.0)) : 0.016;
        this._lastDrawTime = nowMs;

        const curTick = (typeof Tick_Current !== "undefined") ? Tick_Current : null;
        const tickDelta = (this._lastTick != null && curTick != null) ? Math.abs(curTick - this._lastTick) : 0;
        const forceSnap = (typeof isFastForwarding !== "undefined" && isFastForwarding) || (tickDelta > 8);
        let anyIconMoving = false;

        const uiScale = (typeof options_canvasScale !== "undefined") ? Math.max(0.4, Number(options_canvasScale)) : 1.0;
        const showPlayerHealth = (typeof options_health_players !== "undefined" && options_health_players) || (typeof HealthButtonDown !== "undefined" && HealthButtonDown);
        const showVehicleHealth = (typeof options_health_vehicles !== "undefined" && options_health_vehicles) || (typeof HealthButtonDown !== "undefined" && HealthButtonDown);
        const showKitIcons = (typeof options_DrawKitIcons !== "undefined") ? options_DrawKitIcons : true;
        const showAirHeight = (typeof options_DrawVehicleHeight !== "undefined") ? options_DrawVehicleHeight : true;
        const showSpotted = (typeof options_DrawSpottedIndicators !== "undefined") ? options_DrawSpottedIndicators : false;
        const spottedData = showSpotted ? this.computeSpottedEntities() : null;

        // ---------------------------------------------------------------------
        // 1. Render Floating Player HUD Elements (Health, Kits, Squad Leader Star)
        // ---------------------------------------------------------------------
        if (typeof AllPlayers !== "undefined") {
            for (const pId in AllPlayers) {
                if (fpvState && fpvState.active && Number(pId) === fpvState.fpvPlayerId) continue;
                const p = AllPlayers[pId];
                if (!p || p.isJoining || !p.isAlive) continue;

                // RULE: If player is inside a vehicle, do NOT draw floating kit/health on soldier
                if (p.vehicleid >= 0) continue;

                let px = (typeof p.getX === "function") ? p.getX() : p.X;
                let py = (typeof p.getY === "function") ? p.getY() : (p.Y || 0);
                let pz = (typeof p.getZ === "function") ? p.getZ() : p.Z;
                if (px == null || isNaN(px) || pz == null || isNaN(pz)) continue;

                let gh = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(px, pz) : 0;
                let supportY = gh;
                if (typeof buildingHeightmap !== "undefined" && buildingHeightmap.initialized && typeof buildingHeightmap.getSupportSurfaceY === "function") {
                    supportY = buildingHeightmap.getSupportSurfaceY(px, py, pz, gh);
                }
                const relY = py - supportY;
                const spdKmh = (typeof getEntitySpeedKmh === "function") ? getEntitySpeedKmh(p) : 0;

                let stance = "stand";
                const forcedDbgStance = (typeof window !== "undefined" && window._debugForcedStances) ? window._debugForcedStances[Number(p.id != null ? p.id : pId)] : null;
                if (forcedDbgStance) {
                    stance = forcedDbgStance;
                } else if (spdKmh >= 6.0) {
                    stance = "stand";
                } else if (spdKmh >= 1.8) {
                    stance = (relY <= 0.65) ? "crouch" : "stand";
                } else {
                    if (relY <= 0.25) {
                        stance = "prone";
                    } else if (relY <= 0.65) {
                        stance = "crouch";
                    } else {
                        stance = "stand";
                    }
                }

                const stancePelvisOffset = (stance === "prone") ? 0.15 : ((stance === "crouch") ? 0.50 : 0.85);
                const floorY = Math.max(supportY, py - stancePelvisOffset);
                const headElevation = (stance === "prone") ? 0.80 : ((stance === "crouch") ? 1.30 : 1.80);

                // Smooth world-space "Follow" motion (eliminates sudden crouch/step popping without camera-pan lag)
                const reappeared = (curTick != null && p._hudTick != null && Math.abs(curTick - p._hudTick) > 3);
                const smoothPos = this._getSmoothedWorldPos(p, px, floorY + headElevation, pz, dt, forceSnap || reappeared);
                if (curTick != null) p._hudTick = curTick;
                if (!smoothPos.settled) anyIconMoving = true;

                // Head screen position with dynamic stance awareness
                const headProj = this.worldToScreen(smoothPos.x, smoothPos.y, smoothPos.z);
                if (!headProj) continue;

                // Perspective distance scaling: close = ~1.1x, far (200m+) = ~0.55x
                const distanceScale = Math.max(0.55, Math.min(1.15, 60.0 / Math.max(15.0, headProj.dist)));
                const finalScale = uiScale * distanceScale;

                let currentOffsetY = headProj.y;

                // A. Player Health Bar
                if (showPlayerHealth && p.health != null && p.health > 0) {
                    const barW = Math.round(26 * finalScale);
                    const barH = Math.max(3, Math.round(3.5 * finalScale));
                    const barX = Math.round(headProj.x - barW * 0.5);
                    const barY = Math.round(currentOffsetY - barH - (2 * finalScale));

                    const healthPct = Math.max(0, Math.min(1.0, p.health / 100.0));
                    let barColor = "#2ed232"; // Green
                    if (healthPct <= 0.35) barColor = "#ff3333"; // Red
                    else if (healthPct <= 0.65) barColor = "#ffcc00"; // Yellow

                    // Shadow / Background
                    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
                    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

                    // Health Fill
                    ctx.fillStyle = barColor;
                    ctx.fillRect(barX, barY, Math.round(barW * healthPct), barH);

                    currentOffsetY = barY;
                }

                // B. Floating Kit Icon (Team-colored badge with auto-hide inside vehicles)
                if (showKitIcons && p.ns_kitImage) {
                    const badgeRadius = Math.round(9.5 * finalScale);
                    const badgeX = Math.round(headProj.x);
                    const badgeY = Math.round(currentOffsetY - badgeRadius - (2 * finalScale));

                    const teamColor = (p.team === 1) ? "#ff3300" : "#2299ff";
                    const teamDarkBorder = (p.team === 1) ? "#991100" : "#0055bb";

                    // Team-colored Circular Backdrop
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
                    ctx.fillStyle = teamColor;
                    ctx.fill();
                    ctx.lineWidth = Math.max(1.2, 1.8 * finalScale);
                    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
                    ctx.stroke();

                    // Inner border for crisp outline
                    ctx.lineWidth = 1.0;
                    ctx.strokeStyle = teamDarkBorder;
                    ctx.stroke();

                    // Kit Icon inside badge
                    if (p.ns_kitImage.complete && p.ns_kitImage.naturalWidth > 0) {
                        const iconInnerSize = Math.round(13 * finalScale);
                        ctx.drawImage(p.ns_kitImage, badgeX - iconInnerSize * 0.5, badgeY - iconInnerSize * 0.5, iconInnerSize, iconInnerSize);
                    }

                    // Squad Leader Star Badge
                    if (p.isSquadLeader) {
                        ctx.fillStyle = "#ffee00";
                        ctx.strokeStyle = "#000000";
                        ctx.lineWidth = 2.0;
                        ctx.font = `bold ${Math.round(11 * finalScale)}px sans-serif`;
                        ctx.textAlign = "center";
                        ctx.strokeText("★", badgeX - badgeRadius * 0.7, badgeY - badgeRadius * 0.4);
                        ctx.fillText("★", badgeX - badgeRadius * 0.7, badgeY - badgeRadius * 0.4);
                    }
                    ctx.restore();

                    currentOffsetY = badgeY - badgeRadius;

                    // Clickable screen hitbox on player kit badge
                    this.hitboxes.push({
                        entity: p,
                        x: badgeX,
                        y: badgeY,
                        r: Math.max(12, badgeRadius + 3),
                        dist: headProj.dist
                    });
                } else {
                    // Fallback hitbox above soldier head when kit icons are disabled
                    this.hitboxes.push({
                        entity: p,
                        x: headProj.x,
                        y: currentOffsetY - (10 * finalScale),
                        r: Math.max(11, 10 * finalScale),
                        dist: headProj.dist
                    });
                }

                // C. SPOTTED Marker (compact dark tactical pill)
                if (showSpotted && spottedData && spottedData.players && spottedData.players.has(p)) {
                    ctx.save();
                    const fontSize = Math.max(7, Math.round(8.5 * finalScale));
                    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
                    const label = "SPOTTED";
                    const tw = ctx.measureText(label).width;
                    const padX = Math.max(3, Math.round(4 * finalScale));
                    const pillW = tw + padX * 2;
                    const pillH = Math.max(10, Math.round(12 * finalScale));
                    const pillX = Math.round(headProj.x - pillW * 0.5);
                    const pillY = Math.round(currentOffsetY - pillH - (2 * finalScale));

                    ctx.fillStyle = "rgba(23, 35, 34, 0.88)";
                    ctx.fillRect(pillX, pillY, pillW, pillH);
                    ctx.strokeStyle = "#c94a4a";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1);

                    ctx.fillStyle = "#f2b8b8";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(label, Math.round(headProj.x), Math.round(pillY + pillH * 0.5));
                    ctx.restore();
                    currentOffsetY = pillY;
                }

                // D. BVR Target Distance, Focus Timer & Target Ring (Exact 2D Fidelity)
                const showBVRLaser = (typeof options_DrawBVRLaser !== "undefined") ? options_DrawBVRLaser : false;
                if (showBVRLaser && typeof ns_bvrFocusMap !== "undefined") {
                    const selP = (typeof SelectedPlayer !== "undefined" && SelectedPlayer != SELECTED_NOTHING && typeof AllPlayers !== "undefined") ? AllPlayers[SelectedPlayer] : null;
                    if (selP && typeof isEnemyOf === "function" && isEnemyOf(selP, p)) {
                        const key = `${selP.id}_${p.id}`;
                        const entry = ns_bvrFocusMap.get(key);
                        if (entry && entry.ticks > 0) {
                            const dt = (typeof DemoTimePerTick !== "undefined" && DemoTimePerTick > 0) ? DemoTimePerTick : 0.04;
                            const focusSec = entry.ticks * dt;
                            const worldDist = Math.hypot(px - selP.getX(), pz - selP.getZ());
                            const op = Math.min(1.0, 0.10 + (focusSec / 60.0) * 0.90);

                            const greenRgba = `rgba(0, 255, 102, ${op.toFixed(2)})`;
                            const distRgba = `rgba(180, 255, 210, ${op.toFixed(2)})`;

                            // 1. Target Circle around enemy in screen space
                            ctx.beginPath();
                            ctx.arc(headProj.x, headProj.y, Math.round(14 * finalScale), 0, Math.PI * 2);
                            ctx.strokeStyle = greenRgba;
                            ctx.lineWidth = Math.max(1.5, 2.0 * finalScale);
                            ctx.stroke();

                            // 2. Distance tag in top-right
                            const distText = `${Math.round(worldDist)}m`;
                            ctx.fillStyle = distRgba;
                            ctx.font = `bold ${Math.round(10 * finalScale)}px Arial, sans-serif`;
                            ctx.textAlign = "left";
                            ctx.fillText(distText, headProj.x + (12 * finalScale), headProj.y - (10 * finalScale));

                            // 3. Fluorescent Green Seconds Counter Centered Below Target
                            const timeText = `${focusSec.toFixed(1)}s`;
                            ctx.fillStyle = greenRgba;
                            ctx.font = `bold ${Math.round(13 * finalScale)}px Arial, sans-serif`;
                            ctx.textAlign = "center";
                            ctx.fillText(timeText, headProj.x, headProj.y + (22 * finalScale));
                        }
                    }
                }

                // E. Engagement Timer / Flank Chronometer Floating Badge
                const showFlankChrono = (typeof options_DrawFlankChronometer !== "undefined") ? options_DrawFlankChronometer : false;
                if (showFlankChrono && typeof flankChronometer !== "undefined") {
                    const selP = (typeof SelectedPlayer !== "undefined" && SelectedPlayer != SELECTED_NOTHING && typeof AllPlayers !== "undefined") ? AllPlayers[SelectedPlayer] : null;
                    if (selP && selP !== p && !selP.isJoining && selP.isAlive && typeof isEnemyOf === "function" && isEnemyOf(selP, p)) {
                        flankChronometer.update(selP);

                        const s = flankChronometer.state.get(p.id);
                        if (s) {
                            const currentTick = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;
                            const endTick = s.deathTick || s.laserTick || s.enterConeTick || currentTick;
                            let elapsedTicks = endTick - s.enterRangeTick;
                            if (elapsedTicks < 0) elapsedTicks = 0;
                            const dt = (typeof DemoTimePerTick !== "undefined" && DemoTimePerTick > 0) ? DemoTimePerTick : 0.04;
                            const elapsedSeconds = elapsedTicks * dt;

                            const timeText = elapsedSeconds.toFixed(1) + "s";
                            const isDead = !p.isAlive || !!s.deathTick;
                            const isLaser = !!s.laserTick;
                            const isCone = !!s.enterConeTick;

                            let textColor = "#ddd2ec";
                            let bgColor = "rgba(23, 35, 34, 0.88)";
                            let borderColor = "#8c6bb1";
                            if (isDead) {
                                textColor = "#9aa6a5";
                                bgColor = "rgba(26, 28, 30, 0.82)";
                                borderColor = "#5c6665";
                            } else if (isLaser) {
                                textColor = "#f2b8b8";
                                borderColor = "#c94a4a";
                            } else if (isCone) {
                                textColor = "#f3d9a4";
                                borderColor = "#d49b3e";
                            }

                            ctx.save();
                            const fontPx = Math.max(8, Math.round(9.5 * finalScale));
                            ctx.font = `bold ${fontPx}px Arial, sans-serif`;
                            const textWidth = ctx.measureText(timeText).width;
                            const padX = Math.max(4, Math.round(4.5 * finalScale));
                            const badgeW = Math.round(textWidth + padX * 2);
                            const badgeH = Math.max(12, Math.round(13.5 * finalScale));
                            const badgeX = Math.round(headProj.x - badgeW * 0.5);
                            const badgeY = Math.round(currentOffsetY - badgeH - Math.max(2, Math.round(2.5 * finalScale)));

                            ctx.fillStyle = bgColor;
                            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
                            ctx.strokeStyle = borderColor;
                            ctx.lineWidth = 1;
                            ctx.strokeRect(badgeX + 0.5, badgeY + 0.5, badgeW - 1, badgeH - 1);

                            ctx.fillStyle = textColor;
                            ctx.textAlign = "center";
                            ctx.textBaseline = "middle";
                            ctx.fillText(timeText, Math.round(headProj.x), Math.round(badgeY + badgeH * 0.5) + 0.5);
                            ctx.restore();

                            currentOffsetY = badgeY;
                        }
                    }
                }
            }
        }

        // ---------------------------------------------------------------------
        // 2. Render Floating Vehicle HUD Elements (Health, Vehicle Icon, Air Altitude)
        // ---------------------------------------------------------------------
        const showEmptyVehicles = (typeof options_DrawEmptyVehicles !== "undefined") ? options_DrawEmptyVehicles : true;

        if (typeof AllVehicles !== "undefined") {
            for (const vId in AllVehicles) {
                if (fpvState && fpvState.active && Number(vId) === fpvState.fpvVehicleId) continue;
                const v = AllVehicles[vId];
                if (!v || v.isClimbingVehicle) continue;
                if (!showEmptyVehicles && (!v.Passengers || v.Passengers.size === 0)) continue;

                // Lock directly to the exact rendered 3D chassis pose (zero trailing lag or teleport-jumping on fast jets & helicopters)
                const pose = v._poseCache;
                let vx = (pose && typeof pose.posX === "number" && !isNaN(pose.posX)) ? pose.posX : ((typeof v.getX === "function") ? v.getX() : v.X);
                let vy = (pose && typeof pose.smoothY === "number" && !isNaN(pose.smoothY)) ? pose.smoothY : ((typeof v._smoothY === "number" && !isNaN(v._smoothY)) ? v._smoothY : ((typeof v.getY === "function") ? v.getY() : (v.Y || 0)));
                let vz = (pose && typeof pose.posZ === "number" && !isNaN(pose.posZ)) ? pose.posZ : ((typeof v.getZ === "function") ? v.getZ() : v.Z);
                if (vx == null || isNaN(vx) || vz == null || isNaN(vz)) continue;

                let groundH = 0;
                if (typeof heightmap !== "undefined") {
                    groundH = heightmap.getHeightFromCoords(vx, vz);
                    if (!v.isFlyingVehicle) vy = Math.max(vy, groundH + 0.5);
                }

                if (curTick != null) v._hudTick = curTick;

                // Project directly from synced 3D chassis center (anchored firmly above jets, helis, and ground vehicles at any speed)
                const vehProj = this.worldToScreen(vx, vy + 2.4, vz);
                if (!vehProj) continue;

                const distanceScale = Math.max(0.5, Math.min(1.15, 90.0 / Math.max(20.0, vehProj.dist)));
                const finalScale = uiScale * distanceScale;

                let currentOffsetY = vehProj.y;

                // A. Vehicle Health Bar
                if (showVehicleHealth && v.maxHealth > 0 && v.health != null && v.health > 0) {
                    const barW = Math.round(42 * finalScale);
                    const barH = Math.max(3, Math.round(4.5 * finalScale));
                    const barX = Math.round(vehProj.x - barW * 0.5);
                    const barY = Math.round(currentOffsetY - barH - (2 * finalScale));

                    const healthPct = Math.max(0, Math.min(1.0, v.health / v.maxHealth));
                    let barColor = "#2ed232"; // Green
                    if (healthPct <= 0.30) barColor = "#ff2222"; // Red
                    else if (healthPct <= 0.60) barColor = "#ffaa00"; // Orange

                    // Shadow / Background
                    ctx.fillStyle = "rgba(0, 0, 0, 0.80)";
                    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

                    // Health Fill
                    ctx.fillStyle = barColor;
                    ctx.fillRect(barX, barY, Math.round(barW * healthPct), barH);

                    currentOffsetY = barY;
                }

                // B. Vehicle Icon (Floating colored vehicle sprite in 3D HUD without circle backdrop)
                let vehHitboxAdded = false;
                if (showKitIcons && v.ns_mapImage) {
                    let color = 0;
                    if (typeof SelectedVehicle !== "undefined" && (vId == SelectedVehicle || v.id == SelectedVehicle)) {
                        color = 3; // Selected (Yellow)
                    } else if (typeof SquadVehicles !== "undefined" && SquadVehicles && (vId in SquadVehicles || v.id in SquadVehicles)) {
                        color = 2; // Squad Selected (Green)
                    } else if (v.team != null && v.team > 0) {
                        color = v.team - 1; // 0 = Team 1 (Red), 1 = Team 2 (Blue)
                    }

                    const iconImg = v.ns_mapImage[color];
                    if (iconImg && (iconImg.complete === undefined || iconImg.complete) && (iconImg.naturalWidth === undefined || iconImg.naturalWidth > 0 || iconImg.width > 0)) {
                        const iconSize = Math.round(26 * finalScale);
                        const iconX = Math.round(vehProj.x - iconSize * 0.5);
                        const iconY = Math.round(currentOffsetY - iconSize - (2 * finalScale));

                        ctx.save();
                        ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
                        ctx.shadowBlur = 4;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 1;

                        ctx.drawImage(iconImg, iconX, iconY, iconSize, iconSize);
                        ctx.restore();

                        // Clickable screen hitbox on vehicle icon
                        this.hitboxes.push({
                            entity: v,
                            x: iconX + iconSize * 0.5,
                            y: iconY + iconSize * 0.5,
                            r: Math.max(14, iconSize * 0.5 + 4),
                            dist: vehProj.dist
                        });
                        vehHitboxAdded = true;

                        currentOffsetY = iconY;
                    }
                }
                if (!vehHitboxAdded) {
                    this.hitboxes.push({
                        entity: v,
                        x: vehProj.x,
                        y: currentOffsetY - (12 * finalScale),
                        r: Math.max(14, 14 * finalScale),
                        dist: vehProj.dist
                    });
                }

                // C. Air Vehicle Altitude Badge (+145m)
                if (showAirHeight && v.isFlyingVehicle) {
                    const relAltitude = Math.max(0, Math.round(vy - groundH));
                    const altText = `+${relAltitude}m`;

                    ctx.fillStyle = (v.team == 1) ? "#ff5555" : "#33bbee";
                    ctx.strokeStyle = "#000000";
                    ctx.lineWidth = Math.max(2, 2.5 * finalScale);
                    ctx.font = `bold ${Math.round(11 * finalScale)}px Arial, sans-serif`;
                    ctx.textAlign = "center";
                    ctx.strokeText(altText, vehProj.x, currentOffsetY - (3 * finalScale));
                    ctx.fillText(altText, vehProj.x, currentOffsetY - (3 * finalScale));

                    currentOffsetY -= Math.round(12 * finalScale);
                }

                // D. Vehicle SPOTTED Marker (compact dark tactical pill)
                if (showSpotted && spottedData && spottedData.vehicles && spottedData.vehicles.has(v)) {
                    ctx.save();
                    const fontSize = Math.max(7, Math.round(8.5 * finalScale));
                    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
                    const label = "SPOTTED";
                    const tw = ctx.measureText(label).width;
                    const padX = Math.max(3, Math.round(4 * finalScale));
                    const pillW = tw + padX * 2;
                    const pillH = Math.max(10, Math.round(12 * finalScale));
                    const pillX = Math.round(vehProj.x - pillW * 0.5);
                    const pillY = Math.round(currentOffsetY - pillH - (2 * finalScale));

                    ctx.fillStyle = "rgba(23, 35, 34, 0.88)";
                    ctx.fillRect(pillX, pillY, pillW, pillH);
                    ctx.strokeStyle = "#c94a4a";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1);

                    ctx.fillStyle = "#f2b8b8";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(label, Math.round(vehProj.x), Math.round(pillY + pillH * 0.5));
                    ctx.restore();
                    currentOffsetY = pillY;
                }
            }
        }

        // ---------------------------------------------------------------------
        // 3. Squad Leader Orders in 3D (Attack, Defend, Move, Build, Destroy, Observe)
        // ---------------------------------------------------------------------
        const showOrders = (typeof options_drawAllOrderIcons !== "undefined") ? options_drawAllOrderIcons : false;
        let selOrderTeam = -1, selOrderSquad = -1;
        if (typeof SelectedPlayer !== "undefined" && SelectedPlayer != SELECTED_NOTHING && typeof AllPlayers !== "undefined" && AllPlayers[SelectedPlayer]) {
            selOrderTeam = AllPlayers[SelectedPlayer].team;
            selOrderSquad = AllPlayers[SelectedPlayer].squad;
        } else if (typeof SelectedSquadTeam !== "undefined" && SelectedSquadTeam != SELECTED_NOTHING) {
            selOrderTeam = SelectedSquadTeam;
            selOrderSquad = SelectedSquadNumber;
        }
        if ((showOrders || (selOrderTeam > 0 && selOrderSquad > 0)) && typeof AllSLOrders !== "undefined" && typeof icons !== "undefined" && icons.squadorders) {
            const orderEnums = [null, null, null, null, [0, "#cbc337"], [32, "#ff9900"], [64, "#ca32f2"], [96, "#ca32f2"], [128, "#ff9900"], [160, "#ff9900"]];

            for (const index in AllSLOrders) {
                const order = AllSLOrders[index];
                if (!order || order.type == null || order.type === -1 || order.X == null || order.Z == null) continue;
                if (!showOrders && (order.team !== selOrderTeam || order.squad !== selOrderSquad)) continue;

                const e = orderEnums[order.type];
                if (!e) continue;

                let groundH = 0;
                if (typeof heightmap !== "undefined") {
                    groundH = heightmap.getHeightFromCoords(order.X, order.Z);
                }

                const ordProj = this.worldToScreen(order.X, groundH + 1.2, order.Z);
                if (!ordProj) continue;

                const distScale = Math.max(0.55, Math.min(1.2, 70.0 / Math.max(15.0, ordProj.dist)));
                const scale = uiScale * distScale;

                const iconX = e[0];
                const drawW = Math.round(20 * scale);
                const drawH = Math.round(20 * scale);

                ctx.save();
                ctx.drawImage(icons.squadorders, iconX + 6, 12, 20, 20, Math.round(ordProj.x - drawW * 0.5), Math.round(ordProj.y - drawH), drawW, drawH);

                ctx.fillStyle = (order.team === 1) ? "#ff3300" : "#2299ff";
                ctx.strokeStyle = "#000000";
                ctx.lineWidth = Math.max(1.5, 2.0 * scale);
                ctx.font = `bold ${Math.round(11 * scale)}px Arial, sans-serif`;
                ctx.textAlign = "center";
                ctx.strokeText(order.squad || "", ordProj.x + (10 * scale), ordProj.y - drawH + (10 * scale));
                ctx.fillText(order.squad || "", ordProj.x + (10 * scale), ordProj.y - drawH + (10 * scale));
                ctx.restore();
            }
        }

        // ---------------------------------------------------------------------
        // 5. Render FOBs / Hideouts HUD Markers
        // ---------------------------------------------------------------------
        if (showKitIcons && typeof AllFobs !== "undefined") {
            for (const fobId in AllFobs) {
                const fob = AllFobs[fobId];
                if (!fob) continue;
                let groundY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(fob.X, fob.Z) : 0;
                const objY = (typeof fob.Y === "number") ? fob.Y : parseFloat(fob.Y);
                const baseElevY = (Number.isFinite(objY) && objY > groundY + 0.25) ? objY : groundY;
                const fobProj = this.worldToScreen(fob.X, baseElevY + 2.5, fob.Z);
                if (!fobProj) continue;

                const distScale = Math.max(0.6, Math.min(1.2, 70.0 / Math.max(20.0, fobProj.dist)));
                const scale = uiScale * distScale;
                const triSize = Math.round(10 * scale);

                ctx.save();
                ctx.fillStyle = (fob.team === 2) ? "#2299ff" : "#ff3300";
                ctx.strokeStyle = "#000000";
                ctx.lineWidth = Math.max(1.5, 2.0 * scale);
                ctx.lineJoin = "miter";

                // PR in-game FOB icon: team-colored triangle with black outline and center black dot
                ctx.beginPath();
                ctx.moveTo(fobProj.x, fobProj.y - triSize);
                ctx.lineTo(fobProj.x + triSize, fobProj.y + triSize);
                ctx.lineTo(fobProj.x - triSize, fobProj.y + triSize);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = "#000000";
                ctx.beginPath();
                ctx.arc(fobProj.x, fobProj.y + triSize * 0.28, Math.max(2.2, triSize * 0.34), 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // ---------------------------------------------------------------------
        // 6. Selected Kill Midpoint Tactical Badge (distance & weapon)
        // ---------------------------------------------------------------------
        if (typeof SelectedKill !== "undefined" && SelectedKill != SELECTED_NOTHING &&
            typeof eventArrays !== "undefined" && eventArrays.kills && eventArrays.kills.events[SelectedKill]) {
            const k = eventArrays.kills.events[SelectedKill];
            const ax = Number(k.AttackerX), az = Number(k.AttackerY);
            const vx = Number(k.VictimX), vz = Number(k.VictimY);
            if (Number.isFinite(ax) && Number.isFinite(az) && Number.isFinite(vx) && Number.isFinite(vz)) {
                let ay = Number.isFinite(Number(k.AttackerZ)) ? Number(k.AttackerZ) : 0;
                let vy = Number.isFinite(Number(k.VictimZ)) ? Number(k.VictimZ) : 0;
                if (typeof heightmap !== "undefined") {
                    ay = Math.max(ay, heightmap.getHeightFromCoords(ax, az) + 0.8);
                    vy = Math.max(vy, heightmap.getHeightFromCoords(vx, vz) + 0.8);
                }
                const mx = (ax + vx) * 0.5;
                const mz = (az + vz) * 0.5;
                const my = (ay + vy) * 0.5 + 1.8;
                const midProj = this.worldToScreen(mx, my, mz);
                if (midProj) {
                    const distM = k.Distance != null ? `${k.Distance}m` : `${Math.round(Math.hypot(vx - ax, vz - az))}m`;
                    const weap = k.Weapon ? ` | ${k.Weapon}` : "";
                    const label = `${distM}${weap}`;

                    ctx.save();
                    ctx.font = `bold 10px Arial, sans-serif`;
                    const tw = ctx.measureText(label).width;
                    const padX = 6;
                    const pillW = tw + padX * 2;
                    const pillH = 16;
                    const px = Math.round(midProj.x - pillW * 0.5);
                    const py = Math.round(midProj.y - pillH - 4);

                    ctx.fillStyle = "rgba(23, 35, 34, 0.90)";
                    ctx.fillRect(px, py, pillW, pillH);
                    ctx.strokeStyle = "#e2c87a";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(px + 0.5, py + 0.5, pillW - 1, pillH - 1);

                    ctx.fillStyle = "#f4edd3";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(label, Math.round(midProj.x), py + pillH * 0.5);
                    ctx.restore();
                }
            }
        }

        // ---------------------------------------------------------------------
        // 6. Render Rally Points HUD Markers
        // ---------------------------------------------------------------------
        if (typeof AllRallies !== "undefined") {
            for (const rKey in AllRallies) {
                const R = AllRallies[rKey];
                if (!R) continue;
                let groundY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(R.X, R.Z) : 0;
                const objY = (typeof R.Y === "number") ? R.Y : parseFloat(R.Y);
                const baseElevY = (Number.isFinite(objY) && objY > groundY + 0.25) ? objY : groundY;
                const rallyProj = this.worldToScreen(R.X, baseElevY + 1.2, R.Z);
                if (!rallyProj) continue;

                const distScale = Math.max(0.6, Math.min(1.2, 70.0 / Math.max(20.0, rallyProj.dist)));
                const scale = uiScale * distScale;
                const radius = Math.round(9 * scale);

                ctx.save();
                ctx.fillStyle = (R.team === 2) ? "#2299ff" : "#ff3300";
                ctx.strokeStyle = "#000000";
                ctx.lineWidth = Math.max(1.5, 2.0 * scale);

                ctx.beginPath();
                ctx.arc(rallyProj.x, rallyProj.y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = "#39ff14"; // Green squad text
                ctx.font = `bold ${Math.round(11 * scale)}px Arial, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const sqdTxt = (R.squad && R.squad !== 0) ? String(R.squad) : "C";
                ctx.fillText(sqdTxt, rallyProj.x, rallyProj.y);
                ctx.restore();
            }
        }

        // ---------------------------------------------------------------------
        // 7. Render Ammo Caches HUD Markers
        // ---------------------------------------------------------------------
        if (typeof AllCaches !== "undefined" && typeof icons !== "undefined" && (icons.CacheRevealed || icons.CacheUnrevealed)) {
            for (const cId in AllCaches) {
                const cache = AllCaches[cId];
                if (!cache) continue;
                let groundY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(cache.X, cache.Z) : 0;
                const objY = (typeof cache.Y === "number") ? cache.Y : parseFloat(cache.Y);
                const baseElevY = (Number.isFinite(objY) && objY > groundY + 0.25) ? objY : groundY;
                const cacheProj = this.worldToScreen(cache.X, baseElevY + 1.5, cache.Z);
                if (!cacheProj) continue;

                const distScale = Math.max(0.6, Math.min(1.2, 70.0 / Math.max(20.0, cacheProj.dist)));
                const scale = uiScale * distScale;
                const img = cache.revealed ? icons.CacheRevealed : icons.CacheUnrevealed;
                if (img && img.complete && img.naturalWidth > 0) {
                    const iconSize = Math.round(26 * scale);
                    ctx.drawImage(img, Math.round(cacheProj.x - iconSize * 0.5), Math.round(cacheProj.y - iconSize * 0.5), iconSize, iconSize);
                }
            }
        }

        // ---------------------------------------------------------------------
        // Camera Flight Speed HUD Notification Badge (1.5s visual feedback)
        // ---------------------------------------------------------------------
        if (this.showSpeedNotification && (performance.now() - this.showSpeedNotification.time < 1600)) {
            const age = (performance.now() - this.showSpeedNotification.time) / 1000.0;
            const alpha = Math.min(1.0, (1.6 - age) * 2.5);
            const speedPrefix = (typeof ANALYSER_I18N !== "undefined" && typeof currentAnalyserLang !== "undefined"
                && ANALYSER_I18N[currentAnalyserLang] && ANALYSER_I18N[currentAnalyserLang].cameraSpeedPrefix)
                || "3D Camera Speed:";
            const text = `${speedPrefix} ${Math.round(this.showSpeedNotification.speed)} m/s`;

            ctx.save();
            ctx.font = "bold 12px Arial, Helvetica, sans-serif";
            const tw = ctx.measureText(text).width;
            const bw = tw + 22;
            const bh = 24;
            const bx = Math.round((this.canvas.width / 2) - (bw / 2));
            const by = this.canvas.height - 84;

            ctx.fillStyle = `rgba(23, 35, 34, ${0.93 * alpha})`;
            ctx.beginPath();
            if (typeof ctx.roundRect === "function") {
                ctx.roundRect(bx, by, bw, bh, 2);
            } else {
                ctx.rect(bx, by, bw, bh);
            }
            ctx.fill();

            ctx.strokeStyle = `rgba(85, 85, 85, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = `rgba(239, 239, 241, ${alpha})`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, this.canvas.width / 2, by + (bh / 2));
            ctx.restore();
        }

        if (typeof window !== "undefined" && window.DebugLab && typeof window.DebugLab.draw3DHud === "function") {
            window.DebugLab.draw3DHud(this, ctx);
        }

        if (fpvState && fpvState.active) {
            this.draw1PVHud(ctx, fpvState);
        }

        this._lastTick = curTick;

        // Continue animating smoothly until all icons settle onto their targets
        if (anyIconMoving && typeof is3DMode !== "undefined" && is3DMode && typeof requestUpdate === "function") {
            requestUpdate();
        }
    }

    draw1PVHud(ctx, fpvState) {
        if (!ctx || !this.canvas || !fpvState || !fpvState.active) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w * 0.5;
        const cy = h * 0.5;

        const r3d = (typeof renderer3d !== "undefined") ? renderer3d : null;
        const camYaw = r3d ? (r3d.cameraYaw || 0) : 0;
        const baseFov = (r3d && r3d.baseFov) ? r3d.baseFov : 90.0;
        const curFov = (r3d && r3d.fov) ? r3d.fov : baseFov;
        const isZooming = !!(r3d && (r3d.isZooming || (typeof keysDown !== "undefined" && keysDown.has(86)) || curFov < baseFov - 2.0));
        const mag = baseFov / Math.max(1.0, curFov);

        // ---------------------------------------------------------------------
        // 1. Top-Center Compact Compass Strip + Digital Bearing
        // ---------------------------------------------------------------------
        const bearing = (((-camYaw) % 360) + 360) % 360;
        const bearingInt = Math.round(bearing) % 360;
        const bearingText = String(bearingInt).padStart(3, "0") + "\u00B0";

        const compW = Math.min(300, Math.max(200, Math.round(w * 0.28)));
        const compH = 30;
        const compX = Math.round(cx - compW * 0.5);
        const compY = 14;

        ctx.save();
        ctx.fillStyle = "rgba(15, 22, 22, 0.78)";
        ctx.fillRect(compX, compY, compW, compH);
        ctx.strokeStyle = "rgba(143, 163, 161, 0.45)";
        ctx.lineWidth = 1;
        ctx.strokeRect(compX + 0.5, compY + 0.5, compW - 1, compH - 1);

        // Clip compass tape
        ctx.save();
        ctx.beginPath();
        ctx.rect(compX + 2, compY + 1, compW - 4, compH - 2);
        ctx.clip();

        const pxPerDeg = compW / 120.0;
        const cardinals = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (let degStep = -75; degStep <= 75; degStep += 5) {
            const worldDeg = Math.round((bearing + degStep) / 5) * 5;
            const delta = worldDeg - bearing;
            const tx = cx + delta * pxPerDeg;
            if (tx < compX || tx > compX + compW) continue;
            const normDeg = ((worldDeg % 360) + 360) % 360;
            const isMajor = (normDeg % 45 === 0);
            const isMid = (normDeg % 15 === 0);

            ctx.strokeStyle = isMajor ? "rgba(220, 236, 233, 0.85)" : "rgba(170, 190, 188, 0.45)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(Math.round(tx) + 0.5, compY + compH);
            ctx.lineTo(Math.round(tx) + 0.5, compY + compH - (isMajor ? 8 : (isMid ? 6 : 3)));
            ctx.stroke();

            if (cardinals[normDeg]) {
                ctx.font = "bold 10px Arial, sans-serif";
                ctx.fillStyle = (normDeg === 0) ? "#e2c87a" : "#d9e6e4";
                ctx.fillText(cardinals[normDeg], tx, compY + 5);
            } else if (normDeg % 30 === 0) {
                ctx.font = "9px monospace";
                ctx.fillStyle = "rgba(180, 200, 198, 0.78)";
                ctx.fillText(String(normDeg), tx, compY + 6);
            }
        }
        ctx.restore();

        // Center lubber triangle + bearing readout box
        ctx.fillStyle = "#e2c87a";
        ctx.beginPath();
        ctx.moveTo(cx, compY + 2);
        ctx.lineTo(cx - 4, compY - 3);
        ctx.lineTo(cx + 4, compY - 3);
        ctx.closePath();
        ctx.fill();

        const bBoxW = 42;
        const bBoxH = 16;
        const bBoxX = Math.round(cx - bBoxW * 0.5);
        const bBoxY = compY + compH + 3;
        ctx.fillStyle = "rgba(15, 22, 22, 0.85)";
        ctx.fillRect(bBoxX, bBoxY, bBoxW, bBoxH);
        ctx.strokeStyle = "rgba(143, 163, 161, 0.55)";
        ctx.strokeRect(bBoxX + 0.5, bBoxY + 0.5, bBoxW - 1, bBoxH - 1);
        ctx.font = "bold 10px monospace";
        ctx.fillStyle = "#eef6f5";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(bearingText, cx, bBoxY + bBoxH * 0.5 + 0.5);

        // ---------------------------------------------------------------------
        // 2. Center Crosshair / Tactical Optic Reticle
        // ---------------------------------------------------------------------
        if (fpvState.fpvEnclosed || isZooming) {
            const ringR = Math.min(w, h) * 0.30;
            if (fpvState.fpvEnclosed) {
                ctx.strokeStyle = "rgba(140, 210, 195, 0.38)";
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
                ctx.stroke();
            }

            const armLen = Math.min(96, Math.max(46, ringR * 0.45));
            const gap = 5;
            ctx.strokeStyle = "rgba(210, 245, 232, 0.82)";
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(cx - armLen, cy); ctx.lineTo(cx - gap, cy);
            ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + armLen, cy);
            ctx.moveTo(cx, cy - armLen); ctx.lineTo(cx, cy - gap);
            ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + armLen);
            ctx.stroke();

            // Mil ticks along axes
            ctx.lineWidth = 1;
            const tickStep = 16;
            for (let t = tickStep; t <= armLen - 6; t += tickStep) {
                const tickHalf = (t % (tickStep * 2) === 0) ? 4 : 2.5;
                ctx.beginPath();
                ctx.moveTo(cx - t, cy - tickHalf); ctx.lineTo(cx - t, cy + tickHalf);
                ctx.moveTo(cx + t, cy - tickHalf); ctx.lineTo(cx + t, cy + tickHalf);
                ctx.moveTo(cx - tickHalf, cy - t); ctx.lineTo(cx + tickHalf, cy - t);
                ctx.moveTo(cx - tickHalf, cy + t); ctx.lineTo(cx + tickHalf, cy + t);
                ctx.stroke();
            }

            ctx.fillStyle = "rgba(210, 245, 232, 0.9)";
            ctx.beginPath();
            ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
            ctx.fill();

            if (isZooming || mag > 1.08) {
                ctx.font = "bold 10px monospace";
                ctx.fillStyle = "rgba(210, 245, 232, 0.90)";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(mag.toFixed(1) + "x", cx + 14, cy + 14);
            }
        } else {
            const gap = 4;
            const len = 8;
            ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
            ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
            ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
            ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
            ctx.stroke();

            ctx.strokeStyle = "rgba(230, 242, 240, 0.85)";
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
            ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
            ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
            ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
            ctx.stroke();
        }

        // ---------------------------------------------------------------------
        // 3. Bottom-Center Tactical Info Bar + Action Buttons
        // ---------------------------------------------------------------------
        const p = fpvState.player;
        const v = fpvState.vehicle;
        const spdEntity = v || p;
        const spdKmh = (spdEntity && typeof getEntitySpeedKmh === "function") ? getEntitySpeedKmh(spdEntity) : 0;

        let altStr = "";
        if (r3d && r3d.cameraPos) {
            const wx = r3d.cameraPos[0];
            const wy = r3d.cameraPos[1];
            const wz = -r3d.cameraPos[2];
            const gh = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(wx, wz) : 0;
            const agl = Math.max(0, Math.round(wy - gh));
            if ((v && v.isFlyingVehicle) || agl >= 5) {
                altStr = `  |  ALT ${agl}m`;
            }
        }

        let unitTitle = "1PV";
        let kitStr = "";
        if (p) {
            unitTitle = p.name || "Soldier";
            if (p.kit) {
                kitStr = (typeof kitNameToReadable === "function") ? kitNameToReadable(p.kit) : p.kit;
            }
        } else if (v) {
            unitTitle = (typeof vehicleData !== "undefined" && v.name in vehicleData && vehicleData[v.name].HudName)
                ? vehicleData[v.name].HudName
                : (v.name || "Vehicle");
        }

        let vehSeatStr = "";
        if (v) {
            const vName = (typeof vehicleData !== "undefined" && v.name in vehicleData && vehicleData[v.name].HudName)
                ? vehicleData[v.name].HudName
                : (v.name || "Vehicle");
            let seatLabel = "";
            if (p) {
                let rawSeat = p.vehicleSeatName || "";
                if (v.name && rawSeat.startsWith(v.name)) {
                    rawSeat = rawSeat.substring(v.name.length);
                    if (rawSeat.startsWith("_")) rawSeat = rawSeat.substring(1);
                }
                if (rawSeat.length > 0) {
                    seatLabel = rawSeat.charAt(0).toUpperCase() + rawSeat.substring(1);
                } else {
                    seatLabel = (p.vehicleSlot === 0) ? "Driver" : (p.vehicleSlot === 1 ? "Gunner" : "Passenger");
                }
            }
            const seatCounter = (fpvState.crewCount > 0 && fpvState.seatIndex >= 0)
                ? ` [Seat ${fpvState.seatIndex + 1}/${fpvState.crewCount}]`
                : (fpvState.crewCount === 0 ? " [Empty]" : "");
            vehSeatStr = p ? `${vName} - ${seatLabel}${seatCounter}` : `${vName}${seatCounter}`;
        }

        // Health calculation
        let hpCur = 0, hpMax = 100;
        if (v && v.maxHealth > 0) {
            hpCur = Math.max(0, Math.round(v.health || 0));
            hpMax = Math.max(1, Math.round(v.maxHealth));
        } else if (p) {
            hpCur = p.isAlive ? Math.max(0, Math.round(p.health || 0)) : 0;
            hpMax = 100;
        }
        const hpPct = Math.max(0, Math.min(1, hpCur / hpMax));

        const infoLine1 = kitStr ? `${unitTitle} (${kitStr})` : unitTitle;
        const infoLine2 = (vehSeatStr ? `${vehSeatStr}  |  ` : "") + `SPD ${spdKmh.toFixed(0)} km/h${altStr}`;

        // Action Buttons
        const buttons = [];
        if (fpvState.mode === "vehicle" && fpvState.crewCount > 1) {
            buttons.push({
                label: "< Seat",
                onClick: () => {
                    if (typeof cycleSelectedVehiclePassenger === "function") cycleSelectedVehiclePassenger(-1);
                }
            });
            buttons.push({
                label: "Seat >",
                onClick: () => {
                    if (typeof cycleSelectedVehiclePassenger === "function") cycleSelectedVehiclePassenger(1);
                }
            });
        }
        if (r3d && (Math.abs(r3d.fpvYawOffset || 0) > 1.0 || Math.abs(r3d.fpvPitch || 0) > 1.0)) {
            buttons.push({
                label: "Center Look",
                onClick: () => {
                    r3d.fpvYawOffset = 0;
                    r3d.fpvPitch = 0;
                    if (typeof requestUpdate === "function") requestUpdate();
                }
            });
        }
        buttons.push({
            label: "Exit 1PV (F)",
            accent: true,
            onClick: () => {
                if (typeof toggleFirstPersonView === "function") toggleFirstPersonView(false);
            }
        });

        // Measure bar dimensions
        ctx.font = "bold 11px Arial, sans-serif";
        const w1 = ctx.measureText(infoLine1).width;
        ctx.font = "10.5px Arial, sans-serif";
        const w2 = ctx.measureText(infoLine2).width;

        ctx.font = "bold 10px Arial, sans-serif";
        let btnsTotalW = 0;
        const btnSpecs = buttons.map((b) => {
            const bw = Math.ceil(ctx.measureText(b.label).width) + 14;
            btnsTotalW += bw;
            return { ...b, w: bw, h: 19 };
        });
        if (btnSpecs.length > 1) btnsTotalW += (btnSpecs.length - 1) * 5;

        const barW = Math.max(280, Math.min(w - 30, Math.ceil(Math.max(w1 + 90, w2 + 24, btnsTotalW + 24))));
        const barH = 62;

        // Place cleanly above #controlBarContainer
        let bottomClearance = 20;
        const ctrlBar = document.getElementById("controlBarContainer");
        if (ctrlBar && ctrlBar.offsetHeight > 0 && ctrlBar.style.display !== "none") {
            const cRect = this.canvas.getBoundingClientRect();
            const tRect = ctrlBar.getBoundingClientRect();
            if (cRect && tRect && cRect.height > 0) {
                const scaleY = this.canvas.height / cRect.height;
                bottomClearance = Math.max(18, Math.round((cRect.bottom - tRect.top) * scaleY) + 10);
            }
        }

        const barX = Math.round(cx - barW * 0.5);
        const barY = Math.max(66, h - bottomClearance - barH);

        ctx.fillStyle = "rgba(15, 22, 22, 0.84)";
        ctx.fillRect(barX, barY, barW, barH);
        ctx.strokeStyle = "rgba(143, 163, 161, 0.48)";
        ctx.lineWidth = 1;
        ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);

        // Line 1: Name / Kit + Health Bar on right
        ctx.font = "bold 11px Arial, sans-serif";
        ctx.fillStyle = "#eef6f5";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(infoLine1, barX + 10, barY + 12);

        const hpBarW = 64;
        const hpBarH = 6;
        const hpBarX = barX + barW - hpBarW - 10;
        const hpBarY = barY + 9;
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.fillRect(hpBarX, hpBarY, hpBarW, hpBarH);
        ctx.fillStyle = (hpPct <= 0.30) ? "#ff4444" : ((hpPct <= 0.60) ? "#ffbb22" : "#35d448");
        ctx.fillRect(hpBarX, hpBarY, Math.round(hpBarW * hpPct), hpBarH);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.strokeRect(hpBarX + 0.5, hpBarY + 0.5, hpBarW - 1, hpBarH - 1);

        // Line 2: Vehicle / Seat / Speed / Altitude
        ctx.font = "10.5px Arial, sans-serif";
        ctx.fillStyle = "#bfd0ce";
        ctx.fillText(infoLine2, barX + 10, barY + 28);

        // Line 3: Clickable Action Buttons centered
        let bx = Math.round(cx - btnsTotalW * 0.5);
        const by = barY + 38;
        ctx.font = "bold 10px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < btnSpecs.length; i++) {
            const b = btnSpecs[i];
            ctx.fillStyle = b.accent ? "rgba(92, 42, 42, 0.88)" : "rgba(44, 64, 62, 0.88)";
            ctx.fillRect(bx, by, b.w, b.h);
            ctx.strokeStyle = b.accent ? "rgba(210, 120, 120, 0.75)" : "rgba(143, 163, 161, 0.65)";
            ctx.strokeRect(bx + 0.5, by + 0.5, b.w - 1, b.h - 1);
            ctx.fillStyle = "#eef6f5";
            ctx.fillText(b.label, bx + b.w * 0.5, by + b.h * 0.5 + 0.5);

            this.hudHitboxes.push({
                x: bx,
                y: by,
                w: b.w,
                h: b.h,
                onClick: b.onClick
            });
            bx += b.w + 5;
        }

        ctx.restore();
    }

    _getSmoothedWorldPos(ent, targetX, targetY, targetZ, dt, instant) {
        if (!ent || instant || ent._hudX == null || isNaN(ent._hudX) || ent._hudY == null || isNaN(ent._hudY) || ent._hudZ == null || isNaN(ent._hudZ)) {
            if (ent) {
                ent._hudX = targetX;
                ent._hudY = targetY;
                ent._hudZ = targetZ;
            }
            return { x: targetX, y: targetY, z: targetZ, settled: true };
        }

        const dx = targetX - ent._hudX;
        const dy = targetY - ent._hudY;
        const dz = targetZ - ent._hudZ;
        const distSq = dx * dx + dy * dy + dz * dz;

        // Snap immediately on teleport, spawn/respawn, or seek jump
        if (distSq > 144.0) {
            ent._hudX = targetX;
            ent._hudY = targetY;
            ent._hudZ = targetZ;
            return { x: targetX, y: targetY, z: targetZ, settled: true };
        }

        if (distSq < 0.0001) {
            ent._hudX = targetX;
            ent._hudY = targetY;
            ent._hudZ = targetZ;
            return { x: targetX, y: targetY, z: targetZ, settled: true };
        }

        const alphaXZ = 1.0 - Math.exp(-12.0 * dt);
        const alphaY = 1.0 - Math.exp(-6.5 * dt);

        ent._hudX += dx * alphaXZ;
        ent._hudY += dy * alphaY;
        ent._hudZ += dz * alphaXZ;

        return { x: ent._hudX, y: ent._hudY, z: ent._hudZ, settled: false };
    }

    _toCanvasCoords(screenX, screenY) {
        if (!this.canvas) return null;
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = (rect && rect.width > 0) ? (this.canvas.width / rect.width) : 1.0;
        const scaleY = (rect && rect.height > 0) ? (this.canvas.height / rect.height) : 1.0;
        return { x: screenX * scaleX, y: screenY * scaleY };
    }

    pickHudButtonAtScreenPos(screenX, screenY) {
        if (!this.initialized || !this.canvas || !this.hudHitboxes || this.hudHitboxes.length === 0) return null;
        const pt = this._toCanvasCoords(screenX, screenY);
        if (!pt) return null;
        for (let i = this.hudHitboxes.length - 1; i >= 0; i--) {
            const hb = this.hudHitboxes[i];
            if (pt.x >= hb.x && pt.x <= hb.x + hb.w && pt.y >= hb.y && pt.y <= hb.y + hb.h) {
                return hb;
            }
        }
        return null;
    }

    handleHudClick(screenX, screenY) {
        const hb = this.pickHudButtonAtScreenPos(screenX, screenY);
        if (!hb) return false;
        if (typeof hb.onClick === "function") {
            hb.onClick();
        }
        if (typeof requestUpdate === "function") requestUpdate();
        return true;
    }

    pickEntityAtScreenPos(screenX, screenY, includeHudButtons = true) {
        if (!this.initialized || !this.canvas) return null;
        if (includeHudButtons && this.pickHudButtonAtScreenPos(screenX, screenY)) {
            return { _isHudAction: true };
        }
        if (!this.hitboxes || this.hitboxes.length === 0) return null;

        const pt = this._toCanvasCoords(screenX, screenY);
        if (!pt) return null;
        const cx = pt.x;
        const cy = pt.y;

        let best = null;
        let bestScore = Infinity;

        for (let i = 0; i < this.hitboxes.length; i++) {
            const hb = this.hitboxes[i];
            const dx = cx - hb.x;
            const dy = cy - hb.y;
            const dSq = dx * dx + dy * dy;
            if (dSq <= hb.r * hb.r) {
                // Prefer icons closest to cursor, breaking close ties by camera depth
                const score = dSq + hb.dist * 0.001;
                if (score < bestScore) {
                    bestScore = score;
                    best = hb.entity;
                }
            }
        }
        return best;
    }

    computeSpottedEntities() {
        if (typeof ordersHistory === "undefined" || !ordersHistory) return null;

        const allOrders = ordersHistory.getAllOrders();
        if (!allOrders || allOrders.length === 0) return null;

        const spottedFobs = new Set();
        const spottedPlayers = new Set();
        const spottedVehicles = new Set();

        const currentTick = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;
        const fobRadius = (typeof options_FobLinkRadius !== "undefined") ? options_FobLinkRadius : 18;
        const spotRadius = (typeof options_SpottedZoneRadius !== "undefined") ? options_SpottedZoneRadius : 40;
        const dt = (typeof DemoTimePerTick !== "undefined") ? DemoTimePerTick : 0.04;

        // 1. Enemy FOB Spotting
        if (typeof AllFobs !== "undefined" && AllFobs) {
            for (const fobId in AllFobs) {
                const fob = AllFobs[fobId];
                if (!fob) continue;
                for (const order of allOrders) {
                    if (order.tick > currentTick) continue;
                    if (order.team === fob.team) continue;
                    const dist = Math.hypot(fob.X - order.X, fob.Z - order.Z);
                    if (dist <= fobRadius) {
                        spottedFobs.add(fob);
                        break;
                    }
                }
            }
        }

        // 2. Enemy Player Spotting
        if (typeof AllPlayers !== "undefined" && AllPlayers) {
            for (const pid in AllPlayers) {
                const player = AllPlayers[pid];
                if (!player || player.isJoining || !player.isAlive) continue;
                for (const order of allOrders) {
                    if (order.tick > currentTick) continue;
                    if (order.team === player.team) continue;
                    const px = (typeof player.getX === "function") ? player.getX() : player.X;
                    const pz = (typeof player.getZ === "function") ? player.getZ() : player.Z;
                    if (px == null || pz == null) continue;
                    const dist = Math.hypot(px - order.X, pz - order.Z);
                    const key = player.id + ":" + order.id;

                    if (dist <= spotRadius) {
                        if (typeof spottedPlayerEntryMap !== "undefined" && spottedPlayerEntryMap.has(key)) {
                            spottedPlayers.add(player);
                        } else {
                            const orderAgeSec = (currentTick - order.tick) * dt;
                            if (orderAgeSec <= 120) {
                                if (typeof spottedPlayerEntryMap !== "undefined") spottedPlayerEntryMap.set(key, true);
                                spottedPlayers.add(player);
                            }
                        }
                    } else if (typeof spottedPlayerEntryMap !== "undefined") {
                        spottedPlayerEntryMap.delete(key);
                    }
                }
            }
        }

        // 3. Enemy Vehicle Spotting
        if (typeof AllVehicles !== "undefined" && AllVehicles) {
            for (const vid in AllVehicles) {
                const veh = AllVehicles[vid];
                if (!veh || (typeof isVehicleContainer === "function" && isVehicleContainer(vid))) continue;
                for (const order of allOrders) {
                    if (order.tick > currentTick) continue;
                    if (order.team === veh.team) continue;
                    const vx = (typeof veh.getX === "function") ? veh.getX() : veh.X;
                    const vz = (typeof veh.getZ === "function") ? veh.getZ() : veh.Z;
                    if (vx == null || vz == null) continue;
                    const dist = Math.hypot(vx - order.X, vz - order.Z);
                    const key = veh.id + ":" + order.id;

                    if (dist <= spotRadius) {
                        if (typeof spottedVehicleEntryMap !== "undefined" && spottedVehicleEntryMap.has(key)) {
                            spottedVehicles.add(veh);
                        } else {
                            const orderAgeSec = (currentTick - order.tick) * dt;
                            if (orderAgeSec <= 120) {
                                if (typeof spottedVehicleEntryMap !== "undefined") spottedVehicleEntryMap.set(key, true);
                                spottedVehicles.add(veh);
                            }
                        }
                    } else if (typeof spottedVehicleEntryMap !== "undefined") {
                        spottedVehicleEntryMap.delete(key);
                    }
                }
            }
        }

        return { fobs: spottedFobs, players: spottedPlayers, vehicles: spottedVehicles };
    }
}

$(() => {
    hud3d = new Hud3d();
});
