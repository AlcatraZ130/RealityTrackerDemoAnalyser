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

        const uiScale = (typeof options_canvasScale !== "undefined") ? Math.max(0.4, Number(options_canvasScale)) : 1.0;
        const showPlayerHealth = (typeof options_health_players !== "undefined" && options_health_players) || (typeof HealthButtonDown !== "undefined" && HealthButtonDown);
        const showVehicleHealth = (typeof options_health_vehicles !== "undefined" && options_health_vehicles) || (typeof HealthButtonDown !== "undefined" && HealthButtonDown);
        const showKitIcons = (typeof options_DrawKitIcons !== "undefined") ? options_DrawKitIcons : true;
        const showAirHeight = (typeof options_DrawVehicleHeight !== "undefined") ? options_DrawVehicleHeight : true;
        const showSpotted = (typeof options_DrawSpottedIndicators !== "undefined") ? options_DrawSpottedIndicators : false;

        // ---------------------------------------------------------------------
        // 1. Render Floating Player HUD Elements (Health, Kits, Squad Leader Star)
        // ---------------------------------------------------------------------
        if (typeof AllPlayers !== "undefined") {
            for (const pId in AllPlayers) {
                const p = AllPlayers[pId];
                if (!p || p.isJoining || !p.isAlive) continue;

                // RULE: If player is inside a vehicle, do NOT draw floating kit/health on soldier
                if (p.vehicleid >= 0) continue;

                let px = (typeof p.getX === "function") ? p.getX() : p.X;
                let py = (typeof p.getY === "function") ? p.getY() : (p.Y || 0);
                let pz = (typeof p.getZ === "function") ? p.getZ() : p.Z;
                if (px == null || isNaN(px) || pz == null || isNaN(pz)) continue;

                let gh = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(px, pz) : 0;
                const floorY = Math.max(gh, py - 0.85);
                const relY = py - gh;
                const spdKmh = (typeof getEntitySpeedKmh === "function") ? getEntitySpeedKmh(p) : 0;

                let headElevation = 1.80; // Standing: sits neatly right above helmet (floorY + 1.80m, helmet top is at 1.58m)
                if (spdKmh < 3.0 && relY <= 0.25) {
                    headElevation = 0.65; // Prone: surface + 0.65m (prone mesh top is at 0.47m)
                } else if (relY <= 0.65) {
                    headElevation = 1.25; // Crouch: surface + 1.25m (crouch mesh top is at 1.05m)
                }

                // Head screen position with dynamic stance awareness
                const headProj = this.worldToScreen(px, floorY + headElevation, pz);
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
                }

                // C. SPOTTED Marker & Countdown
                if (showSpotted && p.spottedUntil && p.spottedUntil > (typeof Tick_Current !== "undefined" ? Tick_Current : 0)) {
                    const remainingSec = Math.max(0, Math.ceil((p.spottedUntil - Tick_Current) / 3.1));
                    ctx.fillStyle = "#ff2222";
                    ctx.strokeStyle = "#000000";
                    ctx.lineWidth = Math.max(2, 2.5 * finalScale);
                    ctx.font = `bold ${Math.round(11 * finalScale)}px Arial, sans-serif`;
                    ctx.textAlign = "center";
                    ctx.strokeText(`SPOTTED (${remainingSec}s)`, headProj.x, currentOffsetY - (4 * finalScale));
                    ctx.fillText(`SPOTTED (${remainingSec}s)`, headProj.x, currentOffsetY - (4 * finalScale));
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
                            const isTargeted = !!(s.laserTick || s.enterConeTick);
                            const isDead = !p.isAlive || !!s.deathTick;

                            let textColor = isDead ? "#999999" : (isTargeted ? "#ff2244" : "#ffffff");
                            let bgColor = isDead ? "rgba(40, 40, 40, 0.75)" : (isTargeted ? "rgba(180, 0, 30, 0.85)" : "rgba(80, 0, 120, 0.80)");
                            let borderColor = isDead ? "#555555" : (isTargeted ? "#ff4466" : "#aa33ee");

                            ctx.save();
                            ctx.font = `bold ${Math.round(11 * finalScale)}px Arial, sans-serif`;
                            const textWidth = ctx.measureText(timeText).width;
                            const padX = Math.round(5 * finalScale);
                            const badgeW = textWidth + padX * 2;
                            const badgeH = Math.round(15 * finalScale);
                            const badgeX = Math.round(headProj.x - badgeW * 0.5);
                            const badgeY = Math.round(currentOffsetY - badgeH - (2 * finalScale));

                            ctx.fillStyle = bgColor;
                            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
                            ctx.strokeStyle = borderColor;
                            ctx.lineWidth = Math.max(1, 1.2 * finalScale);
                            ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

                            ctx.fillStyle = textColor;
                            ctx.textAlign = "center";
                            ctx.textBaseline = "middle";
                            ctx.fillText(timeText, Math.round(headProj.x), Math.round(badgeY + badgeH * 0.5));
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
                const v = AllVehicles[vId];
                if (!v || v.isClimbingVehicle) continue;
                if (!showEmptyVehicles && (!v.Passengers || v.Passengers.size === 0)) continue;

                let vx = (typeof v.getX === "function") ? v.getX() : v.X;
                let vy = (typeof v._smoothY === "number" && !isNaN(v._smoothY)) ? v._smoothY : ((typeof v.getY === "function") ? v.getY() : (v.Y || 0));
                let vz = (typeof v.getZ === "function") ? v.getZ() : v.Z;
                if (vx == null || isNaN(vx) || vz == null || isNaN(vz)) continue;

                let groundH = 0;
                if (typeof heightmap !== "undefined") {
                    groundH = heightmap.getHeightFromCoords(vx, vz);
                    if (!v.isFlyingVehicle) vy = Math.max(vy, groundH + 0.5);
                }

                // Chassis top screen position
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

                        currentOffsetY = iconY;
                    }
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
            }
        }

        // ---------------------------------------------------------------------
        // 3. Squad Leader Orders in 3D (Attack, Defend, Move, Build, Destroy, Observe)
        // ---------------------------------------------------------------------
        const showOrders = (typeof options_drawAllOrderIcons !== "undefined") ? options_drawAllOrderIcons : false;
        if (showOrders && typeof AllSLOrders !== "undefined" && typeof icons !== "undefined" && icons.squadorders) {
            const orderEnums = [null, null, null, null, [0, "#cbc337"], [33, "#ff9900"], [66, "#ca32f2"], [99, "#ca32f2"], [132, "#ff9900"], [165, "#ff9900"]];

            for (const index in AllSLOrders) {
                const order = AllSLOrders[index];
                if (!order || order.type == null || order.type === -1 || order.X == null || order.Z == null) continue;

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
                const drawH = Math.round(32 * scale);

                ctx.save();
                ctx.drawImage(icons.squadorders, iconX, 12, 20, 32, Math.round(ordProj.x - drawW * 0.5), Math.round(ordProj.y - drawH), drawW, drawH);

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
        if (typeof AllFobs !== "undefined") {
            for (const fobId in AllFobs) {
                const fob = AllFobs[fobId];
                if (!fob) continue;
                let groundY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(fob.X, fob.Z) : 0;
                const fobProj = this.worldToScreen(fob.X, groundY + 2.5, fob.Z);
                if (!fobProj) continue;

                const distScale = Math.max(0.6, Math.min(1.2, 70.0 / Math.max(20.0, fobProj.dist)));
                const scale = uiScale * distScale;
                const triSize = Math.round(10 * scale);

                ctx.save();
                ctx.fillStyle = (fob.team === 2) ? "#2299ff" : "#ff3300";
                ctx.strokeStyle = "#000000";
                ctx.lineWidth = Math.max(1.5, 2.0 * scale);

                ctx.beginPath();
                ctx.moveTo(fobProj.x, fobProj.y - triSize);
                ctx.lineTo(fobProj.x + triSize, fobProj.y + triSize);
                ctx.lineTo(fobProj.x - triSize, fobProj.y + triSize);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = "#ffffff";
                ctx.font = `bold ${Math.round(9 * scale)}px Arial, sans-serif`;
                ctx.textAlign = "center";
                ctx.fillText("FOB", fobProj.x, fobProj.y + triSize + Math.round(11 * scale));
                ctx.restore();
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
                const rallyProj = this.worldToScreen(R.X, groundY + 1.2, R.Z);
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
                const cacheProj = this.worldToScreen(cache.X, groundY + 1.5, cache.Z);
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
            const text = `3D Camera Speed: ${Math.round(this.showSpeedNotification.speed)} m/s`;

            ctx.save();
            ctx.font = "bold 13px 'Roboto', 'Open Sans', sans-serif";
            const tw = ctx.measureText(text).width;
            const bx = (this.canvas.width / 2) - ((tw + 26) / 2);
            const by = this.canvas.height - 85;

            ctx.fillStyle = `rgba(15, 23, 42, ${0.85 * alpha})`;
            ctx.beginPath();
            if (typeof ctx.roundRect === "function") {
                ctx.roundRect(bx, by, tw + 26, 28, 6);
            } else {
                ctx.rect(bx, by, tw + 26, 28);
            }
            ctx.fill();

            ctx.strokeStyle = `rgba(59, 130, 246, ${0.9 * alpha})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, this.canvas.width / 2, by + 14);
            ctx.restore();
        }
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
