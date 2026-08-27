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

function trigger3DExplosion(x, y, z, projType, templateName) {
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
    // Smoke Screen Grenades & Tank Smoke Screen Projectiles (Type 39, 41 or 'smoke')
    // -------------------------------------------------------------------------
    const isSmoke = (type === 39 || type === 41 || tName.includes('smoke') || tName.includes('smk') || tName.includes('ugd'));
    if (isSmoke) {
        const lobes = [];
        const numLobes = 9;
        for (let i = 0; i < numLobes; i++) {
            const ang = (i / numLobes) * Math.PI * 2 + (Math.random() * 0.3 - 0.15);
            const dist = 2.5 + Math.random() * 2.8;
            lobes.push({
                dx: Math.cos(ang) * dist,
                dz: Math.sin(ang) * dist,
                dy: (i % 2 === 0 ? 0.8 : 2.6) + Math.random() * 1.2,
                baseR: 3.6 + Math.random() * 1.2
            });
        }

        const nowSec = (typeof Tick_Current !== "undefined" && typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null)
            ? tickToTime[Tick_Current]
            : (performance.now() / 1000.0);

        ns_activeSmokeScreens3D.push({
            x: x,
            y: worldY,
            z: z,
            spawnTime: performance.now(),
            startTick: (typeof Tick_Current !== "undefined") ? Tick_Current : 0,
            startTimeSeconds: nowSec,
            peakDuration: 40.0,   // Peak dense occlusion for 40 seconds
            totalDuration: 70.0,  // Dissipates gradually from 40s to 70s (1m 10s)
            maxHeight: 8.0,       // 8 meters high
            maxRadius: 7.0,       // 7 meters radius
            lobes: lobes
        });

        if (ns_activeSmokeScreens3D.length > 40) {
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

    let maxRadius = isHuge ? 16.0 : (isSmall ? 5.0 : 9.5);
    let duration = isHuge ? 0.85 : (isSmall ? 0.45 : 0.65);
    let debrisCount = isHuge ? 26 : (isSmall ? 10 : 18);
    let burstSpeed = isHuge ? 26.0 : (isSmall ? 12.0 : 18.0);

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
            // Vehicle Green color (#00ff66 in 2D)
            const r = 0.0, g = 1.0, b = 0.40;
            const bandW = Math.max(0.8, v.ns_auraRadius * 0.03);
            this.add3DTerrainRing(vx, vz, Math.max(0, v.ns_auraRadius - bandW), v.ns_auraRadius, r, g, b, v.ns_auraOpacity, 42);
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
            this.add3DGroundRing(hitX, hitY + 0.1, hitZ, 0.3, 0.7, r, g, b, 0.95, 24);
        } else if (hitType === "terrain") {
            r = 1.0; g = 0.65; b = 0.0; a = 0.98; // Terrain Gold
            this.add3DTerrainRing(hitX, hitZ, 0.4, 0.9, r, g, b, 0.95, 24);
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

    add3DArrow(x1, y1, z1, x2, y2, z2, r, g, b, a, camX, camY, camZ, shaftW, headW, headL, borderR, borderG, borderB) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.5) return;

        const ux = dx / len;
        const uy = dy / len;
        const uz = dz / len;

        const mx = (x1 + x2) * 0.5;
        const my = (y1 + y2) * 0.5;
        const mz = (z1 + z2) * 0.5;

        const vcx = camX - mx;
        const vcy = camY - my;
        const vcz = camZ - mz;

        let nx = uy * vcz - uz * vcy;
        let ny = uz * vcx - ux * vcz;
        let nz = ux * vcy - uy * vcx;
        const nLen = Math.hypot(nx, ny, nz);
        if (nLen < 0.0001) return;

        nx /= nLen;
        ny /= nLen;
        nz /= nLen;

        const actualHeadLen = Math.min(len * 0.40, headL || 3.8);
        const actualHeadWidth = headW || 1.35;
        const halfShaft = (shaftW || 0.45) * 0.5;

        const bx = x2 - ux * actualHeadLen;
        const by = y2 - uy * actualHeadLen;
        const bz = z2 - uz * actualHeadLen;

        const br = (borderR != null) ? borderR : r * 0.25;
        const bg = (borderG != null) ? borderG : g * 0.25;
        const bb = (borderB != null) ? borderB : b * 0.25;

        // 1. Darker Outer Outline Border (High Contrast vs Buildings & Terrain)
        const outlineShaft = halfShaft * 1.65;
        const outlineHeadW = actualHeadWidth * 1.45;
        const outlineHeadL = actualHeadLen * 1.10;
        const bxOut = x2 - ux * outlineHeadL;
        const byOut = y2 - uy * outlineHeadL;
        const bzOut = z2 - uz * outlineHeadL;

        const os1x = x1 - nx * outlineShaft, os1y = y1 - ny * outlineShaft, os1z = z1 - nz * outlineShaft;
        const os2x = x1 + nx * outlineShaft, os2y = y1 + ny * outlineShaft, os2z = z1 + nz * outlineShaft;
        const os3x = bxOut - nx * outlineShaft, os3y = byOut - ny * outlineShaft, os3z = bzOut - nz * outlineShaft;
        const os4x = bxOut + nx * outlineShaft, os4y = byOut + ny * outlineShaft, os4z = bzOut + nz * outlineShaft;

        const oh1x = bxOut - nx * outlineHeadW, oh1y = byOut - ny * outlineHeadW, oh1z = bzOut - nz * outlineHeadW;
        const oh2x = bxOut + nx * outlineHeadW, oh2y = byOut + ny * outlineHeadW, oh2z = bzOut + nz * outlineHeadW;
        const oh3x = x2 + ux * 0.35, oh3y = y2 + uy * 0.35, oh3z = z2 + uz * 0.35;

        this.addTri(os1x, os1y, os1z, os2x, os2y, os2z, os3x, os3y, os3z, br, bg, bb, a * 0.95);
        this.addTri(os2x, os2y, os2z, os4x, os4y, os4z, os3x, os3y, os3z, br, bg, bb, a * 0.95);
        this.addTri(oh1x, oh1y, oh1z, oh2x, oh2y, oh2z, oh3x, oh3y, oh3z, br, bg, bb, a * 0.95);

        // 2. Inner Team Core Shaft & Head
        const s1x = x1 - nx * halfShaft, s1y = y1 - ny * halfShaft, s1z = z1 - nz * halfShaft;
        const s2x = x1 + nx * halfShaft, s2y = y1 + ny * halfShaft, s2z = z1 + nz * halfShaft;
        const s3x = bx - nx * halfShaft, s3y = by - ny * halfShaft, s3z = bz - nz * halfShaft;
        const s4x = bx + nx * halfShaft, s4y = by + ny * halfShaft, s4z = bz + nz * halfShaft;

        const h1x = bx - nx * actualHeadWidth, h1y = by - ny * actualHeadWidth, h1z = bz - nz * actualHeadWidth;
        const h2x = bx + nx * actualHeadWidth, h2y = by + ny * actualHeadWidth, h2z = bz + nz * actualHeadWidth;
        const h3x = x2, h3y = y2, h3z = z2;

        this.addTri(s1x, s1y, s1z, s2x, s2y, s2z, s3x, s3y, s3z, r, g, b, a);
        this.addTri(s2x, s2y, s2z, s4x, s4y, s4z, s3x, s3y, s3z, r, g, b, a);
        this.addTri(h1x, h1y, h1z, h2x, h2y, h2z, h3x, h3y, h3z, r, g, b, a);
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
        if (showAirHeight && typeof AllVehicles !== "undefined") {
            for (const vId in AllVehicles) {
                const v = AllVehicles[vId];
                if (!v || !v.isFlyingVehicle || v.isClimbingVehicle) continue;

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

                // Team 1 (Red / OPFOR): Vivid Red core with dark crimson outline
                // Team 2 (Blue / BLUFOR): Deep Royal Blue core with dark navy outline
                const isTeam1 = (atk.team === 1);
                const r = isTeam1 ? 1.0 : 0.08;
                const g = isTeam1 ? 0.16 : 0.42;
                const b = isTeam1 ? 0.10 : 1.0;

                const borderR = isTeam1 ? 0.35 : 0.01;
                const borderG = isTeam1 ? 0.02 : 0.08;
                const borderB = isTeam1 ? 0.02 : 0.42;

                this.add3DArrow(ax, ay + 1.3, -az, vx, vy + 1.0, -vz, r, g, b, fade, camX, camY, camZ, 0.48, 1.40, 3.8, borderR, borderG, borderB);
            }
        }

        const arrowTriCount = this.triVertexCount;

        // ---------------------------------------------------------------------
        // 2b. Authentic Sea / Ocean / River Water Plane (Depth Tested on Terrain)
        // ---------------------------------------------------------------------
        const activeMapKey = (typeof window.CurrentMapName !== "undefined" && window.CurrentMapName) 
            ? window.CurrentMapName.toLowerCase() 
            : ((typeof buildingHeightmap !== "undefined" && buildingHeightmap._mapKey) ? buildingHeightmap._mapKey.toLowerCase() : null);

        if (activeMapKey && typeof PR_WATER_DATABASE !== "undefined" && PR_WATER_DATABASE[activeMapKey]) {
            const wInfo = PR_WATER_DATABASE[activeMapKey];
            if (wInfo.hasWater && wInfo.seaLevel > 0.0) {
                const seaLevel = (typeof wInfo.seaLevel === "number") ? wInfo.seaLevel : 0.0;
                const mapSize = (typeof heightmap !== "undefined" && heightmap.terrainSize) ? heightmap.terrainSize : 2048;
                const halfS = Math.max(mapSize * 2.5, 5000);

                const wr = (wInfo.color && wInfo.color[0] != null) ? wInfo.color[0] : 0.15;
                const wg = (wInfo.color && wInfo.color[1] != null) ? wInfo.color[1] : 0.25;
                const wb = (wInfo.color && wInfo.color[2] != null) ? wInfo.color[2] : 0.35;
                const wa = 0.85; // Realistic translucent water surface

                const x1 = -halfS, x2 = halfS;
                const z1 = -halfS, z2 = halfS; // In game coords, OpenGL uses -z

                // Top-facing quad (2 triangles)
                this.addTri(x1, seaLevel, -z1, x2, seaLevel, -z1, x2, seaLevel, -z2, wr, wg, wb, wa);
                this.addTri(x1, seaLevel, -z1, x2, seaLevel, -z2, x1, seaLevel, -z2, wr, wg, wb, wa);
                // Bottom-facing quad for underwater camera angles (2 triangles)
                this.addTri(x1, seaLevel, -z1, x2, seaLevel, -z2, x2, seaLevel, -z1, wr, wg, wb, wa);
                this.addTri(x1, seaLevel, -z1, x1, seaLevel, -z2, x2, seaLevel, -z2, wr, wg, wb, wa);

                // DOD (Combat Areas / Out of Bounds) Colored Water Overlays
                const showDOD = (typeof options_DrawDOD !== "undefined") ? options_DrawDOD : true;
                if (showDOD && typeof currentDODList !== "undefined" && currentDODList && currentDODList.length > 0) {
                    const dodY = seaLevel + 0.04;
                    for (let dIdx = 0; dIdx < currentDODList.length; dIdx++) {
                        const CA = currentDODList[dIdx];
                        if (!CA || CA.inverted === 1 || !CA.points || CA.points.length < 3) continue;

                        let dodR = 0.5, dodG = 0.5, dodB = 0.5, dodA = 0.38;
                        if (CA.team === 1) { // Blue Team
                            dodR = 0.10; dodG = 0.35; dodB = 0.95; dodA = 0.42;
                        } else if (CA.team === 2) { // Red Team
                            dodR = 0.95; dodG = 0.15; dodB = 0.15; dodA = 0.42;
                        } else { // Neutral / Out of Bounds
                            dodR = 0.35; dodG = 0.35; dodB = 0.35; dodA = 0.38;
                        }

                        const pts = CA.points;
                        const p0 = pts[0];
                        for (let i = 1; i < pts.length - 1; i++) {
                            const p1 = pts[i];
                            const p2 = pts[i + 1];
                            // Top facing tri
                            this.addTri(p0[0], dodY, -p0[1], p1[0], dodY, -p1[1], p2[0], dodY, -p2[1], dodR, dodG, dodB, dodA);
                            // Bottom facing tri (double-sided)
                            this.addTri(p0[0], dodY, -p0[1], p2[0], dodY, -p2[1], p1[0], dodY, -p1[1], dodR, dodG, dodB, dodA);
                        }
                    }
                }
            }
        }

        // ---------------------------------------------------------------------
        // 3. 3D Ground Rings for Orders & Spotted Tracking
        // ---------------------------------------------------------------------
        const showSpotted = (typeof options_DrawSpottedIndicators !== "undefined") ? options_DrawSpottedIndicators : false;
        if (showSpotted && typeof hud3d !== "undefined" && typeof hud3d.computeSpottedEntities === "function") {
            const spottedData = hud3d.computeSpottedEntities();
            if (spottedData) {
                const pulseFactor = 0.5 + 0.5 * Math.sin(performance.now() / 200);
                const pulseR = 0.70 + pulseFactor * 0.55;
                const ringThickness = 0.22;
                const alpha = 0.35 + (1.0 - pulseFactor) * 0.55;

                const r = 1.0, g = 0.08, b = 0.20;

                for (const player of spottedData.players) {
                    let px = (typeof player.getX === "function") ? player.getX() : player.X;
                    let py = (typeof player.getY === "function") ? player.getY() : (player.Y || 0);
                    let pz = (typeof player.getZ === "function") ? player.getZ() : player.Z;
                    if (px == null || pz == null) continue;

                    if (typeof heightmap !== "undefined") {
                        py = Math.max(py, heightmap.getHeightFromCoords(px, pz));
                    }

                    this.add3DGroundRing(px, py + 0.04, pz, pulseR, pulseR + ringThickness, r, g, b, alpha, 32);
                }

                for (const veh of spottedData.vehicles) {
                    let vx = (typeof veh.getX === "function") ? veh.getX() : veh.X;
                    let vy = (typeof veh._smoothY === "number") ? veh._smoothY : ((typeof veh.getY === "function") ? veh.getY() : (veh.Y || 0));
                    let vz = (typeof veh.getZ === "function") ? veh.getZ() : veh.Z;
                    if (vx == null || vz == null) continue;

                    const vPulseR = 2.2 + pulseFactor * 1.2;
                    this.add3DGroundRing(vx, vy + 0.06, vz, vPulseR, vPulseR + 0.35, r, g, b, alpha, 36);
                }

                for (const fob of spottedData.fobs) {
                    let fx = fob.X, fz = fob.Z, fy = fob.Y || 0;
                    if (typeof heightmap !== "undefined") fy = Math.max(fy, heightmap.getHeightFromCoords(fx, fz));
                    const fPulseR = 3.5 + pulseFactor * 1.5;
                    this.add3DGroundRing(fx, fy + 0.06, fz, fPulseR, fPulseR + 0.40, r, g, b, alpha, 36);
                }
            }
        }

        // ---------------------------------------------------------------------
        // 4. Flag Capture Radii (Projected Flat on 3D Terrain)
        // ---------------------------------------------------------------------
        const showFlags = (typeof options_DrawFlagRadius !== "undefined") ? options_DrawFlagRadius : true;
        if (showFlags && typeof AllFlags !== "undefined") {
            for (const fId in AllFlags) {
                const f = AllFlags[fId];
                if (!f || f.Radius == null || f.Radius <= 0) continue;

                let r = 0.75, g = 0.75, b = 0.75, a = 0.40;
                if (f.team === 1) { r = 1.0; g = 0.18; b = 0.10; a = 0.50; }
                else if (f.team === 2) { r = 0.15; g = 0.55; b = 1.0; a = 0.50; }

                const rad = f.Radius;
                const bandW = Math.max(0.7, rad * 0.022);
                this.add3DTerrainRing(f.X, f.Z, Math.max(0, rad - bandW), rad, r, g, b, a, 48);
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
                const bandW = Math.max(1.0, currentRadiusM * 0.025);
                this.add3DTerrainRing(sw.x, sw.z, Math.max(0, currentRadiusM - bandW), currentRadiusM, col[0], col[1], col[2], opacity, 54);
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
                    const bandW = Math.max(0.6, flankRadius * 0.015);
                    // Purple ring on 3D terrain: rgba(128, 0, 128, 0.75)
                    this.add3DTerrainRing(px, pz, Math.max(0, flankRadius - bandW), flankRadius, 0.65, 0.10, 0.85, 0.75, 54);
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

                // Draw ribbon segments along the trail
                for (let j = 0; j < trail.length - 1; j++) {
                    const p1 = trail[j];
                    const p2 = trail[j + 1];
                    const age1 = (now - p1.time) / 1200.0;
                    const age2 = (now - p2.time) / 1200.0;

                    const alpha1 = Math.max(0.0, Math.pow(1.0 - age1, 1.5) * 0.75);
                    const alpha2 = Math.max(0.0, Math.pow(1.0 - age2, 1.5) * 0.75);

                    if (alpha1 <= 0.01 && alpha2 <= 0.01) continue;

                    // Expanding smoke ribbon width (thin near rocket, thicker behind)
                    const w1 = 0.12 + age1 * 0.45;
                    const w2 = 0.12 + age2 * 0.45;

                    // Draw 3D quad ribbon
                    const nz1 = -p1.z, nz2 = -p2.z;
                    this.addTri(p1.x - w1, p1.y, nz1, p1.x + w1, p1.y, nz1, p2.x - w2, p2.y, nz2, 0.95, 0.95, 0.98, (alpha1 + alpha2) * 0.5);
                    this.addTri(p1.x + w1, p1.y, nz1, p2.x + w2, p2.y, nz2, p2.x - w2, p2.y, nz2, 0.95, 0.95, 0.98, (alpha1 + alpha2) * 0.5);
                    
                    // Vertical ribbon cross for full 3D visibility from any angle
                    this.addTri(p1.x, p1.y - w1, nz1, p1.x, p1.y + w1, nz1, p2.x, p2.y - w2, nz2, 0.95, 0.95, 0.98, (alpha1 + alpha2) * 0.5);
                    this.addTri(p1.x, p1.y + w1, nz1, p2.x, p2.y + w2, nz2, p2.x, p2.y - w2, nz2, 0.95, 0.95, 0.98, (alpha1 + alpha2) * 0.5);
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
        // 5f. Realistic Volumetric 3D Smoke Screens (Tank Smoke & Smoke Grenades)
        // ---------------------------------------------------------------------
        if (typeof ns_activeSmokeScreens3D !== "undefined" && ns_activeSmokeScreens3D.length > 0) {
            const currentT = (typeof Tick_Current !== "undefined" && typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null)
                ? tickToTime[Tick_Current]
                : (performance.now() / 1000.0);

            for (let i = ns_activeSmokeScreens3D.length - 1; i >= 0; i--) {
                const smk = ns_activeSmokeScreens3D[i];
                if (!smk) continue;

                let elapsed = 0;
                if (typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null && smk.startTimeSeconds > 0) {
                    elapsed = currentT - smk.startTimeSeconds;
                } else {
                    elapsed = (performance.now() - smk.spawnTime) / 1000.0;
                }

                if (elapsed < 0 || elapsed >= smk.totalDuration) {
                    if (elapsed >= smk.totalDuration) {
                        ns_activeSmokeScreens3D.splice(i, 1);
                    }
                    continue;
                }

                let alpha = 0.0;
                let radiusScale = 1.0;
                let heightScale = 1.0;

                if (elapsed < 2.0) {
                    const expP = elapsed / 2.0;
                    radiusScale = 0.3 + 0.7 * (1.0 - Math.pow(1.0 - expP, 2.5));
                    heightScale = 0.3 + 0.7 * expP;
                    alpha = 0.90 * expP;
                } else if (elapsed <= smk.peakDuration) {
                    radiusScale = 1.0;
                    heightScale = 1.0;
                    alpha = 0.88;
                } else {
                    const fadeP = (elapsed - smk.peakDuration) / (smk.totalDuration - smk.peakDuration);
                    radiusScale = 1.0 + fadeP * 0.35;
                    heightScale = 1.0 + fadeP * 0.25;
                    alpha = 0.88 * Math.pow(1.0 - fadeP, 1.3);
                }

                if (alpha > 0.02) {
                    const coreR = smk.maxRadius * 0.85 * radiusScale;
                    const coreH = smk.maxHeight * heightScale;
                    const halfH = coreH * 0.5;

                    // Core smoke pillar resting on ground and rising to coreH
                    this.add3DSmokeDome(smk.x, smk.y + halfH * 0.95, smk.z, coreR, halfH, 0.94, 0.94, 0.96, alpha * 0.88, 5, 8);

                    // Surrounding overlapping billowing lobes connecting seamlessly
                    for (const lobe of smk.lobes) {
                        const lx = smk.x + lobe.dx * radiusScale;
                        const lz = smk.z + lobe.dz * radiusScale;
                        const lr = lobe.baseR * radiusScale;
                        const lobeH = (lobe.dy + lr * 0.5) * heightScale;
                        const halfLobeH = lobeH * 0.5;
                        const ly = smk.y + halfLobeH * 0.95;

                        this.add3DSmokeDome(lx, ly, lz, lr, halfLobeH, 0.91, 0.91, 0.93, alpha * 0.78, 4, 7);
                    }
                }
            }
        }

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

                            // 2D Exact Colors: Sprint = Gold/Yellow, Walk/Crouch = Cyan
                            let r = 0.0, g = 0.90, b = 1.0;
                            if (st.stance === "sprint") {
                                r = 1.0; g = 0.78; b = 0.0;
                            }
                            const bandW = Math.max(0.35, p.ns_auraRadius * 0.035);
                            this.add3DTerrainRing(px, pz, Math.max(0, p.ns_auraRadius - bandW), p.ns_auraRadius, r, g, b, p.ns_auraOpacity, 36);
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

            // --- PASS 3: 3D Ground & Volumetric Geometry (Depth Tested on Roofs/Terrain with Blending) ---
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
