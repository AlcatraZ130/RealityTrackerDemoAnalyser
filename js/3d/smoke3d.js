// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Project Reality SpriteParticleSystem 3D Smoke Renderer (WebGL2)
// Uses PR's authentic 2x2 billowing smoke sprite sheet (Textures/anim_smoke2ground2.webp),
// deterministic demo-clock emitter simulation (burning infantry smoke + burst vehicle/mortar smoke),
// directional sun shading, and map distance fog integration in 1 single draw call.

var smoke3dRenderer;

class Smoke3dRenderer extends Initializable {
    dataReady = true;
    initialized = false;

    program = null;
    vao = null;
    vbo = null;
    ibo = null;
    tex = null;
    texReady = false;

    maxPuffs = 2048;
    // Per vertex: pos(3) + uv(2) + localUv(2) + color(4) = 11 floats
    vertData = null;
    puffList = [];

    constructor() {
        super();
        this.dataReady = true;
        this.vertData = new Float32Array(this.maxPuffs * 4 * 11);
    }

    getIsDataReady() {
        return true;
    }

    getDependencyList() {
        return [];
    }

    init() {
        if (this.initialized) return true;
        const gl = renderer3d ? renderer3d.gl : null;
        if (!gl) return false;

        const vsSource = `#version 300 es
            precision highp float;
            layout(location = 0) in vec3 aPos;
            layout(location = 1) in vec2 aUv;
            layout(location = 2) in vec2 aLocalUv;
            layout(location = 3) in vec4 aColor;

            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;

            out vec2 vUv;
            out vec2 vLocalUv;
            out vec4 vColor;
            out vec3 vWorldPos;

            void main(void) {
                vUv = aUv;
                vLocalUv = aLocalUv;
                vColor = aColor;
                vWorldPos = aPos;
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(aPos, 1.0);
            }
        `;

        const fsSource = `#version 300 es
            precision highp float;
            in vec2 vUv;
            in vec2 vLocalUv;
            in vec4 vColor;
            in vec3 vWorldPos;

            uniform sampler2D uTex;
            uniform sampler2D uSceneDepth;
            uniform int uHasSceneDepth;
            uniform vec2 uViewportSize;
            uniform vec3 uSunDir;
            uniform vec3 uFogColor;
            uniform int uUseFog;
            uniform vec3 uFogOrigin;
            uniform vec4 uFogRange;
            uniform float uFogAlphaFloor;

            out vec4 fragColor;

            float linearizeSceneDepth(float d) {
                float zNdc = d * 2.0 - 1.0;
                return (2.0 * 0.25 * 20000.0) / (20000.0 + 0.25 - zNdc * (20000.0 - 0.25));
            }

            void main(void) {
                float softFade = 1.0;
                if (uHasSceneDepth == 1) {
                    vec2 screenUv = gl_FragCoord.xy / uViewportSize;
                    float sceneD = texture(uSceneDepth, screenUv).r;
                    if (gl_FragCoord.z >= sceneD) discard;
                    float linScene = linearizeSceneDepth(sceneD);
                    float linFrag = linearizeSceneDepth(gl_FragCoord.z);
                    softFade = clamp((linScene - linFrag) / 1.5, 0.0, 1.0);
                    if (softFade <= 0.005) discard;
                }

                vec4 texel = texture(uTex, vUv);
                float alpha = texel.a * vColor.a * softFade;
                if (alpha <= 0.008) discard;

                // Soft volumetric billboard shading: warmer lit upper/sunward side, grounded base
                float sunY = clamp(uSunDir.y * 0.5 + 0.5, 0.30, 1.0);
                float verticalShade = mix(0.84, 1.08, clamp(vLocalUv.y, 0.0, 1.0));
                float radialSoft = 1.0 - smoothstep(0.40, 0.99, length(vLocalUv * 2.0 - 1.0));
                vec3 col = texel.rgb * vColor.rgb * verticalShade * mix(0.90, 1.05, sunY);
                alpha *= mix(0.88, 1.0, radialSoft);

                // PR distance fog integration (Ra_GetFogValue)
                if (uUseFog == 1) {
                    float d = length(vWorldPos - uFogOrigin);
                    vec2 fv = d * uFogRange.xy + uFogRange.zw;
                    float closeF = max(fv.y, uFogAlphaFloor);
                    float fx = max(fv.x, 0.0);
                    float fogVis = smoothstep(0.0, 1.0, closeF - fx * fx * fx);
                    if (fogVis <= 0.004) discard;
                    col = mix(uFogColor, col, fogVis);
                    alpha *= smoothstep(0.0, 0.18, fogVis);
                }

                fragColor = vec4(col, clamp(alpha, 0.0, 0.98));
            }
        `;

        const vs = renderer3d.loadShader(gl.VERTEX_SHADER, vsSource);
        const fs = renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return false;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error("[Smoke3D] Program link failed:", gl.getProgramInfoLog(prog));
            return false;
        }
        this.program = prog;

        this.uViewMatrix = gl.getUniformLocation(prog, "uViewMatrix");
        this.uProjectionMatrix = gl.getUniformLocation(prog, "uProjectionMatrix");
        this.uTex = gl.getUniformLocation(prog, "uTex");
        this.uSceneDepth = gl.getUniformLocation(prog, "uSceneDepth");
        this.uHasSceneDepth = gl.getUniformLocation(prog, "uHasSceneDepth");
        this.uViewportSize = gl.getUniformLocation(prog, "uViewportSize");
        this.uSunDir = gl.getUniformLocation(prog, "uSunDir");
        this.uFogColor = gl.getUniformLocation(prog, "uFogColor");
        this.uUseFog = gl.getUniformLocation(prog, "uUseFog");
        this.uFogOrigin = gl.getUniformLocation(prog, "uFogOrigin");
        this.uFogRange = gl.getUniformLocation(prog, "uFogRange");
        this.uFogAlphaFloor = gl.getUniformLocation(prog, "uFogAlphaFloor");

        // Pre-build static quad index buffer for maxPuffs
        const indices = new Uint16Array(this.maxPuffs * 6);
        for (let i = 0; i < this.maxPuffs; i++) {
            const vi = i * 4;
            const ii = i * 6;
            indices[ii + 0] = vi + 0;
            indices[ii + 1] = vi + 1;
            indices[ii + 2] = vi + 2;
            indices[ii + 3] = vi + 0;
            indices[ii + 4] = vi + 2;
            indices[ii + 5] = vi + 3;
        }

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertData.byteLength, gl.DYNAMIC_DRAW);

        const stride = 11 * 4;
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 3 * 4);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 5 * 4);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 7 * 4);

        this.ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        gl.bindVertexArray(null);

        this._loadSmokeTexture(gl);
        this.initialized = true;
        return true;
    }

    _loadSmokeTexture(gl) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // 1x1 neutral fallback until WebP finishes loading
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([220, 215, 205, 0]));
        this.tex = tex;

        const img = new Image();
        img.onload = () => {
            if (!renderer3d || !renderer3d.gl) return;
            const g = renderer3d.gl;
            g.bindTexture(g.TEXTURE_2D, tex);
            g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
            g.generateMipmap(g.TEXTURE_2D);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
            g.bindTexture(g.TEXTURE_2D, null);
            this.texReady = true;
            if (typeof requestUpdate === "function") requestUpdate();
        };
        img.src = "Textures/anim_smoke2ground2.webp";
    }

    // Deterministic fast hash in [0, 1)
    _hash(seed) {
        const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
        return s - Math.floor(s);
    }

    // Evaluates PR's cubic transparencyGraph (-1/-1/1/1) smoothly clamped to [0, 1]
    _evalPrAlphaCurve(ageNorm) {
        if (ageNorm <= 0.0 || ageNorm >= 1.0) return 0.0;
        const fadeIn = Math.min(1.0, ageNorm / 0.14);
        const fadeOut = Math.pow(Math.max(0.0, 1.0 - Math.max(0.0, (ageNorm - 0.58) / 0.42)), 1.45);
        return fadeIn * fadeOut;
    }

    draw(useFogArg, fogCfgArg, fogOriginArg) {
        if (!this.initialized || !this.program || !this.texReady) return;
        if (typeof syncBurningSmokeScreensFromAllProj === "function") {
            syncBurningSmokeScreensFromAllProj();
        }
        if (typeof ns_activeSmokeScreens3D === "undefined" || ns_activeSmokeScreens3D.length === 0) return;

        const gl = renderer3d.gl;
        const viewMatrix = renderer3d.getCurrentViewMatrix();
        const projMatrix = renderer3d.getCurrentProjectionMatrix();
        const camPos = renderer3d.cameraPos;

        const currentT = (typeof Tick_Current !== "undefined" && typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null)
            ? tickToTime[Tick_Current]
            : (performance.now() / 1000.0);

        const puffs = this.puffList;
        puffs.length = 0;

        for (let i = ns_activeSmokeScreens3D.length - 1; i >= 0; i--) {
            const smk = ns_activeSmokeScreens3D[i];
            if (!smk) continue;

            // Follow bouncing burning canister live while active
            if (smk.projId != null && typeof AllProj !== "undefined" && AllProj[smk.projId]) {
                const liveP = AllProj[smk.projId];
                const lx = (typeof liveP.getX === "function") ? liveP.getX() : liveP.X;
                const ly = (typeof liveP.getY === "function") ? liveP.getY() : liveP.Y;
                const lz = (typeof liveP.getZ === "function") ? liveP.getZ() : liveP.Z;
                if (lx != null && !isNaN(lx) && lz != null && !isNaN(lz)) {
                    smk.x = lx;
                    smk.z = lz;
                    if (typeof heightmap !== "undefined") {
                        smk.y = Math.max(ly || 0, heightmap.getHeightFromCoords(lx, lz) + 0.05);
                    } else if (ly != null && !isNaN(ly)) {
                        smk.y = ly;
                    }
                }
            }

            const elapsed = (typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null && smk.startTimeSeconds > 0)
                ? (currentT - smk.startTimeSeconds)
                : ((performance.now() - smk.spawnTime) / 1000.0);

            if (elapsed < 0 || elapsed >= smk.totalDuration) {
                if (elapsed >= smk.totalDuration) {
                    ns_activeSmokeScreens3D.splice(i, 1);
                }
                continue;
            }

            // Ground-anchor smoke near terrain (vehicle turrets/launchers spawn 2-4m above ground;
            // clamp ground-level smoke to terrain so it sits solidly on the street/ground without floating)
            let anchorY = smk.y;
            if (typeof heightmap !== "undefined") {
                const groundY = heightmap.getHeightFromCoords(smk.x, smk.z);
                if (!isNaN(groundY) && (smk.y - groundY) < 7.0) {
                    anchorY = groundY;
                }
            }

            const baseCol = Array.isArray(smk.color) ? smk.color : [0.88, 0.85, 0.81];
            const isNeutral = (Math.abs(baseCol[0] - baseCol[1]) < 0.08 && Math.abs(baseCol[1] - baseCol[2]) < 0.08);
            const col1 = isNeutral ? [0.89, 0.87, 0.83] : baseCol;
            const col2 = isNeutral ? [0.76, 0.74, 0.69] : [baseCol[0] * 0.84, baseCol[1] * 0.84, baseCol[2] * 0.84];
            const seedBase = (smk.startTick || 1) * 1.37 + smk.x * 0.13 + smk.z * 0.19;

            if (smk.mode === "burning") {
                // Authentic PR e_smokegrenade2 / e_smokegrenade_40mm continuous emitter
                const emitDelay = smk.emitDelay || 2.0;
                const mainDelay = smk.mainDelay || 6.0;
                const burnEnd = smk.burnEnd || 60.0;
                const fadeDur = smk.fadeDuration || 18.0;
                const maxR = smk.maxRadius || 7.5;
                const maxH = (smk.maxHeight || 7.5) * 1.32;
                if (elapsed < emitDelay) continue;

                // Stage 1: Ignition puffs (2s..burnEnd, low dense puffs near canister)
                const ignStep = 1.05;
                const ignMaxBirth = Math.min(elapsed, burnEnd);
                const ignStartIdx = Math.max(0, Math.floor((elapsed - 6.0 - emitDelay) / ignStep));
                const ignEndIdx = Math.floor((ignMaxBirth - emitDelay) / ignStep);
                for (let k = ignStartIdx; k <= ignEndIdx; k++) {
                    const birth = emitDelay + k * ignStep;
                    const age = elapsed - birth;
                    const ttl = 3.5 + this._hash(seedBase + k * 7.1) * 2.4;
                    if (age < 0 || age >= ttl) continue;
                    const ageN = age / ttl;
                    const ang = this._hash(seedBase + k * 13.3) * Math.PI * 2;
                    const drift = (0.3 + 1.5 * Math.pow(ageN, 0.7));
                    const px = smk.x + Math.cos(ang) * drift;
                    const pz = smk.z + Math.sin(ang) * drift;
                    const py = anchorY + 0.45 + age * 0.48;
                    const size = 2.0 + 3.1 * Math.pow(ageN, 0.62);
                    const alpha = this._evalPrAlphaCurve(ageN) * 0.76;
                    if (alpha > 0.02 && puffs.length < this.maxPuffs) {
                        puffs.push({
                            x: px, y: py, z: -pz,
                            size: size,
                            rot: this._hash(seedBase + k * 3.7) * Math.PI * 2 + age * 0.08,
                            frame: k & 3,
                            r: col1[0], g: col1[1], b: col1[2], a: alpha,
                            distSq: 0
                        });
                    }
                }

                // Stage 2: Main billowing smoke (6s..burnEnd, dense continuous PR stream -> full tall cloud)
                if (elapsed >= mainDelay) {
                    const mainStep = 0.62;
                    const maxPuffTtl = fadeDur + 4.0;
                    const mMaxBirth = Math.min(elapsed, burnEnd);
                    const mStartIdx = Math.max(0, Math.floor((elapsed - maxPuffTtl - mainDelay) / mainStep));
                    const mEndIdx = Math.floor((mMaxBirth - mainDelay) / mainStep);
                    for (let k = mStartIdx; k <= mEndIdx; k++) {
                        const birth = mainDelay + k * mainStep;
                        const age = elapsed - birth;
                        const h1 = this._hash(seedBase + k * 19.7 + 101);
                        const h2 = this._hash(seedBase + k * 29.3 + 203);
                        const h3 = this._hash(seedBase + k * 41.1 + 307);
                        const ttl = (fadeDur * 0.68) + h1 * (fadeDur * 0.52);
                        if (age < 0 || age >= ttl) continue;
                        const ageN = age / ttl;
                        const ang = h2 * Math.PI * 2;
                        const spread = maxR * (0.16 + 0.84 * h3) * (1.0 - Math.exp(-age * 0.28));
                        const px = smk.x + Math.cos(ang) * spread;
                        const pz = smk.z + Math.sin(ang) * spread;
                        // Ground-hugging base up to tall billowing crown
                        const py = anchorY + 0.45 + Math.min(maxH * 0.88, age * 0.34 + h1 * 2.4);
                        const size = (maxR * 0.56) + (maxR * 1.08) * (0.28 + 0.72 * Math.pow(ageN, 0.52));
                        const alpha = this._evalPrAlphaCurve(ageN) * 0.90;
                        if (alpha > 0.02 && puffs.length < this.maxPuffs) {
                            const r = col1[0] + (col2[0] - col1[0]) * ageN;
                            const g = col1[1] + (col2[1] - col1[1]) * ageN;
                            const b = col1[2] + (col2[2] - col1[2]) * ageN;
                            puffs.push({
                                x: px, y: py, z: -pz,
                                size: size,
                                rot: h1 * Math.PI * 2 + (h2 > 0.5 ? 1 : -1) * age * 0.045,
                                frame: k & 3,
                                r: r, g: g, b: b, a: alpha,
                                distSq: 0
                            });
                        }
                    }
                }
            } else {
                // Instant-burst PR vehicle M82 / M82_brightIR / mortar / tank shell smoke
                const burstTime = smk.burstTime || 1.8;
                const peakDur = smk.peakDuration || 40.0;
                const maxR = smk.maxRadius || 7.5;
                const maxH = (smk.maxHeight || 8.0) * 1.40;
                const numPuffs = (maxR >= 10.0) ? 54 : 42;

                let cloudAlpha = 0.0;
                let expandT = 1.0;
                let ageColorT = 0.0;
                if (elapsed < burstTime) {
                    const p = elapsed / Math.max(0.1, burstTime);
                    expandT = 0.24 + 0.76 * (1.0 - Math.pow(1.0 - p, 2.5));
                    cloudAlpha = 0.98 * p;
                    ageColorT = 0.0;
                } else if (elapsed <= peakDur) {
                    expandT = 1.0 + 0.10 * ((elapsed - burstTime) / Math.max(1.0, peakDur - burstTime));
                    cloudAlpha = 0.98;
                    ageColorT = 0.50 * ((elapsed - burstTime) / Math.max(1.0, peakDur - burstTime));
                } else {
                    const fadeP = (elapsed - peakDur) / Math.max(0.1, smk.totalDuration - peakDur);
                    expandT = 1.10 + fadeP * 0.28;
                    cloudAlpha = 0.98 * Math.pow(Math.max(0.0, 1.0 - fadeP), 1.35);
                    ageColorT = 0.50 + 0.50 * fadeP;
                }

                if (cloudAlpha <= 0.02) continue;

                for (let k = 0; k < numPuffs; k++) {
                    const h1 = this._hash(seedBase + k * 11.3);
                    const h2 = this._hash(seedBase + k * 23.7 + 17);
                    const h3 = this._hash(seedBase + k * 37.9 + 53);
                    const ang = (k / numPuffs) * Math.PI * 2 + (h1 - 0.5) * 0.42;
                    // Layered structure: dense ground-skirt core (first 38%), thick mid-wall (next 38%), tall crown (top 24%)
                    const tier = k / numPuffs;
                    let ring, baseElev, sizeScale, alphaScale;
                    if (tier < 0.38) {
                        ring = 0.14 + 0.76 * Math.sqrt(h2);
                        baseElev = 0.35 + (maxH * 0.24) * h3;
                        sizeScale = 0.92 + h1 * 0.52;
                        alphaScale = 0.92;
                    } else if (tier < 0.76) {
                        ring = 0.18 + 0.78 * Math.sqrt(h2);
                        baseElev = (maxH * 0.22) + (maxH * 0.42) * h3;
                        sizeScale = 0.96 + h1 * 0.58;
                        alphaScale = 0.88;
                    } else {
                        ring = 0.12 + 0.62 * Math.sqrt(h2);
                        baseElev = (maxH * 0.58) + (maxH * 0.36) * h3;
                        sizeScale = 0.88 + h1 * 0.56;
                        alphaScale = 0.76;
                    }

                    const radDist = maxR * 0.80 * ring * expandT;
                    const px = smk.x + Math.cos(ang) * radDist;
                    const pz = smk.z + Math.sin(ang) * radDist;
                    const rise = Math.min(maxH * 0.24, elapsed * 0.038 * (0.4 + h1));
                    const py = anchorY + baseElev * Math.min(1.0, expandT) + rise;
                    const size = (maxR * sizeScale) * (0.48 + 0.52 * expandT);
                    const puffAlpha = cloudAlpha * alphaScale * (0.82 + 0.18 * (1.0 - ring * 0.5));
                    if (puffAlpha > 0.02 && puffs.length < this.maxPuffs) {
                        const r = col1[0] + (col2[0] - col1[0]) * ageColorT;
                        const g = col1[1] + (col2[1] - col1[1]) * ageColorT;
                        const b = col1[2] + (col2[2] - col1[2]) * ageColorT;
                        puffs.push({
                            x: px, y: py, z: -pz,
                            size: size,
                            rot: h2 * Math.PI * 2 + (h3 > 0.5 ? 1 : -1) * elapsed * 0.028,
                            frame: k & 3,
                            r: r, g: g, b: b, a: puffAlpha,
                            distSq: 0
                        });
                    }
                }
            }
        }

        if (puffs.length === 0) return;

        // Sort back-to-front relative to camera for clean alpha blending
        const cx = camPos[0], cy = camPos[1], cz = camPos[2];
        for (let i = 0; i < puffs.length; i++) {
            const p = puffs[i];
            const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
            p.distSq = dx * dx + dy * dy + dz * dz;
        }
        puffs.sort((a, b) => b.distSq - a.distSq);

        // Camera right and up axes from viewMatrix (column-major)
        const rX = viewMatrix[0], rY = viewMatrix[4], rZ = viewMatrix[8];
        const uX = viewMatrix[1], uY = viewMatrix[5], uZ = viewMatrix[9];

        const vd = this.vertData;
        let ptr = 0;
        const count = puffs.length;
        for (let i = 0; i < count; i++) {
            const p = puffs[i];
            const hs = p.size * 0.5;
            const ca = Math.cos(p.rot), sa = Math.sin(p.rot);

            // Rotated billboard basis vectors
            const bxX = (rX * ca - uX * sa) * hs;
            const bxY = (rY * ca - uY * sa) * hs;
            const bxZ = (rZ * ca - uZ * sa) * hs;
            const byX = (rX * sa + uX * ca) * hs;
            const byY = (rY * sa + uY * ca) * hs;
            const byZ = (rZ * sa + uZ * ca) * hs;

            // 2x2 sprite sheet UV bounds (inset slightly to prevent neighbor bleed)
            const fx = (p.frame & 1) * 0.5;
            const fy = ((p.frame >> 1) & 1) * 0.5;
            const u0 = fx + 0.008, u1 = fx + 0.492;
            const v0 = fy + 0.008, v1 = fy + 0.492;

            // Corner 0: bottom-left
            vd[ptr++] = p.x - bxX - byX; vd[ptr++] = p.y - bxY - byY; vd[ptr++] = p.z - bxZ - byZ;
            vd[ptr++] = u0; vd[ptr++] = v1; vd[ptr++] = 0.0; vd[ptr++] = 0.0;
            vd[ptr++] = p.r; vd[ptr++] = p.g; vd[ptr++] = p.b; vd[ptr++] = p.a;

            // Corner 1: bottom-right
            vd[ptr++] = p.x + bxX - byX; vd[ptr++] = p.y + bxY - byY; vd[ptr++] = p.z + bxZ - byZ;
            vd[ptr++] = u1; vd[ptr++] = v1; vd[ptr++] = 1.0; vd[ptr++] = 0.0;
            vd[ptr++] = p.r; vd[ptr++] = p.g; vd[ptr++] = p.b; vd[ptr++] = p.a;

            // Corner 2: top-right
            vd[ptr++] = p.x + bxX + byX; vd[ptr++] = p.y + bxY + byY; vd[ptr++] = p.z + bxZ + byZ;
            vd[ptr++] = u1; vd[ptr++] = v0; vd[ptr++] = 1.0; vd[ptr++] = 1.0;
            vd[ptr++] = p.r; vd[ptr++] = p.g; vd[ptr++] = p.b; vd[ptr++] = p.a;

            // Corner 3: top-left
            vd[ptr++] = p.x - bxX + byX; vd[ptr++] = p.y - bxY + byY; vd[ptr++] = p.z - bxZ + byZ;
            vd[ptr++] = u0; vd[ptr++] = v0; vd[ptr++] = 0.0; vd[ptr++] = 1.0;
            vd[ptr++] = p.r; vd[ptr++] = p.g; vd[ptr++] = p.b; vd[ptr++] = p.a;
        }

        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uViewMatrix, false, viewMatrix);
        gl.uniformMatrix4fv(this.uProjectionMatrix, false, projMatrix);

        const sunDir = (typeof skyboxRenderer !== "undefined" && skyboxRenderer && Array.isArray(skyboxRenderer.sunDir))
            ? skyboxRenderer.sunDir
            : [0.55, 0.72, 0.42];
        gl.uniform3f(this.uSunDir, sunDir[0], sunDir[1], sunDir[2]);

        const fogCfg = fogCfgArg || ((typeof renderer3d.getMapFogConfig === "function") ? renderer3d.getMapFogConfig() : null);
        const fogCol = (fogCfg && Array.isArray(fogCfg.fogColor))
            ? fogCfg.fogColor
            : ((typeof skyboxRenderer !== "undefined" && skyboxRenderer && Array.isArray(skyboxRenderer.fogColor))
                ? skyboxRenderer.fogColor
                : [0.72, 0.74, 0.76]);
        gl.uniform3f(this.uFogColor, fogCol[0], fogCol[1], fogCol[2]);

        const useFog = (useFogArg && fogCfg && fogCfg.fogRange) ? 1 : 0;
        gl.uniform1i(this.uUseFog, useFog);
        if (useFog === 1) {
            const fo = fogOriginArg || camPos;
            gl.uniform3f(this.uFogOrigin, fo[0], fo[1], fo[2]);
            gl.uniform4fv(this.uFogRange, fogCfg.fogRange);
            gl.uniform1f(this.uFogAlphaFloor, fogCfg.fogAlphaFloor || 0.0);
        }

        const hasSceneDepth = (renderer3d && renderer3d.sceneDepthTex) ? 1 : 0;
        gl.uniform1i(this.uHasSceneDepth, hasSceneDepth);
        gl.uniform2f(this.uViewportSize, renderer3d.canvas.width, renderer3d.canvas.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.uniform1i(this.uTex, 0);

        if (hasSceneDepth === 1) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, renderer3d.sceneDepthTex);
            gl.uniform1i(this.uSceneDepth, 1);
            gl.activeTexture(gl.TEXTURE0);
        }

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vd.subarray(0, ptr));

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        if (hasSceneDepth === 1) {
            // Post-SSAO pass has no scene depth attachment; fragment shader tests uSceneDepth directly
            gl.disable(gl.DEPTH_TEST);
        } else {
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
        }
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);

        gl.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_SHORT, 0);

        gl.depthMask(true);
        gl.bindVertexArray(null);
    }
}

smoke3dRenderer = new Smoke3dRenderer();
