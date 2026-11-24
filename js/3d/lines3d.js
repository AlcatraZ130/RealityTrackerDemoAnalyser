// Part of RealityTracker Demo Analyser 3D ALPHA - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// High-Performance Hardware-Accelerated 3D Tactical Geometry & Terrain Projection Engine
// Renders:
// 1. Air Vehicle Vertical Altitude Drop Lines (Hardware Depth Occluded by Terrain)
// 2. 3D Volumetric Kill Arrows (Camera-Facing 3D Ribbon + 3D Arrowhead, Map-Wide Visibility)
// 3. Flag Capture Radii Projected Flat on 3D Terrain
// 4. Movement Sound Radii (12m/20m/35m & Vehicle Engines)
// 5. Shooting Sound Shockwaves (Expanding acoustic waves on terrain)
// 6. Orders & Spotted 3D Ground Rings

var lines3dRenderer;
var ns_activeExplosions3D = [];
var ns_activeLaunchSmoke3D = [];
var ns_activeSmokeScreens3D = [];

function trigger3DLaunchSmoke(x, y, z, projType, templateName) {
    if (x == null || isNaN(x) || z == null || isNaN(z)) return;
    if (typeof isFastForwarding !== "undefined" && isFastForwarding) return;

    let worldY = y;
    if (worldY == null || isNaN(worldY) || worldY <= 0) {
        if (typeof heightmap !== "undefined") {
            worldY = heightmap.getHeightFromCoords(x, z) + 1.2;
        } else {
            worldY = 1.2;
        }
    }

    const tName = (templateName || "").toLowerCase();
    const type = Number(projType || 0);

    let isHuge = (type === 33 || type === 34 || tName.includes('tow') || tName.includes('hat') || tName.includes('kornet') || tName.includes('rpg29') || tName.includes('eryx'));
    let maxRadius = isHuge ? 4.5 : 2.5;
    let duration = isHuge ? 1.4 : 0.85;

    ns_activeLaunchSmoke3D.push({
        x: x,
        y: worldY,
        z: z,
        spawnTime: performance.now(),
        startTick: (typeof Tick_Current !== "undefined") ? Tick_Current : 0,
        maxRadius: maxRadius,
        duration: duration,
        isHuge: isHuge
    });

    if (ns_activeLaunchSmoke3D.length > 40) {
        ns_activeLaunchSmoke3D.shift();
    }
}

function isSmokeProjectile(projType, templateName) {
    const tName = (templateName || "").toLowerCase();
    const type = Number(projType || 0);
    return (type === 39 || type === 41 || tName.includes("smoke") || tName.includes("smk") || tName.includes("ugd"));
}

function isBurningSmokeProjectile(projType, templateName) {
    if (!isSmokeProjectile(projType, templateName)) return false;
    const tName = (templateName || "").toLowerCase();
    const type = Number(projType || 0);
    // Instant-burst detonation smokes (vehicle M82/M82_brightIR, mortar smoke shell, tank smoke shell)
    if (type === 41 || type === 37 || type === 40) return false;
    if (tName === "m82" || tName.startsWith("m82_") || tName.includes("mortar") || tName.includes("tnk_")) return false;
    // Continuous-emitter soldier smokes (40mm_smoke, riflegrenade_smoke, plhgr_ugd200*, m18, rdg, l83, hgr_smoke)
    return true;
}

function getSmokeColorRGB(templateName) {
    const tName = (templateName || "").toLowerCase();
    if (tName.includes("ugd200red") || tName.includes("signalred") || tName.includes("_red")) return [0.84, 0.34, 0.32];
    if (tName.includes("purple") || tName.includes("ugd200")) return [0.66, 0.44, 0.78];
    if (tName.includes("green")) return [0.38, 0.72, 0.42];
    if (tName.includes("orange")) return [0.88, 0.56, 0.28];
    if (tName.includes("blue")) return [0.38, 0.58, 0.84];
    if (tName.includes("brown")) return [0.68, 0.52, 0.38];
    if (tName.includes("yellow")) return [0.88, 0.82, 0.36];
    return [0.90, 0.89, 0.87];
}

function computeSmokeCloudState(smk, elapsed) {
    if (!smk || elapsed < 0 || elapsed >= smk.totalDuration) {
        return { visible: false, alpha: 0, radiusScale: 0, heightScale: 0 };
    }
    if (smk.mode === "burning") {
        const emitDelay = smk.emitDelay || 2.0;
        const mainDelay = smk.mainDelay || 6.0;
        const fullSpread = smk.fullSpreadTime || 20.0;
        const burnEnd = smk.burnEnd || 60.0;

        if (elapsed < emitDelay) {
            return { visible: false, alpha: 0, radiusScale: 0, heightScale: 0 };
        }
        if (elapsed < mainDelay) {
            const t = (elapsed - emitDelay) / Math.max(0.1, mainDelay - emitDelay);
            return {
                visible: true,
                radiusScale: 0.10 + 0.24 * t,
                heightScale: 0.12 + 0.24 * t,
                alpha: 0.48 * t
            };
        }
        if (elapsed < fullSpread) {
            const t = (elapsed - mainDelay) / Math.max(0.1, fullSpread - mainDelay);
            const easeR = 1.0 - Math.pow(1.0 - t, 2.0);
            const easeH = 1.0 - Math.pow(1.0 - t, 1.8);
            return {
                visible: true,
                radiusScale: 0.34 + 0.66 * easeR,
                heightScale: 0.36 + 0.64 * easeH,
                alpha: 0.48 + 0.40 * t
            };
        }
        if (elapsed <= burnEnd) {
            return { visible: true, radiusScale: 1.0, heightScale: 1.0, alpha: 0.88 };
        }
        const fadeP = (elapsed - burnEnd) / Math.max(0.1, smk.totalDuration - burnEnd);
        return {
            visible: true,
            radiusScale: 1.0 + fadeP * 0.28,
            heightScale: 1.0 + fadeP * 0.22,
            alpha: 0.88 * Math.pow(Math.max(0.0, 1.0 - fadeP), 1.35)
        };
    }

    // Instant-burst mode (vehicle M82 / M82_brightIR, mortar smoke, tank smoke)
    const burstTime = smk.burstTime || 1.8;
    const peakDur = smk.peakDuration || 40.0;
    if (elapsed < burstTime) {
        const expP = elapsed / Math.max(0.1, burstTime);
        return {
            visible: true,
            radiusScale: 0.30 + 0.70 * (1.0 - Math.pow(1.0 - expP, 2.5)),
            heightScale: 0.30 + 0.70 * expP,
            alpha: 0.90 * expP
        };
    }
    if (elapsed <= peakDur) {
        return { visible: true, radiusScale: 1.0, heightScale: 1.0, alpha: 0.88 };
    }
    const fadeP = (elapsed - peakDur) / Math.max(0.1, smk.totalDuration - peakDur);
    return {
        visible: true,
        radiusScale: 1.0 + fadeP * 0.35,
        heightScale: 1.0 + fadeP * 0.25,
        alpha: 0.88 * Math.pow(Math.max(0.0, 1.0 - fadeP), 1.3)
    };
}

function _buildSmokeLobes(scaleMult) {
    const lobes = [];
    const numLobes = 9;
    const s = scaleMult || 1.0;
    for (let i = 0; i < numLobes; i++) {
        const ang = (i / numLobes) * Math.PI * 2 + (Math.random() * 0.3 - 0.15);
        const dist = (2.3 + Math.random() * 2.6) * s;
        lobes.push({
            dx: Math.cos(ang) * dist,
            dz: Math.sin(ang) * dist,
            dy: ((i % 2 === 0 ? 0.8 : 2.4) + Math.random() * 1.1) * s,
            baseR: (3.4 + Math.random() * 1.1) * s
        });
    }
    return lobes;
}

function triggerBurningSmokeScreen(projId, x, y, z, projType, templateName, customStartTimeSec = null) {
    if (x == null || isNaN(x) || z == null || isNaN(z)) return;
    if (customStartTimeSec == null && typeof isFastForwarding !== "undefined" && isFastForwarding) return;

    // Avoid duplicate entry for the same projectile ID
    for (let i = 0; i < ns_activeSmokeScreens3D.length; i++) {
        if (ns_activeSmokeScreens3D[i] && ns_activeSmokeScreens3D[i].projId === projId) return;
    }

    let worldY = y;
    if (worldY == null || isNaN(worldY) || worldY <= 0) {
        worldY = (typeof heightmap !== "undefined") ? (heightmap.getHeightFromCoords(x, z) + 0.2) : 0.2;
    }

    const tName = (templateName || "").toLowerCase();
    const is40mm = tName.includes("40mm") || tName.includes("riflegrenade");
    const burnEnd = is40mm ? 53.0 : 60.0;
    const fadeDuration = is40mm ? 15.0 : 18.0;
    const maxRadius = is40mm ? 6.0 : 7.5;
    const maxHeight = is40mm ? 6.5 : 7.5;

    const nowSec = (customStartTimeSec != null && customStartTimeSec > 0)
        ? customStartTimeSec
        : ((typeof Tick_Current !== "undefined" && typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null)
            ? tickToTime[Tick_Current]
            : (performance.now() / 1000.0));

    ns_activeSmokeScreens3D.push({
        projId: projId,
        mode: "burning",
        x: x,
        y: worldY,
        z: z,
        color: getSmokeColorRGB(templateName),
        spawnTime: performance.now(),
        startTick: (typeof Tick_Current !== "undefined") ? Tick_Current : 0,
        startTimeSeconds: nowSec,
        emitDelay: 2.0,
        mainDelay: 6.0,
        fullSpreadTime: is40mm ? 18.0 : 20.0,
        burnEnd: burnEnd,
        fadeDuration: fadeDuration,
        totalDuration: burnEnd + fadeDuration,
        maxHeight: maxHeight,
        maxRadius: maxRadius,
        lobes: _buildSmokeLobes(is40mm ? 0.85 : 1.0)
    });

    if (ns_activeSmokeScreens3D.length > 50) {
        ns_activeSmokeScreens3D.shift();
    }
}

function syncBurningSmokeScreensFromAllProj() {
    if (typeof AllProj === "undefined" || !AllProj) return;
    for (const projId in AllProj) {
        const proj = AllProj[projId];
        if (!proj) continue;
        if (!isBurningSmokeProjectile(proj.type, proj.templateName)) continue;
        const numId = Number(projId);
        let exists = false;
        for (let i = 0; i < ns_activeSmokeScreens3D.length; i++) {
            const s = ns_activeSmokeScreens3D[i];
            if (s && (s.projId === numId || s.projId === projId)) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            const px = (typeof proj.getX === "function") ? proj.getX() : proj.X;
            const py = (typeof proj.getY === "function") ? proj.getY() : proj.Y;
            const pz = (typeof proj.getZ === "function") ? proj.getZ() : proj.Z;
            triggerBurningSmokeScreen(numId, px, py, pz, proj.type, proj.templateName, proj.spawnTimeSec || null);
        }
    }
}

function trigger3DExplosion(x, y, z, projType, templateName, projId = null) {
    if (x == null || isNaN(x) || z == null || isNaN(z)) return;
    if (typeof isFastForwarding !== "undefined" && isFastForwarding) return;

    let worldY = y;
    if (worldY == null || isNaN(worldY) || worldY <= 0) {
        if (typeof heightmap !== "undefined") {
            worldY = heightmap.getHeightFromCoords(x, z) + 0.3;
        } else {
            worldY = 0.3;
        }
    }

    const tName = (templateName || "").toLowerCase();
    const type = Number(projType || 0);

    // -------------------------------------------------------------------------
    // Smoke Screen Grenades & Tank Smoke Screen Projectiles
    // -------------------------------------------------------------------------
    if (isSmokeProjectile(type, tName)) {
        const nowSec = (typeof Tick_Current !== "undefined" && typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null)
            ? tickToTime[Tick_Current]
            : (performance.now() / 1000.0);

        // If a burning soldier smoke screen already exists for this projId, transition it to dissipation
        if (projId != null) {
            for (let i = ns_activeSmokeScreens3D.length - 1; i >= 0; i--) {
                const smk = ns_activeSmokeScreens3D[i];
                if (smk && smk.projId === projId) {
                    const elapsed = (smk.startTimeSeconds > 0) ? (nowSec - smk.startTimeSeconds) : ((performance.now() - smk.spawnTime) / 1000.0);
                    smk.x = x;
                    smk.y = worldY;
                    smk.z = z;
                    smk.projId = null;
                    smk.burnEnd = Math.max(smk.fullSpreadTime || 18.0, elapsed);
                    smk.totalDuration = smk.burnEnd + (smk.fadeDuration || 16.0);
                    return;
                }
            }
        }

        // Instant-burst detonation smokes: vehicle M82 / M82_brightIR, mortar smoke, tank smoke shell
        const isMortarSmoke = (type === 37 || tName.includes("mortar"));
        const isTankShellSmoke = (type === 40 || tName.includes("tnk_"));
        const maxRadius = isMortarSmoke ? 12.0 : (isTankShellSmoke ? 9.0 : 7.5);
        const maxHeight = isMortarSmoke ? 10.0 : (isTankShellSmoke ? 8.5 : 8.0);
        const peakDuration = isMortarSmoke ? 50.0 : (isTankShellSmoke ? 45.0 : 40.0);
        const totalDuration = isMortarSmoke ? 85.0 : (isTankShellSmoke ? 75.0 : 70.0);

        ns_activeSmokeScreens3D.push({
            projId: null,
            mode: "burst",
            x: x,
            y: worldY,
            z: z,
            color: getSmokeColorRGB(templateName),
            spawnTime: performance.now(),
            startTick: (typeof Tick_Current !== "undefined") ? Tick_Current : 0,
            startTimeSeconds: nowSec,
            burstTime: isMortarSmoke ? 2.5 : 1.8,
            peakDuration: peakDuration,
            totalDuration: totalDuration,
            maxHeight: maxHeight,
            maxRadius: maxRadius,
            lobes: _buildSmokeLobes(isMortarSmoke ? 1.45 : (isTankShellSmoke ? 1.15 : 1.0))
        });

        if (ns_activeSmokeScreens3D.length > 50) {
            ns_activeSmokeScreens3D.shift();
        }
        return;
    }

    let isHuge = (type === 33 || type === 34 || type === 40 || type === 6 ||
                  tName.includes('tow') || tName.includes('hat') || tName.includes('kornet') ||
                  tName.includes('satchel') || tName.includes('155mm') || tName.includes('artillery') ||
                  tName.includes('mortar_120') || tName.includes('tnk') || tName.includes('tank') ||
                  tName.includes('120mm') || tName.includes('125mm') || tName.includes('bomb') || tName.includes('ied_large'));

    let isSmall = (type === 36 || type === 37 || type === 38 || type === 2 || type === 4 ||
                   tName.includes('grenade') || tName.includes('m203') || tName.includes('gp25') ||
                   tName.includes('ag36') || tName.includes('frag') || tName.includes('mineap') ||
                   tName.includes('f1') || tName.includes('m67'));

    let isFrag = (type === 38 || tName.includes('f1grenade') || tName.includes('m67') || tName.includes('l109') || tName.includes('rgo88') || tName.includes('of37') || tName.includes('dm51'));

    let maxRadius = isHuge ? 16.0 : (isFrag ? 8.5 : (isSmall ? 5.5 : 9.5));
    let duration = isHuge ? 0.85 : (isFrag ? 0.65 : (isSmall ? 0.45 : 0.65));
    let debrisCount = isHuge ? 26 : (isFrag ? 14 : (isSmall ? 10 : 18));
    let burstSpeed = isHuge ? 26.0 : (isFrag ? 15.0 : (isSmall ? 12.0 : 18.0));

    const particles = [];
    for (let i = 0; i < debrisCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const elevation = Math.random() * 0.85 + 0.15;
        const spd = burstSpeed * (0.5 + Math.random() * 0.7);
        particles.push({
            vx: Math.cos(angle) * spd * Math.cos(elevation),
            vy: Math.sin(elevation) * spd + (Math.random() * 3.5),
            vz: Math.sin(angle) * spd * Math.cos(elevation),
            size: (isHuge ? 0.40 : (isSmall ? 0.18 : 0.28)) * (0.8 + Math.random() * 0.5)
        });
    }

    ns_activeExplosions3D.push({
        x: x,
        y: worldY,
        z: z,
        spawnTime: performance.now(),
        startTick: (typeof Tick_Current !== "undefined") ? Tick_Current : 0,
        maxRadius: maxRadius,
        duration: duration,
        isHuge: isHuge,
        isSmall: isSmall,
        isFrag: isFrag,
        particles: particles
    });

    if (ns_activeExplosions3D.length > 50) {
        ns_activeExplosions3D.shift();
    }
}

class Lines3dRenderer extends Initializable {
    program = null;
    gpu_pos_buffer = null;
    gpu_col_buffer = null;

    aPosition = -1;
    aColor = -1;
    uViewMatrix = null;
    uProjectionMatrix = null;

    initialized = false;
    dataReady = true;

    // Preallocated Float32 buffers for batch rendering (200,000 vertices max per frame)
    maxVertices = 200000;
    positions = new Float32Array(200000 * 3);
    colors = new Float32Array(200000 * 4);
    
    lineVertexCount = 0;
    triVertexCount = 0;

    constructor() {
        super();
    }

    init() {
        if (this.initialized) return true;

        const gl = renderer3d.gl;
        if (!gl) return false;

        const vsSource = `#version 300 es
            in vec3 aPosition;
            in vec4 aColor;

            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;

            out vec4 vColor;

            void main() {
                vColor = aColor;
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(aPosition, 1.0);
            }
        `;

        const fsSource = `#version 300 es
            precision mediump float;
            in vec4 vColor;
            out vec4 fragColor;

            void main() {
                fragColor = vColor;
            }
        `;

        this.program = this.createProgram(gl, vsSource, fsSource);
        if (!this.program) return false;

        this.aPosition = gl.getAttribLocation(this.program, "aPosition");
        this.aColor = gl.getAttribLocation(this.program, "aColor");
        this.uViewMatrix = gl.getUniformLocation(this.program, "uViewMatrix");
        this.uProjectionMatrix = gl.getUniformLocation(this.program, "uProjectionMatrix");

        this.gpu_pos_buffer = gl.createBuffer();
        this.gpu_col_buffer = gl.createBuffer();

        this.initialized = true;
        return true;
    }

    createProgram(gl, vsSource, fsSource) {
        const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return null;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error("Lines3D shader link error:", gl.getProgramInfoLog(prog));
            return null;
        }
        return prog;
    }

    compileShader(gl, type, source) {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error("Lines3D shader compile error:", gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
        }
        return s;
    }

    addLine(x1, y1, z1, x2, y2, z2, r, g, b, a) {
        if (this.lineVertexCount + 2 > 6000) return;

        const idx = this.lineVertexCount * 3;
        const cIdx = this.lineVertexCount * 4;

        this.positions[idx] = x1; this.positions[idx + 1] = y1; this.positions[idx + 2] = z1;
        this.colors[cIdx] = r; this.colors[cIdx + 1] = g; this.colors[cIdx + 2] = b; this.colors[cIdx + 3] = a;

        this.positions[idx + 3] = x2; this.positions[idx + 4] = y2; this.positions[idx + 5] = z2;
        this.colors[cIdx + 4] = r; this.colors[cIdx + 5] = g; this.colors[cIdx + 6] = b; this.colors[cIdx + 7] = a;

        this.lineVertexCount += 2;
    }

    addTri(x1, y1, z1, x2, y2, z2, x3, y3, z3, r, g, b, a) {
        const offset = 6000; // Start triangles after line buffer space
        if (this.triVertexCount + 3 > (this.maxVertices - offset)) return;

        const idx = (offset + this.triVertexCount) * 3;
        const cIdx = (offset + this.triVertexCount) * 4;

        // V1
        this.positions[idx] = x1; this.positions[idx + 1] = y1; this.positions[idx + 2] = z1;
        this.colors[cIdx] = r; this.colors[cIdx + 1] = g; this.colors[cIdx + 2] = b; this.colors[cIdx + 3] = a;

        // V2
        this.positions[idx + 3] = x2; this.positions[idx + 4] = y2; this.positions[idx + 5] = z2;
        this.colors[cIdx + 4] = r; this.colors[cIdx + 5] = g; this.colors[cIdx + 6] = b; this.colors[cIdx + 7] = a;

        // V3
        this.positions[idx + 6] = x3; this.positions[idx + 7] = y3; this.positions[idx + 8] = z3;
        this.colors[cIdx + 8] = r; this.colors[cIdx + 9] = g; this.colors[cIdx + 10] = b; this.colors[cIdx + 11] = a;

        this.triVertexCount += 3;
    }

    // Flat ground ring on local surface (e.g. for rooftops or soldier feet)
    add3DGroundRing(cx, cy, cz, innerRadius, outerRadius, r, g, b, a, segments = 32) {
        const dTheta = (Math.PI * 2) / segments;
        for (let i = 0; i < segments; i++) {
            const t1 = i * dTheta;
            const t2 = (i + 1) * dTheta;

            const cos1 = Math.cos(t1), sin1 = Math.sin(t1);
            const cos2 = Math.cos(t2), sin2 = Math.sin(t2);

            const inX1 = cx + cos1 * innerRadius, inZ1 = -cz - sin1 * innerRadius;
            const outX1 = cx + cos1 * outerRadius, outZ1 = -cz - sin1 * outerRadius;

            const inX2 = cx + cos2 * innerRadius, inZ2 = -cz - sin2 * innerRadius;
            const outX2 = cx + cos2 * outerRadius, outZ2 = -cz - sin2 * outerRadius;

            this.addTri(inX1, cy, inZ1, outX1, cy, outZ1, inX2, cy, inZ2, r, g, b, a);
            this.addTri(outX1, cy, outZ1, outX2, cy, outZ2, inX2, cy, inZ2, r, g, b, a);
        }
    }

    // Tactical 4-arc segmented reticle ring on ground (calm slow rotation, matches 2D Spotted reticle)
    add3DSpottedReticle(cx, cy, cz, radius, thickness, r, g, b, a, rotRad = 0) {
        const arcCount = 4;
        const arcSpan = (Math.PI * 2) / arcCount;
        const drawSpan = arcSpan * 0.62; // 4 clean arcs with 38% tactical gaps
        const segsPerArc = 7;
        const innerR = Math.max(0.05, radius);
        const outerR = innerR + thickness;

        for (let k = 0; k < arcCount; k++) {
            const baseA = rotRad + k * arcSpan - drawSpan * 0.5;
            const step = drawSpan / segsPerArc;
            for (let s = 0; s < segsPerArc; s++) {
                const t1 = baseA + s * step;
                const t2 = baseA + (s + 1) * step;
                const c1 = Math.cos(t1), s1 = Math.sin(t1);
                const c2 = Math.cos(t2), s2 = Math.sin(t2);

                const inX1 = cx + c1 * innerR, inZ1 = cz + s1 * innerR;
                const outX1 = cx + c1 * outerR, outZ1 = cz + s1 * outerR;
                const inX2 = cx + c2 * innerR, inZ2 = cz + s2 * innerR;
                const outX2 = cx + c2 * outerR, outZ2 = cz + s2 * outerR;

                this.addTri(inX1, cy, -inZ1, outX1, cy, -outZ1, inX2, cy, -inZ2, r, g, b, a);
                this.addTri(outX1, cy, -outZ1, outX2, cy, -outZ2, inX2, cy, -inZ2, r, g, b, a);
            }
        }
    }

    // Tactical Flag Capture Sector: crisp terrain perimeter + soft inward ground fade + low vertical curtain (1.45m)
    add3DFlagSector(cx, cz, radius, r, g, b, segments = 56) {
        if (!Number.isFinite(cx) || !Number.isFinite(cz) || !(radius > 0)) return;
        const dTheta = (Math.PI * 2) / segments;
        const bandW = Math.max(0.42, Math.min(1.05, radius * 0.015));
        const innerFadeR = Math.max(0.0, radius - Math.min(radius * 0.26, 5.5));
        const innerBandR = Math.max(0.0, radius - bandW);
        const curtainH = 1.45;

        const sampleH = (wx, wz) => {
            if (typeof heightmap !== "undefined") {
                const h = heightmap.getHeightFromCoords(wx, wz);
                if (Number.isFinite(h)) return h + 0.14;
            }
            return 0.14;
        };

        for (let i = 0; i < segments; i++) {
            const t1 = i * dTheta;
            const t2 = (i + 1) * dTheta;
            const c1 = Math.cos(t1), s1 = Math.sin(t1);
            const c2 = Math.cos(t2), s2 = Math.sin(t2);

            // Outer perimeter coordinates
            const ox1 = cx + c1 * radius, oz1 = cz + s1 * radius;
            const ox2 = cx + c2 * radius, oz2 = cz + s2 * radius;
            const oy1 = sampleH(ox1, oz1);
            const oy2 = sampleH(ox2, oz2);

            // Inner edge of crisp perimeter line
            const bx1 = cx + c1 * innerBandR, bz1 = cz + s1 * innerBandR;
            const bx2 = cx + c2 * innerBandR, bz2 = cz + s2 * innerBandR;
            const by1 = sampleH(bx1, bz1);
            const by2 = sampleH(bx2, bz2);

            // 1. Crisp terrain perimeter band
            this.addTri(bx1, by1, -bz1, ox1, oy1, -oz1, bx2, by2, -bz2, r, g, b, 0.72);
            this.addTri(ox1, oy1, -oz1, ox2, oy2, -oz2, bx2, by2, -bz2, r, g, b, 0.72);

            // 2. Soft inward ground gradient (0.20 -> 0.0)
            if (innerFadeR < innerBandR) {
                const fx1 = cx + c1 * innerFadeR, fz1 = cz + s1 * innerFadeR;
                const fx2 = cx + c2 * innerFadeR, fz2 = cz + s2 * innerFadeR;
                const fy1 = sampleH(fx1, fz1);
                const fy2 = sampleH(fx2, fz2);

                this._addTriGrad(
                    fx1, fy1, -fz1, r, g, b, 0.0,
                    bx1, by1, -bz1, r, g, b, 0.20,
                    fx2, fy2, -fz2, r, g, b, 0.0
                );
                this._addTriGrad(
                    bx1, by1, -bz1, r, g, b, 0.20,
                    bx2, by2, -bz2, r, g, b, 0.20,
                    fx2, fy2, -fz2, r, g, b, 0.0
                );
            }

            // 3. Low holographic vertical curtain (0.28 at ground -> 0.0 at +1.45m)
            this._addTriGrad(
                ox1, oy1, -oz1, r, g, b, 0.28,
                ox1, oy1 + curtainH, -oz1, r, g, b, 0.0,
                ox2, oy2, -oz2, r, g, b, 0.28
            );
            this._addTriGrad(
                ox1, oy1 + curtainH, -oz1, r, g, b, 0.0,
                ox2, oy2 + curtainH, -oz2, r, g, b, 0.0,
                ox2, oy2, -oz2, r, g, b, 0.28
            );
        }
    }

    // Large terrain ring that samples heightmap elevation at every vertex to hug hills & valleys
    add3DTerrainRing(cx, cz, innerRadius, outerRadius, r, g, b, a, segments = 36) {
        const dTheta = (Math.PI * 2) / segments;
        for (let i = 0; i < segments; i++) {
            const t1 = i * dTheta;
            const t2 = (i + 1) * dTheta;

            const cos1 = Math.cos(t1), sin1 = Math.sin(t1);
            const cos2 = Math.cos(t2), sin2 = Math.sin(t2);

            const inX1 = cx + cos1 * innerRadius, inZ1 = cz + sin1 * innerRadius;
            const outX1 = cx + cos1 * outerRadius, outZ1 = cz + sin1 * outerRadius;

            const inX2 = cx + cos2 * innerRadius, inZ2 = cz + sin2 * innerRadius;
            const outX2 = cx + cos2 * outerRadius, outZ2 = cz + sin2 * outerRadius;

            let inY1 = 0.1, outY1 = 0.1, inY2 = 0.1, outY2 = 0.1;
            if (typeof heightmap !== "undefined") {
                inY1 = heightmap.getHeightFromCoords(inX1, inZ1) + 0.12;
                outY1 = heightmap.getHeightFromCoords(outX1, outZ1) + 0.12;
                inY2 = heightmap.getHeightFromCoords(inX2, inZ2) + 0.12;
                outY2 = heightmap.getHeightFromCoords(outX2, outZ2) + 0.12;
            }

            this.addTri(inX1, inY1, -inZ1, outX1, outY1, -outZ1, inX2, inY2, -inZ2, r, g, b, a);
            this.addTri(outX1, outY1, -outZ1, outX2, outY2, -outZ2, inX2, inY2, -inZ2, r, g, b, a);
        }
    }

    // Terrain-hugging ring with crisp outer edge + smooth inward alpha fade
    add3DSoftTerrainRing(cx, cz, radius, bandW, fadeInW, r, g, b, a, segments = 48) {
        if (!Number.isFinite(cx) || !Number.isFinite(cz) || !(radius > 0.1) || !(a > 0.005)) return;
        const dTheta = (Math.PI * 2) / segments;
        const innerBandR = Math.max(0.0, radius - bandW);
        const innerFadeR = Math.max(0.0, innerBandR - fadeInW);
        const fadeAlpha = a * 0.28;

        const sampleH = (wx, wz) => {
            if (typeof heightmap !== "undefined") {
                const h = heightmap.getHeightFromCoords(wx, wz);
                if (Number.isFinite(h)) return h + 0.14;
            }
            return 0.14;
        };

        for (let i = 0; i < segments; i++) {
            const t1 = i * dTheta;
            const t2 = (i + 1) * dTheta;
            const c1 = Math.cos(t1), s1 = Math.sin(t1);
            const c2 = Math.cos(t2), s2 = Math.sin(t2);

            const ox1 = cx + c1 * radius, oz1 = cz + s1 * radius;
            const ox2 = cx + c2 * radius, oz2 = cz + s2 * radius;
            const oy1 = sampleH(ox1, oz1);
            const oy2 = sampleH(ox2, oz2);

            const bx1 = cx + c1 * innerBandR, bz1 = cz + s1 * innerBandR;
            const bx2 = cx + c2 * innerBandR, bz2 = cz + s2 * innerBandR;
            const by1 = sampleH(bx1, bz1);
            const by2 = sampleH(bx2, bz2);

            // Crisp perimeter band
            this.addTri(bx1, by1, -bz1, ox1, oy1, -oz1, bx2, by2, -bz2, r, g, b, a);
            this.addTri(ox1, oy1, -oz1, ox2, oy2, -oz2, bx2, by2, -bz2, r, g, b, a);

            // Soft inward gradient
            if (fadeInW > 0.05 && innerFadeR < innerBandR) {
                const fx1 = cx + c1 * innerFadeR, fz1 = cz + s1 * innerFadeR;
                const fx2 = cx + c2 * innerFadeR, fz2 = cz + s2 * innerFadeR;
                const fy1 = sampleH(fx1, fz1);
                const fy2 = sampleH(fx2, fz2);

                this._addTriGrad(
                    fx1, fy1, -fz1, r, g, b, 0.0,
                    bx1, by1, -bz1, r, g, b, fadeAlpha,
                    fx2, fy2, -fz2, r, g, b, 0.0
                );
                this._addTriGrad(
                    bx1, by1, -bz1, r, g, b, fadeAlpha,
                    bx2, by2, -bz2, r, g, b, fadeAlpha,
                    fx2, fy2, -fz2, r, g, b, 0.0
                );
            }
        }
    }

    // Terrain-hugging dashed perimeter ring (with optional subtle inward gradient)
    add3DDashedTerrainRing(cx, cz, radius, thickness, r, g, b, a, dashCount = 40, innerFadeW = 0) {
        if (!Number.isFinite(cx) || !Number.isFinite(cz) || !(radius > 0.1) || !(a > 0.005)) return;
        const innerR = Math.max(0.0, radius - thickness);
        const fadeR = Math.max(0.0, innerR - innerFadeW);
        const slotAngle = (Math.PI * 2) / dashCount;
        const dashSpan = slotAngle * 0.58;
        const subSegs = radius > 60 ? 2 : 1;

        const sampleH = (wx, wz) => {
            if (typeof heightmap !== "undefined") {
                const h = heightmap.getHeightFromCoords(wx, wz);
                if (Number.isFinite(h)) return h + 0.15;
            }
            return 0.15;
        };

        for (let d = 0; d < dashCount; d++) {
            const startA = d * slotAngle;
            for (let s = 0; s < subSegs; s++) {
                const t1 = startA + (s / subSegs) * dashSpan;
                const t2 = startA + ((s + 1) / subSegs) * dashSpan;
                const c1 = Math.cos(t1), s1 = Math.sin(t1);
                const c2 = Math.cos(t2), s2 = Math.sin(t2);

                const ox1 = cx + c1 * radius, oz1 = cz + s1 * radius;
                const ox2 = cx + c2 * radius, oz2 = cz + s2 * radius;
                const oy1 = sampleH(ox1, oz1);
                const oy2 = sampleH(ox2, oz2);

                const ix1 = cx + c1 * innerR, iz1 = cz + s1 * innerR;
                const ix2 = cx + c2 * innerR, iz2 = cz + s2 * innerR;
                const iy1 = sampleH(ix1, iz1);
                const iy2 = sampleH(ix2, iz2);

                this.addTri(ix1, iy1, -iz1, ox1, oy1, -oz1, ix2, iy2, -iz2, r, g, b, a);
                this.addTri(ox1, oy1, -oz1, ox2, oy2, -oz2, ix2, iy2, -iz2, r, g, b, a);

                if (innerFadeW > 0.05 && fadeR < innerR) {
                    const fx1 = cx + c1 * fadeR, fz1 = cz + s1 * fadeR;
                    const fx2 = cx + c2 * fadeR, fz2 = cz + s2 * fadeR;
                    const fy1 = sampleH(fx1, fz1);
                    const fy2 = sampleH(fx2, fz2);
                    const fa = a * 0.18;

                    this._addTriGrad(
                        fx1, fy1, -fz1, r, g, b, 0.0,
                        ix1, iy1, -iz1, r, g, b, fa,
                        fx2, fy2, -fz2, r, g, b, 0.0
                    );
                    this._addTriGrad(
                        ix1, iy1, -iz1, r, g, b, fa,
                        ix2, iy2, -iz2, r, g, b, fa,
                        fx2, fy2, -fz2, r, g, b, 0.0
                    );
                }
            }
        }
    }

    // Clean 3D dashed vector line (for tactical SL orders, etc.)
    add3DDashedLine(x1, y1, z1, x2, y2, z2, r, g, b, a, dashLen = 4.0, gapLen = 2.4) {
        const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
        const totalLen = Math.hypot(dx, dy, dz);
        if (totalLen < 0.1) return;
        const step = dashLen + gapLen;
        const maxDashes = 110;
        const effStep = Math.max(step, totalLen / maxDashes);
        const effDash = effStep * (dashLen / step);

        for (let dist = 0; dist < totalLen; dist += effStep) {
            const t0 = dist / totalLen;
            const t1 = Math.min(1.0, (dist + effDash) / totalLen);
            this.addLine(
                x1 + dx * t0, y1 + dy * t0, z1 + dz * t0,
                x1 + dx * t1, y1 + dy * t1, z1 + dz * t1,
                r, g, b, a
            );
        }
    }

    // Expanding 3D Fireball Hemisphere / Sphere for explosions
    add3DFireball(cx, cy, cz, radius, r, g, b, a, rings = 5, segments = 8) {
        for (let i = 0; i < rings; i++) {
            const phi1 = (i / rings) * (Math.PI * 0.5);
            const phi2 = ((i + 1) / rings) * (Math.PI * 0.5);
            const y1 = cy + Math.sin(phi1) * radius;
            const y2 = cy + Math.sin(phi2) * radius;
            const r1 = Math.cos(phi1) * radius;
            const r2 = Math.cos(phi2) * radius;

            for (let j = 0; j < segments; j++) {
                const theta1 = (j / segments) * (Math.PI * 2);
                const theta2 = ((j + 1) / segments) * (Math.PI * 2);

                const x11 = cx + Math.cos(theta1) * r1, z11 = -cz - Math.sin(theta1) * r1;
                const x12 = cx + Math.cos(theta2) * r1, z12 = -cz - Math.sin(theta2) * r1;
                const x21 = cx + Math.cos(theta1) * r2, z21 = -cz - Math.sin(theta1) * r2;
                const x22 = cx + Math.cos(theta2) * r2, z22 = -cz - Math.sin(theta2) * r2;

                this.addTri(x11, y1, z11, x21, y2, z21, x12, y1, z12, r, g, b, a);
                this.addTri(x12, y1, z12, x21, y2, z21, x22, y2, z22, r, g, b, a);
            }
        }
    }

    // Volumetric 3D Smoke Billow Dome (Spherical with softened top/bottom)
    add3DSmokeDome(cx, cy, cz, radius, height, r, g, b, a, rings = 4, segments = 7) {
        for (let i = 0; i < rings; i++) {
            const phi1 = (i / rings) * Math.PI;
            const phi2 = ((i + 1) / rings) * Math.PI;
            const y1 = cy + Math.cos(phi1) * height;
            const y2 = cy + Math.cos(phi2) * height;
            const r1 = Math.sin(phi1) * radius;
            const r2 = Math.sin(phi2) * radius;

            for (let j = 0; j < segments; j++) {
                const theta1 = (j / segments) * (Math.PI * 2);
                const theta2 = ((j + 1) / segments) * (Math.PI * 2);

                const x11 = cx + Math.cos(theta1) * r1, z11 = -cz - Math.sin(theta1) * r1;
                const x12 = cx + Math.cos(theta2) * r1, z12 = -cz - Math.sin(theta2) * r1;
                const x21 = cx + Math.cos(theta1) * r2, z21 = -cz - Math.sin(theta1) * r2;
                const x22 = cx + Math.cos(theta2) * r2, z22 = -cz - Math.sin(theta2) * r2;

                this.addTri(x11, y1, z11, x21, y2, z21, x12, y1, z12, r, g, b, a);
                this.addTri(x12, y1, z12, x21, y2, z21, x22, y2, z22, r, g, b, a);
            }
        }
    }

    // 3D Flying Sparks & Fiery Debris Ember Diamond
    add3DDebrisParticle(x, y, z, size, r, g, b, a) {
        const s = size;
        const nz = -z;
        this.addTri(x - s, y, nz, x + s, y, nz, x, y + s * 1.4, nz, r, g, b, a);
        this.addTri(x - s, y, nz, x, y - s * 1.4, nz, x + s, y, nz, r, g, b, a);
        this.addTri(x, y, nz - s, x, y, nz + s, x, y + s * 1.4, nz, r, g, b, a);
        this.addTri(x, y, nz - s, x, y - s * 1.4, nz, x, y, nz + s, r, g, b, a);
    }

    parseRgba(str, defaultAlpha = 0.5) {
        if (!str) return [1.0, 0.85, 0.2, defaultAlpha];
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (m) {
            return [
                Number(m[1]) / 255.0,
                Number(m[2]) / 255.0,
                Number(m[3]) / 255.0,
                m[4] !== undefined ? Number(m[4]) : defaultAlpha
            ];
        }
        return [1.0, 0.85, 0.2, defaultAlpha];
    }

    updateAndRenderVehicleAura3D(v) {
        if (!v) return;
        const vx = (typeof v.getX === "function") ? v.getX() : v.X;
        const vz = (typeof v.getZ === "function") ? v.getZ() : v.Z;
        if (vx == null || isNaN(vx) || vz == null || isNaN(vz)) return;

        let hasDriver = false;
        if (v.Passengers && typeof v.Passengers.forEach === "function") {
            v.Passengers.forEach((pid) => {
                const passenger = (typeof AllPlayers !== "undefined") ? AllPlayers[pid] : null;
                if (passenger && (passenger.vehicleSlot === 0 || passenger.vehicleSlot == null || passenger.vehicleSlot === "0")) {
                    hasDriver = true;
                }
            });
        } else if (Array.isArray(v.Passengers)) {
            for (const pid of v.Passengers) {
                const passenger = (typeof AllPlayers !== "undefined") ? AllPlayers[pid] : null;
                if (passenger && (passenger.vehicleSlot === 0 || passenger.vehicleSlot == null || passenger.vehicleSlot === "0")) {
                    hasDriver = true;
                    break;
                }
            }
        }

        const spdKmh = (typeof getEntitySpeedKmh === "function") ? getEntitySpeedKmh(v) : 0;
        const vName = (v.name || "").toLowerCase();
        const isHeavy = vName.includes("tnk") || vName.includes("tank") || vName.includes("apc") || vName.includes("bmp") || vName.includes("btr");
        const isHeli = vName.includes("heli") || vName.includes("uh60") || vName.includes("mi8") || vName.includes("ah1z");

        let targetEngineRadiusM = 0;
        let targetOpacity = 0.0;

        if (hasDriver) {
            targetEngineRadiusM = spdKmh >= 2.0 ? (isHeli ? 800 : isHeavy ? 450 : 250) : (isHeli ? 300 : isHeavy ? 100 : 60);
            targetOpacity = spdKmh >= 2.0 ? 0.50 : 0.25;
        }

        if (v.ns_auraRadius == null || isNaN(v.ns_auraRadius)) {
            v.ns_auraRadius = targetEngineRadiusM;
            v.ns_auraOpacity = targetOpacity;
        }

        const lerpFactor = targetEngineRadiusM > v.ns_auraRadius ? 0.18 : 0.06;
        v.ns_auraRadius += (targetEngineRadiusM - v.ns_auraRadius) * lerpFactor;
        v.ns_auraOpacity += (targetOpacity - v.ns_auraOpacity) * lerpFactor;

        if (v.ns_auraRadius > 0.5 && v.ns_auraOpacity > 0.02) {
            // Soft tactical emerald ring with smooth inward fade
            const r = 0.22, g = 0.82, b = 0.48;
            const bandW = Math.max(0.55, Math.min(2.2, v.ns_auraRadius * 0.014));
            const fadeW = Math.min(v.ns_auraRadius * 0.14, 14.0);
            this.add3DSoftTerrainRing(vx, vz, v.ns_auraRadius, bandW, fadeW, r, g, b, v.ns_auraOpacity, 48);
        }
    }

    // -------------------------------------------------------------------------
    // Phase 3: 3D Volumetric Vision Cone (Analytical Post-Process with Scene Depth Clamping)
    //   - Queues the active cone parameters for the Fullscreen Volumetric Pass in renderer3d
    // -------------------------------------------------------------------------
    add3DVisionCone(eyeX, eyeY, eyeZ, rotDeg, rangeM, coneAngleDeg, respectLOS) {
        const coneAngle = coneAngleDeg || 94.9;
        const range = rangeM || 150.0;
        const respect = (typeof respectLOS !== "undefined") ? respectLOS : true;

        if (typeof renderer3d !== "undefined" && renderer3d.initialized) {
            renderer3d.activeVisionCone = {
                eyeX: eyeX,
                eyeY: eyeY,
                eyeZ: eyeZ,
                rotDeg: rotDeg,
                range: range,
                coneAngle: coneAngle,
                respect: respect
            };
        }
    }

    add3D4KmLaser(eyeX, eyeY, eyeZ, rotDeg) {
        const rad = (rotDeg || 0) / 180.0 * Math.PI;
        const dirX = Math.sin(rad);
        const dirZ = Math.cos(rad);
        const maxDistM = 4000.0;

        const targetWorldX = eyeX + dirX * maxDistM;
        const targetWorldZ = eyeZ + dirZ * maxDistM;

        let closestFrac = 1.0;
        let hitType = null;
        let hitX = targetWorldX;
        let hitZ = targetWorldZ;
        let hitY = eyeY;

        const hasBuildings = (typeof buildingHeightmap !== "undefined" && buildingHeightmap.initialized);
        const hasTerrain = (typeof heightmap !== "undefined" && heightmap.initialized && heightmap.heightdataview);

        if (hasBuildings) {
            const bHit = buildingHeightmap.getRayCollision(eyeX, eyeY, eyeZ, targetWorldX, eyeY, targetWorldZ, 0.0);
            if (bHit && bHit.t > 0 && bHit.t < closestFrac) {
                closestFrac = bHit.t;
                hitX = bHit.hitX;
                hitZ = bHit.hitZ;
                hitY = bHit.hitY || eyeY;
                hitType = "building";
            }
        }

        if (hasTerrain) {
            const maxDist = maxDistM * closestFrac;
            const stepM = 4.0;
            const steps = Math.floor(maxDist / stepM);

            for (let s = 1; s <= steps; s++) {
                const dist = s * stepM;
                const frac = dist / maxDistM;
                if (frac >= closestFrac) break;

                const sampleX = eyeX + dirX * dist;
                const sampleZ = eyeZ + dirZ * dist;
                const terrainH = heightmap.getHeightFromCoords(sampleX, sampleZ);

                if (terrainH !== -Infinity && !isNaN(terrainH) && terrainH >= eyeY) {
                    closestFrac = frac;
                    hitX = sampleX;
                    hitZ = sampleZ;
                    hitY = terrainH;
                    hitType = "terrain";
                    break;
                }
            }
        }

        let r = 0.0, g = 1.0, b = 0.40, a = 0.95; // Open Sky Green
        if (hitType === "building") {
            r = 0.0; g = 0.90; b = 1.0; a = 0.98; // Building Cyan
            this.add3DGroundRing(hitX, hitY + 0.12, hitZ, 0.58, 0.74, r, g, b, 0.92, 24);
            this.add3DGroundRing(hitX, hitY + 0.12, hitZ, 0.08, 0.22, r, g, b, 0.96, 16);
        } else if (hitType === "terrain") {
            r = 1.0; g = 0.65; b = 0.0; a = 0.98; // Terrain Gold
            this.add3DTerrainRing(hitX, hitZ, 0.68, 0.88, r, g, b, 0.92, 24);
            this.add3DTerrainRing(hitX, hitZ, 0.10, 0.26, r, g, b, 0.96, 16);
        }

        // Draw 3D Laser Beam with High-Contrast Solid Black Outline
        this.add3DLaserRibbon(eyeX, eyeY, -eyeZ, hitX, hitY, -hitZ, r, g, b, a, 0.08, true);
    }

    add3DLaserRibbon(x1, y1, z1, x2, y2, z2, r, g, b, a, width = 0.08, hasOutline = true) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        const len2D = Math.hypot(dx, dz);
        if (len2D < 0.01) return;

        // Perpendicular unit vector in horizontal XZ plane
        const px = (-dz / len2D);
        const pz = (dx / len2D);

        if (hasOutline) {
            // Black outline ribbons (horizontal + vertical cross)
            const outW = width * 2.8;
            const outH = width * 2.8;

            // 1. Horizontal Black Outline
            const ohX1 = x1 + px * outW, ohZ1 = z1 + pz * outW;
            const ohX2 = x1 - px * outW, ohZ2 = z1 - pz * outW;
            const ohX3 = x2 - px * outW, ohZ3 = z2 - pz * outW;
            const ohX4 = x2 + px * outW, ohZ4 = z2 + pz * outW;
            this.addTri(ohX1, y1, ohZ1, ohX2, y1, ohZ2, ohX3, y2, ohZ3, 0.0, 0.0, 0.0, 0.95);
            this.addTri(ohX1, y1, ohZ1, ohX3, y2, ohZ3, ohX4, y2, ohZ4, 0.0, 0.0, 0.0, 0.95);

            // 2. Vertical Black Outline
            this.addTri(x1, y1 + outH, z1, x1, y1 - outH, z1, x2, y2 - outH, z2, 0.0, 0.0, 0.0, 0.95);
            this.addTri(x1, y1 + outH, z1, x2, y2 - outH, z2, x2, y2 + outH, z2, 0.0, 0.0, 0.0, 0.95);
        }

        // Inner Core Ribbons (Horizontal + Vertical Cross)
        const inW = width;
        const inH = width;

        const ihX1 = x1 + px * inW, ihZ1 = z1 + pz * inW;
        const ihX2 = x1 - px * inW, ihZ2 = z1 - pz * inW;
        const ihX3 = x2 - px * inW, ihZ3 = z2 - pz * inW;
        const ihX4 = x2 + px * inW, ihZ4 = z2 + pz * inW;
        this.addTri(ihX1, y1, ihZ1, ihX2, y1, ihZ2, ihX3, y2, ihZ3, r, g, b, a);
        this.addTri(ihX1, y1, ihZ1, ihX3, y2, ihZ3, ihX4, y2, ihZ4, r, g, b, a);

        this.addTri(x1, y1 + inH, z1, x1, y1 - inH, z1, x2, y2 - inH, z2, r, g, b, a);
        this.addTri(x1, y1 + inH, z1, x2, y2 - inH, z2, x2, y2 + inH, z2, r, g, b, a);

        this.addLine(x1, y1, z1, x2, y2, z2, 1.0, 1.0, 1.0, 1.0);
    }

    add3DBVRLaser(entity, eyeX, eyeY, eyeZ, rotDeg, minRangeM) {
        if (!entity) return;
        const rad = (rotDeg || 0) / 180.0 * Math.PI;
        const dirX = Math.sin(rad);
        const dirZ = Math.cos(rad);
        const minRange = minRangeM || 150.0;
        const maxRangeM = 4000.0;

        // BVR laser starts exactly where the vision cone ends (minRange) and extends to 4000m
        const startX = eyeX + dirX * minRange;
        const startZ = eyeZ + dirZ * minRange;
        const endX = eyeX + dirX * maxRangeM;
        const endZ = eyeZ + dirZ * maxRangeM;

        // Draw segmented/dashed 3D line from the end of the vision cone to 4000m
        const segmentCount = 36;
        for (let i = 0; i < segmentCount; i += 2) {
            const f1 = i / segmentCount;
            const f2 = (i + 1) / segmentCount;
            const sx = startX + (endX - startX) * f1;
            const sz = startZ + (endZ - startZ) * f1;
            const ex = startX + (endX - startX) * f2;
            const ez = startZ + (endZ - startZ) * f2;

            this.addLine(sx, eyeY, -sz, ex, eyeY, -ez, 0.0, 1.0, 0.40, 0.70);
        }

        const isEnemy = (other) => {
            if (!other || other === entity || other.isJoining || !other.isAlive || other.X == null || isNaN(other.X)) return false;
            if (entity.id != null && typeof isEnemyOf === "function") {
                return isEnemyOf(entity, other);
            }
            if (entity.team != null && other.team != null) {
                return entity.team !== other.team;
            }
            return false;
        };

        const px = typeof entity.getCanvasX === "function" ? entity.getCanvasX() : (entity.X != null ? XtoCanvas(entity.X) : NaN);
        const py = typeof entity.getCanvasY === "function" ? entity.getCanvasY() : (entity.Z != null ? YtoCanvas(entity.Z) : NaN);

        // Detect BVR targets within 50m corridor beyond vision cone
        if (typeof AllPlayers !== "undefined") {
            for (const pid in AllPlayers) {
                const other = AllPlayers[pid];
                if (!isEnemy(other)) continue;

                const ox = (typeof other.getX === "function") ? other.getX() : other.X;
                const oz = (typeof other.getZ === "function") ? other.getZ() : other.Z;
                let oy = (typeof other.getY === "function") ? other.getY() : (other.Y || 0);

                const worldDist = Math.hypot(ox - eyeX, oz - eyeZ);
                if (worldDist <= minRange || worldDist > maxRangeM) continue;

                const opx = typeof other.getCanvasX === "function" ? other.getCanvasX() : (other.X != null ? XtoCanvas(other.X) : NaN);
                const opy = typeof other.getCanvasY === "function" ? other.getCanvasY() : (other.Z != null ? YtoCanvas(other.Z) : NaN);

                let angleDeg = 0;
                if (typeof angleToTargetDeg === "function" && !isNaN(px) && !isNaN(opx)) {
                    angleDeg = angleToTargetDeg(px, py, rotDeg, opx, opy);
                }
                const perpDist = worldDist * Math.sin(angleDeg * Math.PI / 180);

                if (perpDist <= 25.0) {
                    if (typeof heightmap !== "undefined") oy = Math.max(oy, heightmap.getHeightFromCoords(ox, oz));
                    // 3D Fluorescent Green Indicator Ring at target's feet
                    this.add3DGroundRing(ox, oy + 0.05, oz, 0.8, 1.2, 0.0, 1.0, 0.40, 0.85, 24);
                }
            }
        }
    }

    add3DThreatLasers(entity, eyeX, eyeY, eyeZ, rotDeg, coneRangeM, coneAngleDeg, respectTerrainLOS = true) {
        if (!entity) return;
        const rad = (rotDeg || 0) / 180.0 * Math.PI;
        const dirX = Math.sin(rad);
        const dirZ = Math.cos(rad);
        const range = coneRangeM || 150.0;
        const hFovHalf = (coneAngleDeg || 94.9) / 2.0;
        const vFovHalf = 63.03 / 2.0; // 31.515° vertical half FOV

        const targetX = eyeX + dirX * range;
        const targetZ = eyeZ + dirZ * range;

        let hasBlockedEnemyNearGaze = false;
        const hasBld = (typeof buildingHeightmap !== "undefined" && buildingHeightmap.initialized);

        // Helper to check enemy status against selected entity
        const isEnemy = (other) => {
            if (!other || other === entity || other.isJoining || !other.isAlive || other.X == null || isNaN(other.X)) return false;
            if (entity.id != null && typeof isEnemyOf === "function") {
                return isEnemyOf(entity, other);
            }
            if (entity.team != null && other.team != null) {
                return entity.team !== other.team;
            }
            return false;
        };

        const px = typeof entity.getCanvasX === "function" ? entity.getCanvasX() : (entity.X != null ? XtoCanvas(entity.X) : NaN);
        const py = typeof entity.getCanvasY === "function" ? entity.getCanvasY() : (entity.Z != null ? YtoCanvas(entity.Z) : NaN);

        // 1. Central Gaze / No-LOS Alert check:
        //    Controlled by respectTerrainLOS (Terrain/Building LOS option, identical to 2D drawLineOfSight).
        //    Checks if an enemy is in the forward crosshair (tight cone: ≤ 5° horizontal, ≤ 15° vertical),
        //    BUT is hidden behind terrain or buildings (No-LOS). If so, turns RED!
        if (respectTerrainLOS && typeof AllPlayers !== "undefined") {
            for (const pid in AllPlayers) {
                const other = AllPlayers[pid];
                if (!isEnemy(other)) continue;

                const ox = (typeof other.getX === "function") ? other.getX() : other.X;
                const oz = (typeof other.getZ === "function") ? other.getZ() : other.Z;
                let oy = (typeof other.getY === "function") ? other.getY() : (other.Y || 0);
                let ogh = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(ox, oz) : 0;
                const otherEyeY = Math.max(ogh, oy - 0.85) + 1.45; // exact eye level of enemy

                const dx = ox - eyeX;
                const dy = otherEyeY - eyeY;
                const dz = oz - eyeZ;
                const dist2D = Math.hypot(dx, dz);
                const dist3D = Math.hypot(dist2D, dy);
                if (dist3D > range || dist2D < 0.5) continue;

                const opx = typeof other.getCanvasX === "function" ? other.getCanvasX() : (other.X != null ? XtoCanvas(other.X) : NaN);
                const opy = typeof other.getCanvasY === "function" ? other.getCanvasY() : (other.Z != null ? YtoCanvas(other.Z) : NaN);

                let angleH = 0;
                if (typeof angleToTargetDeg === "function" && !isNaN(px) && !isNaN(opx)) {
                    angleH = angleToTargetDeg(px, py, rotDeg, opx, opy);
                }

                // Vertical pitch angle in 3D (elevation difference)
                const pitchDeg = Math.atan2(dy, dist2D) * 180.0 / Math.PI;

                // In forward crosshair corridor: ≤ 5° horizontal, ≤ 15° vertical
                if (angleH <= 5.0 && Math.abs(pitchDeg) <= 15.0) {
                    let hasLOS = true;
                    if (typeof hasTerrainLOS === "function" && !hasTerrainLOS(eyeX, eyeY - 1.65, eyeZ, ox, oy, oz, 1.65)) {
                        hasLOS = false;
                    }
                    if (hasLOS && hasBld) {
                        const bHit = buildingHeightmap.getRayCollision(eyeX, eyeY, eyeZ, ox, otherEyeY, oz, 0.0);
                        if (bHit && bHit.t > 0 && bHit.t < 0.98) {
                            hasLOS = false;
                        }
                    }

                    if (!hasLOS) {
                        hasBlockedEnemyNearGaze = true;
                        break;
                    }
                }
            }
        }

        // Primary Central Gaze Laser: RED if an enemy is behind cover near gaze (No-LOS Alert), else CYAN/BLUE
        const r = hasBlockedEnemyNearGaze ? 1.0 : 0.0;
        const g = hasBlockedEnemyNearGaze ? 0.15 : 0.85;
        const b = hasBlockedEnemyNearGaze ? 0.15 : 1.0;
        const a = 0.90;
        this.addLine(eyeX, eyeY, -eyeZ, targetX, eyeY, -targetZ, r, g, b, a);

        // 2. Orange Threat Target Lasers to enemies INSIDE the 3D Vision Cone:
        //    Must be within 3D range, within Horizontal FOV (±47.45°), within Vertical FOV (±31.515°).
        //    If respectTerrainLOS is true, must also have clear Line of Sight (not behind terrain/buildings).
        if (typeof AllPlayers !== "undefined") {
            for (const pid in AllPlayers) {
                const other = AllPlayers[pid];
                if (!isEnemy(other)) continue;

                const ox = (typeof other.getX === "function") ? other.getX() : other.X;
                const oz = (typeof other.getZ === "function") ? other.getZ() : other.Z;
                let oy = (typeof other.getY === "function") ? other.getY() : (other.Y || 0);
                let ogh = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(ox, oz) : 0;
                const otherEyeY = Math.max(ogh, oy - 0.85) + 1.45; // exact eye level of enemy

                const dx = ox - eyeX;
                const dy = otherEyeY - eyeY;
                const dz = oz - eyeZ;
                const dist2D = Math.hypot(dx, dz);
                const dist3D = Math.hypot(dist2D, dy);
                if (dist3D > range || dist2D < 0.5) continue;

                // Check Horizontal FOV
                const opx = typeof other.getCanvasX === "function" ? other.getCanvasX() : (other.X != null ? XtoCanvas(other.X) : NaN);
                const opy = typeof other.getCanvasY === "function" ? other.getCanvasY() : (other.Z != null ? YtoCanvas(other.Z) : NaN);

                let angleH = 0;
                if (typeof angleToTargetDeg === "function" && !isNaN(px) && !isNaN(opx)) {
                    angleH = angleToTargetDeg(px, py, rotDeg, opx, opy);
                }
                if (angleH > hFovHalf) continue; // Outside horizontal FOV

                // Check Vertical FOV (63.03° vertical = ±31.515°)
                const pitchDeg = Math.atan2(dy, dist2D) * 180.0 / Math.PI;
                if (Math.abs(pitchDeg) > vFovHalf) continue; // Outside vertical FOV (e.g. below helicopter)

                // Check Line of Sight if respectTerrainLOS is active
                let clearLOS = true;
                if (respectTerrainLOS) {
                    if (typeof hasTerrainLOS === "function" && !hasTerrainLOS(eyeX, eyeY - 1.65, eyeZ, ox, oy, oz, 1.65)) {
                        clearLOS = false;
                    }
                    if (clearLOS && hasBld) {
                        const bHit = buildingHeightmap.getRayCollision(eyeX, eyeY, eyeZ, ox, otherEyeY, oz, 0.0);
                        if (bHit && bHit.t > 0 && bHit.t < 0.98) {
                            clearLOS = false;
                        }
                    }
                }

                if (clearLOS) {
                    // Target is inside 3D vision cone and visible: draw orange threat laser beam
                    this.addLine(eyeX, eyeY, -eyeZ, ox, otherEyeY, -oz, 1.0, 0.25, 0.05, 0.85);
                }
            }
        }
    }

    _addTriGrad(x1, y1, z1, r1, g1, b1, a1, x2, y2, z2, r2, g2, b2, a2, x3, y3, z3, r3, g3, b3, a3) {
        const offset = 6000;
        if (this.triVertexCount + 3 > (this.maxVertices - offset)) return;

        const idx = (offset + this.triVertexCount) * 3;
        const cIdx = (offset + this.triVertexCount) * 4;

        this.positions[idx] = x1; this.positions[idx + 1] = y1; this.positions[idx + 2] = z1;
        this.colors[cIdx] = r1; this.colors[cIdx + 1] = g1; this.colors[cIdx + 2] = b1; this.colors[cIdx + 3] = a1;

        this.positions[idx + 3] = x2; this.positions[idx + 4] = y2; this.positions[idx + 5] = z2;
        this.colors[cIdx + 4] = r2; this.colors[cIdx + 5] = g2; this.colors[cIdx + 6] = b2; this.colors[cIdx + 7] = a2;

        this.positions[idx + 6] = x3; this.positions[idx + 7] = y3; this.positions[idx + 8] = z3;
        this.colors[cIdx + 8] = r3; this.colors[cIdx + 9] = g3; this.colors[cIdx + 10] = b3; this.colors[cIdx + 11] = a3;

        this.triVertexCount += 3;
    }

    _addGradQuad(p1x, p1y, p1z, p2x, p2y, p2z, n1x, n1y, n1z, n2x, n2y, n2z, hw1, hw2, r, g, b, a1, a2) {
        const v1x = p1x - n1x * hw1, v1y = p1y - n1y * hw1, v1z = p1z - n1z * hw1;
        const v2x = p1x + n1x * hw1, v2y = p1y + n1y * hw1, v2z = p1z + n1z * hw1;
        const v3x = p2x - n2x * hw2, v3y = p2y - n2y * hw2, v3z = p2z - n2z * hw2;
        const v4x = p2x + n2x * hw2, v4y = p2y + n2y * hw2, v4z = p2z + n2z * hw2;

        this._addTriGrad(v1x, v1y, v1z, r, g, b, a1, v2x, v2y, v2z, r, g, b, a1, v3x, v3y, v3z, r, g, b, a2);
        this._addTriGrad(v2x, v2y, v2z, r, g, b, a1, v4x, v4y, v4z, r, g, b, a2, v3x, v3y, v3z, r, g, b, a2);
    }

    add3DKillTracer(x1, y1, z1, x2, y2, z2, r, g, b, coreR, coreG, coreB, fade, camX, camY, camZ, style = "direct", isSelected = false) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.35) return;

        const mx = (x1 + x2) * 0.5;
        const my = (y1 + y2) * 0.5;
        const mz = (z1 + z2) * 0.5;
        const camDist = Math.hypot(camX - mx, camY - my, camZ - mz);

        // Camera-distance adaptive thickness: sleek up close, clearly legible on bright desert/snow maps
        const baseHalfW = Math.max(0.042, Math.min(0.46, camDist * 0.00125)) * (isSelected ? 1.35 : 1.0);
        const outlineHalfW = baseHalfW * 2.55;
        const haloHalfW = baseHalfW * 1.85;
        const coreHalfW = baseHalfW * 0.68;

        const outR = r * 0.22;
        const outG = g * 0.22;
        const outB = b * 0.26;

        const isArc = (style === "indirect");
        const isBleedout = (style === "bleedout");
        const arcHeight = isArc ? Math.min(48.0, Math.max(4.5, len * 0.22)) : 0.0;
        const segCount = isArc ? 14 : (isBleedout ? Math.min(24, Math.max(6, Math.floor(len / 8.0))) : 6);

        const samplePt = (t) => {
            const px = x1 + dx * t;
            const pz = z1 + dz * t;
            const py = y1 + dy * t + (isArc ? (4.0 * arcHeight * t * (1.0 - t)) : 0.0);
            return [px, py, pz];
        };

        const pts = [];
        for (let i = 0; i <= segCount; i++) {
            pts.push(samplePt(i / segCount));
        }

        const computeNormal = (pA, pB) => {
            const sdx = pB[0] - pA[0], sdy = pB[1] - pA[1], sdz = pB[2] - pA[2];
            const slen = Math.hypot(sdx, sdy, sdz);
            if (slen < 0.0001) return [0, 1, 0];
            const ux = sdx / slen, uy = sdy / slen, uz = sdz / slen;
            const vcx = camX - (pA[0] + pB[0]) * 0.5;
            const vcy = camY - (pA[1] + pB[1]) * 0.5;
            const vcz = camZ - (pA[2] + pB[2]) * 0.5;
            let nx = uy * vcz - uz * vcy;
            let ny = uz * vcx - ux * vcz;
            let nz = ux * vcy - uy * vcx;
            const nLen = Math.hypot(nx, ny, nz);
            if (nLen < 0.0001) return [0, 1, 0];
            return [nx / nLen, ny / nLen, nz / nLen];
        };

        for (let i = 0; i < segCount; i++) {
            if (isBleedout && (i % 2 === 1)) continue; // Subtle dashed trail for bleed-out

            const t0 = i / segCount;
            const t1 = (i + 1) / segCount;
            const p0 = pts[i];
            const p1 = pts[i + 1];
            const n = computeNormal(p0, p1);

            const fadeMult = isBleedout ? 0.45 : 1.0;
            const outA0 = (0.18 + 0.54 * t0) * fade * fadeMult;
            const outA1 = (0.18 + 0.54 * t1) * fade * fadeMult;
            const haloA0 = (0.24 + 0.68 * t0) * fade * fadeMult;
            const haloA1 = (0.24 + 0.68 * t1) * fade * fadeMult;
            const coreA0 = (0.35 + 0.65 * t0) * fade * fadeMult;
            const coreA1 = (0.35 + 0.65 * t1) * fade * fadeMult;

            // Taper slightly from origin toward impact for sleek ballistic look
            const wScale0 = 0.68 + 0.32 * t0;
            const wScale1 = 0.68 + 0.32 * t1;

            this._addGradQuad(
                p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
                n[0], n[1], n[2], n[0], n[1], n[2],
                outlineHalfW * wScale0, outlineHalfW * wScale1,
                outR, outG, outB, outA0, outA1
            );
            this._addGradQuad(
                p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
                n[0], n[1], n[2], n[0], n[1], n[2],
                haloHalfW * wScale0, haloHalfW * wScale1,
                r, g, b, haloA0, haloA1
            );
            this._addGradQuad(
                p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
                n[0], n[1], n[2], n[0], n[1], n[2],
                coreHalfW * wScale0, coreHalfW * wScale1,
                coreR, coreG, coreB, coreA0, coreA1
            );
        }

        // Sleek small directional chevron near victim (never dwarfs the soldier)
        if (!isBleedout && len > 2.0) {
            const pPrev = pts[segCount - 1];
            const pEnd = pts[segCount];
            const sdx = pEnd[0] - pPrev[0], sdy = pEnd[1] - pPrev[1], sdz = pEnd[2] - pPrev[2];
            const slen = Math.hypot(sdx, sdy, sdz);
            if (slen > 0.01) {
                const ux = sdx / slen, uy = sdy / slen, uz = sdz / slen;
                const n = computeNormal(pPrev, pEnd);
                const chevLen = Math.min(len * 0.16, baseHalfW * 7.5);
                const chevW = baseHalfW * 3.4;
                const bx = pEnd[0] - ux * chevLen;
                const by = pEnd[1] - uy * chevLen;
                const bz = pEnd[2] - uz * chevLen;

                this.addTri(
                    bx - n[0] * chevW, by - n[1] * chevW, bz - n[2] * chevW,
                    bx + n[0] * chevW, by + n[1] * chevW, bz + n[2] * chevW,
                    pEnd[0], pEnd[1], pEnd[2],
                    r, g, b, fade * 0.92
                );
                const innerW = chevW * 0.48;
                const ibx = pEnd[0] - ux * (chevLen * 0.72);
                const iby = pEnd[1] - uy * (chevLen * 0.72);
                const ibz = pEnd[2] - uz * (chevLen * 0.72);
                this.addTri(
                    ibx - n[0] * innerW, iby - n[1] * innerW, ibz - n[2] * innerW,
                    ibx + n[0] * innerW, iby + n[1] * innerW, ibz + n[2] * innerW,
                    pEnd[0], pEnd[1], pEnd[2],
                    coreR, coreG, coreB, fade * 0.98
                );
            }
        }

        // Compact camera-facing impact diamond at victim point
        const vDist = Math.hypot(camX - x2, camY - y2, camZ - z2);
        const impR = Math.max(0.14, Math.min(1.1, vDist * 0.0038)) * (isSelected ? 1.35 : 1.0);
        const toCamX = camX - x2, toCamY = camY - y2, toCamZ = camZ - z2;
        const tcLen = Math.hypot(toCamX, toCamY, toCamZ);
        if (tcLen > 0.01) {
            const fx = toCamX / tcLen, fy = toCamY / tcLen, fz = toCamZ / tcLen;
            // Right vector = cross(up(0,1,0), f)
            let rx = fz, ry = 0, rz = -fx;
            let rLen = Math.hypot(rx, ry, rz);
            if (rLen < 0.001) { rx = 1; ry = 0; rz = 0; rLen = 1; }
            rx /= rLen; rz /= rLen;
            // Up vector = cross(f, r)
            const ux = fy * rz - fz * ry;
            const uy = fz * rx - fx * rz;
            const uz = fx * ry - fy * rx;

            const outerAlpha = fade * (isSelected ? 0.9 : 0.75);
            const innerR = impR * 0.45;
            const ringPts = 8;
            for (let s = 0; s < ringPts; s++) {
                const a0 = (s / ringPts) * Math.PI * 2;
                const a1 = ((s + 1) / ringPts) * Math.PI * 2;
                const c0 = Math.cos(a0), s0 = Math.sin(a0);
                const c1 = Math.cos(a1), s1 = Math.sin(a1);

                const in0x = x2 + (rx * c0 + ux * s0) * innerR;
                const in0y = y2 + (ry * c0 + uy * s0) * innerR;
                const in0z = z2 + (rz * c0 + uz * s0) * innerR;
                const out0x = x2 + (rx * c0 + ux * s0) * impR;
                const out0y = y2 + (ry * c0 + uy * s0) * impR;
                const out0z = z2 + (rz * c0 + uz * s0) * impR;

                const in1x = x2 + (rx * c1 + ux * s1) * innerR;
                const in1y = y2 + (ry * c1 + uy * s1) * innerR;
                const in1z = z2 + (rz * c1 + uz * s1) * innerR;
                const out1x = x2 + (rx * c1 + ux * s1) * impR;
                const out1y = y2 + (ry * c1 + uy * s1) * impR;
                const out1z = z2 + (rz * c1 + uz * s1) * impR;

                this.addTri(in0x, in0y, in0z, out0x, out0y, out0z, in1x, in1y, in1z, r, g, b, outerAlpha);
                this.addTri(out0x, out0y, out0z, out1x, out1y, out1z, in1x, in1y, in1z, r, g, b, outerAlpha);
            }
        }
    }

    _classifyKillStyle(weaponName) {
        if (!weaponName) return "direct";
        const w = String(weaponName).toLowerCase();
        if (w === "killed" || w.includes("bleed")) return "bleedout";
        if (
            w.includes("mortar") ||
            w.includes("arty") ||
            w.includes("artillery") ||
            w.includes("grenade") ||
            w.includes("frag") ||
            w.includes("m203") ||
            w.includes("gp25") ||
            w.includes("gp30") ||
            w.includes("ugl") ||
            w.includes("howitzer")
        ) {
            return "indirect";
        }
        return "direct";
    }

    draw() {
        if (!this.initialized && !this.init()) return;
        if (!this.program) return;

        const gl = renderer3d.gl;
        if (!gl) return;

        this.lineVertexCount = 0;
        this.triVertexCount = 0;

        const camPos = renderer3d.cameraPos || [0, 300, 0];
        const camX = camPos[0], camY = camPos[1], camZ = camPos[2];

        // ---------------------------------------------------------------------
        // 1. Air Vehicle Vertical Drop Lines (Hardware Depth Tested)
        // ---------------------------------------------------------------------
        const showAirHeight = (typeof options_DrawVehicleHeight !== "undefined") ? options_DrawVehicleHeight : true;
        const showEmptyVehs = (typeof options_DrawEmptyVehicles !== "undefined") ? options_DrawEmptyVehicles : true;
        if (showAirHeight && typeof AllVehicles !== "undefined") {
            for (const vId in AllVehicles) {
                const v = AllVehicles[vId];
                if (!v || !v.isFlyingVehicle || v.isClimbingVehicle) continue;
                if (!showEmptyVehs && (!v.Passengers || v.Passengers.size === 0)) continue;

                let vx = (typeof v.getX === "function") ? v.getX() : v.X;
                let vy = (typeof v._smoothY === "number" && !isNaN(v._smoothY)) ? v._smoothY : ((typeof v.getY === "function") ? v.getY() : (v.Y || 0));
                let vz = (typeof v.getZ === "function") ? v.getZ() : v.Z;
                if (vx == null || isNaN(vx) || vz == null || isNaN(vz)) continue;

                let groundH = 0;
                if (typeof heightmap !== "undefined") {
                    groundH = heightmap.getHeightFromCoords(vx, vz);
                }

                const relAlt = vy - groundH;
                if (relAlt > 1.5) {
                    const r = (v.team === 1) ? 1.0 : 0.15;
                    const g = (v.team === 1) ? 0.2 : 0.65;
                    const b = (v.team === 1) ? 0.1 : 1.0;
                    const a = 0.85;

                    this.addLine(vx, vy, -vz, vx, groundH, -vz, r, g, b, a);
                }
            }
        }

        // ---------------------------------------------------------------------
        // 2. 3D Volumetric Kill Arrows (Depth Ignored for Global Map Visibility)
        // ---------------------------------------------------------------------
        const showKillLines = (typeof options_DrawKillLines !== "undefined") ? options_DrawKillLines : true;
        if (showKillLines && typeof killLines !== "undefined" && killLines.length > 0) {
            const currentTick = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;

            for (const kill of killLines) {
                if (!kill) continue;
                const atk = (typeof AllPlayers !== "undefined") ? AllPlayers[kill.AttackerID] : null;
                const vic = (typeof AllPlayers !== "undefined") ? AllPlayers[kill.VictimID] : null;
                if (!atk || !vic) continue;

                const age = currentTick - kill.tick;
                const fade = Math.max(0.0, Math.min(1.0, 1.0 - age * 0.025));
                if (fade <= 0.01) continue;

                let ax = (typeof atk.getX === "function") ? atk.getX() : atk.X;
                let ay = (typeof atk.getY === "function") ? atk.getY() : (atk.Y || 0);
                let az = (typeof atk.getZ === "function") ? atk.getZ() : atk.Z;

                let vx = (typeof vic.getX === "function") ? vic.getX() : vic.X;
                let vy = (typeof vic.getY === "function") ? vic.getY() : (vic.Y || 0);
                let vz = (typeof vic.getZ === "function") ? vic.getZ() : vic.Z;

                if (ax == null || vx == null) continue;

                if (typeof heightmap !== "undefined") {
                    ay = Math.max(ay, heightmap.getHeightFromCoords(ax, az) + 0.8);
                    vy = Math.max(vy, heightmap.getHeightFromCoords(vx, vz) + 0.8);
                }

                // Team 1 (Deep Crimson) vs Team 2 (Deep Cobalt Blue) for strong readability on bright desert/snow maps
                const isTeam1 = (atk.team === 1);
                const r = isTeam1 ? 0.92 : 0.05;
                const g = isTeam1 ? 0.14 : 0.30;
                const b = isTeam1 ? 0.12 : 0.90;

                const coreR = isTeam1 ? 1.00 : 0.36;
                const coreG = isTeam1 ? 0.60 : 0.66;
                const coreB = isTeam1 ? 0.50 : 1.00;

                const killStyle = this._classifyKillStyle(kill.Weapon);
                this.add3DKillTracer(ax, ay + 1.35, -az, vx, vy + 1.05, -vz, r, g, b, coreR, coreG, coreB, fade, camX, camY, camZ, killStyle, false);
            }
        }

        // 2a. Selected Kill Line in 3D (when a kill row is hovered or selected in Kill Feed)
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
                const pulse = 0.82 + 0.18 * Math.sin(performance.now() * 0.006);
                const killStyle = this._classifyKillStyle(k.Weapon);
                this.add3DKillTracer(ax, ay + 1.4, -az, vx, vy + 1.1, -vz, 0.98, 0.78, 0.22, 1.0, 0.97, 0.78, pulse, camX, camY, camZ, killStyle, true);
            }
        }

        const arrowTriCount = this.triVertexCount;

        // (3D water surface and concave DOD water overlays are rendered seamlessly by Water3dRenderer)

        // ---------------------------------------------------------------------
        // 3. 3D Ground Segmented Reticles for Orders & Spotted Tracking
        // ---------------------------------------------------------------------
        const showSpotted = (typeof options_DrawSpottedIndicators !== "undefined") ? options_DrawSpottedIndicators : false;
        if (showSpotted && typeof hud3d !== "undefined" && typeof hud3d.computeSpottedEntities === "function") {
            const spottedData = hud3d.computeSpottedEntities();
            if (spottedData) {
                const nowSec = performance.now() * 0.001;
                const rotRad = nowSec * 0.28; // Calm, slow rotation (~22s/rev)
                const pulseFactor = 0.5 + 0.5 * Math.sin(nowSec * 1.1); // Gentle slow breath (~5.7s cycle)
                const alpha = 0.62 + pulseFactor * 0.20;

                // Sober tactical crimson (matches dark SPOTTED pill)
                const r = 0.82, g = 0.28, b = 0.28;

                for (const player of spottedData.players) {
                    let px = (typeof player.getX === "function") ? player.getX() : player.X;
                    let py = (typeof player.getY === "function") ? player.getY() : (player.Y || 0);
                    let pz = (typeof player.getZ === "function") ? player.getZ() : player.Z;
                    if (px == null || pz == null) continue;

                    if (typeof heightmap !== "undefined") {
                        py = Math.max(py, heightmap.getHeightFromCoords(px, pz));
                    }

                    const pRad = 0.85 + pulseFactor * 0.16;
                    this.add3DSpottedReticle(px, py + 0.05, pz, pRad, 0.14, r, g, b, alpha, rotRad);
                }

                for (const veh of spottedData.vehicles) {
                    let vx = (typeof veh.getX === "function") ? veh.getX() : veh.X;
                    let vy = (typeof veh._smoothY === "number") ? veh._smoothY : ((typeof veh.getY === "function") ? veh.getY() : (veh.Y || 0));
                    let vz = (typeof veh.getZ === "function") ? veh.getZ() : veh.Z;
                    if (vx == null || vz == null) continue;

                    const vRad = 2.6 + pulseFactor * 0.35;
                    this.add3DSpottedReticle(vx, vy + 0.07, vz, vRad, 0.24, r, g, b, alpha, rotRad);
                }

                for (const fob of spottedData.fobs) {
                    let fx = fob.X, fz = fob.Z, fy = fob.Y || 0;
                    if (typeof heightmap !== "undefined") fy = Math.max(fy, heightmap.getHeightFromCoords(fx, fz));
                    const fRad = 3.8 + pulseFactor * 0.45;
                    this.add3DSpottedReticle(fx, fy + 0.07, fz, fRad, 0.28, r, g, b, alpha, rotRad);
                }
            }
        }

        // ---------------------------------------------------------------------
        // 4. Flag Capture Sectors (Perimeter + Inward Fade + Low Curtain)
        // ---------------------------------------------------------------------
        const showFlags = (typeof options_DrawFlagRadius !== "undefined") ? options_DrawFlagRadius : true;
        if (showFlags && typeof AllFlags !== "undefined") {
            for (const fId in AllFlags) {
                const f = AllFlags[fId];
                if (!f || f.Radius == null || f.Radius <= 0) continue;

                let r = 0.72, g = 0.76, b = 0.78;
                if (f.team === 1) { r = 0.92; g = 0.16; b = 0.12; }
                else if (f.team === 2) { r = 0.08; g = 0.42; b = 0.96; }

                this.add3DFlagSector(f.X, f.Z, f.Radius, r, g, b, 56);
            }
        }

        // ---------------------------------------------------------------------
        // 5. Shooting Sound Shockwaves (Real-time dynamic expansion in 3D)
        // ---------------------------------------------------------------------
        const showShockwaves = (typeof options_DrawShootingSoundShockwaves !== "undefined") ? options_DrawShootingSoundShockwaves : false;
        if (showShockwaves && typeof ns_activeShockwaves !== "undefined" && ns_activeShockwaves.length > 0) {
            const currentTick = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;
            const now = performance.now();

            const selPlayer = (typeof SelectedPlayer !== "undefined") ? SelectedPlayer : -1;
            const selVehicle = (typeof SelectedVehicle !== "undefined") ? SelectedVehicle : -1;

            for (let i = ns_activeShockwaves.length - 1; i >= 0; i--) {
                const sw = ns_activeShockwaves[i];
                if (!sw) continue;

                if (selPlayer != -1 || selVehicle != -1) {
                    let isForSel = false;
                    if (selPlayer != -1 && typeof AllPlayers !== "undefined") {
                        const p = AllPlayers[selPlayer];
                        if (p) {
                            const selId = Number(selPlayer);
                            if (sw.shooterId === selId || sw.victimId === selId) isForSel = true;
                            else if (p.vehicleid >= 0 && (sw.vehicleId === Number(p.vehicleid) || sw.vehicleId === p.vehicleid)) isForSel = true;
                        }
                    }
                    if (!isForSel && selVehicle != -1 && typeof AllVehicles !== "undefined") {
                        const v = AllVehicles[selVehicle];
                        if (v) {
                            const selVeh = Number(selVehicle);
                            if (sw.vehicleId === selVeh || sw.vehicleId === selVehicle) isForSel = true;
                            else if (v.Passengers && typeof v.Passengers.has === "function") {
                                if (v.Passengers.has(sw.shooterId) || v.Passengers.has(sw.victimId)) isForSel = true;
                            }
                        }
                    }
                    if (!isForSel) continue;
                }

                let progress = 0;
                if (sw.startTick > 0 && currentTick >= sw.startTick && sw.durationTicks > 0) {
                    const elapsedTicks = currentTick - sw.startTick;
                    if (elapsedTicks > sw.durationTicks) {
                        ns_activeShockwaves.splice(i, 1);
                        continue;
                    }
                    progress = elapsedTicks / sw.durationTicks;
                } else if (sw.spawnTime) {
                    const elapsedSec = (now - sw.spawnTime) / 1000.0;
                    if (elapsedSec >= 1.5) {
                        ns_activeShockwaves.splice(i, 1);
                        continue;
                    }
                    progress = elapsedSec / 1.5;
                }

                const easeOutProgress = 1.0 - Math.pow(1.0 - progress, 2.5);
                const currentRadiusM = sw.maxRadiusM * easeOutProgress;
                const opacity = Math.pow(1.0 - progress, 1.5) * 0.85;
                if (currentRadiusM < 1.5 || opacity <= 0.01) continue;

                const col = this.parseRgba(sw.color, opacity);
                const bandW = Math.max(0.65, Math.min(2.8, currentRadiusM * 0.015));
                const fadeW = Math.min(currentRadiusM * 0.18, 18.0);
                this.add3DSoftTerrainRing(sw.x, sw.z, currentRadiusM, bandW, fadeW, col[0], col[1], col[2], opacity, 56);
            }
        }

        // ---------------------------------------------------------------------
        // 5b. Engagement Timer (Flank Chronometer) Adaptive Zone Ring on 3D terrain
        // ---------------------------------------------------------------------
        const showFlankChrono = (typeof options_DrawFlankChronometer !== "undefined") ? options_DrawFlankChronometer : false;
        if (showFlankChrono) {
            const selPlayer = (typeof SelectedPlayer !== "undefined") ? SelectedPlayer : -1;
            if (selPlayer != -1 && typeof AllPlayers !== "undefined") {
                const p = AllPlayers[selPlayer];
                if (p && !p.isJoining && p.isAlive && p.X != null && !isNaN(p.X)) {
                    const px = (typeof p.getX === "function") ? p.getX() : p.X;
                    const pz = (typeof p.getZ === "function") ? p.getZ() : p.Z;
                    const flankRadius = (typeof getAdaptiveFlankRadius === "function") ? getAdaptiveFlankRadius() : 100;
                    const bandW = Math.max(0.45, Math.min(1.15, flankRadius * 0.011));
                    const fadeW = Math.min(flankRadius * 0.08, 3.0);
                    // Desaturated tactical violet dashed perimeter matching 2D
                    this.add3DDashedTerrainRing(px, pz, flankRadius, bandW, 0.68, 0.45, 0.82, 0.58, 40, fadeW);
                }
            }
        }

        // ---------------------------------------------------------------------
        // 5c. Dynamic 3D Explosions (Fireballs, Shockwaves, Flying Sparks & Smoke)
        // ---------------------------------------------------------------------
        if (typeof ns_activeExplosions3D !== "undefined" && ns_activeExplosions3D.length > 0) {
            const now = performance.now();
            for (let i = ns_activeExplosions3D.length - 1; i >= 0; i--) {
                const exp = ns_activeExplosions3D[i];
                if (!exp) continue;

                const elapsed = (now - exp.spawnTime) / 1000.0;
                if (elapsed >= exp.duration) {
                    ns_activeExplosions3D.splice(i, 1);
                    continue;
                }

                const progress = elapsed / exp.duration; // 0.0 to 1.0
                const easeOut = 1.0 - Math.pow(1.0 - progress, 3.0);
                const currentRadius = exp.maxRadius * easeOut;

                // 1. Core Fireball Dome / Sphere
                let r = 1.0, g = 0.9, b = 0.4, a = 0.95;
                if (progress < 0.25) {
                    // Bright white-yellow incandescent flash
                    r = 1.0; g = 0.98; b = 0.85; a = 0.95;
                } else if (progress < 0.65) {
                    // Blazing orange flame
                    const t = (progress - 0.25) / 0.40;
                    r = 1.0; g = 0.85 * (1.0 - t) + 0.25 * t; b = 0.3 * (1.0 - t); a = 0.90 * (1.0 - t) + 0.35 * t;
                } else {
                    // Smoky dark burst
                    const t = (progress - 0.65) / 0.35;
                    r = 0.35 * (1.0 - t); g = 0.25 * (1.0 - t); b = 0.2 * (1.0 - t); a = 0.35 * (1.0 - t);
                }

                if (a > 0.02 && currentRadius > 0.3) {
                    this.add3DFireball(exp.x, exp.y, exp.z, currentRadius * 0.75, r, g, b, a, 5, 8);
                }

                // 2. Shockwave Blast Ring on Terrain
                const ringRadius = exp.maxRadius * (1.0 - Math.pow(1.0 - progress, 2.0));
                const ringAlpha = Math.pow(1.0 - progress, 1.8) * 0.85;
                if (ringRadius > 0.8 && ringAlpha > 0.02) {
                    const bandW = Math.max(0.8, ringRadius * 0.06);
                    this.add3DTerrainRing(exp.x, exp.z, Math.max(0, ringRadius - bandW), ringRadius, 1.0, 0.65, 0.15, ringAlpha, 36);
                }

                // 3. Flying 3D Sparks & Debris Embers
                if (exp.particles) {
                    const grav = 9.8;
                    for (let p of exp.particles) {
                        const px = exp.x + p.vx * elapsed;
                        const py = exp.y + p.vy * elapsed - 0.5 * grav * elapsed * elapsed;
                        const pz = exp.z + p.vz * elapsed;
                        
                        let terrainH = 0;
                        if (typeof heightmap !== "undefined") terrainH = heightmap.getHeightFromCoords(px, pz);
                        if (py < terrainH) continue; // Hit the ground

                        const pAlpha = Math.pow(1.0 - progress, 1.4);
                        const pr = (progress < 0.5) ? 1.0 : (1.0 - (progress - 0.5) * 1.5);
                        const pg = (progress < 0.5) ? 0.85 : (0.4 * (1.0 - progress));
                        const pb = (progress < 0.3) ? 0.3 : 0.0;
                        this.add3DDebrisParticle(px, py, pz, p.size * (1.0 - progress * 0.6), pr, pg, pb, pAlpha);
                    }
                }
            }
        }

        // ---------------------------------------------------------------------
        // 5d. Launch Backblast & Muzzle Smoke Puffs (3D Rising White/Grey Clouds)
        // ---------------------------------------------------------------------
        if (typeof ns_activeLaunchSmoke3D !== "undefined" && ns_activeLaunchSmoke3D.length > 0) {
            const now = performance.now();
            for (let i = ns_activeLaunchSmoke3D.length - 1; i >= 0; i--) {
                const smk = ns_activeLaunchSmoke3D[i];
                if (!smk) continue;

                const elapsed = (now - smk.spawnTime) / 1000.0;
                if (elapsed >= smk.duration) {
                    ns_activeLaunchSmoke3D.splice(i, 1);
                    continue;
                }

                const progress = elapsed / smk.duration;
                const easeOut = 1.0 - Math.pow(1.0 - progress, 2.5);
                const currentRadius = smk.maxRadius * easeOut;
                const riseY = smk.y + elapsed * 1.8; // Thermal rising plume

                // Brief initial flash -> billowy white/grey smoke
                let r = 0.92, g = 0.92, b = 0.94, a = Math.pow(1.0 - progress, 1.3) * 0.70;
                if (progress < 0.12) {
                    // Muzzle flash
                    r = 1.0; g = 0.95; b = 0.7; a = 0.90;
                }

                if (a > 0.02 && currentRadius > 0.3) {
                    this.add3DFireball(smk.x, riseY, smk.z, currentRadius, r, g, b, a, 4, 7);
                }
            }
        }

        // ---------------------------------------------------------------------
        // 5e. 3D Projectile White Smoke Tracer Trails & Rocket Flares
        // ---------------------------------------------------------------------
        if (typeof AllProj !== "undefined") {
            const now = performance.now();
            for (const projId in AllProj) {
                const proj = AllProj[projId];
                if (!proj) continue;

                // Only render trails for ballistic & rocket projectiles (skip static mines/c4)
                const type = Number(proj.type || 0);
                if (type < 30 && type !== 0) continue;

                let px = (typeof proj.getX === "function") ? proj.getX() : proj.X;
                let py = (typeof proj.getY === "function") ? proj.getY() : (proj.Y || 0);
                let pz = (typeof proj.getZ === "function") ? proj.getZ() : proj.Z;

                if (px == null || isNaN(px) || pz == null || isNaN(pz)) continue;
                if (typeof heightmap !== "undefined") {
                    const gh = heightmap.getHeightFromCoords(px, pz);
                    py = Math.max(py, gh + 0.15);
                }

                if (!proj._smokeTrail) proj._smokeTrail = [];
                const trail = proj._smokeTrail;

                // Append new position sample if moved
                const lastPt = trail.length > 0 ? trail[trail.length - 1] : null;
                if (!lastPt || (Math.hypot(px - lastPt.x, py - lastPt.y, pz - lastPt.z) > 0.3)) {
                    trail.push({ x: px, y: py, z: pz, time: now });
                }

                // Cull samples older than 1.2 seconds
                while (trail.length > 0 && (now - trail[0].time) > 1200) {
                    trail.shift();
                }

                if (trail.length < 2) continue;

                // Draw ribbon segments along the trail (consistent white trail across all projectiles)
                const isHandGrenade = (type === 38);
                const isBurningSmoke = isBurningSmokeProjectile(type, proj.templateName);
                const trR = 0.95;
                const trG = 0.95;
                const trB = 0.98;
                const wScale = isHandGrenade ? 0.55 : (isBurningSmoke ? 0.55 : 1.0);
                const aScale = isHandGrenade ? 0.85 : (isBurningSmoke ? 0.60 : 1.0);
                for (let j = 0; j < trail.length - 1; j++) {
                    const p1 = trail[j];
                    const p2 = trail[j + 1];
                    const age1 = (now - p1.time) / 1200.0;
                    const age2 = (now - p2.time) / 1200.0;

                    const alpha1 = Math.max(0.0, Math.pow(1.0 - age1, 1.5) * 0.75 * aScale);
                    const alpha2 = Math.max(0.0, Math.pow(1.0 - age2, 1.5) * 0.75 * aScale);

                    if (alpha1 <= 0.01 && alpha2 <= 0.01) continue;

                    // Expanding ribbon width
                    const w1 = (0.12 + age1 * 0.45) * wScale;
                    const w2 = (0.12 + age2 * 0.45) * wScale;

                    // Draw 3D quad ribbon
                    const nz1 = -p1.z, nz2 = -p2.z;
                    this.addTri(p1.x - w1, p1.y, nz1, p1.x + w1, p1.y, nz1, p2.x - w2, p2.y, nz2, trR, trG, trB, (alpha1 + alpha2) * 0.5);
                    this.addTri(p1.x + w1, p1.y, nz1, p2.x + w2, p2.y, nz2, p2.x - w2, p2.y, nz2, trR, trG, trB, (alpha1 + alpha2) * 0.5);
                    
                    // Vertical ribbon cross for full 3D visibility from any angle
                    this.addTri(p1.x, p1.y - w1, nz1, p1.x, p1.y + w1, nz1, p2.x, p2.y - w2, nz2, trR, trG, trB, (alpha1 + alpha2) * 0.5);
                    this.addTri(p1.x, p1.y + w1, nz1, p2.x, p2.y + w2, nz2, p2.x, p2.y - w2, nz2, trR, trG, trB, (alpha1 + alpha2) * 0.5);
                }

                // Glowing rocket engine flare only for actual rockets/missiles (not hand grenades)
                const tName = (proj.templateName || "").toLowerCase();
                const isRocket = (type >= 32 && type <= 35) || tName.includes('rpg') || tName.includes('rocket') || tName.includes('missile') || tName.includes('tow') || tName.includes('lat') || tName.includes('hat');
                if (isRocket) {
                    this.add3DDebrisParticle(px, py, pz, 0.22, 1.0, 0.9, 0.4, 0.95);
                }
            }
        }

        // ---------------------------------------------------------------------
        // 5f. Volumetric 3D Smoke Screens are rendered by dedicated Smoke3dRenderer
        //     (js/3d/smoke3d.js) using PR's authentic anim_smoke2ground2.webp sprites.
        // ---------------------------------------------------------------------

        // ---------------------------------------------------------------------
        // 6. Movement Sound Radii (Real-time dynamic update in 3D matching 2D colors)
        // ---------------------------------------------------------------------
        const showMovementSounds = (typeof options_DrawMovementSoundAuras !== "undefined") ? options_DrawMovementSoundAuras : false;
        if (showMovementSounds) {
            const selPlayer = (typeof SelectedPlayer !== "undefined") ? SelectedPlayer : -1;
            const selVehicle = (typeof SelectedVehicle !== "undefined") ? SelectedVehicle : -1;

            if (selPlayer != -1 && typeof AllPlayers !== "undefined") {
                const p = AllPlayers[selPlayer];
                if (p && !p.isJoining && p.isAlive && p.X != null && !isNaN(p.X)) {
                    if (p.vehicleid < 0) {
                        const spdKmh = (typeof getEntitySpeedKmh === "function") ? getEntitySpeedKmh(p) : 0;
                        const st = (typeof getPlayerStance === "function") ? getPlayerStance(p, spdKmh) : { stance: "stationary", radiusM: 0, opacity: 0, color: "" };
                        const targetRadiusM = st.radiusM;
                        const targetOpacity = st.opacity;

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
                            const px = (typeof p.getX === "function") ? p.getX() : p.X;
                            const pz = (typeof p.getZ === "function") ? p.getZ() : p.Z;

                            // Refined tactical sound aura: Sprint = Warm Amber, Walk/Crouch = Muted Cyan
                            let r = 0.22, g = 0.78, b = 0.88;
                            if (st.stance === "sprint") {
                                r = 0.92; g = 0.72; b = 0.24;
                            }
                            const bandW = Math.max(0.28, Math.min(0.85, p.ns_auraRadius * 0.02));
                            const fadeW = Math.min(p.ns_auraRadius * 0.22, 4.5);
                            this.add3DSoftTerrainRing(px, pz, p.ns_auraRadius, bandW, fadeW, r, g, b, p.ns_auraOpacity, 40);
                        }
                    } else if (typeof AllVehicles !== "undefined") {
                        const v = AllVehicles[p.vehicleid];
                        if (v) this.updateAndRenderVehicleAura3D(v);
                    }
                }
            } else if (selVehicle != -1 && typeof AllVehicles !== "undefined") {
                const v = AllVehicles[selVehicle];
                if (v) this.updateAndRenderVehicleAura3D(v);
            }
        }

function getPlayerEyePos(p) {
    if (!p) return { x: 0, y: 1.45, z: 0, rot: 0 };
    let worldX = typeof p.getX === "function" ? p.getX() : (p.X || 0);
    let worldZ = typeof p.getZ === "function" ? p.getZ() : (p.Z || 0);
    let groundH = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(worldX, worldZ) : 0;
    let posY = (typeof p.getY === "function" ? p.getY() : (p.Y || (groundH + 0.85)));

    const floorY = Math.max(groundH, posY - 0.85);
    const relY = posY - groundH;
    const spdKmh = (typeof getEntitySpeedKmh === "function") ? getEntitySpeedKmh(p) : 0;

    let eyeHeight = 1.45; // Standing: exact eye level of the 1.58m soldier mesh
    if (spdKmh < 3.0 && relY <= 0.25) {
        eyeHeight = 0.35; // Prone: exact eye level of prone mesh
    } else if (relY <= 0.65) {
        eyeHeight = 0.95; // Crouch: exact eye level of crouch mesh
    }

    let eyeY = floorY + eyeHeight;
    let rot = typeof p.getRotation === "function" ? p.getRotation() : (p.rotation || 0);

    if (p.vehicleid >= 0 && typeof AllVehicles !== "undefined" && AllVehicles[p.vehicleid]) {
        const v = AllVehicles[p.vehicleid];
        worldX = typeof v.getX === "function" ? v.getX() : (v.X || worldX);
        worldZ = typeof v.getZ === "function" ? v.getZ() : (v.Z || worldZ);
        let vBaseH = (typeof v._smoothY === "number" && !isNaN(v._smoothY)) ? v._smoothY : ((typeof v.getY === "function") ? v.getY() : (v.Y || 0));
        let vGroundH = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(worldX, worldZ) : 0;
        if (!v.isFlyingVehicle) vBaseH = Math.max(vBaseH, vGroundH);

        const vName = (v.name || "").toLowerCase();
        const isArmor = vName.includes("tnk") || vName.includes("tank") || vName.includes("apc") || vName.includes("bmp") || vName.includes("btr");
        const isHeli = vName.includes("heli") || vName.includes("uh60") || vName.includes("mi8") || vName.includes("ah1z");

        let opticOffset = isArmor ? 2.4 : (isHeli ? 1.8 : 1.7);
        eyeY = vBaseH + opticOffset;

        const vRot = typeof v.getRotation === "function" ? v.getRotation() : (v.rotation || 0);
        const pRot = typeof p.getRotation === "function" ? p.getRotation() : (p.rotation || 0);
        rot = (p.vehicleSlot === 0 || p.rotation == null || p.rotation === 0) ? vRot : pRot;
    }

    return { x: worldX, y: eyeY, z: worldZ, rot: rot };
}

function getVehicleEyePos(v) {
    if (!v) return { x: 0, y: 2.0, z: 0, rot: 0 };
    const vx = typeof v.getX === "function" ? v.getX() : (v.X || 0);
    const vz = typeof v.getZ === "function" ? v.getZ() : (v.Z || 0);
    let vy = (typeof v._smoothY === "number" && !isNaN(v._smoothY)) ? v._smoothY : ((typeof v.getY === "function") ? v.getY() : (v.Y || 0));
    let groundH = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(vx, vz) : 0;
    if (!v.isFlyingVehicle) vy = Math.max(vy, groundH);

    const vName = (v.name || "").toLowerCase();
    const isArmor = vName.includes("tnk") || vName.includes("tank") || vName.includes("apc") || vName.includes("bmp") || vName.includes("btr");
    const isHeli = vName.includes("heli") || vName.includes("uh60") || vName.includes("mi8") || vName.includes("ah1z");
    const opticOffset = isArmor ? 2.4 : (isHeli ? 1.8 : 1.7);

    const rot = typeof v.getRotation === "function" ? v.getRotation() : (v.rotation || 0);
    return { x: vx, y: vy + opticOffset, z: vz, rot: rot };
}

        // ---------------------------------------------------------------------
        // 7. Phase 3: 3D Tactical Geometry (Vision Cone, Threat Lasers, 4km LOS, BVR)
        // ---------------------------------------------------------------------
        const showVisionCone = (typeof options_DrawVisionCone !== "undefined") ? options_DrawVisionCone : false;
        const showThreatLasers = (typeof options_DrawThreatLasers !== "undefined") ? options_DrawThreatLasers : false;
        const show4KmLaser = (typeof options_Draw4KmLaser !== "undefined") ? options_Draw4KmLaser : false;
        const showBVRLaser = (typeof options_DrawBVRLaser !== "undefined") ? options_DrawBVRLaser : false;

        const selPlayer = (typeof SelectedPlayer !== "undefined") ? SelectedPlayer : -1;
        const selVehicle = (typeof SelectedVehicle !== "undefined") ? SelectedVehicle : -1;

        if (selPlayer != -1 && typeof AllPlayers !== "undefined") {
            const p = AllPlayers[selPlayer];
            if (p && !p.isJoining && p.isAlive && p.X != null && !isNaN(p.X)) {
                const eye = getPlayerEyePos(p);

                const coneRange = (typeof options_VisionConeRange !== "undefined") ? options_VisionConeRange : 150;
                const coneAngle = (typeof options_VisionConeAngle !== "undefined") ? options_VisionConeAngle : 94.9;
                const coneRespectsLOS = (typeof options_VisionConeRespectsLOS !== "undefined") ? options_VisionConeRespectsLOS : true;
                const respectTerrainLOS = (typeof options_ConeRespectsTerrain !== "undefined") ? options_ConeRespectsTerrain : true;

                // 1. 3D Volumetric Vision Cone (Radiates from eye level with 63.03° vertical FOV)
                // Controlled specifically by "Cone with LOS" (options_VisionConeRespectsLOS)
                if (showVisionCone) {
                    this.add3DVisionCone(eye.x, eye.y, eye.z, eye.rot, coneRange, coneAngle, coneRespectsLOS);
                }

                // 2. 3D Threat Lasers (Forward Gaze LOS + Enemy Targeting Beams from eye level)
                // Controlled specifically by "Terrain/Building LOS" (options_ConeRespectsTerrain)
                if (showThreatLasers) {
                    this.add3DThreatLasers(p, eye.x, eye.y, eye.z, eye.rot, coneRange, coneAngle, respectTerrainLOS);
                }

                // 3. 3D 4km Laser (Head/Eye Level 4000m projection)
                if (show4KmLaser) {
                    this.add3D4KmLaser(eye.x, eye.y, eye.z, eye.rot);
                }

                // 4. 3D BVR Laser (Head/Eye Level BVR corridor laser)
                if (showBVRLaser) {
                    this.add3DBVRLaser(p, eye.x, eye.y, eye.z, eye.rot, coneRange);
                }
            }
        } else if (selVehicle != -1 && typeof AllVehicles !== "undefined") {
            const v = AllVehicles[selVehicle];
            if (v && v.X != null && !isNaN(v.X)) {
                const eye = getVehicleEyePos(v);

                const coneRange = (typeof options_VisionConeRange !== "undefined") ? options_VisionConeRange : 150;
                const coneAngle = (typeof options_VisionConeAngle !== "undefined") ? options_VisionConeAngle : 94.9;
                const coneRespectsLOS = (typeof options_VisionConeRespectsLOS !== "undefined") ? options_VisionConeRespectsLOS : true;
                const respectTerrainLOS = (typeof options_ConeRespectsTerrain !== "undefined") ? options_ConeRespectsTerrain : true;

                if (showVisionCone) {
                    this.add3DVisionCone(eye.x, eye.y, eye.z, eye.rot, coneRange, coneAngle, coneRespectsLOS);
                }
                if (showThreatLasers) {
                    this.add3DThreatLasers(v, eye.x, eye.y, eye.z, eye.rot, coneRange, coneAngle, respectTerrainLOS);
                }
                if (show4KmLaser) {
                    this.add3D4KmLaser(eye.x, eye.y, eye.z, eye.rot);
                }
                if (showBVRLaser) {
                    this.add3DBVRLaser(v, eye.x, eye.y, eye.z, eye.rot, coneRange);
                }
            }
        }

        // 7b. Active Squad Leader Order Vector Line in 3D (for selected player or selected squad)
        {
            let orderTeam = 0, orderSquad = 0;
            let originX = null, originY = null, originZ = null;
            if (selPlayer != -1 && selPlayer != SELECTED_NOTHING && typeof AllPlayers !== "undefined" && AllPlayers[selPlayer]) {
                const sp = AllPlayers[selPlayer];
                if (!sp.isJoining && sp.isAlive && sp.squad > 0 && sp.X != null && !isNaN(sp.X)) {
                    orderTeam = sp.team;
                    orderSquad = sp.squad;
                    const pEye = getPlayerEyePos(sp);
                    if (Number.isFinite(pEye.x) && Number.isFinite(pEye.y) && Number.isFinite(pEye.z)) {
                        originX = pEye.x; originY = pEye.y - 0.5; originZ = pEye.z;
                    }
                }
            } else if (typeof SelectedSquadTeam !== "undefined" && SelectedSquadTeam != SELECTED_NOTHING &&
                       typeof SelectedSquadNumber !== "undefined" && SelectedSquadNumber > 0) {
                orderTeam = SelectedSquadTeam;
                orderSquad = SelectedSquadNumber;
                if (typeof AllPlayers !== "undefined") {
                    for (const pid in AllPlayers) {
                        const mp = AllPlayers[pid];
                        if (mp && !mp.isJoining && mp.isAlive && mp.team === orderTeam && mp.squad === orderSquad && mp.isSquadLeader && mp.X != null && !isNaN(mp.X)) {
                            const pEye = getPlayerEyePos(mp);
                            if (Number.isFinite(pEye.x) && Number.isFinite(pEye.y) && Number.isFinite(pEye.z)) {
                                originX = pEye.x; originY = pEye.y - 0.5; originZ = pEye.z;
                            }
                            break;
                        }
                    }
                }
            }
            if (orderTeam > 0 && orderSquad > 0 && typeof getOrderFromTeamSquad === "function") {
                const ord = getOrderFromTeamSquad(orderTeam, orderSquad);
                if (ord && ord.type !== 0 && Number.isFinite(ord.X) && Number.isFinite(ord.Z)) {
                    const ordH = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(ord.X, ord.Z) + 1.0 : 1.0;
                    // Sleek 8-arc tactical amber target marker + small center anchor
                    this.add3DDashedTerrainRing(ord.X, ord.Z, 4.2, 0.52, 0.92, 0.56, 0.16, 0.86, 8, 1.2);
                    this.add3DTerrainRing(ord.X, ord.Z, 0.35, 0.78, 0.92, 0.56, 0.16, 0.86, 16);
                    if (originX !== null) {
                        this.add3DDashedLine(originX, originY, -originZ, ord.X, ordH, -ord.Z, 0.92, 0.56, 0.16, 0.82, 4.0, 2.5);
                    }
                }
            }
        }

        // 7c. 3D Highlight Area Rings (when clicking event coordinates in dialogs or timeline)
        if (typeof highlights !== "undefined" && Array.isArray(highlights) && highlights.length > 0) {
            for (let hi = 0; hi < highlights.length; hi++) {
                const h = highlights[hi];
                if (!h || !Number.isFinite(h.x) || !Number.isFinite(h.z) || !(h.fade > 0)) continue;
                const radius = 5.0 + (1.0 - h.fade) * 26.0;
                const fadeAlpha = Math.min(0.88, h.fade);
                this.add3DSoftTerrainRing(h.x, h.z, radius, 0.72, Math.min(radius * 0.25, 4.5), 0.92, 0.34, 0.24, fadeAlpha, 36);
                this.add3DDashedTerrainRing(h.x, h.z, 2.8, 0.48, 0.94, 0.76, 0.28, Math.min(0.92, h.fade), 4, 0);
            }
        }

        const totalTriCount = this.triVertexCount;
        const groundTriCount = totalTriCount - arrowTriCount;

        if (this.lineVertexCount === 0 && totalTriCount === 0) return;

        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uViewMatrix, false, renderer3d.getCurrentViewMatrix());
        gl.uniformMatrix4fv(this.uProjectionMatrix, false, renderer3d.getCurrentProjectionMatrix());

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // --- PASS 1: Air Vertical Drop Lines (Hardware Depth Tested) ---
        if (this.lineVertexCount > 0) {
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu_pos_buffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.positions.subarray(0, this.lineVertexCount * 3), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.aPosition);
            gl.vertexAttribPointer(this.aPosition, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu_col_buffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.colors.subarray(0, this.lineVertexCount * 4), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.aColor);
            gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
        }

        // Upload Triangles buffer once for Pass 2 and Pass 3
        if (totalTriCount > 0) {
            const offset = 6000;
            gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu_pos_buffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.positions.subarray(offset * 3, (offset + totalTriCount) * 3), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.aPosition);
            gl.vertexAttribPointer(this.aPosition, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu_col_buffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.colors.subarray(offset * 4, (offset + totalTriCount) * 4), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.aColor);
            gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, 0, 0);

            // --- PASS 2: 3D Volumetric Kill Arrows (Always Visible Through Terrain) ---
            if (arrowTriCount > 0) {
                gl.disable(gl.DEPTH_TEST);
                gl.drawArrays(gl.TRIANGLES, 0, arrowTriCount);
            }

            // --- PASS 3: 3D Ground & Volumetric Overlays (Depth Tested on Roofs/Terrain/Water with Blending) ---
            if (groundTriCount > 0) {
                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LEQUAL);
                gl.depthMask(false);
                gl.drawArrays(gl.TRIANGLES, arrowTriCount, groundTriCount);
                gl.depthMask(true);
            }
        }

        gl.disableVertexAttribArray(this.aPosition);
        gl.disableVertexAttribArray(this.aColor);
    }
}

$(() => {
    lines3dRenderer = new Lines3dRenderer();
});
