// Part of RealityTracker Demo Analyser 3D ALPHA - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// High-Performance On-Demand 3D Entity Renderer in WebGL2 (Soldiers & Vehicles)
// Renders real 3D triangle meshes with Team Colors (Team 1 OpFor #ff0000 / Team 2 BluFor #0040ff),
// Selection Outlines (#bea425), Ground Offset Compensation, and Dynamic Terrain Following (Pitch & Roll).

var entities3dRenderer;

class Entities3dRenderer extends Initializable {
    program = null;
    outlineProgram = null;
    
    // WebGL GPU Buffers Cache: name -> { vertexBuffer, indexBuffer, indexCount, vertexCount, groundOffset, length, width }
    gpuMeshCache = {};
    modularMeshCache = {};
    rawModelCache = {};
    pendingFetches = new Set();
    pendingModularFetches = new Set();
    _modularFetchQueue = [];
    _modularQueuedKeys = new Set();
    _modularActiveFetches = 0;
    _modularMaxConcurrent = 6;
    _modularRetryAfter = {};
    failedModels = new Set();
    failedModularModels = new Set();
    texCache = {};
    pendingTexPaths = {};
    pendingTexFetches = new Set();
    failedTexModels = new Set();
    _preloadInProgress = false;
    _preloadFinished = false;
    
    // Active Map Spawns Cache
    currentMap = null;
    mapSpawnEntities = [];
    
    // Attribute & Uniform Locations
    aVertexPosition = null;
    aVertexNormal = null;
    aVertexUV = null;
    uModelMatrix = null;
    uViewMatrix = null;
    uProjectionMatrix = null;
    uTeamColor = null;
    uIsSelected = null;
    uUseTexture = null;
    uEntityTex = null;
    hasSelection = false;

    // Outline Shader Locations (Legacy Fallback)
    aOutlineVertexPosition = null;
    aOutlineVertexNormal = null;
    uOutlineModelMatrix = null;
    uOutlineViewMatrix = null;
    uOutlineProjectionMatrix = null;
    uOutlineColor = null;

    // RealityTracker Team Color Definitions:
    // Team 1: OpFor (Red #ff0000)
    // Team 2: BluFor (Blue #0040ff)
    colorTeam1 = vec3.set(vec3.create(), 1.0, 0.0, 0.0);   // #ff0000 (OpFor / Team 1 / Red)
    colorTeam2 = vec3.set(vec3.create(), 0.0, 0.25, 1.0);  // #0040ff (BluFor / Team 2 / Blue)
    colorSquad = vec3.set(vec3.create(), 0.22, 1.0, 0.08); // Green (#39ff14)
    colorOutline = vec3.set(vec3.create(), 0.745, 0.643, 0.145); // Golden Outline (#bea425)
    colorDeadTeam1 = vec3.set(vec3.create(), 0.52, 0.38, 0.38); // OpFor Dead (Gris rojizo apagado)
    colorDeadTeam2 = vec3.set(vec3.create(), 0.38, 0.42, 0.52); // BluFor Dead (Gris azulado apagado)
    colorCache = vec3.set(vec3.create(), 0.88, 0.72, 0.22);     // Insurgency Ammo Cache (Dorado)

    dataReady = true;
    initialized = false;

    constructor() {
        super();
    }

    getIsDataReady() {
        return true;
    }

    init() {
        if (this.initialized) return true;

        const gl = renderer3d.gl;
        if (!gl) return false;

        // ---------------------------------------------------------------------
        // 1. Main Entity Shader (Solid Color / Lazy Texture + Lighting + MRT Selection Mask)
        // ---------------------------------------------------------------------
        const vsSource = `#version 300 es
            in vec3 aVertexPosition;
            in vec3 aVertexNormal;
            in vec2 aVertexUV;

            uniform mat4 uModelMatrix;
            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;

            out vec3 vNormal;
            out vec3 vWorldPos;
            out vec2 vUV;

            void main(void) {
                vec4 worldPos = uModelMatrix * vec4(aVertexPosition, 1.0);
                gl_Position = uProjectionMatrix * uViewMatrix * worldPos;
                vNormal = normalize(mat3(uModelMatrix) * aVertexNormal);
                vWorldPos = worldPos.xyz;
                vUV = aVertexUV;
            }
        `;

        const fsSource = `#version 300 es
            precision highp float;
            precision highp sampler2DShadow;

            in vec3 vNormal;
            in vec3 vWorldPos;
            in vec2 vUV;

            uniform vec3 uTeamColor;
            uniform float uIsSelected;
            uniform int uUseTexture;
            uniform sampler2D uEntityTex;
            uniform vec4 uUvScroll;
            uniform vec3 uSunDir;
            uniform vec3 uCameraPos;
            uniform int uUsePrReflections;
            uniform mat4 uLightSpaceMatrix;
            uniform sampler2DShadow uShadowMap;
            uniform int uUseShadows;

            layout(location = 0) out vec4 fragColor;
            layout(location = 1) out vec4 fragMask;

            float sampleEntityShadow(vec3 worldPos, vec3 norm, float ndotl) {
                float nOff = mix(0.07, 0.025, ndotl);
                vec4 ls = uLightSpaceMatrix * vec4(worldPos + norm * nOff, 1.0);
                vec3 proj = (ls.xyz / ls.w) * 0.5 + 0.5;
                if (proj.x <= 0.002 || proj.x >= 0.998 || proj.y <= 0.002 || proj.y >= 0.998 || proj.z <= 0.0 || proj.z >= 1.0) {
                    return 1.0;
                }
                float edge = min(min(proj.x, 1.0 - proj.x), min(proj.y, 1.0 - proj.y));
                float edgeFade = smoothstep(0.0, 0.12, edge);
                float zRef = proj.z - mix(0.00035, 0.00014, ndotl);
                float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
                float ca = cos(ang), sa = sin(ang);
                mat2 rot = mat2(ca, -sa, sa, ca);
                const float rad = 1.5 / 2048.0;
                const vec2 POISSON[9] = vec2[9](
                    vec2( 0.000,  0.000),
                    vec2( 0.520,  0.210),
                    vec2(-0.460,  0.340),
                    vec2( 0.180, -0.580),
                    vec2(-0.290, -0.490),
                    vec2( 0.890, -0.350),
                    vec2(-0.850, -0.220),
                    vec2( 0.340,  0.880),
                    vec2(-0.410,  0.840)
                );
                float s = 0.0;
                for (int i = 0; i < 9; i++) {
                    vec2 off = (rot * POISSON[i]) * rad;
                    s += texture(uShadowMap, vec3(proj.xy + off, zRef));
                }
                s *= (1.0 / 9.0);
                return mix(1.0, s, edgeFade);
            }

            void main(void) {
                vec3 norm = normalize(vNormal);
                if (!gl_FrontFacing) norm = -norm;

                vec3 sunDir = normalize(uSunDir);
                float rawNdotL = max(dot(norm, sunDir), 0.0);
                // PR RealityShaders Half-Lambert diffuse wrap (RDirectXTK_GetHalfNL)
                float halfNL = dot(norm, sunDir) * 0.5 + 0.5;
                float sunDiff = halfNL * halfNL;
                float shadowVis = 1.0;
                if (uUseShadows == 1 && rawNdotL > 0.001) {
                    shadowVis = sampleEntityShadow(vWorldPos, norm, rawNdotL);
                    sunDiff *= mix(0.20, 1.0, shadowVis);
                }

                vec3 skyDir = normalize(vec3(-sunDir.x, 0.65, -sunDir.z));
                float skyDiff = max(dot(norm, skyDir), 0.0);

                float skyFactor = clamp(norm.y * 0.5 + 0.5, 0.0, 1.0);
                float lighting = 0.24 + (0.50 * sunDiff) + (0.15 * skyDiff) + (0.11 * skyFactor);

                vec2 sampleUV = vUV;
                if (uUseTexture == 1 && uUvScroll.w > 0.5) {
                    float cMin = uUvScroll.y;
                    float cSize = max(uUvScroll.z, 0.01);
                    float localV = fract((sampleUV.y - cMin) / cSize + uUvScroll.x);
                    sampleUV.y = cMin + (0.004 + localV * 0.992) * cSize;
                }
                vec3 baseCol = (uUseTexture == 1) ? texture(uEntityTex, sampleUV).rgb : uTeamColor;
                vec3 finalCol = baseCol * lighting;

                if (uUsePrReflections == 1) {
                    // Exact PR RealityDirectXTK.fxh RDirectXTK_ComputeLights (SpecPower = 32.0) + RaShaderBM env reflection
                    vec3 V = normalize(uCameraPos - vWorldPos);
                    vec3 H = normalize(sunDir + V);
                    float luma = dot(baseCol, vec3(0.299, 0.587, 0.114));
                    float gloss = smoothstep(0.06, 0.48, luma);
                    float spec = pow(max(dot(norm, H), 0.0), 32.0) * rawNdotL * shadowVis * gloss;
                    float fresnel = pow(1.0 - max(dot(norm, V), 0.0), 3.5);
                    vec3 skyReflCol = mix(vec3(0.42, 0.48, 0.56), vec3(0.76, 0.85, 0.96), skyFactor);
                    finalCol += vec3(1.0, 0.96, 0.88) * (spec * 0.30);
                    finalCol = mix(finalCol, skyReflCol, clamp(fresnel * (gloss * 0.25), 0.0, 0.25));
                    finalCol = clamp(finalCol, 0.0, 1.0);
                }

                fragColor = vec4(finalCol, 1.0);
                fragMask = vec4(uIsSelected, 0.0, 0.0, 1.0);
            }
        `;

        const vertexShader = renderer3d.loadShader(gl.VERTEX_SHADER, vsSource);
        const fragmentShader = renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource);

        const prog = gl.createProgram();
        gl.attachShader(prog, vertexShader);
        gl.attachShader(prog, fragmentShader);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Unable to initialize Entity 3D shader program: ' + gl.getProgramInfoLog(prog));
            return false;
        }

        this.program = prog;
        this.aVertexPosition = gl.getAttribLocation(prog, 'aVertexPosition');
        this.aVertexNormal = gl.getAttribLocation(prog, 'aVertexNormal');
        this.aVertexUV = gl.getAttribLocation(prog, 'aVertexUV');
        this.uModelMatrix = gl.getUniformLocation(prog, 'uModelMatrix');
        this.uViewMatrix = gl.getUniformLocation(prog, 'uViewMatrix');
        this.uProjectionMatrix = gl.getUniformLocation(prog, 'uProjectionMatrix');
        this.uTeamColor = gl.getUniformLocation(prog, 'uTeamColor');
        this.uIsSelected = gl.getUniformLocation(prog, 'uIsSelected');
        this.uUseTexture = gl.getUniformLocation(prog, 'uUseTexture');
        this.uEntityTex = gl.getUniformLocation(prog, 'uEntityTex');
        this.uUvScroll = gl.getUniformLocation(prog, 'uUvScroll');
        this.uSunDir = gl.getUniformLocation(prog, 'uSunDir');
        this.uCameraPos = gl.getUniformLocation(prog, 'uCameraPos');
        this.uUsePrReflections = gl.getUniformLocation(prog, 'uUsePrReflections');
        this.uLightSpaceMatrix = gl.getUniformLocation(prog, 'uLightSpaceMatrix');
        this.uShadowMap = gl.getUniformLocation(prog, 'uShadowMap');
        this.uUseShadows = gl.getUniformLocation(prog, 'uUseShadows');

        // Lightweight depth-only shadow caster shader
        const shadowVs = `#version 300 es
            in vec3 aVertexPosition;
            uniform mat4 uModelMatrix;
            uniform mat4 uLightSpaceMatrix;
            void main(void) {
                gl_Position = uLightSpaceMatrix * uModelMatrix * vec4(aVertexPosition, 1.0);
            }
        `;
        const shadowFs = `#version 300 es
            precision lowp float;
            void main(void) {}
        `;
        const sProg = gl.createProgram();
        gl.attachShader(sProg, renderer3d.loadShader(gl.VERTEX_SHADER, shadowVs));
        gl.attachShader(sProg, renderer3d.loadShader(gl.FRAGMENT_SHADER, shadowFs));
        gl.linkProgram(sProg);
        if (gl.getProgramParameter(sProg, gl.LINK_STATUS)) {
            this.shadowProgram = sProg;
            this.sVertexPosition = gl.getAttribLocation(sProg, 'aVertexPosition');
            this.sModelMatrix = gl.getUniformLocation(sProg, 'uModelMatrix');
            this.sLightSpaceMatrix = gl.getUniformLocation(sProg, 'uLightSpaceMatrix');
        }
        this._shadowCasters = [];

        // ---------------------------------------------------------------------
        // 2. Selection Outline Shader (Expanded Hull #bea425)
        // ---------------------------------------------------------------------
        const vsOutlineSource = `
            attribute vec3 aVertexPosition;
            attribute vec3 aVertexNormal;

            uniform mat4 uModelMatrix;
            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;

            void main(void) {
                vec3 norm = normalize(aVertexNormal);
                vec3 expanded = aVertexPosition + norm * 0.045;
                vec4 worldPos = uModelMatrix * vec4(expanded, 1.0);
                gl_Position = uProjectionMatrix * uViewMatrix * worldPos;
            }
        `;

        const fsOutlineSource = `
            uniform highp vec3 uOutlineColor;

            void main(void) {
                gl_FragColor = vec4(uOutlineColor, 1.0);
            }
        `;

        const vOutlineShader = renderer3d.loadShader(gl.VERTEX_SHADER, vsOutlineSource);
        const fOutlineShader = renderer3d.loadShader(gl.FRAGMENT_SHADER, fsOutlineSource);

        const outlineProg = gl.createProgram();
        gl.attachShader(outlineProg, vOutlineShader);
        gl.attachShader(outlineProg, fOutlineShader);
        gl.linkProgram(outlineProg);

        if (gl.getProgramParameter(outlineProg, gl.LINK_STATUS)) {
            this.outlineProgram = outlineProg;
            this.aOutlineVertexPosition = gl.getAttribLocation(outlineProg, 'aVertexPosition');
            this.aOutlineVertexNormal = gl.getAttribLocation(outlineProg, 'aVertexNormal');
            this.uOutlineModelMatrix = gl.getUniformLocation(outlineProg, 'uModelMatrix');
            this.uOutlineViewMatrix = gl.getUniformLocation(outlineProg, 'uViewMatrix');
            this.uOutlineProjectionMatrix = gl.getUniformLocation(outlineProg, 'uProjectionMatrix');
            this.uOutlineColor = gl.getUniformLocation(outlineProg, 'uOutlineColor');
        }

        // Upload any raw models already preloaded in the background to GPU buffers
        for (const modelKey in this.rawModelCache) {
            if (!this.gpuMeshCache[modelKey]) {
                this.uploadToGpu(modelKey, this.rawModelCache[modelKey]);
            }
        }

        this.initialized = true;
        this._prewarmPredictiveModularAssets();
        return true;
    }

    _prewarmPredictiveModularAssets() {
        if (this._prewarmedPredictive || typeof SOLDIER_LOADOUT_DB === "undefined" || !SOLDIER_LOADOUT_DB) return;
        this._prewarmedPredictive = true;
        const db = SOLDIER_LOADOUT_DB;
        // Pre-warm core predictive secondary equipment weapons (small JSONs) so they appear immediately on first action
        const coreEquipKeys = ["epipen", "medikit", "dressing", "shovel", "frag", "smoke", "mine_at", "c4", "ammokit"];
        if (db.equipDefaults && db.weapons) {
            for (const ek of coreEquipKeys) {
                const w = db.equipDefaults[ek];
                if (w && db.weapons[w]) {
                    this.fetchModularMeshAsync(`w_${w}`, false);
                }
            }
        }
        // Pre-warm active factions' stand/crouch/prone rifle bodies so crouched/prone soldiers never drop to legacy meshes
        if (db.factionDefaults && db.bodies) {
            const facList = [];
            if (typeof OpForTeam !== "undefined" && OpForTeam) facList.push(String(OpForTeam).toLowerCase());
            if (typeof BluForTeam !== "undefined" && BluForTeam) facList.push(String(BluForTeam).toLowerCase());
            const seenG = new Set();
            for (const fac of facList) {
                const fd = db.factionDefaults[fac];
                if (!fd) continue;
                for (const role of Object.keys(fd)) {
                    const bName = fd[role];
                    const be = bName ? db.bodies[bName] : null;
                    if (be && be.g && !seenG.has(be.g)) {
                        seenG.add(be.g);
                        this.fetchModularMeshAsync(`b_${be.g}_rifle_stand`, false);
                        this.fetchModularMeshAsync(`b_${be.g}_rifle_crouch`, false);
                        this.fetchModularMeshAsync(`b_${be.g}_rifle_prone`, false);
                    }
                }
            }
        }
    }

    _uploadAnimParts(gl, rawParts) {
        if (!Array.isArray(rawParts) || rawParts.length === 0) return null;
        const out = [];
        for (let i = 0; i < rawParts.length; i++) {
            const pt = rawParts[i];
            if (!pt || !Array.isArray(pt.v) || !Array.isArray(pt.i) || pt.i.length === 0) continue;
            const vBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pt.v), gl.STATIC_DRAW);
            const iBuf = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(pt.i), gl.STATIC_DRAW);
            out.push({
                kind: pt.k || "w",
                axis: pt.a || "x",
                pivot: Array.isArray(pt.p) && pt.p.length >= 3 ? pt.p : [0.0, 0.0, 0.0],
                radius: (typeof pt.r === "number" && pt.r > 0.05) ? pt.r : 0.45,
                vertexBuffer: vBuf,
                indexBuffer: iBuf,
                indexCount: pt.i.length,
                vertexCount: pt.v.length / 6
            });
        }
        return out.length > 0 ? out : null;
    }

    uploadToGpu(modelKey, raw) {
        const gl = renderer3d.gl;
        if (!gl || !raw || !raw.data) return null;

        const animParts = this._uploadAnimParts(gl, raw.data.parts);

        if (raw.data.hull && raw.data.turret) {
            // Multi-Part Vehicle (Chassis Hull + Rotating Turret)
            const hullData = raw.data.hull;
            const turretData = raw.data.turret;

            const hVBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, hVBuf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(hullData.v), gl.STATIC_DRAW);

            const hIBuf = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hIBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(hullData.i), gl.STATIC_DRAW);

            const tVBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, tVBuf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(turretData.v), gl.STATIC_DRAW);

            const tIBuf = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tIBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(turretData.i), gl.STATIC_DRAW);

            const gpuMesh = {
                modelKey: modelKey,
                isMultiPart: true,
                hull: {
                    vertexBuffer: hVBuf,
                    indexBuffer: hIBuf,
                    indexCount: hullData.i.length,
                    vertexCount: hullData.v.length / 6
                },
                turret: {
                    vertexBuffer: tVBuf,
                    indexBuffer: tIBuf,
                    indexCount: turretData.i.length,
                    vertexCount: turretData.v.length / 6,
                    pivot: turretData.pivot || [0.0, 1.5, 0.0]
                },
                parts: animParts,
                groundOffset: raw.groundOffset,
                hasTex: raw.hasTex !== false,
                preserveOrigin: !!raw.preserveOrigin,
                maxZ: raw.maxZ || 0.0,
                isNullMesh: !!raw.isNullMesh,
                length: raw.length,
                width: raw.width
            };

            this.gpuMeshCache[modelKey] = gpuMesh;
            return gpuMesh;
        }

        // Standard Single-Mesh Model
        const vBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(raw.data.v), gl.STATIC_DRAW);

        const iBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(raw.data.i), gl.STATIC_DRAW);

        const gpuMesh = {
            modelKey: modelKey,
            isMultiPart: false,
            vertexBuffer: vBuf,
            indexBuffer: iBuf,
            indexCount: raw.data.i.length,
            vertexCount: raw.numVerts,
            parts: animParts,
            groundOffset: raw.groundOffset,
            hasTex: raw.hasTex !== false,
            preserveOrigin: !!raw.preserveOrigin,
            maxZ: raw.maxZ || 0.0,
            isNullMesh: !!raw.isNullMesh,
            length: raw.length,
            width: raw.width
        };

        this.gpuMeshCache[modelKey] = gpuMesh;
        return gpuMesh;
    }

    _texLoadQueue = [];
    _texActiveLoads = 0;
    _texMaxConcurrent = 6;

    _pumpTexLoadQueue() {
        while (this._texActiveLoads < this._texMaxConcurrent && this._texLoadQueue.length > 0) {
            const job = this._texLoadQueue.shift();
            this._texActiveLoads++;
            this._runSingleTexLoad(job);
        }
    }

    _runSingleTexLoad(job) {
        const { texKey, wrapMode, cacheKey, resolve, attempt } = job;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            this._texActiveLoads--;
            this._pumpTexLoadQueue();
            const gl = renderer3d.gl;
            if (!gl) {
                delete this.pendingTexPaths[cacheKey];
                resolve(null);
                return;
            }
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            const mode = wrapMode ? gl.REPEAT : gl.CLAMP_TO_EDGE;
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic')
                || gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
                || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
            if (anisoExt) {
                const maxAniso = gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
                gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, maxAniso));
            }
            gl.bindTexture(gl.TEXTURE_2D, null);
            this.texCache[cacheKey] = tex;
            delete this.pendingTexPaths[cacheKey];
            resolve(tex);
        };
        img.onerror = () => {
            this._texActiveLoads--;
            if (attempt < 2) {
                setTimeout(() => {
                    this._texLoadQueue.push({ texKey, wrapMode, cacheKey, resolve, attempt: attempt + 1 });
                    this._pumpTexLoadQueue();
                }, 400);
            } else {
                delete this.pendingTexPaths[cacheKey];
                resolve(null);
            }
            this._pumpTexLoadQueue();
        };
        img.src = `Textures/entities/${texKey}.webp?v=6.0_glass_sit`;
    }

    _loadEntityTexture(texKey, wrapMode) {
        const cacheKey = `${texKey}_${wrapMode ? 1 : 0}`;
        if (this.texCache[cacheKey]) {
            return Promise.resolve(this.texCache[cacheKey]);
        }
        if (this.pendingTexPaths[cacheKey]) {
            return this.pendingTexPaths[cacheKey];
        }
        const p = new Promise((resolve) => {
            this._texLoadQueue.push({ texKey, wrapMode, cacheKey, resolve, attempt: 0 });
            this._pumpTexLoadQueue();
        });
        this.pendingTexPaths[cacheKey] = p;
        return p;
    }

    async fetchModelTexAsync(modelKey) {
        if (!modelKey || modelKey.startsWith("proj_") ||
            modelKey === "cache" || modelKey === "vehicle_dummy" ||
            this.pendingTexFetches.has(modelKey) || this.failedTexModels.has(modelKey)) return;
        const gpuMesh = this.gpuMeshCache[modelKey];
        if (!gpuMesh || gpuMesh.texReady || gpuMesh.hasTex === false || gpuMesh.isNullMesh) return;

        this.pendingTexFetches.add(modelKey);
        try {
            const resp = await fetch(`models_3d_tex/${modelKey}.json?v=7.1_tracks_fix`);
            if (!resp.ok) {
                this.failedTexModels.add(modelKey);
                this.pendingTexFetches.delete(modelKey);
                return;
            }
            const texData = await resp.json();
            if (!texData || !texData.tex) {
                this.failedTexModels.add(modelKey);
                this.pendingTexFetches.delete(modelKey);
                return;
            }

            const glTex = await this._loadEntityTexture(texData.tex, !!texData.wrap);
            const gl = renderer3d.gl;
            if (!gl || !glTex) {
                this.failedTexModels.add(modelKey);
                this.pendingTexFetches.delete(modelKey);
                return;
            }

            if (gpuMesh.isMultiPart && texData.hull_uv && texData.turret_uv) {
                const hUvBuf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, hUvBuf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texData.hull_uv), gl.STATIC_DRAW);

                const tUvBuf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, tUvBuf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texData.turret_uv), gl.STATIC_DRAW);

                gpuMesh.hull.uvBuffer = hUvBuf;
                gpuMesh.hull.glTexture = glTex;
                gpuMesh.hull.texReady = true;

                gpuMesh.turret.uvBuffer = tUvBuf;
                gpuMesh.turret.glTexture = glTex;
                gpuMesh.turret.texReady = true;

                gpuMesh.texReady = true;
            } else if (!gpuMesh.isMultiPart) {
                if (texData.v && texData.i && texData.uv) {
                    const tvBuf = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, tvBuf);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texData.v), gl.STATIC_DRAW);

                    const tiBuf = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tiBuf);
                    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(texData.i), gl.STATIC_DRAW);

                    const uvBuf = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texData.uv), gl.STATIC_DRAW);

                    gpuMesh.texVertexBuffer = tvBuf;
                    gpuMesh.texIndexBuffer = tiBuf;
                    gpuMesh.texIndexCount = texData.i.length;
                    gpuMesh.uvBuffer = uvBuf;
                    gpuMesh.glTexture = glTex;
                    gpuMesh.texReady = true;
                } else if (texData.uv) {
                    const uvBuf = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texData.uv), gl.STATIC_DRAW);

                    gpuMesh.uvBuffer = uvBuf;
                    gpuMesh.glTexture = glTex;
                    gpuMesh.texReady = true;
                }
            }

            if (gpuMesh.parts && Array.isArray(texData.parts_uv) && texData.parts_uv.length === gpuMesh.parts.length) {
                for (let pi = 0; pi < gpuMesh.parts.length; pi++) {
                    const pUv = texData.parts_uv[pi];
                    if (!Array.isArray(pUv) || pUv.length === 0) continue;
                    const pUvBuf = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, pUvBuf);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pUv), gl.STATIC_DRAW);
                    gpuMesh.parts[pi].uvBuffer = pUvBuf;
                    gpuMesh.parts[pi].glTexture = glTex;
                    gpuMesh.parts[pi].texReady = true;
                    if (Array.isArray(texData.parts_cell) && Array.isArray(texData.parts_cell[pi])) {
                        gpuMesh.parts[pi].uvCell = texData.parts_cell[pi];
                    }
                }
            }

            if (typeof requestUpdate === "function") requestUpdate();
        } catch (err) {
            this.failedTexModels.add(modelKey);
        }
        this.pendingTexFetches.delete(modelKey);
    }

    async fetchModelAsync(modelKey) {
        if (!modelKey || this.gpuMeshCache[modelKey] || this.pendingFetches.has(modelKey) || this.failedModels.has(modelKey)) return;
        
        this.pendingFetches.add(modelKey);
        try {
            const resp = await fetch(`models_3d/${modelKey}.json?v=18.1_tracks_fix`);
            if (!resp.ok) {
                this.failedModels.add(modelKey);
                this.pendingFetches.delete(modelKey);
                return;
            }
            const data = await resp.json();
            if (!data || (!data.v && !data.hull)) {
                this.failedModels.add(modelKey);
                this.pendingFetches.delete(modelKey);
                return;
            }

            // Calculate precise bounding box and ground offset across all vertices
            let minY = Infinity, maxY = -Infinity;
            let minX = Infinity, maxX = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            let allMinX = Infinity, allMaxX = -Infinity;
            let allMinZ = Infinity, allMaxZ = -Infinity;

            const isMulti = Boolean(data.hull && data.turret && Array.isArray(data.hull.v) && Array.isArray(data.turret.v));
            let allV = isMulti ? data.hull.v.concat(data.turret.v) : (data.v || []).slice();
            if (Array.isArray(data.parts)) {
                for (let pi = 0; pi < data.parts.length; pi++) {
                    if (data.parts[pi] && Array.isArray(data.parts[pi].v)) {
                        allV = allV.concat(data.parts[pi].v);
                    }
                }
            }
            const chassisV = (isMulti && data.hull.v.length >= 6) ? data.hull.v : allV;
            const numVerts = allV.length / 6;
            for (let vIdx = 0; vIdx < numVerts; vIdx++) {
                const vx = allV[vIdx * 6];
                const vy = allV[vIdx * 6 + 1];
                const vz = allV[vIdx * 6 + 2];
                if (vx < allMinX) allMinX = vx;
                if (vx > allMaxX) allMaxX = vx;
                if (vy < minY) minY = vy;
                if (vy > maxY) maxY = vy;
                if (vz < allMinZ) allMinZ = vz;
                if (vz > allMaxZ) allMaxZ = vz;
            }
            const numChassisVerts = chassisV.length / 6;
            for (let vIdx = 0; vIdx < numChassisVerts; vIdx++) {
                const vx = chassisV[vIdx * 6];
                const vz = chassisV[vIdx * 6 + 2];
                if (vx < minX) minX = vx;
                if (vx > maxX) maxX = vx;
                if (vz < minZ) minZ = vz;
                if (vz > maxZ) maxZ = vz;
            }

            const preserveOrigin = (data.preserveOrigin === true);
            const groundOffset = preserveOrigin ? 0.0 : ((minY < 0) ? -minY : 0.0);
            const maxSpan = (numVerts > 0) ? Math.max(allMaxX - allMinX, maxY - minY, allMaxZ - allMinZ) : 0.0;
            const isNullMesh = (data.isNullMesh === true) ||
                modelKey === "vehicle_uav_fuel" ||
                modelKey === "vehicle_dummy" ||
                modelKey.includes("null_staticmesh") ||
                (!modelKey.startsWith("proj_") && (maxSpan < 0.05 || (numVerts <= 6 && maxSpan <= 0.06)));

            const raw = {
                data: data,
                numVerts: numVerts,
                preserveOrigin: preserveOrigin,
                hasTex: (data.hasTex !== false),
                isNullMesh: isNullMesh,
                groundOffset: groundOffset,
                maxZ: Number.isFinite(maxZ) ? maxZ : 0.0,
                length: (maxZ > minZ) ? (maxZ - minZ) : 5.0,
                width: (maxX > minX) ? (maxX - minX) : 2.5
            };

            this.rawModelCache[modelKey] = raw;

            // If WebGL is already active, upload directly to GPU
            if (this.initialized && renderer3d.gl) {
                this.uploadToGpu(modelKey, raw);
                if (typeof requestUpdate === "function") requestUpdate();
            }
        } catch (e) {
            this.failedModels.add(modelKey);
        } finally {
            this.pendingFetches.delete(modelKey);
        }
    }

    normalizeFaction(fac) {
        if (!fac) return 'ru';
        let f = fac.toLowerCase().replace(/_vehicles|_iron|_night|_desert|_woodland|_winter/g, '').trim();
        const map = {
            'usmc': 'us',
            'russia': 'ru',
            'pla': 'ch',
            'china': 'ch',
            'british': 'gb',
            'uk': 'gb',
            'gb82': 'gb',
            'germany': 'ger',
            'france': 'fr',
            'canada': 'cf',
            'dutch': 'nl',
            'netherlands': 'nl',
            'poland': 'pl',
            'israel': 'idf',
            'insurgents': 'meinsurgent',
            'militia': 'meinsurgent',
            'syria': 'fsa',
            'nva': 'vnnva',
            'arf': 'meinsurgent',
            'arg82': 'cf',
            'chechen90': 'meinsurgent',
            'chinsurgent': 'meinsurgent',
            'chinsurgent90': 'meinsurgent',
            'vnusmc': 'vnusa',
            'ww2ger41': 'ww2ger',
            'ww2rusearly': 'ww2rus'
        };
        return map[f] || f;
    }

    startProgressiveBackgroundPreload() {
        if (this._preloadInProgress || this._preloadFinished) return;
        this._preloadInProgress = true;

        const queue = [];

        // Priority 1: Base Universal Fallbacks & Standard Riflemen
        queue.push('soldier_stand', 'soldier_crouch', 'soldier_prone');
        queue.push('vehicle_ammocache', 'vehicle_rallypoint_ru_placeable', 'vehicle_rallypoint_us_placeable');
        queue.push('fob_deployable_firebase', 'fob_insurgent_hideout');

        // Priority 2: Faction Rifleman Models (90% of soldiers on screen)
        const opforRaw = (typeof window.OpForTeam !== "undefined" && window.OpForTeam) || 'ru';
        const bluforRaw = (typeof window.BluForTeam !== "undefined" && window.BluForTeam) || 'us';
        const opforFaction = this.normalizeFaction(opforRaw);
        const bluforFaction = this.normalizeFaction(bluforRaw);
        const factions = new Set([opforFaction, bluforFaction]);

        factions.forEach(fac => {
            queue.push(`soldier_pr_${fac}_soldier2_stand`, `soldier_pr_${fac}_soldier2_crouch`, `soldier_pr_${fac}_soldier2_prone`);
        });

        // Priority 3: Core Projectiles
        queue.push('proj_tow', 'proj_lat', 'proj_aa', 'proj_grenadier', 'proj_frag', 'proj_smoke');

        // Priority 4: Other 5 kit roles for active factions
        factions.forEach(fac => {
            [1, 3, 4, 5, 6].forEach(kit => {
                queue.push(`soldier_pr_${fac}_soldier${kit}_stand`, `soldier_pr_${fac}_soldier${kit}_crouch`, `soldier_pr_${fac}_soldier${kit}_prone`);
            });
        });

        // Priority 5: Active Vehicles
        if (typeof AllVehicles !== "undefined") {
            for (const vid in AllVehicles) {
                const v = AllVehicles[vid];
                if (!v || !v.name) continue;
                const meshKey = this.getVehicleMeshKey(v);
                if (meshKey && !queue.includes(meshKey)) queue.push(meshKey);
            }
        }

        // Stream 1 single model every 70ms in background so 2D CPU usage is 0%
        let index = 0;
        const processNext = async () => {
            if (index >= queue.length) {
                this._preloadInProgress = false;
                this._preloadFinished = true;
                return;
            }

            const modelKey = queue[index++];
            if (!this.gpuMeshCache[modelKey] && !this.rawModelCache[modelKey]) {
                await this.fetchModelAsync(modelKey);
            }

            setTimeout(processNext, 70);
        };

        // Start progressive streaming after 1.5 seconds of 2D playback
        setTimeout(processNext, 1500);
    }

    getSoldierMeshKey(player, stance = "stand") {
        const validStance = (stance === "sit" || stance === "crouch" || stance === "prone" || stance === "stand") ? stance : "stand";
        if (!player) return `soldier_${validStance}`;
        
        // Team 1 is OpFor (Red), Team 2 is BluFor (Blue)
        let rawFaction = (player.team == 1 ? (window.OpForTeam || 'ru') : (window.BluForTeam || 'us'));
        let cleanFaction = this.normalizeFaction(rawFaction);

        let kitSlot = 2; // Default to standard Rifleman (Fusilero)
        const kit = (player.kit || '').toLowerCase();
        if (player.isSquadLeader || kit.includes('officer') || kit.includes('lead') || /(?:^|_)sl(?:_|$)/.test(kit)) {
            kitSlot = 1; // Officer / Squad Leader
        } else if (kit.includes('medic')) {
            kitSlot = 3; // Medic
        } else if (kit.includes('marksman') || kit.includes('sniper') || /(?:^|_)dmr(?:_|$)/.test(kit)) {
            kitSlot = 6; // Marksman / Sniper
        } else if (kit.includes('support') || kit.includes('autorifleman') || kit.includes('automaticrifleman') || /(?:^|_)(?:ar|mg|lmg|hmg)(?:_|$)/.test(kit)) {
            kitSlot = 4; // Support / Automatic Rifleman
        } else if (kit.includes('lat') || kit.includes('hat') || kit.includes('rpg') || kit.includes('smaw') || kit.includes('riflemanat') || kit.includes('antitank') || /(?:^|_)at(?:_|$)/.test(kit)) {
            kitSlot = 5; // Anti-Tank
        } else {
            kitSlot = 2; // Standard Rifleman
        }

        return `soldier_pr_${cleanFaction}_soldier${kitSlot}_${validStance}`;
    }

    getVehicleMeshKey(vehicle) {
        if (!vehicle) return null;
        let rawName = (typeof vehicle === "string" ? vehicle : (vehicle.name || vehicle.templateName || '')).toLowerCase().trim();
        if (!rawName) return null;

        if (typeof isClimbingVehicle === "function" && isClimbingVehicle(rawName)) return null;
        if (rawName === 'uav_fuel' || rawName === 'null_staticmesh' || rawName === 'vehicle_dummy' || rawName === 'mg_vehicle' || rawName.includes('null_staticmesh')) {
            return null;
        }

        // 1. Direct Lookup via 1:1 Vehicle Dictionary Table
        if (typeof VEHICLE_DICTIONARY !== "undefined" && VEHICLE_DICTIONARY[rawName]) {
            const mapped = VEHICLE_DICTIONARY[rawName];
            if (mapped === 'vehicle_dummy' || mapped === 'vehicle_uav_fuel' || mapped.includes('null_staticmesh')) return null;
            return mapped;
        }

        // 2. Direct model key match
        let directKey = 'vehicle_' + rawName;
        if (this.gpuMeshCache[directKey]) return directKey;

        // 3. Fallback: Normalized variant match (token-safe boundaries so _spg9/_spike/_spandrel/_spn are preserved)
        let cleanName = rawName.replace(/(?:_alt\d*|_sp|_bf2|_woodland|_desert_cage|_desert|_camo|_cage|_dfr|_rws|_pkp|_dshk|_m240[bd]|_atc)(?=_|$)/g, '');
        if (typeof VEHICLE_DICTIONARY !== "undefined" && VEHICLE_DICTIONARY[cleanName]) {
            const mapped = VEHICLE_DICTIONARY[cleanName];
            if (mapped === 'vehicle_dummy' || mapped === 'vehicle_uav_fuel' || mapped.includes('null_staticmesh')) return null;
            return mapped;
        }

        let cleanKey = 'vehicle_' + cleanName;
        if (this.gpuMeshCache[cleanKey]) return cleanKey;

        if (rawName.startsWith('init_air')) return 'vehicle_uav_pred';

        return directKey;
    }

    _isDeployableOrTurret(nameOrKey) {
        if (!nameOrKey) return false;
        const n = nameOrKey.toLowerCase();
        // Exclude mobile vehicle hulls (e.g. Ural ZU-23, Flak38 Blitz, Fennek AGL, Boat RIB AGL, UAZ SPG)
        if (/_(jep|trk|apc|ifv|tnk|aav|atm|acv|ahe|the|jet|shp|bik)_|^boat_|^vehicle_boat/.test(n)) {
            return false;
        }
        const bare = n.startsWith("vehicle_") ? n.slice(8) : n;
        if (bare.startsWith("aa_") || bare.startsWith("at_") || bare.startsWith("hmg_")) {
            return true;
        }
        return (
            n.includes("deployable") || n.includes("stationary") || n.includes("bipod") || n.includes("tripod") ||
            n.includes("ats_") || n.includes("aaa_") || n.includes("mortar") || n.includes("zu23") ||
            n.includes("zpu") || n.includes("flak") || n.includes("sam_") || n.includes("zis3") || n.includes("pak") ||
            n.includes("spg") || n.includes("tow") || n.includes("kornet") || n.includes("m220") ||
            n.includes("m1910") || n.includes("m1919") || n.includes("mg42") || n.includes("dshk") ||
            n.includes("djigit") || n.includes("milan") || n.includes("hj8") || n.includes("eryx") || n.includes("metis") ||
            n.includes("mistral") || n.includes("stinger") || n.includes("spike") || n.includes("agl") ||
            n.includes("sandbag") || n.includes("firebase") || n.includes("hideout") || n.includes("commandpost") ||
            n.includes("roadblock") || n.includes("foxhole") || n.includes("razorwire") || n.includes("trestle")
        );
    }

    _getElevatedEntityY(rawObjY, groundY, x = null, z = null) {
        const objY = (typeof rawObjY === "number") ? rawObjY : parseFloat(rawObjY);
        if (!Number.isFinite(objY) || objY <= groundY + 0.25) return groundY;
        if (x != null && z != null && typeof buildingHeightmap !== "undefined" && buildingHeightmap.initialized && typeof buildingHeightmap.getSupportSurfaceY === "function") {
            const structY = buildingHeightmap.getSupportSurfaceY(x, objY + 1.2, z, groundY);
            if (structY > groundY + 0.25 && Math.abs(structY - objY) <= 1.6) {
                return structY;
            }
        }
        return objY;
    }

    _sampleVehicleSupportY(x, refY, z, hasHm, hasBh, checkStructures = true) {
        const groundY = hasHm ? heightmap.getHeightFromCoords(x, z) : refY;
        if (!checkStructures || !hasBh) return groundY;
        let structY = buildingHeightmap.getSupportSurfaceY(x, refY, z, groundY);
        if (structY === groundY && refY > groundY + 1.35) {
            structY = buildingHeightmap.getSupportSurfaceY(x, refY - 0.8, z, groundY);
        }
        return structY;
    }

    /**
     * C1-continuous non-uniform Cubic Hermite (Catmull-Rom) evaluator in 1D.
     * Guarantees exact matching position AND velocity across every tick boundary (zero jumps!).
     */
    _evalHermite1D(p0, p1, p2, p3, t0, t1, t2, t3, t) {
        const h = t2 - t1;
        if (h < 1e-5) {
            return { val: p2, vel: 0.0 };
        }
        const u = Math.max(0.0, Math.min(1.0, (t - t1) / h));
        const slope12 = (p2 - p1) / h;
        const m1 = (t1 > t0 + 1e-4) ? (0.5 * ((p1 - p0) / (t1 - t0) + slope12)) : slope12;
        const m2 = (t3 > t2 + 1e-4) ? (0.5 * (slope12 + (p3 - p2) / (t3 - t2))) : slope12;

        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2.0 * u3 - 3.0 * u2 + 1.0;
        const h10 = u3 - 2.0 * u2 + u;
        const h01 = -2.0 * u3 + 3.0 * u2;
        const h11 = u3 - u2;
        const val = h00 * p1 + h10 * (m1 * h) + h01 * p2 + h11 * (m2 * h);

        const dh00 = 6.0 * u2 - 6.0 * u;
        const dh10 = 3.0 * u2 - 4.0 * u + 1.0;
        const dh01 = -6.0 * u2 + 6.0 * u;
        const dh11 = 3.0 * u2 - 2.0 * u;
        const vel = (dh00 * p1 + dh01 * p2) / h + dh10 * m1 + dh11 * m2;
        return { val, vel };
    }

    /**
     * C1-continuous Catmull-Rom 3D flight trajectory + aerodynamic Pitch & Roll estimator
     * for airborne jets/UAVs and helicopters. Uses a phase-locked ~1-tick spline clock so
     * high-speed jets glide through turns, climbs, and dives at 60 FPS with zero jumps.
     */
    _estimateAircraftKinematics(v, posX, posY, posZ, rotDeg, safeDt) {
        const vName = (v && v.name ? v.name : "").toLowerCase();
        const isJet = vName.includes("_jet_") || vName.includes("_air_") || vName.startsWith("air_") ||
            vName.startsWith("usair_") || vName.startsWith("ruair_") || vName.startsWith("chair_") ||
            vName.includes("a10") || vName.includes("su25") || vName.includes("su30") || vName.includes("su34") ||
            vName.includes("mig") || vName.includes("f16") || vName.includes("f18") || vName.includes("f15") ||
            vName.includes("f4_") || vName.includes("a4_") || vName.includes("tornado") || vName.includes("harrier") ||
            vName.includes("q5") || vName.includes("j10") || vName.includes("mirage") || vName.includes("ef2000") ||
            vName.includes("gripen") || vName.includes("c130") || vName.includes("c47") || vName.includes("ac130") ||
            vName.includes("spitfire") || vName.includes("bf109") || vName.includes("fw190") || vName.includes("p51") ||
            vName.includes("yak") || vName.includes("il2") || vName.includes("ju87") || vName.includes("a1h") ||
            vName.includes("ov10") || (typeof isUAVVehicle === "function" && isUAVVehicle(vName));

        const tArr = (typeof tickToTime !== "undefined" && tickToTime && tickToTime.length > 0) ? tickToTime : null;
        const tIdx = (typeof Tick_Current !== "undefined") ? Math.max(0, Math.min(Tick_Current, tArr ? (tArr.length - 1) : 0)) : 0;
        const baseT = tArr ? tArr[tIdx] : (tIdx * ((typeof TIMESTEP !== "undefined" && TIMESTEP > 0) ? TIMESTEP : 0.04));
        const tickDt = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0) ? (1.0 / DetectedDemoHz) : 0.04;
        const playingNow = (typeof isPlaying !== "undefined") ? !!isPlaying : true;
        const speedMult = (typeof playSpeed === "number" && Number.isFinite(playSpeed) && playSpeed > 0) ? playSpeed : 1.0;
        const liveInterpFrac = (playingNow && typeof interpolation_CurrentAmount === "number" && Number.isFinite(interpolation_CurrentAmount))
            ? Math.max(0.0, Math.min(1.0, interpolation_CurrentAmount))
            : 1.0;
        const curTime = baseT - (1.0 - liveInterpFrac) * tickDt;

        const hist = v.ns_posHistory;
        if (!hist || hist.length < 2) {
            return { smoothTargetX: posX, smoothTargetY: posY, smoothTargetZ: posZ, smoothRotDeg: rotDeg, airPitch: 0.0, airRoll: 0.0, isJet, useSplinePos: false };
        }

        // Gather continuous trajectory knots (breaking only on true respawn/teleport > 450m)
        const maxHistSec = isJet ? 2.5 : 2.2;
        const pts = [];
        let prevX = hist[hist.length - 1].x;
        let prevZ = hist[hist.length - 1].z;
        for (let i = hist.length - 1; i >= 0; i--) {
            const h = hist[i];
            if (!h || h.time == null || isNaN(h.x) || isNaN(h.z)) continue;
            if (baseT - h.time > maxHistSec && pts.length >= 4) break;
            if (Math.hypot(h.x - prevX, h.z - prevZ) > 450.0) break;
            // Enforce strictly increasing timestamps for valid Hermite tangents
            if (pts.length > 0 && h.time >= pts[pts.length - 1].time - 1e-4) continue;
            pts.push(h);
            prevX = h.x;
            prevZ = h.z;
        }
        pts.reverse();

        const n = pts.length;
        if (n < 2) {
            return { smoothTargetX: posX, smoothTargetY: posY, smoothTargetZ: posZ, smoothRotDeg: rotDeg, airPitch: 0.0, airRoll: 0.0, isJet, useSplinePos: false };
        }

        const tFirst = pts[0].time;
        const tLast = pts[n - 1].time;
        const spanT = tLast - tFirst;
        if (spanT < 0.08) {
            return { smoothTargetX: posX, smoothTargetY: posY, smoothTargetZ: posZ, smoothRotDeg: rotDeg, airPitch: 0.0, airRoll: 0.0, isJet, useSplinePos: false };
        }

        // Maintain a smooth 60 FPS phase-locked spline clock ~1 knot interval behind curTime
        // so P1..P2 always have valid P0 and P3 neighbor tangents -> 100% C1 continuous!
        const lastKnotDt = Math.max(tickDt, pts[n - 1].time - pts[n - 2].time);
        const lagSec = Math.max(0.10, Math.min(0.85, lastKnotDt * 1.12));
        const tTarget = Math.max(tFirst, Math.min(tLast, curTime - lagSec));

        const fastFwd = (typeof isFastForwarding !== "undefined" && isFastForwarding);
        if (v._splineTime == null || isNaN(v._splineTime) || fastFwd || Math.abs(tTarget - v._splineTime) > 1.5 || v._splineTime < tFirst - 0.05) {
            v._splineTime = tTarget;
        } else if (playingNow) {
            // Advance monotonically at exact playback rate + gentle phase-lock nudge (zero tick-boundary hiccups!)
            v._splineTime += (safeDt || 0.016) * speedMult;
            const drift = tTarget - v._splineTime;
            v._splineTime += drift * (1.0 - Math.exp(-3.5 * (safeDt || 0.016)));
            if (v._splineTime > tLast) v._splineTime = tLast;
            if (v._splineTime < tFirst) v._splineTime = tFirst;
        } else {
            // Paused: settle gently on scrub/step without drifting
            if (Math.abs(tTarget - v._splineTime) > 0.02) {
                v._splineTime = tTarget;
            }
        }

        const tRender = v._splineTime;

        // Locate spline segment [idx, idx + 1] bracketing tRender
        let idx = n - 2;
        for (let i = n - 2; i >= 0; i--) {
            if (pts[i].time <= tRender) {
                idx = i;
                break;
            }
        }
        const i0 = Math.max(0, idx - 1);
        const i1 = idx;
        const i2 = Math.min(n - 1, idx + 1);
        const i3 = Math.min(n - 1, idx + 2);
        const p0 = pts[i0], p1 = pts[i1], p2 = pts[i2], p3 = pts[i3];

        // Evaluate C1-continuous 3D Cubic Hermite spline for X, Y, Z
        const sx = this._evalHermite1D(p0.x, p1.x, p2.x, p3.x, p0.time, p1.time, p2.time, p3.time, tRender);
        const sy = this._evalHermite1D(p0.y, p1.y, p2.y, p3.y, p0.time, p1.time, p2.time, p3.time, tRender);
        const sz = this._evalHermite1D(p0.z, p1.z, p2.z, p3.z, p0.time, p1.time, p2.time, p3.time, tRender);

        // Unwrap yaw across p0..p3 and evaluate smooth C1 yaw + angular rate
        const r0 = p0.rot;
        const r1 = r0 + ((((p1.rot - r0) % 360) + 540) % 360 - 180);
        const r2 = r1 + ((((p2.rot - r1) % 360) + 540) % 360 - 180);
        const r3 = r2 + ((((p3.rot - r2) % 360) + 540) % 360 - 180);
        const sRot = this._evalHermite1D(r0, r1, r2, r3, p0.time, p1.time, p2.time, p3.time, tRender);

        // Helper: OLS linear regression over recent windowed knots (for steady noise-free heli velocity & Y)
        const fitLinear = (startIdx, endIdx) => {
            const cnt = endIdx - startIdx + 1;
            let sT = 0, sX = 0, sY = 0, sZ = 0;
            for (let i = startIdx; i <= endIdx; i++) {
                sT += pts[i].time; sX += pts[i].x; sY += pts[i].y; sZ += pts[i].z;
            }
            const mT = sT / cnt, mX = sX / cnt, mY = sY / cnt, mZ = sZ / cnt;
            let tt = 0, tx = 0, ty = 0, tz = 0;
            for (let i = startIdx; i <= endIdx; i++) {
                const d = pts[i].time - mT;
                tt += d * d;
                tx += d * (pts[i].x - mX);
                ty += d * (pts[i].y - mY);
                tz += d * (pts[i].z - mZ);
            }
            return {
                mT, mX, mY, mZ,
                vx: tt > 1e-5 ? (tx / tt) : 0.0,
                vy: tt > 1e-5 ? (ty / tt) : 0.0,
                vz: tt > 1e-5 ? (tz / tt) : 0.0
            };
        };

        let smoothTargetX = sx.val;
        let smoothTargetY = sy.val;
        let smoothTargetZ = sz.val;
        let smoothRotDeg = ((sRot.val % 360) + 360) % 360;
        let airPitch = 0.0;
        let airRoll = 0.0;

        if (isJet) {
            const vx = sx.vel;
            const vy = sy.vel;
            const vz = sz.vel;
            const vHoriz = Math.hypot(vx, vz);

            // For fast jets, smoothly align heading to the exact C1 flight velocity tangent (eliminates 1-deg yaw stepping!)
            if (vHoriz > 28.0) {
                smoothRotDeg = ((Math.atan2(vx, vz) * 180.0 / Math.PI) % 360 + 360) % 360;
            }

            // Estimate smooth yaw rate from spline tangent + short window curvature
            let omegaYaw = sRot.vel * Math.PI / 180.0;
            if (vHoriz > 28.0 && p2.time > p1.time + 0.04) {
                // Analytical curvature yaw-rate from velocity at tRender - dt vs tRender + dt
                const eps = Math.min(0.06, 0.25 * (p2.time - p1.time));
                const tA = Math.max(tFirst, tRender - eps);
                const tB = Math.min(tLast, tRender + eps);
                if (tB > tA + 0.01) {
                    const vxA = this._evalHermite1D(p0.x, p1.x, p2.x, p3.x, p0.time, p1.time, p2.time, p3.time, tA).vel;
                    const vzA = this._evalHermite1D(p0.z, p1.z, p2.z, p3.z, p0.time, p1.time, p2.time, p3.time, tA).vel;
                    const vxB = this._evalHermite1D(p0.x, p1.x, p2.x, p3.x, p0.time, p1.time, p2.time, p3.time, tB).vel;
                    const vzB = this._evalHermite1D(p0.z, p1.z, p2.z, p3.z, p0.time, p1.time, p2.time, p3.time, tB).vel;
                    const hA = Math.atan2(vxA, vzA);
                    const hB = Math.atan2(vxB, vzB);
                    let dH = hB - hA;
                    while (dH > Math.PI) dH -= 2.0 * Math.PI;
                    while (dH < -Math.PI) dH += 2.0 * Math.PI;
                    omegaYaw = dH / (tB - tA);
                }
            }

            const speedBlend = Math.max(0.0, Math.min(1.0, (vHoriz - 10.0) / 14.0));
            const rawPitch = Math.atan2(vy, Math.max(18.0, vHoriz));
            const rawRoll = -Math.atan2(vHoriz * omegaYaw, 9.81);
            airPitch = Math.max(-0.96, Math.min(0.96, rawPitch * speedBlend));
            airRoll = Math.max(-1.08, Math.min(1.08, rawRoll * speedBlend));
        } else {
            // Helicopter: use ~1.3s OLS window around tRender for rock-steady velocity & Int16-free altitude
            let winStart = i1;
            while (winStart > 0 && (tRender - pts[winStart - 1].time) <= 1.25) winStart--;
            let winEnd = i2;
            while (winEnd < n - 1 && (pts[winEnd + 1].time - tRender) <= 0.35) winEnd++;
            const fit = fitLinear(winStart, winEnd);

            // Smooth helicopter Y via OLS regression (eliminates 1m hover/climb staircase bumps)
            let regY = fit.mY + fit.vy * (tRender - fit.mT);
            smoothTargetY = Math.max(sy.val - 0.75, Math.min(sy.val + 0.75, regY));

            const hRad = smoothRotDeg * Math.PI / 180.0;
            const fX = Math.sin(hRad), fZ = Math.cos(hRad);
            const rX = fZ, rZ = -fX;

            const vx = fit.vx, vz = fit.vz;
            const vFwd = vx * fX + vz * fZ;
            const vRight = vx * rX + vz * rZ;
            const vHoriz = Math.hypot(vx, vz);

            // Unwrapped yaw rate over the helicopter window
            let winYawDeg = 0.0;
            for (let i = winStart + 1; i <= winEnd; i++) {
                winYawDeg += (((pts[i].rot - pts[i - 1].rot) % 360) + 540) % 360 - 180;
            }
            const winSpan = Math.max(0.15, pts[winEnd].time - pts[winStart].time);
            const omegaYaw = (winYawDeg * Math.PI / 180.0) / winSpan;

            // Subtle, realistic helicopter forward/reverse pitch (cruise ~8-13 deg nose down, max ±18 deg — never nosediving!)
            const vFwdAbs = Math.abs(vFwd);
            const vFwdEff = (vFwdAbs > 1.5) ? (Math.sign(vFwd) * (vFwdAbs - 1.5)) : 0.0;
            const speedPitch = -Math.atan(vFwdEff / 48.0) * 0.28;

            // Gentle J-hook braking flare only during strong deceleration from real speed
            let flarePitch = 0.0;
            const winCnt = winEnd - winStart + 1;
            if (winCnt >= 5 && vHoriz > 12.0) {
                const mid = winStart + Math.floor(winCnt / 2);
                const fitOld = fitLinear(winStart, mid);
                const fitNew = fitLinear(mid, winEnd);
                const dtMid = fitNew.mT - fitOld.mT;
                if (dtMid > 0.25) {
                    const ax = (fitNew.vx - fitOld.vx) / dtMid;
                    const az = (fitNew.vz - fitOld.vz) / dtMid;
                    const aFwd = ax * fX + az * fZ;
                    const aAbs = Math.abs(aFwd);
                    if (aAbs > 5.0) {
                        const aExcess = Math.sign(aFwd) * Math.min(14.0, aAbs - 5.0);
                        flarePitch = -Math.atan(aExcess / 16.0) * 0.24;
                    }
                }
            }
            airPitch = Math.max(-0.31, Math.min(0.31, speedPitch + flarePitch));

            // Natural helicopter roll: coordinated turn bank + clean sideways strafe roll
            const turnRoll = (vHoriz > 4.0) ? (-Math.atan2(vHoriz * omegaYaw, 15.0)) : 0.0;
            const vRightAbs = Math.abs(vRight);
            const vRightEff = (vRightAbs > 1.5) ? (Math.sign(vRight) * (vRightAbs - 1.5)) : 0.0;
            const strafeRoll = -Math.atan(vRightEff / 22.0) * 0.28;
            airRoll = Math.max(-0.56, Math.min(0.56, turnRoll + strafeRoll));
        }

        return { smoothTargetX, smoothTargetY, smoothTargetZ, smoothRotDeg, airPitch, airRoll, isJet, useSplinePos: true };
    }

    _getContinuousPlaybackTimeSec() {
        const tArr = (typeof tickToTime !== "undefined" && tickToTime && tickToTime.length > 0) ? tickToTime : null;
        const tIdx = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;
        const fracNow = (typeof interpolation_CurrentAmount === "number" && Number.isFinite(interpolation_CurrentAmount))
            ? Math.max(0.0, Math.min(1.0, interpolation_CurrentAmount))
            : 1.0;
        if (tArr && tArr.length > 1) {
            // tickToTime[Tick_Current] matches v.X / proj.X at Tick_Current, and tickToTime[Tick_Current - 1] matches prevX
            const idxCur = Math.max(0, Math.min(tIdx, tArr.length - 1));
            const idxPrev = Math.max(0, idxCur - 1);
            const tStart = tArr[idxPrev];
            const tEnd = tArr[idxCur];
            return tStart + fracNow * (tEnd - tStart);
        }
        const step = (typeof TIMESTEP !== "undefined" && TIMESTEP > 0) ? TIMESTEP : 0.04;
        return Math.max(0, (tIdx - 1 + fracNow) * step);
    }

    /**
     * Single source of truth for vehicle world pose (smoothX, smoothY, smoothZ, yaw, smoothPitch, smoothRoll, modelMatrix).
     * Idempotent per frameStamp so update1PVCamera(), entities3d.draw(), and hud3d.draw() share the exact same pose
     * with zero 1-frame desync, zero cockpit bounce, and zero lagging icons on fast jets/helicopters.
     */
    syncVehiclePose(v, activeMesh, dt, frameStamp) {
        if (!v) return null;
        if (frameStamp != null && v._poseFrameStamp === frameStamp && v._poseCache) {
            return v._poseCache;
        }

        let posX = (typeof v.getX === "function") ? v.getX() : v.X;
        let posY = (typeof v.getY === "function") ? v.getY() : (v.Y || 0);
        let posZ = (typeof v.getZ === "function") ? v.getZ() : v.Z;
        if (posX == null || isNaN(posX)) posX = v.X;
        if (posZ == null || isNaN(posZ)) posZ = v.Z;
        if (posY == null || isNaN(posY)) posY = v.Y || 0;
        if (posX == null || isNaN(posX) || posZ == null || isNaN(posZ)) return null;

        const meshKey = activeMesh ? activeMesh.modelKey : this.getVehicleMeshKey(v);
        const groundOffset = (activeMesh && typeof activeMesh.groundOffset === "number") ? activeMesh.groundOffset : 0.0;
        const halfLen = Math.max(1.5, Math.min(4.5, ((activeMesh && activeMesh.length) || 6.0) * 0.40));
        const halfWidth = Math.max(0.8, Math.min(2.2, ((activeMesh && activeMesh.width) || 2.8) * 0.40));

        let rotDeg = (typeof v.getRotation === "function") ? v.getRotation() : (v.rotation || 0);
        const safeDt = Math.min(0.05, Math.max(0.001, dt || 0.016));
        const isDeployable = this._isDeployableOrTurret(meshKey);
        const hasHm = (typeof heightmap !== "undefined" && heightmap && heightmap.initialized);
        const hasBh = (typeof buildingHeightmap !== "undefined" && buildingHeightmap && buildingHeightmap.initialized && typeof buildingHeightmap.getSupportSurfaceY === "function");

        // Sample pre-simulated zero-phase offline motion track (Jets, Helicopters, and Impact-Preserving Ground Vehicles)
        const preTrack = (!isDeployable && v.trackMode && typeof window.sampleVehicleTrack === "function")
            ? window.sampleVehicleTrack(v.id, this._getContinuousPlaybackTimeSec())
            : null;

        let targetX = posX;
        let targetY = posY;
        let targetZ = posZ;
        let targetPitch = 0.0;
        let targetRoll = 0.0;
        let isAirborneAircraft = false;
        let isJetAircraft = false;
        let useDirectPreSim = false;

        if (isDeployable) {
            const supportCenter = (hasHm || hasBh) ? this._sampleVehicleSupportY(posX, posY, posZ, hasHm, hasBh, true) : posY;
            targetY = ((posY <= supportCenter + 2.4) ? supportCenter : posY) + groundOffset;
        } else if (hasHm || hasBh) {
            if (!v.isFlyingVehicle) {
                // ---- GROUND VEHICLE: Impact-preserving pre-simulated XZ/Yaw + Live 4-Corner Terrain Slope + Suspension Squat/Dive/Lean ----
                let suspPitch = 0.0;
                let suspRoll = 0.0;
                if (preTrack && preTrack.mode === "ground") {
                    targetX = preTrack.x;
                    targetZ = preTrack.z;
                    rotDeg = preTrack.yawDeg;
                    suspPitch = preTrack.pitch;
                    suspRoll = preTrack.roll;
                }
                const gRad = (rotDeg * Math.PI / 180);
                const fGX = Math.sin(gRad), fGZ = Math.cos(gRad);
                const rGX = fGZ, rGZ = -fGX;

                const groundCenter = hasHm ? heightmap.getHeightFromCoords(targetX, targetZ) : posY;
                const supportCenter = this._sampleVehicleSupportY(targetX, posY, targetZ, hasHm, hasBh, true);

                if (posY <= supportCenter + 2.4) {
                    const onStructure = (supportCenter > groundCenter + 0.35);
                    const pitchSampleHalfL = Math.max(2.0, halfLen);
                    const rollSampleHalfW = Math.max(1.25, halfWidth);

                    const frontLeftY = this._sampleVehicleSupportY(targetX + fGX * pitchSampleHalfL - rGX * rollSampleHalfW, posY, targetZ + fGZ * pitchSampleHalfL - rGZ * rollSampleHalfW, hasHm, hasBh, onStructure);
                    const frontRightY = this._sampleVehicleSupportY(targetX + fGX * pitchSampleHalfL + rGX * rollSampleHalfW, posY, targetZ + fGZ * pitchSampleHalfL + rGZ * rollSampleHalfW, hasHm, hasBh, onStructure);
                    const rearLeftY = this._sampleVehicleSupportY(targetX - fGX * pitchSampleHalfL - rGX * rollSampleHalfW, posY, targetZ - fGZ * pitchSampleHalfL - rGZ * rollSampleHalfW, hasHm, hasBh, onStructure);
                    const rearRightY = this._sampleVehicleSupportY(targetX - fGX * pitchSampleHalfL + rGX * rollSampleHalfW, posY, targetZ - fGZ * pitchSampleHalfL + rGZ * rollSampleHalfW, hasHm, hasBh, onStructure);

                    const avgFront = (frontLeftY + frontRightY) * 0.5;
                    const avgRear = (rearLeftY + rearRightY) * 0.5;
                    const avgRight = (frontRightY + rearRightY) * 0.5;
                    const avgLeft = (frontLeftY + rearLeftY) * 0.5;

                    const supportAvgY = (supportCenter * 0.5) + ((avgFront + avgRear) * 0.25);
                    targetY = supportAvgY + groundOffset;

                    const terrainPitch = Math.atan2(avgFront - avgRear, pitchSampleHalfL * 2.0);
                    let terrainRoll = Math.atan2(avgRight - avgLeft, rollSampleHalfW * 2.0);
                    if (Math.abs(terrainRoll) < 0.015) terrainRoll = 0.0;

                    targetPitch = terrainPitch + suspPitch;
                    targetRoll = terrainRoll + suspRoll;
                } else {
                    targetY = posY + groundOffset;
                }
            } else {
                // ---- FLYING VEHICLE (Jets, Helicopters, UAVs): Pre-Simulated Zero-Phase Offline Tracks ----
                if (preTrack && (preTrack.mode === "jet" || preTrack.mode === "heli")) {
                    const airSupportY = this._sampleVehicleSupportY(preTrack.x, preTrack.y, preTrack.z, hasHm, hasBh, true);
                    const airGroundY = hasHm ? heightmap.getHeightFromCoords(preTrack.x, preTrack.z) : preTrack.y;
                    const airMinY = airSupportY + groundOffset;
                    const airAlt = preTrack.y - airMinY;

                    isAirborneAircraft = true;
                    isJetAircraft = (preTrack.mode === "jet");
                    useDirectPreSim = true;
                    targetX = preTrack.x;
                    targetZ = preTrack.z;
                    rotDeg = preTrack.yawDeg;

                    if (airAlt <= 1.0) {
                        const onStructure = (airSupportY > airGroundY + 0.35);
                        const aRad = (rotDeg * Math.PI / 180);
                        const fAX = Math.sin(aRad), fAZ = Math.cos(aRad);
                        const frontY = this._sampleVehicleSupportY(targetX + fAX * halfLen, preTrack.y, targetZ + fAZ * halfLen, hasHm, hasBh, onStructure);
                        const rearY = this._sampleVehicleSupportY(targetX - fAX * halfLen, preTrack.y, targetZ - fAZ * halfLen, hasHm, hasBh, onStructure);
                        targetY = airMinY;
                        targetPitch = Math.atan2(frontY - rearY, halfLen * 2.0);
                        targetRoll = 0.0;
                    } else {
                        const airBlend = Math.max(0.0, Math.min(1.0, (airAlt - 1.0) / 3.5));
                        targetY = Math.max(airMinY, preTrack.y);
                        targetPitch = preTrack.pitch * airBlend;
                        targetRoll = preTrack.roll * airBlend;
                    }
                } else {
                    // Fallback to real-time spline when no pre-simulated track exists (e.g. live stream)
                    const groundCenter = hasHm ? heightmap.getHeightFromCoords(posX, posZ) : posY;
                    const supportCenter = this._sampleVehicleSupportY(posX, posY, posZ, hasHm, hasBh, true);
                    const minAirY = supportCenter + groundOffset;
                    const altAboveGround = posY - minAirY;

                    if (altAboveGround <= 1.2) {
                        v._splineTime = null;
                        const onStructure = (supportCenter > groundCenter + 0.35);
                        const gRad = (rotDeg * Math.PI / 180);
                        const fGX = Math.sin(gRad), fGZ = Math.cos(gRad);
                        targetY = minAirY;
                        const frontY = this._sampleVehicleSupportY(posX + fGX * halfLen, posY, posZ + fGZ * halfLen, hasHm, hasBh, onStructure);
                        const rearY = this._sampleVehicleSupportY(posX - fGX * halfLen, posY, posZ - fGZ * halfLen, hasHm, hasBh, onStructure);
                        targetPitch = Math.atan2(frontY - rearY, halfLen * 2.0);
                        targetRoll = 0.0;
                    } else {
                        isAirborneAircraft = true;
                        const kin = this._estimateAircraftKinematics(v, posX, posY, posZ, rotDeg, safeDt);
                        isJetAircraft = kin.isJet;
                        useDirectPreSim = !!kin.useSplinePos;
                        const airBlend = Math.max(0.0, Math.min(1.0, (altAboveGround - 1.2) / 3.2));
                        targetX = kin.smoothTargetX;
                        targetY = Math.max(minAirY, kin.smoothTargetY);
                        targetZ = kin.smoothTargetZ;
                        if (useDirectPreSim && typeof kin.smoothRotDeg === "number" && Number.isFinite(kin.smoothRotDeg)) {
                            rotDeg = kin.smoothRotDeg;
                        }
                        targetPitch = kin.airPitch * airBlend;
                        targetRoll = kin.airRoll * airBlend;
                    }
                }
            }
        } else {
            targetY += groundOffset;
        }

        // Clamp angles according to vehicle class
        if (isAirborneAircraft) {
            const maxP = isJetAircraft ? 0.96 : 0.33;
            const maxR = isJetAircraft ? 1.10 : 0.61;
            targetPitch = Math.max(-maxP, Math.min(maxP, targetPitch));
            targetRoll = Math.max(-maxR, Math.min(maxR, targetRoll));
        } else {
            targetPitch = Math.max(-0.65, Math.min(0.65, targetPitch));
            targetRoll = Math.max(-0.48, Math.min(0.48, targetRoll));
        }

        if (useDirectPreSim) {
            // Pre-simulated zero-phase jet & heli tracks are already globally smooth -> lock directly (100% exact on pause/scrub!)
            v._smoothPitch = targetPitch;
            v._smoothRoll = targetRoll;
            v._smoothX = targetX;
            v._smoothY = targetY;
            v._smoothZ = targetZ;
        } else {
            const altAlpha = 1.0 - Math.exp(-12.0 * safeDt);
            const pitchAlpha = 1.0 - Math.exp(-8.5 * safeDt);
            const rollAlpha = 1.0 - Math.exp(-7.0 * safeDt);
            const fastFwd = (typeof isFastForwarding !== "undefined" && isFastForwarding);
            const jumpY = (v._smoothY == null || isNaN(v._smoothY)) ? 999 : Math.abs(targetY - v._smoothY);
            const snapJump = fastFwd || (jumpY > 6.0);

            if (v._smoothPitch == null || isNaN(v._smoothPitch) || snapJump) v._smoothPitch = targetPitch;
            else v._smoothPitch = v._smoothPitch * (1.0 - pitchAlpha) + targetPitch * pitchAlpha;

            if (v._smoothRoll == null || isNaN(v._smoothRoll) || snapJump) v._smoothRoll = targetRoll;
            else v._smoothRoll = v._smoothRoll * (1.0 - rollAlpha) + targetRoll * rollAlpha;

            if (v._smoothY == null || isNaN(v._smoothY) || snapJump) v._smoothY = targetY;
            else v._smoothY = v._smoothY * (1.0 - altAlpha) + targetY * altAlpha;

            v._smoothX = targetX;
            v._smoothZ = targetZ;
        }

        const yawRad = -(rotDeg * Math.PI / 180);
        const modelMatrix = mat4.create();
        mat4.translate(modelMatrix, modelMatrix, [v._smoothX, v._smoothY, -v._smoothZ]);
        mat4.rotateY(modelMatrix, modelMatrix, yawRad);
        if (Math.abs(v._smoothPitch) > 0.001) mat4.rotateX(modelMatrix, modelMatrix, v._smoothPitch);
        if (Math.abs(v._smoothRoll) > 0.001) mat4.rotateZ(modelMatrix, modelMatrix, v._smoothRoll);

        const pose = {
            posX: v._smoothX,
            smoothY: v._smoothY,
            posZ: v._smoothZ,
            rotDeg,
            yawRad,
            smoothPitch: v._smoothPitch,
            smoothRoll: v._smoothRoll,
            modelMatrix
        };
        v._poseFrameStamp = frameStamp;
        v._poseCache = pose;
        return pose;
    }

    categorizeVehicle(vName) {
        const name = (vName || '').toLowerCase();
        if (name.includes('crate') || name.includes('rallypoint') || name.includes('depot') || name.includes('post') || name.includes('artillery')) {
            return null; // Ignore deployables/crates
        }
        if (name.includes('ahe_') || name.includes('the_') || name.includes('air_') || name.includes('jet_') || name.includes('heli_') || name.includes('apache') || name.includes('blackhawk') || name.includes('chinook') || name.includes('mi24') || name.includes('mi17') || name.includes('ah1') || name.includes('ah64') || name.includes('uh1') || name.includes('uh60') || name.includes('a10') || name.includes('su25') || name.includes('mig29') || name.includes('tornado') || name.includes('harrier') || name.includes('mv22')) {
            return { cat: 'air', row: 4, spacing: 22 };
        }
        if (name.includes('tnk') || name.includes('t72') || name.includes('t55') || name.includes('t62') || name.includes('t90') || name.includes('m1a') || name.includes('leo') || name.includes('challenger') || name.includes('ztz') || name.includes('merkava') || name.includes('pt91') || name.includes('abrams') || name.includes('leopard')) {
            return { cat: 'tank', row: 3, spacing: 15 };
        }
        if (name.includes('apc') || name.includes('ifv') || name.includes('btr') || name.includes('bmp') || name.includes('marder') || name.includes('warrior') || name.includes('bradley') || name.includes('stryker') || name.includes('boxer') || name.includes('scimitar') || name.includes('lav') || name.includes('aav') || name.includes('mtlb') || name.includes('wz551') || name.includes('zbl08')) {
            return { cat: 'armor', row: 2, spacing: 13 };
        }
        return { cat: 'jeep', row: 1, spacing: 9 };
    }

    buildMapSpawns(mapName) {
        this.currentMap = mapName;
        this.buildActiveMapSpawnEntities(mapName);
    }

    buildActiveMapSpawnEntities(mapName) {
        if (!mapName || typeof PR_MAPS_DATABASE === "undefined") return;
        
        const mapData = PR_MAPS_DATABASE[mapName] || PR_MAPS_DATABASE[mapName.toLowerCase()];
        if (!mapData || !mapData.modes) return;

        this.mapSpawnEntities = [];

        const factionsMap = new Map();
        for (const modeKey in mapData.modes) {
            const modeObj = mapData.modes[modeKey];
            if (!modeObj.layers) continue;

            for (const layerKey in modeObj.layers) {
                const layerObj = modeObj.layers[layerKey];

                // Team 1 (OpFor / Red)
                const t1 = layerObj.team1 || {};
                const f1Id = (t1.faction_id || 'team1').toLowerCase();
                if (!factionsMap.has(f1Id)) {
                    factionsMap.set(f1Id, { id: f1Id, team: 1, name: t1.faction_name, vehicles: new Set() });
                }
                for (const v in (t1.vehicles || {})) factionsMap.get(f1Id).vehicles.add(v);

                // Team 2 (BluFor / Blue)
                const t2 = layerObj.team2 || {};
                const f2Id = (t2.faction_id || 'team2').toLowerCase();
                if (!factionsMap.has(f2Id)) {
                    factionsMap.set(f2Id, { id: f2Id, team: 2, name: t2.faction_name, vehicles: new Set() });
                }
                for (const v in (t2.vehicles || {})) factionsMap.get(f2Id).vehicles.add(v);
            }
        }

        const originX = 0;
        const originZ = 0;

        let teamBaseZ = -80;
        for (const fData of factionsMap.values()) {
            const team = fData.team;
            const cleanFId = this.normalizeFaction(fData.id);

            // A. Place an Infantry Squad of 7 soldiers in the front row
            const squadSize = 7;
            const soldierSpacing = 3.5;
            for (let sIdx = 0; sIdx < squadSize; sIdx++) {
                const soldierKey = `soldier_pr_${cleanFId}_soldier${(sIdx % 6) + 1}_stand`;
                const sX = originX + (sIdx - (squadSize - 1) * 0.5) * soldierSpacing;
                const sZ = originZ + teamBaseZ;
                const sY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(sX, sZ) + 0.1 : 5.0;

                this.mapSpawnEntities.push({
                    meshKey: soldierKey,
                    fallbackKey: (team === 2) ? 'soldier_pr_us_soldier1_stand' : 'soldier_pr_ru_soldier1_stand',
                    x: sX,
                    y: sY,
                    z: sZ,
                    yaw: (team === 2) ? 0 : 180,
                    team: team,
                    id: `spawn_soldier_${team}_${sIdx}`
                });
            }

            // B. Group combat vehicles by row/class
            const rowMap = new Map();
            for (const vName of fData.vehicles) {
                const catInfo = this.categorizeVehicle(vName);
                if (!catInfo) continue;
                
                const rNum = catInfo.row;
                if (!rowMap.has(rNum)) rowMap.set(rNum, []);
                const list = rowMap.get(rNum);
                if (list.length < 8) {
                    list.push({ name: vName, spacing: catInfo.spacing });
                }
            }

            // C. Place vehicles in organized rows behind infantry
            const rowOffsets = { 1: 20, 2: 44, 3: 68, 4: 94 };
            for (const [rNum, vList] of rowMap.entries()) {
                const rOffset = rowOffsets[rNum] || (rNum * 24);
                const rZ = originZ + teamBaseZ + (team === 2 ? -rOffset : rOffset);
                const avgSpacing = vList[0] ? vList[0].spacing : 14;
                const numInRow = vList.length;

                for (let vIdx = 0; vIdx < numInRow; vIdx++) {
                    const vItem = vList[vIdx];
                    const vKey = this.getVehicleMeshKey({ name: vItem.name, team: team });
                    const vX = originX + (vIdx - (numInRow - 1) * 0.5) * avgSpacing;
                    const vY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(vX, rZ) + 0.1 : 5.0;

                    this.mapSpawnEntities.push({
                        meshKey: vKey,
                        fallbackKey: null,
                        x: vX,
                        y: vY,
                        z: rZ,
                        yaw: (team === 2) ? 0 : 180,
                        team: team,
                        id: `spawn_veh_${team}_${rNum}_${vIdx}`
                    });
                }
            }

            teamBaseZ += 180;
        }

        // Trigger background pre-fetch for map spawns
        for (const ent of this.mapSpawnEntities) {
            this.fetchModelAsync(ent.meshKey);
            if (ent.fallbackKey) this.fetchModelAsync(ent.fallbackKey);
        }
    }

    draw() {
        if (!this.initialized || !this.program) return;

        const gl = renderer3d.gl;
        if (!gl) return;

        const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function") ? performance.now() : Date.now();
        const rawDt = this._lastDrawMs ? ((nowMs - this._lastDrawMs) / 1000.0) : 0.016;
        this._lastDrawMs = nowMs;
        const dt = (rawDt > 0.25) ? 0.016 : Math.min(0.05, Math.max(0.001, rawDt));
        const altAlpha = 1.0 - Math.exp(-12.0 * dt);
        const pitchAlpha = 1.0 - Math.exp(-6.5 * dt);
        const rollAlpha = 1.0 - Math.exp(-4.0 * dt);

        this.hasSelection = false;
        const viewMatrix = renderer3d.getCurrentViewMatrix();
        const projectionMatrix = renderer3d.getCurrentProjectionMatrix();

        const isWallhack = (typeof options_Wallhack !== "undefined" && options_Wallhack);
        const fpvState = (typeof renderer3d !== "undefined" && typeof renderer3d.getActive1PVState === "function")
            ? renderer3d.getActive1PVState()
            : null;
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        this._xrayQueue = isWallhack ? [] : null;
        this._inXrayPass = false;
        this._shadowCasters = [];
        this._afterburnerQueue = [];

        // Bind per-frame sun direction & shadow map once on unit 5
        const sunDir = (typeof renderer3d.getMapSunDirection === "function") ? renderer3d.getMapSunDirection() : [0.4508, 0.8515, -0.3005];
        const useShadows = !!(renderer3d.shadowsActiveThisFrame && renderer3d.shadowDepthTex);
        const usePrRefl = (typeof options_3dPrReflections !== "undefined" && !!options_3dPrReflections) ? 1 : 0;
        const cam = renderer3d.cameraPos;
        gl.useProgram(this.program);
        if (this.uSunDir !== null) gl.uniform3f(this.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
        if (this.uCameraPos !== null) gl.uniform3f(this.uCameraPos, cam[0], cam[1], cam[2]);
        if (this.uUsePrReflections !== null) gl.uniform1i(this.uUsePrReflections, usePrRefl);
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, useShadows ? renderer3d.shadowDepthTex : (renderer3d.shadowDummyTex || null));
        if (this.uShadowMap !== null) gl.uniform1i(this.uShadowMap, 5);
        if (this.uUseShadows !== null) gl.uniform1i(this.uUseShadows, useShadows ? 1 : 0);
        if (useShadows && this.uLightSpaceMatrix !== null) {
            gl.uniformMatrix4fv(this.uLightSpaceMatrix, false, renderer3d.lightViewProjMatrix);
        }
        gl.activeTexture(gl.TEXTURE0);

        // Check if map changed to rebuild spawns
        const activeMapKey = (typeof buildingHeightmap !== "undefined" && buildingHeightmap._mapKey) ? buildingHeightmap._mapKey : (window.CurrentMapName || null);
        if (activeMapKey && activeMapKey !== this.currentMap) {
            this.buildMapSpawns(activeMapKey);
        }

        const hasLiveDemoEntities = (typeof AllVehicles !== "undefined" && Object.keys(AllVehicles).length > 0) ||
                                   (typeof AllPlayers !== "undefined" && Object.keys(AllPlayers).length > 0);

        // ---------------------------------------------------------------------
        // 1. Render Map Spawn Positions (When browsing map without demo)
        // ---------------------------------------------------------------------
        const isDebugLabActive = !!(typeof window !== "undefined" && window.debugLabState && window.debugLabState.active);
        if (!hasLiveDemoEntities && !isDebugLabActive && this.mapSpawnEntities.length > 0) {
            for (const ent of this.mapSpawnEntities) {
                let activeMesh = this.gpuMeshCache[ent.meshKey];
                if (!activeMesh && ent.fallbackKey) activeMesh = this.gpuMeshCache[ent.fallbackKey];

                if (!activeMesh) {
                    this.fetchModelAsync(ent.meshKey);
                    if (ent.fallbackKey) this.fetchModelAsync(ent.fallbackKey);
                    continue;
                }
                if (activeMesh.isNullMesh) continue;

                const groundOffset = (typeof activeMesh.groundOffset === "number") ? activeMesh.groundOffset : 0.0;
                let finalY = ent.y + groundOffset;

                // Team 1 is Red, Team 2 is Blue
                let teamCol = (ent.team === 1) ? this.colorTeam1 : this.colorTeam2;
                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [ent.x, finalY, -ent.z]);
                mat4.rotateY(modelMatrix, modelMatrix, -(ent.yaw * Math.PI / 180));

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, false);
            }
        }

        // ---------------------------------------------------------------------
        // 2. Render Live Demo Vehicles (Dynamic Terrain Slope + Aerodynamic Flight Attitude)
        // ---------------------------------------------------------------------
        if (typeof AllVehicles !== "undefined") {
            const showEmptyVehicles = (typeof options_DrawEmptyVehicles !== "undefined") ? options_DrawEmptyVehicles : true;
            const poseFrameStamp = (typeof renderer3d !== "undefined" && renderer3d && renderer3d._renderFrameStamp != null)
                ? renderer3d._renderFrameStamp
                : ((this._localPoseStamp = (this._localPoseStamp || 0) + 1));

            for (const vId in AllVehicles) {
                const v = AllVehicles[vId];
                if (!v) continue;
                if (!showEmptyVehicles && (!v.Passengers || v.Passengers.size === 0)) continue;
                if (v.isClimbingVehicle) continue;

                const meshKey = this.getVehicleMeshKey(v);
                if (!meshKey) continue;

                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }
                if (activeMesh.isNullMesh) continue;

                const pose = this.syncVehiclePose(v, activeMesh, dt, poseFrameStamp);
                if (!pose) continue;

                const rotDeg = pose.rotDeg;
                const modelMatrix = pose.modelMatrix;

                const vIdNum = Number(vId);
                const isFpvVehicle = !!(fpvState && fpvState.active && Number(fpvState.fpvVehicleId) === vIdNum);
                const hideFpvHull = false;
                const isSelected = (!isFpvVehicle && typeof SelectedVehicle !== "undefined" && SelectedVehicle == v.id);
                // Team 1 is OpFor/Red, Team 2 is BluFor/Blue
                let teamCol = (v.team == 1) ? this.colorTeam1 : this.colorTeam2;

                // Compute relative turret yaw (in radians) and turret matrix even when 1PV masks enclosed hulls
                const turretRelYawRad = activeMesh.isMultiPart ? this.getVehicleTurretRelYawRad(v, rotDeg) : 0.0;
                let turretMatrix = null;
                if (activeMesh.isMultiPart && activeMesh.turret) {
                    turretMatrix = modelMatrix;
                    if (Math.abs(turretRelYawRad) > 0.0005) {
                        const pivot = activeMesh.turret.pivot || [0.0, 1.5, 0.0];
                        turretMatrix = mat4.clone(modelMatrix);
                        mat4.translate(turretMatrix, turretMatrix, pivot);
                        mat4.rotateY(turretMatrix, turretMatrix, turretRelYawRad);
                        mat4.translate(turretMatrix, turretMatrix, [-pivot[0], -pivot[1], -pivot[2]]);
                    }
                }

                // Compute animated rotor spin (helicopters) & wheel roll (wheeled ground vehicles)
                const animState = this._updateVehicleAnimState(v, activeMesh, pose, dt);

                // Queue jet afterburner plumes ONLY for jets with real afterburner nozzles in PR (excludes subsonic A-10/Su-25/Harrier/props)
                if (v.isFlyingVehicle) {
                    const vNameLow = (v.name || v.templateName || "").toLowerCase();
                    const cleanStem = meshKey.startsWith("vehicle_") ? meshKey.slice(8) : meshKey;
                    const db = (typeof window !== "undefined" && window.JET_AFTERBURNERS_DB) ? window.JET_AFTERBURNERS_DB : null;
                    const nozzles = db ? (db[vNameLow] || db[cleanStem] || null) : null;
                    if (nozzles && nozzles.length > 0) {
                        const spd = (v._animSpeed != null) ? v._animSpeed : 0.0;
                        const hasCrew = !!(v.Passengers && (v.Passengers.size > 0 || v.Passengers.length > 0));
                        const agl = (v._animAgl != null) ? v._animAgl : 0.0;
                        if (spd > 18.0 || (hasCrew && agl > 3.0)) {
                            const abPower = Math.max(0.28, Math.min(1.0, (spd - 15.0) / 85.0));
                            this._afterburnerQueue.push({
                                modelMatrix: modelMatrix,
                                nozzles: nozzles,
                                power: abPower,
                                seed: (vIdNum % 97) * 0.37
                            });
                        }
                    }
                }

                // Render Vehicle Model (with animated rotors & wheels)
                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, isSelected, turretRelYawRad, true, !isFpvVehicle, hideFpvHull, null, animState);

                // Render visible vehicle passengers inside/on vehicle
                if (v.Passengers && (v.Passengers.size > 0 || v.Passengers.length > 0) && typeof AllPlayers !== "undefined") {
                    const passengerIds = Array.from(v.Passengers)
                        .map((id) => Number((typeof id === "object" && id !== null) ? id.id : id))
                        .filter((id) => Number.isFinite(id))
                        .sort((a, b) => a - b);
                    const usedSeats = new Set();
                    const allowTex = (typeof options_FactionTextures !== "undefined") ? !!options_FactionTextures : false;
                    const gunnerRotOk = (typeof gunnerRotationSupported === "undefined" || gunnerRotationSupported);

                    for (let i = 0; i < passengerIds.length; i++) {
                        const pid = passengerIds[i];
                        const p = AllPlayers[pid];
                        if (!p || !p.isAlive || p.isJoining) continue;

                        const seat = this.resolveVehicleSeat(v, p, usedSeats);
                        if ((fpvState && fpvState.active && Number(p.id) === Number(fpvState.fpvPlayerId)) || !seat.visible3p) {
                            continue;
                        }

                        const passSelected = (!isFpvVehicle && typeof SelectedPlayer !== "undefined" && SelectedPlayer == p.id);
                        const pIsSquad = (typeof SelectedSquadTeam !== "undefined" && typeof SelectedSquadNumber !== "undefined" &&
                                          p.team == SelectedSquadTeam && p.squad == SelectedSquadNumber);
                        const pTeamCol = pIsSquad ? this.colorSquad : ((p.team == 1) ? this.colorTeam1 : this.colorTeam2);

                        let localYawRad;
                        const pRot = (typeof p.getRotation === "function") ? p.getRotation() : p.rotation;
                        if (!seat.onTurret && (p.vehicleSlot === 1 || v.ns_isStationaryWeapon) && gunnerRotOk && p.rotation != null && pRot != null && !isNaN(pRot)) {
                            localYawRad = -((pRot - rotDeg) * Math.PI / 180);
                        } else {
                            localYawRad = -(seat.yaw * Math.PI / 180);
                        }

                        // Try authentic 3-layer modular soldier first (keeps spawn skin, map camo, real kit & weapon in vehicles!)
                        const modYLocal = (seat.pose === "sit") ? seat.pos[1] : (seat.pos[1] - 1.0);
                        const modPassMatrix = (seat.onTurret && turretMatrix) ? mat4.clone(turretMatrix) : mat4.clone(modelMatrix);
                        mat4.translate(modPassMatrix, modPassMatrix, [seat.pos[0], modYLocal, seat.pos[2]]);
                        mat4.rotateY(modPassMatrix, modPassMatrix, localYawRad);

                        if (!this.renderModularSoldier(p, seat.pose, modPassMatrix, viewMatrix, projectionMatrix, pTeamCol, passSelected, allowTex, !isFpvVehicle, false, false)) {
                            const resolved = this._resolvePassengerMesh(p, seat.pose);
                            if (!resolved || !resolved.mesh || resolved.mesh.isNullMesh) continue;

                            if (allowTex) {
                                this.fetchModelTexAsync(resolved.meshKey);
                            }

                            const yLocal = seat.pos[1] + resolved.yOffset;
                            const passMatrix = (seat.onTurret && turretMatrix) ? mat4.clone(turretMatrix) : mat4.clone(modelMatrix);
                            mat4.translate(passMatrix, passMatrix, [seat.pos[0], yLocal, seat.pos[2]]);
                            mat4.rotateY(passMatrix, passMatrix, localYawRad);

                            this.renderSingleMesh(resolved.mesh, passMatrix, viewMatrix, projectionMatrix, pTeamCol, passSelected, 0.0, allowTex, !isFpvVehicle, false);
                        }
                    }
                }
            }
        }

        // ---------------------------------------------------------------------
        // 3. Render Live Demo Soldiers (Alive with Anti-Clipping + Separation, Climbing/Parachute & Dead)
        // ---------------------------------------------------------------------
        if (typeof AllPlayers !== "undefined") {
            const hasHm = (typeof heightmap !== "undefined" && heightmap && heightmap.initialized);
            const hasBh = (typeof buildingHeightmap !== "undefined" && buildingHeightmap && buildingHeightmap.initialized);
            const hasWallSolver = hasBh && (typeof buildingHeightmap.resolveSoldierWallCollision === "function");
            const hasSupportSolver = hasBh && (typeof buildingHeightmap.getSupportSurfaceY === "function");
            const colSmoothAlpha = 1.0 - Math.exp(-14.0 * dt);
            const liveOnFoot = [];

            for (const pId in AllPlayers) {
                const p = AllPlayers[pId];
                if (!p || p.isJoining) continue;

                const inVeh = (p.vehicleid != null && p.vehicleid !== "" && !isNaN(p.vehicleid) && Number(p.vehicleid) >= 0);
                let climbVeh = null;
                if (inVeh) {
                    climbVeh = (typeof AllVehicles !== "undefined") ? AllVehicles[p.vehicleid] : null;
                    if (!climbVeh || !climbVeh.isClimbingVehicle) continue;
                    if (!p.isAlive) continue;
                }

                const posSource = climbVeh || p;
                let posX = (typeof posSource.getX === "function") ? posSource.getX() : posSource.X;
                let posY = (typeof posSource.getY === "function") ? posSource.getY() : (posSource.Y || 0);
                let posZ = (typeof posSource.getZ === "function") ? posSource.getZ() : posSource.Z;

                if (posX == null || isNaN(posX)) posX = posSource.X;
                if (posZ == null || isNaN(posZ)) posZ = posSource.Z;
                if (posY == null || isNaN(posY)) posY = posSource.Y || 0;

                if (climbVeh && (posX == null || isNaN(posX) || posZ == null || isNaN(posZ))) {
                    posX = (typeof p.getX === "function") ? p.getX() : p.X;
                    posY = (typeof p.getY === "function") ? p.getY() : (p.Y || 0);
                    posZ = (typeof p.getZ === "function") ? p.getZ() : p.Z;
                }

                if (posX == null || isNaN(posX) || posZ == null || isNaN(posZ)) continue;

                const terrainH = hasHm ? heightmap.getHeightFromCoords(posX, posZ) : 0;
                const supportY = hasSupportSolver ? buildingHeightmap.getSupportSurfaceY(posX, posY, posZ, terrainH) : terrainH;
                const relSurfaceY = posY - supportY;

                const playerNumId = Number(p.id != null ? p.id : pId);
                const isFpvPlayer = !!(fpvState && fpvState.active && playerNumId === Number(fpvState.fpvPlayerId));
                const isSelected = (!isFpvPlayer && typeof SelectedPlayer !== "undefined" && SelectedPlayer == p.id);
                const isSquad = (typeof SelectedSquadTeam !== "undefined" && typeof SelectedSquadNumber !== "undefined" &&
                                 p.team == SelectedSquadTeam && p.squad == SelectedSquadNumber);

                let rotDeg;
                if (climbVeh) {
                    const vRot = (typeof climbVeh.getRotation === "function") ? climbVeh.getRotation() : (climbVeh.rotation || 0);
                    const pRot = (typeof p.getRotation === "function") ? p.getRotation() : (p.rotation || 0);
                    const gunnerOk = (typeof gunnerRotationSupported === "undefined" || gunnerRotationSupported);
                    rotDeg = (p.vehicleSlot === 0 || p.rotation == null || isNaN(p.rotation) || !gunnerOk) ? vRot : pRot;
                } else {
                    rotDeg = (typeof p.getRotation === "function") ? p.getRotation() : (p.rotation || 0);
                }

                if (!p.isAlive) {
                    // -------------------------------------------------------------
                    // A. Dead Soldier: Lying Flat on Surface/Terrain, Tinted Gray
                    // -------------------------------------------------------------
                    const deadFloorY = Math.max(terrainH, supportY, posY - 0.85);
                    const deadTeamCol = (p.team === 1) ? this.colorDeadTeam1 : this.colorDeadTeam2;
                    const deadMatrix = mat4.create();
                    mat4.translate(deadMatrix, deadMatrix, [posX, deadFloorY + 0.28, -posZ]);
                    mat4.rotateY(deadMatrix, deadMatrix, -(rotDeg * Math.PI / 180));
                    mat4.rotateX(deadMatrix, deadMatrix, Math.PI / 2);

                    if (!this.renderModularSoldier(p, "stand", deadMatrix, viewMatrix, projectionMatrix, deadTeamCol, isSelected, false, !isFpvPlayer, isFpvPlayer, true)) {
                        const deadMeshKey = 'soldier_stand';
                        let activeMesh = this.gpuMeshCache[deadMeshKey];
                        if (!activeMesh) {
                            this.fetchModelAsync(deadMeshKey);
                            continue;
                        }
                        const deadLift = (typeof activeMesh.maxZ === "number" && activeMesh.maxZ > 0.1)
                            ? Math.min(0.48, Math.max(0.25, activeMesh.maxZ * 0.60))
                            : 0.25;
                        const modelMatrix = mat4.create();
                        mat4.translate(modelMatrix, modelMatrix, [posX, deadFloorY + deadLift, -posZ]);
                        mat4.rotateY(modelMatrix, modelMatrix, -(rotDeg * Math.PI / 180));
                        mat4.rotateX(modelMatrix, modelMatrix, Math.PI / 2);

                        this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, deadTeamCol, isSelected, 0.0, false, !isFpvPlayer, isFpvPlayer);
                    }
                    continue;
                }

                const teamCol = isSquad ? this.colorSquad : ((p.team == 1) ? this.colorTeam1 : this.colorTeam2);
                let stance = "stand";
                const forcedDbgStance = (typeof window !== "undefined" && window._debugForcedStances) ? window._debugForcedStances[playerNumId] : null;
                if (forcedDbgStance && !climbVeh) {
                    stance = forcedDbgStance;
                } else if (!climbVeh) {
                    const spdKmh = (typeof getEntitySpeedKmh === "function") ? getEntitySpeedKmh(p) : 0;
                    if (spdKmh >= 6.0) {
                        stance = "stand";
                    } else if (spdKmh >= 1.8) {
                        stance = (relSurfaceY <= 0.65) ? "crouch" : "stand";
                    } else {
                        if (relSurfaceY <= 0.25) stance = "prone";
                        else if (relSurfaceY <= 0.65) stance = "crouch";
                        else stance = "stand";
                    }
                }

                const stancePelvisOffset = (stance === "prone") ? 0.15 : ((stance === "crouch") ? 0.50 : 0.85);
                const onResolvedSurface = (posY - supportY <= 1.55) && (posY - supportY >= -0.75);
                let floorY = onResolvedSurface ? supportY : Math.max(supportY, posY - stancePelvisOffset);
                if (floorY < terrainH) floorY = terrainH;

                // Climbing / parachute soldiers bypass ground wall & crowd separation
                if (climbVeh) {
                    const modMatrix = mat4.create();
                    mat4.translate(modMatrix, modMatrix, [posX, floorY, -posZ]);
                    mat4.rotateY(modMatrix, modMatrix, -(rotDeg * Math.PI / 180));
                    if (!this.renderModularSoldier(p, stance, modMatrix, viewMatrix, projectionMatrix, teamCol, isSelected, true, !isFpvPlayer, isFpvPlayer, false)) {
                        const meshKey = this.getSoldierMeshKey(p, stance);
                        let activeMesh = this.gpuMeshCache[meshKey] || this.gpuMeshCache['soldier_stand'];
                        if (!activeMesh) {
                            this.fetchModelAsync(meshKey);
                            continue;
                        }
                        const modelLift = (typeof activeMesh.groundOffset === "number") ? activeMesh.groundOffset : 0.0;
                        const modelMatrix = mat4.create();
                        mat4.translate(modelMatrix, modelMatrix, [posX, floorY + modelLift, -posZ]);
                        mat4.rotateY(modelMatrix, modelMatrix, -(rotDeg * Math.PI / 180));
                        this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, isSelected, 0.0, true, !isFpvPlayer, isFpvPlayer);
                    }
                    continue;
                }

                // Step 1: Initial Wall Push-Out (keeps torso/legs & prone lateral flanks out of building walls)
                let colX = posX;
                let colZ = posZ;
                if (hasWallSolver) {
                    const wr = buildingHeightmap.resolveSoldierWallCollision(posX, floorY, posZ, stance, rotDeg, 0.68);
                    colX = wr.x;
                    colZ = wr.z;
                }

                liveOnFoot.push({
                    p, numId: playerNumId,
                    rawX: posX, rawY: posY, rawZ: posZ,
                    x: colX, z: colZ, floorY,
                    stance, rotDeg, teamCol, isSelected, isFpvPlayer,
                    crowdShifted: false
                });
            }

            // Step 2: Soldier-to-Soldier Separation (prevents two soldiers occupying the same space)
            const nLive = liveOnFoot.length;
            for (let pass = 0; pass < 2; pass++) {
                for (let i = 0; i < nLive; i++) {
                    const a = liveOnFoot[i];
                    for (let j = i + 1; j < nLive; j++) {
                        const b = liveOnFoot[j];
                        if (Math.abs(a.floorY - b.floorY) > 1.45) continue;
                        const dx = b.x - a.x;
                        const dz = b.z - a.z;
                        if (Math.abs(dx) > 0.95 || Math.abs(dz) > 0.95) continue;

                        const minDist = (a.stance === "prone" || b.stance === "prone") ? 0.78 : 0.64;
                        const dSq = dx * dx + dz * dz;
                        if (dSq >= minDist * minDist) continue;

                        let ux, uz, dist;
                        if (dSq < 1e-4) {
                            const ang = (((a.numId * 73 + b.numId * 37) % 360) * Math.PI) / 180;
                            ux = Math.cos(ang);
                            uz = Math.sin(ang);
                            dist = 0;
                        } else {
                            dist = Math.sqrt(dSq);
                            ux = dx / dist;
                            uz = dz / dist;
                        }

                        const push = 0.5 * (minDist - dist);
                        a.x -= ux * push;
                        a.z -= uz * push;
                        b.x += ux * push;
                        b.z += uz * push;
                        a.crowdShifted = true;
                        b.crowdShifted = true;
                    }
                }
            }

            // Step 3: Re-enforce wall clearance after crowd separation, smooth offset, re-sample floor & render
            for (let i = 0; i < nLive; i++) {
                const s = liveOnFoot[i];
                const p = s.p;

                if (s.crowdShifted && hasWallSolver) {
                    const wr2 = buildingHeightmap.resolveSoldierWallCollision(s.x, s.floorY, s.z, s.stance, s.rotDeg, 0.72);
                    s.x = wr2.x;
                    s.z = wr2.z;
                }

                // Clamp total horizontal correction from raw Int16 demo pos to <= 0.72m
                let targetOffX = s.x - s.rawX;
                let targetOffZ = s.z - s.rawZ;
                const offDist = Math.hypot(targetOffX, targetOffZ);
                if (offDist > 0.72) {
                    const k = 0.72 / offDist;
                    targetOffX *= k;
                    targetOffZ *= k;
                }

                // Smooth collision offset so wall-sliding & teammate separation never jitter
                if (p.ns_colOffX == null || isNaN(p.ns_colOffX) || (p.ns_colPrevX != null && Math.hypot(s.rawX - p.ns_colPrevX, s.rawZ - p.ns_colPrevZ) > 5.0)) {
                    p.ns_colOffX = targetOffX;
                    p.ns_colOffZ = targetOffZ;
                } else {
                    p.ns_colOffX += (targetOffX - p.ns_colOffX) * colSmoothAlpha;
                    p.ns_colOffZ += (targetOffZ - p.ns_colOffZ) * colSmoothAlpha;
                }
                p.ns_colPrevX = s.rawX;
                p.ns_colPrevZ = s.rawZ;

                const finalX = s.rawX + p.ns_colOffX;
                const finalZ = s.rawZ + p.ns_colOffZ;

                // Re-sample supporting surface at corrected (finalX, finalZ) so feet never clip floors/stairs/terrain
                const finalTerrainH = hasHm ? heightmap.getHeightFromCoords(finalX, finalZ) : 0;
                const finalSupportY = hasSupportSolver
                    ? buildingHeightmap.getSupportSurfaceY(finalX, s.rawY, finalZ, finalTerrainH)
                    : finalTerrainH;
                const stancePelvisOffset = (s.stance === "prone") ? 0.15 : ((s.stance === "crouch") ? 0.50 : 0.85);
                const onResolvedFinal = (s.rawY - finalSupportY <= 1.55) && (s.rawY - finalSupportY >= -0.75);
                let finalFloorY = onResolvedFinal ? finalSupportY : Math.max(finalSupportY, s.rawY - stancePelvisOffset);
                if (finalFloorY < finalTerrainH) finalFloorY = finalTerrainH;

                const modMatrix = mat4.create();
                mat4.translate(modMatrix, modMatrix, [finalX, finalFloorY, -finalZ]);
                mat4.rotateY(modMatrix, modMatrix, -(s.rotDeg * Math.PI / 180));

                if (!this.renderModularSoldier(p, s.stance, modMatrix, viewMatrix, projectionMatrix, s.teamCol, s.isSelected, true, !s.isFpvPlayer, s.isFpvPlayer, false)) {
                    const meshKey = this.getSoldierMeshKey(p, s.stance);
                    let activeMesh = this.gpuMeshCache[meshKey];
                    if (!activeMesh) {
                        this.fetchModelAsync(meshKey);
                        activeMesh = this.gpuMeshCache[`soldier_${s.stance}`] || this.gpuMeshCache['soldier_stand'];
                        if (!activeMesh) {
                            this.fetchModelAsync(`soldier_${s.stance}`);
                            this.fetchModelAsync('soldier_stand');
                            continue;
                        }
                    }

                    const modelLift = (typeof activeMesh.groundOffset === "number") ? activeMesh.groundOffset : 0.0;
                    const modelMatrix = mat4.create();
                    mat4.translate(modelMatrix, modelMatrix, [finalX, finalFloorY + modelLift, -finalZ]);
                    mat4.rotateY(modelMatrix, modelMatrix, -(s.rotDeg * Math.PI / 180));

                    this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, s.teamCol, s.isSelected, 0.0, true, !s.isFpvPlayer, s.isFpvPlayer);
                }
            }
        }

        // ---------------------------------------------------------------------
        // 4. Render FOBs / Hideouts / Command Posts (AllFobs)
        // ---------------------------------------------------------------------
        if (typeof AllFobs !== "undefined") {
            for (const fobId in AllFobs) {
                const fob = AllFobs[fobId];
                if (!fob || fob.X == null || isNaN(fob.X)) continue;

                let posX = fob.X;
                let posZ = fob.Z;
                let groundY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(posX, posZ) : 0;
                const baseElevY = this._getElevatedEntityY(fob.Y, groundY, posX, posZ);

                const fobFaction = (fob.team === 1)
                    ? (typeof window.OpForTeam !== "undefined" ? window.OpForTeam : "")
                    : (typeof window.BluForTeam !== "undefined" ? window.BluForTeam : "");
                const isInsurgentFaction = ['hamas', 'taliban', 'meinsurgent', 'fsa', 'arf'].includes(fobFaction.toLowerCase());
                const meshKey = isInsurgentFaction ? "fob_insurgent_hideout" : "fob_deployable_firebase";

                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }

                const groundOffset = (typeof activeMesh.groundOffset === "number") ? activeMesh.groundOffset : 0.0;
                let teamCol = (fob.team === 1) ? this.colorTeam1 : this.colorTeam2;

                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, baseElevY + groundOffset, -posZ]);

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, false);
            }
        }

        // ---------------------------------------------------------------------
        // 5. Render Rally Points (AllRallies)
        // ---------------------------------------------------------------------
        if (typeof AllRallies !== "undefined") {
            for (const rId in AllRallies) {
                const rally = AllRallies[rId];
                if (!rally || rally.X == null || isNaN(rally.X)) continue;

                let posX = rally.X;
                let posZ = rally.Z;
                let groundY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(posX, posZ) : 0;
                const baseElevY = this._getElevatedEntityY(rally.Y, groundY, posX, posZ);

                let meshKey = (rally.team === 1) ? "vehicle_rallypoint_ru_placeable" : "vehicle_rallypoint_us_placeable";
                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }

                let isSquad = (typeof SelectedSquadTeam !== "undefined" && typeof SelectedSquadNumber !== "undefined" &&
                               rally.team == SelectedSquadTeam && rally.squad == SelectedSquadNumber);
                let teamCol = isSquad ? this.colorSquad : ((rally.team === 1) ? this.colorTeam1 : this.colorTeam2);
                const groundOffset = (typeof activeMesh.groundOffset === "number") ? activeMesh.groundOffset : 0.0;

                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, baseElevY + groundOffset, -posZ]);

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, false);
            }
        }

        // ---------------------------------------------------------------------
        // 6. Render Insurgency Weapon Caches (AllCaches)
        // ---------------------------------------------------------------------
        if (typeof AllCaches !== "undefined") {
            for (const cId in AllCaches) {
                const cache = AllCaches[cId];
                if (!cache || cache.X == null || isNaN(cache.X)) continue;

                let posX = cache.X;
                let posZ = cache.Z;
                let groundY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(posX, posZ) : 0;
                const baseElevY = this._getElevatedEntityY(cache.Y, groundY, posX, posZ);

                let meshKey = "vehicle_ammocache";
                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }

                const groundOffset = (typeof activeMesh.groundOffset === "number") ? activeMesh.groundOffset : 0.0;
                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, baseElevY + groundOffset, -posZ]);

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, this.colorCache, false);
            }
        }

        // ---------------------------------------------------------------------
        // 7. Render Active Projectiles in 3D (AllProj: Pre-Simulated 3D Arcs + Pitch/Yaw)
        // ---------------------------------------------------------------------
        if (typeof AllProj !== "undefined") {
            const projTimeSec = this._getContinuousPlaybackTimeSec();
            const hasProjTrack = (typeof window.sampleProjTrack === "function");

            for (const projId in AllProj) {
                const proj = AllProj[projId];
                if (!proj) continue;

                const pt = hasProjTrack ? window.sampleProjTrack(proj.id, projTimeSec) : null;
                let posX = pt ? pt.x : ((typeof proj.getX === "function") ? proj.getX() : proj.X);
                let posY = pt ? pt.y : ((typeof proj.getY === "function") ? proj.getY() : (proj.Y || 0));
                let posZ = pt ? pt.z : ((typeof proj.getZ === "function") ? proj.getZ() : proj.Z);

                if (posX == null || isNaN(posX)) posX = proj.X;
                if (posZ == null || isNaN(posZ)) posZ = proj.Z;
                if (posY == null || isNaN(posY)) posY = proj.Y || 0;

                if (posX == null || isNaN(posX) || posZ == null || isNaN(posZ)) continue;

                if (typeof heightmap !== "undefined") {
                    const gh = heightmap.getHeightFromCoords(posX, posZ);
                    posY = Math.max(posY, gh + 0.15);
                }

                const tLow = (proj.templateName || "").toLowerCase();
                const isSmkProj = (proj.type === 39 || proj.type === 41 || tLow.includes("smoke") || tLow.includes("smk") || tLow.includes("ugd"));
                const isTankShell = (proj.type === 40 && !isSmkProj) || tLow.startsWith("tnk_");
                let meshKey = isSmkProj
                    ? "proj_smoke"
                    : (isTankShell
                        ? "proj_tankshell"
                        : ((typeof ProjectileTypeToImageName !== "undefined" && ProjectileTypeToImageName[proj.type]) || "proj_lat"));
                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }

                let teamCol = (proj.team === 2) ? this.colorTeam2 : this.colorTeam1;
                const rotDeg = pt ? pt.yawDeg : ((typeof proj.getYaw === "function") ? proj.getYaw() : (proj.yaw || proj.rotation || 0));
                const pitchRad = (pt && proj.ns_shouldRotate) ? pt.pitch : 0.0;

                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, posY, -posZ]);
                mat4.rotateY(modelMatrix, modelMatrix, -(rotDeg * Math.PI / 180));
                if (Math.abs(pitchRad) > 0.001) {
                    mat4.rotateX(modelMatrix, modelMatrix, pitchRad);
                }

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, false, 0.0, false);
            }
        }

        // Optional Debug Lab 3D Asset Museum pass
        if (typeof window !== "undefined" && window.DebugLab && typeof window.DebugLab.draw3DEntities === "function") {
            window.DebugLab.draw3DEntities(this, viewMatrix, projectionMatrix);
        }

        // Pass 2 (X-Ray): Draw only occluded parts behind walls/terrain as clean untextured team-colored silhouettes
        if (isWallhack && this._xrayQueue && this._xrayQueue.length > 0) {
            this._inXrayPass = true;
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.GREATER);
            gl.depthMask(false);
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);

            for (let i = 0; i < this._xrayQueue.length; i++) {
                const item = this._xrayQueue[i];
                this.renderSingleMesh(item.mesh, item.modelMatrix, viewMatrix, projectionMatrix, item.teamColor, item.isSelected, 0.0, false);
            }

            gl.disable(gl.CULL_FACE);
            gl.depthMask(true);
            gl.depthFunc(gl.LEQUAL);
            this._inXrayPass = false;
        }
        this._xrayQueue = null;

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
    }

    _updateVehicleAnimState(v, activeMesh, pose, dt) {
        const isPlaying = (typeof IsPlaying !== "undefined") ? !!IsPlaying : true;
        const stepDt = isPlaying ? dt : 0.0;
        const curX = pose.x != null ? pose.x : ((typeof v.getX === "function") ? v.getX() : (v.X || 0));
        const curY = pose.y != null ? pose.y : ((typeof v.getY === "function") ? v.getY() : (v.Y || 0));
        const curZ = pose.z != null ? pose.z : ((typeof v.getZ === "function") ? v.getZ() : (v.Z || 0));
        const groundY = (typeof heightmap !== "undefined" && heightmap.initialized) ? heightmap.getHeightFromCoords(curX, curZ) : 0.0;
        const agl = Math.max(0.0, curY - groundY);
        v._animAgl = agl;

        let signedFwdVel = 0.0;
        let horizSpeed = 0.0;
        if (v._animPrevX != null && stepDt > 0.0005) {
            const dx = curX - v._animPrevX;
            const dz = curZ - v._animPrevZ;
            const dist = Math.hypot(dx, dz);
            if (dist < 140.0) {
                horizSpeed = dist / stepDt;
                const hRad = (pose.rotDeg || 0) * Math.PI / 180.0;
                const fwdX = Math.sin(hRad);
                const fwdZ = Math.cos(hRad);
                signedFwdVel = (dx * fwdX + dz * fwdZ) / stepDt;
            }
        }
        v._animPrevX = curX;
        v._animPrevZ = curZ;
        if (v._animSpeed == null) v._animSpeed = horizSpeed;
        else v._animSpeed += (horizSpeed - v._animSpeed) * Math.min(1.0, dt * 8.0);

        if (v._wheelDist == null) v._wheelDist = 0.0;
        if (stepDt > 0.0 && Math.abs(signedFwdVel) > 0.05 && Math.abs(signedFwdVel) < 85.0) {
            v._wheelDist += signedFwdVel * stepDt;
        }

        const hasCrew = !!(v.Passengers && (v.Passengers.size > 0 || v.Passengers.length > 0));
        const rotorActive = (agl > 1.2 || hasCrew || v._animSpeed > 1.5);
        if (v._rotorRpm == null) v._rotorRpm = rotorActive ? 1.0 : 0.0;
        const targetRpm = rotorActive ? 1.0 : 0.0;
        v._rotorRpm += (targetRpm - v._rotorRpm) * Math.min(1.0, dt * (rotorActive ? 1.6 : 0.8));

        if (v._rotorAngle == null) v._rotorAngle = 0.0;
        if (v._tailRotorAngle == null) v._tailRotorAngle = 0.0;
        if (stepDt > 0.0 && v._rotorRpm > 0.01) {
            v._rotorAngle = (v._rotorAngle + stepDt * 22.0 * v._rotorRpm) % (Math.PI * 2.0);
            v._tailRotorAngle = (v._tailRotorAngle + stepDt * 38.0 * v._rotorRpm) % (Math.PI * 2.0);
        }

        return {
            rotorAngle: v._rotorAngle,
            tailRotorAngle: v._tailRotorAngle,
            wheelDist: v._wheelDist
        };
    }

    _ensureAfterburnerProgram(gl) {
        if (this._abProgram) return true;
        const vs = `#version 300 es
            precision highp float;
            layout(location = 0) in vec3 aPos;
            layout(location = 1) in vec2 aUv;
            uniform mat4 uModelMatrix;
            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;
            out vec2 vUv;
            void main() {
                vUv = aUv;
                gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aPos, 1.0);
            }
        `;
        const fs = `#version 300 es
            precision highp float;
            in vec2 vUv;
            uniform float uTime;
            uniform float uPower;
            uniform float uSeed;
            out vec4 fragColor;
            void main() {
                float t = clamp(vUv.y, 0.0, 1.0); // 0 = nozzle exit, 1 = tail tip
                float flicker = 0.88 + 0.12 * sin(uTime * 52.0 + uSeed * 17.0 + t * 9.0);
                // Authentic PR e_jetexhaust_AB_s palette: hot white-yellow core -> plasma blue -> amber/orange tail
                float core = exp(-t * 4.8);
                float diamonds = 0.5 + 0.5 * sin(t * 22.0 - uTime * 34.0 + uSeed * 5.0);
                float diamondBand = pow(diamonds, 3.0) * (1.0 - t) * uPower * 0.55;
                vec3 colHot = vec3(1.0, 0.92, 0.68);
                vec3 colBlue = vec3(0.22, 0.48, 1.0);
                vec3 colAmber = vec3(1.0, 0.44, 0.06);
                vec3 col = mix(colBlue, colAmber, smoothstep(0.10, 0.72, t));
                col = mix(col, colHot, clamp(core * 0.95 + diamondBand, 0.0, 1.0));
                float fadeEnd = pow(max(0.0, 1.0 - t), 1.35);
                float fadeStart = smoothstep(0.0, 0.06, t);
                float radial = 1.0 - abs(vUv.x * 2.0 - 1.0) * 0.35;
                float alpha = fadeStart * fadeEnd * radial * (0.35 + 0.65 * uPower) * flicker;
                if (alpha <= 0.01) discard;
                fragColor = vec4(col * (1.15 + 0.45 * uPower), clamp(alpha, 0.0, 0.95));
            }
        `;
        const vsh = renderer3d.loadShader(gl.VERTEX_SHADER, vs);
        const fsh = renderer3d.loadShader(gl.FRAGMENT_SHADER, fs);
        if (!vsh || !fsh) return false;
        const prog = gl.createProgram();
        gl.attachShader(prog, vsh);
        gl.attachShader(prog, fsh);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;

        this._abProgram = prog;
        this._abUM = gl.getUniformLocation(prog, "uModelMatrix");
        this._abUV = gl.getUniformLocation(prog, "uViewMatrix");
        this._abUP = gl.getUniformLocation(prog, "uProjectionMatrix");
        this._abUTime = gl.getUniformLocation(prog, "uTime");
        this._abUPower = gl.getUniformLocation(prog, "uPower");
        this._abUSeed = gl.getUniformLocation(prog, "uSeed");

        // Build tapered 12-sided unit cone pointing along +Z (0..1)
        const segs = 12;
        const verts = [];
        const idxs = [];
        for (let i = 0; i <= segs; i++) {
            const ang = (i / segs) * Math.PI * 2.0;
            const c = Math.cos(ang), s = Math.sin(ang);
            const u = i / segs;
            // Ring 0 (nozzle base, z=0, r=1.0)
            verts.push(c, s, 0.0, u, 0.0);
            // Ring 1 (mid bulge, z=0.22, r=0.82)
            verts.push(c * 0.82, s * 0.82, 0.22, u, 0.22);
            // Ring 2 (tapered tip, z=1.0, r=0.04)
            verts.push(c * 0.04, s * 0.04, 1.0, u, 1.0);
        }
        for (let i = 0; i < segs; i++) {
            const b0 = i * 3, b1 = (i + 1) * 3;
            idxs.push(b0, b1, b0 + 1, b1, b1 + 1, b0 + 1);
            idxs.push(b0 + 1, b1 + 1, b0 + 2, b1 + 1, b1 + 2, b0 + 2);
        }

        this._abVao = gl.createVertexArray();
        gl.bindVertexArray(this._abVao);
        this._abVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._abVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
        this._abIbo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._abIbo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idxs), gl.STATIC_DRAW);
        this._abIdxCount = idxs.length;
        gl.bindVertexArray(null);
        return true;
    }

    drawAfterburnersPass() {
        if (!this.initialized || !this._afterburnerQueue || this._afterburnerQueue.length === 0) return;
        const viewMatrix = renderer3d.getCurrentViewMatrix();
        const projectionMatrix = renderer3d.getCurrentProjectionMatrix();
        const nowSec = ((typeof performance !== "undefined" && typeof performance.now === "function") ? performance.now() : Date.now()) * 0.001;
        this._drawAfterburners(viewMatrix, projectionMatrix, nowSec);
    }

    _drawAfterburners(viewMatrix, projectionMatrix, timeSec) {
        const gl = renderer3d.gl;
        if (!gl || !this._ensureAfterburnerProgram(gl)) return;

        gl.useProgram(this._abProgram);
        gl.uniformMatrix4fv(this._abUV, false, viewMatrix);
        gl.uniformMatrix4fv(this._abUP, false, projectionMatrix);
        gl.uniform1f(this._abUTime, timeSec);

        gl.bindVertexArray(this._abVao);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);

        const plumeMat = mat4.create();
        for (let i = 0; i < this._afterburnerQueue.length; i++) {
            const item = this._afterburnerQueue[i];
            const pwr = item.power;
            const pulse = 1.0 + 0.09 * Math.sin(timeSec * 47.0 + item.seed * 13.0);
            const len = (2.2 + 4.4 * pwr) * pulse;
            const rad = 0.36 + 0.22 * pwr;

            gl.uniform1f(this._abUPower, pwr);
            gl.uniform1f(this._abUSeed, item.seed);

            for (let n = 0; n < item.nozzles.length; n++) {
                const nz = item.nozzles[n];
                mat4.copy(plumeMat, item.modelMatrix);
                mat4.translate(plumeMat, plumeMat, [nz[0], nz[1], nz[2]]);
                mat4.scale(plumeMat, plumeMat, [rad, rad, len]);
                gl.uniformMatrix4fv(this._abUM, false, plumeMat);
                gl.drawElements(gl.TRIANGLES, this._abIdxCount, gl.UNSIGNED_SHORT, 0);

                // Inner hot core cone (brighter, narrower, shorter)
                mat4.copy(plumeMat, item.modelMatrix);
                mat4.translate(plumeMat, plumeMat, [nz[0], nz[1], nz[2]]);
                mat4.scale(plumeMat, plumeMat, [rad * 0.52, rad * 0.52, len * 0.62]);
                gl.uniformMatrix4fv(this._abUM, false, plumeMat);
                gl.drawElements(gl.TRIANGLES, this._abIdxCount, gl.UNSIGNED_SHORT, 0);
            }
        }

        gl.depthMask(true);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(null);
    }

    /**
     * Resolve a vehicle passenger's 3D seat pose, offset, turret attachment, and 1PV camera data.
     */
    resolveVehicleSeat(v, p, usedSeatKeysSet) {
        const vNameLow = (v && (v.name || v.templateName) ? (v.name || v.templateName) : "").toLowerCase().trim();
        const seatLow = (p && p.vehicleSeatName ? p.vehicleSeatName : "").toLowerCase().trim();
        const slot = (p && typeof p.vehicleSlot === "number") ? p.vehicleSlot : 0;

        const db = (typeof VEHICLE_SEATS_DB !== "undefined" && VEHICLE_SEATS_DB) ? VEHICLE_SEATS_DB : null;
        const cleanVName = vNameLow.replace(/(?:_alt\d*|_sp|_bf2|_woodland|_desert_cage|_desert|_camo|_cage|_dfr|_rws|_pkp|_dshk|_m240[bd]|_atc)(?=_|$)/g, "");
        const entry = db ? (db[vNameLow] || (cleanVName && db[cleanVName]) || null) : null;

        if (entry && entry.s && Array.isArray(entry.o) && entry.o.length > 0) {
            const used = usedSeatKeysSet || new Set();
            let chosenKey = null;

            // 1) Exact match
            if (seatLow && entry.s[seatLow]) {
                chosenKey = seatLow;
            }

            // 2) Suffix / substring match across unused entry.o keys
            if (!chosenKey && seatLow) {
                const candidates = [];
                if (vNameLow && seatLow.startsWith(vNameLow) && seatLow.length > vNameLow.length) {
                    candidates.push(seatLow.slice(vNameLow.length));
                } else if (cleanVName && seatLow.startsWith(cleanVName) && seatLow.length > cleanVName.length) {
                    candidates.push(seatLow.slice(cleanVName.length));
                }
                const lastIdx = seatLow.lastIndexOf("_");
                if (lastIdx >= 0) {
                    const tail = seatLow.slice(lastIdx);
                    if (tail.length >= 3 && !/^_\d+$/.test(tail)) {
                        candidates.push(tail);
                    } else if (lastIdx > 0) {
                        const prevIdx = seatLow.lastIndexOf("_", lastIdx - 1);
                        if (prevIdx >= 0) candidates.push(seatLow.slice(prevIdx));
                    }
                }

                for (let i = 0; i < entry.o.length; i++) {
                    const k = entry.o[i];
                    if (!used.has(k) && entry.s[k] && (k.endsWith(seatLow) || seatLow.endsWith(k))) {
                        chosenKey = k;
                        break;
                    }
                }
                if (!chosenKey) {
                    for (let c = 0; c < candidates.length && !chosenKey; c++) {
                        const pat = candidates[c];
                        if (!pat || pat.length < 2) continue;
                        for (let i = 0; i < entry.o.length; i++) {
                            const k = entry.o[i];
                            if (!used.has(k) && entry.s[k] && (k.endsWith(pat) || k.includes(pat))) {
                                chosenKey = k;
                                break;
                            }
                        }
                    }
                }
                if (!chosenKey && seatLow.length >= 3) {
                    for (let i = 0; i < entry.o.length; i++) {
                        const k = entry.o[i];
                        if (!used.has(k) && entry.s[k] && k.includes(seatLow)) {
                            chosenKey = k;
                            break;
                        }
                    }
                }
            }

            // 3) Ordered fallback across entry.o
            if (!chosenKey) {
                if (slot === 0) {
                    chosenKey = entry.o[0];
                } else {
                    const startIdx = (entry.o.length > 1) ? 1 : 0;
                    for (let i = startIdx; i < entry.o.length; i++) {
                        const k = entry.o[i];
                        if (!used.has(k) && entry.s[k]) {
                            chosenKey = k;
                            break;
                        }
                    }
                    if (!chosenKey) {
                        const clampedIdx = Math.max(0, Math.min(slot || 0, entry.o.length - 1));
                        chosenKey = entry.o[clampedIdx];
                    }
                }
            }

            if (chosenKey && entry.s[chosenKey]) {
                if (usedSeatKeysSet) usedSeatKeysSet.add(chosenKey);
                const arr = entry.s[chosenKey];
                return {
                    visible3p: !!arr[0],
                    pos: [arr[1] || 0, arr[2] || 0, arr[3] || 0],
                    yaw: arr[4] || 0,
                    pose: arr[5] === 1 ? "stand" : "sit",
                    onTurret: !!arr[6],
                    cam: [arr[7] || 0, arr[8] || 0, arr[9] || 0],
                    enclosed1pv: !!arr[10]
                };
            }
        }

        // Heuristic Fallback when VEHICLE_SEATS_DB is missing or vehicle is absent
        if (v && v.ns_isStationaryWeapon) {
            if (usedSeatKeysSet) usedSeatKeysSet.add(`__stationary_${usedSeatKeysSet.size}`);
            return {
                visible3p: true,
                pos: [0, 1.0, 0.55],
                yaw: 0,
                pose: "sit",
                onTurret: true,
                cam: [0, 1.15, 0.35],
                enclosed1pv: false
            };
        }
        if (/(?:^|_)(?:tnk|ifv|apc|aav)(?:_|$)|tank|bmp|btr/.test(vNameLow)) {
            if (usedSeatKeysSet) usedSeatKeysSet.add(`__armor_${usedSeatKeysSet.size}`);
            return {
                visible3p: false,
                pos: [0, 1.5, 0],
                yaw: 0,
                pose: "sit",
                onTurret: slot === 1,
                cam: [0, 2.35, 0],
                enclosed1pv: true
            };
        }

        const openSeats = [
            [-0.45, 1.35, -0.2],
            [0.45, 1.35, -0.2],
            [-0.45, 1.35, 0.7],
            [0.45, 1.35, 0.7],
            [-0.45, 1.35, 1.5],
            [0.45, 1.35, 1.5]
        ];
        const fallbackIdx = usedSeatKeysSet ? usedSeatKeysSet.size : Math.max(0, slot || 0);
        const [px, py, pz] = openSeats[Math.min(fallbackIdx, openSeats.length - 1)];
        if (usedSeatKeysSet) usedSeatKeysSet.add(`__heuristic_${fallbackIdx}`);
        return {
            visible3p: true,
            pos: [px, py, pz],
            yaw: 0,
            pose: "sit",
            onTurret: false,
            cam: [px, py + 0.05, pz],
            enclosed1pv: false
        };
    }

    /**
     * Resolve cached soldier mesh for a vehicle passenger pose with zero pop-out crouch fallback.
     */
    _resolvePassengerMesh(p, pose) {
        const targetKey = this.getSoldierMeshKey(p, pose);
        let mesh = this.gpuMeshCache[targetKey];
        if (mesh) {
            return {
                mesh,
                meshKey: targetKey,
                yOffset: (pose === "sit") ? 0.0 : -1.0
            };
        }

        this.fetchModelAsync(targetKey);
        if (pose === "sit") {
            const crouchKey = this.getSoldierMeshKey(p, "crouch");
            mesh = this.gpuMeshCache[crouchKey];
            if (mesh) return { mesh, meshKey: crouchKey, yOffset: -0.55 };

            mesh = this.gpuMeshCache["soldier_crouch"];
            if (mesh) return { mesh, meshKey: "soldier_crouch", yOffset: -0.55 };
        } else {
            mesh = this.gpuMeshCache["soldier_stand"];
            if (mesh) return { mesh, meshKey: "soldier_stand", yOffset: -1.0 };
        }
        return null;
    }

    fetchModularMeshAsync(modKey, highPriority = false) {
        if (!modKey || this.modularMeshCache[modKey] || this.pendingModularFetches.has(modKey) || this.failedModularModels.has(modKey)) return;
        const retryAt = this._modularRetryAfter[modKey];
        if (retryAt && performance.now() < retryAt) return;

        if (this._modularQueuedKeys.has(modKey)) {
            if (highPriority) {
                const idx = this._modularFetchQueue.indexOf(modKey);
                if (idx > 0) {
                    this._modularFetchQueue.splice(idx, 1);
                    this._modularFetchQueue.unshift(modKey);
                }
            }
            return;
        }
        this._modularQueuedKeys.add(modKey);
        if (highPriority) this._modularFetchQueue.unshift(modKey);
        else this._modularFetchQueue.push(modKey);
        this._pumpModularFetchQueue();
    }

    _pumpModularFetchQueue() {
        while (this._modularActiveFetches < this._modularMaxConcurrent && this._modularFetchQueue.length > 0) {
            const modKey = this._modularFetchQueue.shift();
            this._modularQueuedKeys.delete(modKey);
            if (!modKey || this.modularMeshCache[modKey] || this.pendingModularFetches.has(modKey) || this.failedModularModels.has(modKey)) continue;
            this._executeModularFetch(modKey);
        }
    }

    async _executeModularFetch(modKey) {
        this._modularActiveFetches++;
        this.pendingModularFetches.add(modKey);
        try {
            const resp = await fetch(`models_3d/modular/${modKey}.json?v=1.2_mod_helmet`);
            if (!resp.ok) {
                // Only permanently blacklist truly missing assets (404/410); allow retry on transient 5xx/server busy
                if (resp.status === 404 || resp.status === 410) {
                    this.failedModularModels.add(modKey);
                } else {
                    this._modularRetryAfter[modKey] = performance.now() + 1500;
                }
                return;
            }
            const data = await resp.json();
            const gl = (typeof renderer3d !== "undefined") ? renderer3d.gl : null;
            if (!data || !data.v || !data.i || !gl) {
                this.failedModularModels.add(modKey);
                return;
            }

            const vBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.v), gl.STATIC_DRAW);

            const iBuf = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(data.i), gl.STATIC_DRAW);

            let uvBuf = null;
            if (data.uv && data.uv.length > 0) {
                uvBuf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.uv), gl.STATIC_DRAW);
            }

            let minZ = Infinity, maxZ = -Infinity;
            for (let k = 2; k < data.v.length; k += 6) {
                const vz = data.v[k];
                if (vz < minZ) minZ = vz;
                if (vz > maxZ) maxZ = vz;
            }

            this.modularMeshCache[modKey] = {
                modelKey: null, // Managed via modular texture override
                isMultiPart: false,
                vertexBuffer: vBuf,
                indexBuffer: iBuf,
                uvBuffer: uvBuf,
                indexCount: data.i.length,
                vertexCount: Math.floor(data.v.length / 6),
                groundOffset: 0.0,
                preserveOrigin: true,
                minZ: isFinite(minZ) ? minZ : -0.3,
                maxZ: isFinite(maxZ) ? maxZ : 0.3,
                texReady: false,
                hasTex: true
            };
            delete this._modularRetryAfter[modKey];
            if (typeof requestUpdate === "function") requestUpdate();
        } catch (err) {
            // Never permanently blacklist on transient ERR_CONNECTION_REFUSED / network drop!
            this._modularRetryAfter[modKey] = performance.now() + 1200;
        } finally {
            this.pendingModularFetches.delete(modKey);
            this._modularActiveFetches--;
            this._pumpModularFetchQueue();
        }
    }

    _getOrLoadModularTex(texKey, wrap) {
        if (!texKey) return null;
        const relKey = `modular/${texKey}`;
        // Must match _loadEntityTexture cacheKey format: `${texKey}_${wrapMode ? 1 : 0}`
        const cacheKey = `${relKey}_${wrap ? 1 : 0}`;
        if (this.texCache[cacheKey]) {
            return this.texCache[cacheKey];
        }
        if (!this.pendingTexPaths[cacheKey]) {
            this._loadEntityTexture(relKey, !!wrap).then((tex) => {
                if (tex && typeof requestUpdate === "function") requestUpdate();
            });
        }
        return null;
    }

    // Phase 4: Predictive Equipment Lookahead (EpiPen, Medikit, Field Dressing, Shovel, Launchers, Grenades, Mines, Ammo, Grapple, Binoculars)
    getPlayerActiveWeaponOverride(player) {
        if (typeof options_PredictiveEquipment !== "undefined" && !options_PredictiveEquipment) return null;
        if (!player || !player.isAlive || (player.vehicleid != null && player.vehicleid >= 0)) return null;
        if (typeof window.getPlayerActionAtTime !== "function" || typeof SOLDIER_LOADOUT_DB === "undefined" || !SOLDIER_LOADOUT_DB) return null;

        const curTime = this._getContinuousPlaybackTimeSec();
        const act = window.getPlayerActionAtTime(player.id, curTime);
        if (!act) return null;

        const db = SOLDIER_LOADOUT_DB;
        const weapons = db.weapons || null;
        if (!weapons) return null;

        const kitLow = (player.kit || "").toLowerCase().trim();
        let wgeom = null;

        // 1. Direct projectile template match (strip _projectile/_proj/_rocket/_missile suffixes)
        if (act.n) {
            if (weapons[act.n]) {
                wgeom = act.n;
            } else {
                const stripped = act.n.replace(/(?:_projectile|_proj|_rocket|_missile|_warhead|_heat|_he|_tandem|_frag|_smoke)+$/g, "");
                if (stripped && weapons[stripped]) {
                    wgeom = stripped;
                }
            }
        }

        // 2. Kit-specific secondary equipment (kitMap launcher slot [4] or kitEquip map)
        if (!wgeom && act.t === "launcher" && db.kitMap && db.kitMap[kitLow] && db.kitMap[kitLow][4]) {
            const cand = db.kitMap[kitLow][4];
            if (weapons[cand]) wgeom = cand;
        }
        if (!wgeom && db.kitEquip && db.kitEquip[kitLow] && db.kitEquip[kitLow][act.t]) {
            const cand = db.kitEquip[kitLow][act.t];
            if (weapons[cand]) wgeom = cand;
        }

        // 3. Universal equipment fallback
        if (!wgeom && db.equipDefaults && db.equipDefaults[act.t]) {
            const cand = db.equipDefaults[act.t];
            if (weapons[cand]) wgeom = cand;
        }

        if (!wgeom) return null;

        let grip = act.g || "item_hold";
        if (db.weaponMats && !db.weaponMats[grip]) {
            grip = db.weaponMats["item_hold"] ? "item_hold" : "rifle";
        }

        return { weaponGeom: wgeom, grip: grip };
    }

    resolveModularSoldierLayers(player, stance, isDead) {
        if (typeof SOLDIER_LOADOUT_DB === "undefined" || !SOLDIER_LOADOUT_DB || !player) return null;
        const db = SOLDIER_LOADOUT_DB;
        const pose = (stance === "crouch" || stance === "prone" || stance === "sit") ? stance : "stand";
        const camoSuffix = (typeof window.CurrentMapCamoSuffix === "string") ? window.CurrentMapCamoSuffix : "";
        const kitLow = (player.kit || "").toLowerCase().trim();
        const ov = !isDead ? this.getPlayerActiveWeaponOverride(player) : null;

        // Per-player memoization (avoids string/object allocations every frame for 100+ soldiers)
        const memoKey = `${kitLow}|${player.spawnSoldierBody || ""}|${pose}|${isDead ? 1 : 0}|${camoSuffix}|${ov ? (ov.weaponGeom + ":" + ov.grip) : ""}`;
        if (player.ns_modLayerKey === memoKey && player.ns_modLayers) {
            return player.ns_modLayers;
        }

        // 1. Resolve Kit Gear, Primary Weapon, and Grip Archetype
        let kitPairKey = null;
        let weapGeom = null;
        let gripName = "unarmed";

        if (!kitLow || kitLow.endsWith("_unarmed") || kitLow.includes("unarmed") || kitLow.includes("civilian")) {
            kitPairKey = null;
            weapGeom = null;
            gripName = "unarmed";
        } else if (db.kitMap && db.kitMap[kitLow]) {
            const entry = db.kitMap[kitLow];
            kitPairKey = entry[0] || null;
            weapGeom = entry[1] || null;
            const gId = entry[2];
            gripName = (db.grips && db.grips[gId]) ? db.grips[gId] : (weapGeom ? "rifle" : "unarmed");
        } else if (kitLow.startsWith("gungame_")) {
            const parts = kitLow.split("_");
            const ggToken = parts[2] || "rif";
            const ggRoleMap = {
                ar: "support", mg: "mg", dmr: "marksman", sniper: "sniper",
                rif: "rifleman", smg: "assault", shotgun: "breacher",
                pistol: "pilot", grenade: "grenadier", m79: "grenadier",
                claymore: "sapper", knife: "unarmed", scorpion: "assault"
            };
            const targetRole = ggRoleMap[ggToken] || "rifleman";
            if (targetRole === "unarmed") {
                gripName = "unarmed";
            } else {
                const teamFac = (player.team == 1)
                    ? (typeof window.OpForTeam !== "undefined" ? window.OpForTeam.toLowerCase() : "ru")
                    : (typeof window.BluForTeam !== "undefined" ? window.BluForTeam.toLowerCase() : "us");
                const synthKey = `${teamFac}_${targetRole}`;
                const synthAlt = `${teamFac}_${targetRole}_alt`;
                const entry = db.kitMap[synthKey] || db.kitMap[synthAlt] || db.kitMap[`${teamFac}_rifleman`] || db.kitMap[`${teamFac}_rifleman_alt`];
                if (entry) {
                    kitPairKey = entry[0] || null;
                    weapGeom = entry[1] || null;
                    gripName = (db.grips && db.grips[entry[2]]) ? db.grips[entry[2]] : (weapGeom ? "rifle" : "unarmed");
                }
            }
        }

        // Apply optional Phase 4 predictive equipment override (when alive and not dead)
        if (!isDead) {
            if (ov) {
                if (ov.weaponGeom !== undefined) weapGeom = ov.weaponGeom;
                if (ov.grip) gripName = ov.grip;
            }
        } else {
            weapGeom = null;
            gripName = "unarmed";
        }

        if (!weapGeom) {
            gripName = "unarmed";
        }

        // 2. Resolve Spawn Soldier Body (locked on spawn, preserved across mid-game kit swaps)
        let bodyName = player.spawnSoldierBody;
        if ((!bodyName || !db.bodies[bodyName]) && typeof resolveSpawnSoldierBody === "function") {
            bodyName = resolveSpawnSoldierBody(player.team, player.kit);
            if (bodyName && player.kit) {
                player.spawnSoldierBody = bodyName;
            }
        }
        const bodyEntry = (bodyName && db.bodies[bodyName]) ? db.bodies[bodyName] : db.bodies["pr_us_soldier1"];
        if (!bodyEntry) return null;

        const bodyTex = (camoSuffix && bodyEntry.c && bodyEntry.c[camoSuffix]) ? bodyEntry.c[camoSuffix] : bodyEntry.t;
        const bodyKey = `b_${bodyEntry.g}_${gripName}_${pose}`;

        // 3. Resolve Kit Gear mesh & camo texture
        let kitKey = null, kitTex = null, kitWrap = 0;
        if (kitPairKey && db.kits && db.kits[kitPairKey]) {
            const ke = db.kits[kitPairKey];
            kitKey = `k_${ke.g}_${pose}`;
            kitTex = (camoSuffix && ke.c && ke.c[camoSuffix]) ? ke.c[camoSuffix] : ke.t;
            kitWrap = ke.w || 0;
        }

        // 4. Resolve Rigid 3P Weapon mesh & bone matrix
        let weapKey = null, weapTex = null, weapWrap = 0, weapMat = null;
        if (weapGeom && db.weapons && db.weapons[weapGeom] && db.weaponMats && db.weaponMats[gripName] && db.weaponMats[gripName][pose]) {
            const we = db.weapons[weapGeom];
            weapKey = `w_${weapGeom}`;
            weapTex = we.t;
            weapWrap = we.w || 0;
            weapMat = db.weaponMats[gripName][pose];
        }

        const res = {
            bodyKey, bodyTex, bodyWrap: bodyEntry.w || 0,
            fallbackBodyKey: `b_${bodyEntry.g}_rifle_${pose}`,
            isPredictive: !!ov,
            kitKey, kitTex, kitWrap,
            weapKey, weapTex, weapWrap, weapMat
        };
        player.ns_modLayerKey = memoKey;
        player.ns_modLayers = res;
        return res;
    }

    renderModularSoldier(player, stance, modelMatrix, viewMatrix, projectionMatrix, teamCol, isSelected, allowTex, allowXray, skipColorPass, isDead = false) {
        const layers = this.resolveModularSoldierLayers(player, stance, isDead);
        if (!layers) return false;

        const hiPri = !!layers.isPredictive;
        let bodyMesh = this.modularMeshCache[layers.bodyKey];
        if (!bodyMesh) {
            this.fetchModularMeshAsync(layers.bodyKey, hiPri);
            if (layers.kitKey && !this.modularMeshCache[layers.kitKey]) this.fetchModularMeshAsync(layers.kitKey, hiPri);
            if (layers.weapKey && !this.modularMeshCache[layers.weapKey]) this.fetchModularMeshAsync(layers.weapKey, hiPri);
            // Keep already-cached same-stance modular body while new grip arms download (prevents weaponless fallback on crouch/prone!)
            bodyMesh = (layers.fallbackBodyKey && layers.fallbackBodyKey !== layers.bodyKey)
                ? this.modularMeshCache[layers.fallbackBodyKey]
                : null;
            if (!bodyMesh) return false;
        }

        const wantTex = allowTex && (typeof options_FactionTextures !== "undefined" ? options_FactionTextures : false);

        // Layer 1: Soldier Body / Uniform / Face / Map Camo
        const bodyGlTex = wantTex ? this._getOrLoadModularTex(layers.bodyTex, layers.bodyWrap) : null;
        this.renderSingleMesh(bodyMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, isSelected, 0.0, allowTex, allowXray, skipColorPass, bodyGlTex);

        // Layer 2: Kit Gear (Helmet / Vest / Backpack — omitted when unarmed/civilian/no kit)
        if (layers.kitKey) {
            const kitMesh = this.modularMeshCache[layers.kitKey];
            if (kitMesh) {
                const kitGlTex = wantTex ? this._getOrLoadModularTex(layers.kitTex, layers.kitWrap) : null;
                this.renderSingleMesh(kitMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, isSelected, 0.0, allowTex, allowXray, skipColorPass, kitGlTex);
            } else {
                this.fetchModularMeshAsync(layers.kitKey, hiPri);
            }
        }

        // Layer 3: Real 3P Weapon rigidly attached to mesh1 bone matrix for (grip, pose)
        if (layers.weapKey && layers.weapMat) {
            const weapMesh = this.modularMeshCache[layers.weapKey];
            if (weapMesh) {
                const weapMatrix = mat4.create();
                mat4.multiply(weapMatrix, modelMatrix, layers.weapMat);
                const weapGlTex = wantTex ? this._getOrLoadModularTex(layers.weapTex, layers.weapWrap) : null;
                this.renderSingleMesh(weapMesh, weapMatrix, viewMatrix, projectionMatrix, teamCol, isSelected, 0.0, allowTex, allowXray, skipColorPass, weapGlTex);
            } else {
                this.fetchModularMeshAsync(layers.weapKey, hiPri);
            }
        }

        return true;
    }

    getVehicleTurretRelYawRad(v, vehRotDeg) {
        if (!v) return 0.0;
        let bestGunner = null;
        let bestScore = 0;

        if (v.Passengers && typeof v.Passengers.forEach === "function") {
            const vName = (v.name || v.templateName || "").toLowerCase();
            const cleanVName = vName.replace(/(?:_alt\d*|_sp|_ndl)(?=_|$)/g, "");
            const isStationaryTurret = this._isDeployableOrTurret(vName);

            v.Passengers.forEach((pOrId) => {
                const p = (typeof pOrId === "object" && pOrId !== null)
                    ? pOrId
                    : ((typeof AllPlayers !== "undefined") ? AllPlayers[pOrId] : null);
                if (!p || !p.isAlive) return;

                const rawSeat = (p.vehicleSeatName || "").toLowerCase();
                let seat = rawSeat;
                const matchedPrefix = (vName && seat.startsWith(vName)) ? vName : ((cleanVName && seat.startsWith(cleanVName)) ? cleanVName : "");
                if (matchedPrefix) {
                    seat = seat.substring(matchedPrefix.length);
                    if (seat.startsWith("_")) seat = seat.substring(1);
                    else if (seat.length === 0) seat = "driver";
                }
                const slot = (typeof p.vehicleSlot === "number") ? p.vehicleSlot : -1;

                // Disambiguate main turret gunner from commander roof cupola / bow MG / passenger seats
                let score = 0;
                if (seat.includes("gunnercupola")) {
                    score = 75;
                } else if (seat === "driver" || (isStationaryTurret && (seat === "" || slot === 0))) {
                    score = isStationaryTurret ? 80 : 0;
                } else if (
                    seat.includes("cupola") ||
                    seat.includes("mg_gunner") ||
                    seat.includes("mggunner") ||
                    seat.includes("machinegunner") ||
                    seat.includes("hullgun") ||
                    seat.includes("bowgun") ||
                    seat.includes("codriver") ||
                    seat.includes("rightpass") ||
                    seat.includes("leftpass") ||
                    seat.includes("passenger") ||
                    seat.includes("pass_") ||
                    seat.endsWith("pass") ||
                    seat.includes("lavett") ||
                    seat.includes("door")
                ) {
                    score = 0;
                } else if (
                    seat === "gunner" ||
                    rawSeat.endsWith("_gunner") ||
                    seat.includes("turretgunner") ||
                    seat.includes("_crows") ||
                    seat.includes("crows") ||
                    seat.includes("_turret") ||
                    seat.includes("turret")
                ) {
                    score = 100;
                } else if (seat.includes("gunner") || seat.includes("weaponmount") || seat.includes("50mount") || seat.includes("gunmount")) {
                    score = 85;
                } else if (slot === 1) {
                    score = 70;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestGunner = p;
                }
            });
        }

        if (bestGunner) {
            const gunnerRotDeg = (typeof bestGunner.getRotation === "function")
                ? bestGunner.getRotation()
                : (bestGunner.rotation || 0);
            const targetRelRad = -((gunnerRotDeg - vehRotDeg) * Math.PI / 180.0);
            if (v._turretRelYawRad == null || isNaN(v._turretRelYawRad)) {
                v._turretRelYawRad = targetRelRad;
            } else {
                // Shortest angular delta interpolation to avoid 360-degree wrap-around spin
                let diff = targetRelRad - v._turretRelYawRad;
                diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                v._turretRelYawRad = v._turretRelYawRad + diff * 0.45;
            }
        }

        return (v._turretRelYawRad != null && !isNaN(v._turretRelYawRad)) ? v._turretRelYawRad : 0.0;
    }

    _renderAnimParts(gpuMesh, modelMatrix, viewMatrix, projectionMatrix, teamColor, isSelected, allowTexture, allowXray, skipColorPass, overrideGlTexture, animState) {
        if (!gpuMesh || !Array.isArray(gpuMesh.parts) || gpuMesh.parts.length === 0) return;
        for (let i = 0; i < gpuMesh.parts.length; i++) {
            const pt = gpuMesh.parts[i];
            let ptMat = modelMatrix;
            let uvScroll = null;
            if (animState) {
                if (pt.kind === "t") {
                    const dist = animState.wheelDist || 0.0;
                    if (Math.abs(dist) > 0.001) {
                        const cMin = (pt.uvCell && pt.uvCell.length >= 2) ? pt.uvCell[0] : 0.0;
                        const cSize = (pt.uvCell && pt.uvCell.length >= 2) ? pt.uvCell[1] : 1.0;
                        uvScroll = [dist * 0.42, cMin, cSize, 1.0];
                    }
                } else {
                    let ang = 0.0;
                    if (pt.kind === "r") {
                        ang = (pt.axis === "x") ? (animState.tailRotorAngle || 0.0) : (animState.rotorAngle || 0.0);
                    } else if (pt.kind === "w") {
                        ang = -((animState.wheelDist || 0.0) / Math.max(0.22, pt.radius || 0.45));
                    }
                    if (Math.abs(ang) > 0.0005) {
                        const p = pt.pivot || [0.0, 0.0, 0.0];
                        ptMat = mat4.clone(modelMatrix);
                        mat4.translate(ptMat, ptMat, p);
                        if (pt.axis === "y") mat4.rotateY(ptMat, ptMat, ang);
                        else mat4.rotateX(ptMat, ptMat, ang);
                        mat4.translate(ptMat, ptMat, [-p[0], -p[1], -p[2]]);
                    }
                }
            }
            this._activeUvScroll = uvScroll;
            this.renderSingleMesh(pt, ptMat, viewMatrix, projectionMatrix, teamColor, isSelected, 0.0, allowTexture, allowXray, skipColorPass, overrideGlTexture, null);
            this._activeUvScroll = null;
        }
    }

    renderSingleMesh(gpuMesh, modelMatrix, viewMatrix, projectionMatrix, teamColor, isSelected, turretRelYawRad = 0.0, allowTexture = true, allowXray = true, skipColorPass = false, overrideGlTexture = null, animState = null) {
        const gl = renderer3d.gl;
        if (!gl || !gpuMesh) return;

        const wantTex = allowTexture && (typeof options_FactionTextures !== "undefined" ? options_FactionTextures : false);
        if (wantTex && !overrideGlTexture && gpuMesh.modelKey && !gpuMesh.texReady) {
            this.fetchModelTexAsync(gpuMesh.modelKey);
        }

        if (gpuMesh.isMultiPart) {
            if (gpuMesh.hull) {
                this.renderSingleMesh(gpuMesh.hull, modelMatrix, viewMatrix, projectionMatrix, teamColor, isSelected, 0.0, allowTexture, allowXray, skipColorPass, overrideGlTexture, null);
            }
            if (gpuMesh.turret) {
                let turretMatrix = modelMatrix;
                if (Math.abs(turretRelYawRad) > 0.0005) {
                    const p = gpuMesh.turret.pivot || [0.0, 1.5, 0.0];
                    turretMatrix = mat4.clone(modelMatrix);
                    mat4.translate(turretMatrix, turretMatrix, p);
                    mat4.rotateY(turretMatrix, turretMatrix, turretRelYawRad);
                    mat4.translate(turretMatrix, turretMatrix, [-p[0], -p[1], -p[2]]);
                }
                this.renderSingleMesh(gpuMesh.turret, turretMatrix, viewMatrix, projectionMatrix, teamColor, isSelected, 0.0, allowTexture, allowXray, skipColorPass, overrideGlTexture, null);
            }
            if (gpuMesh.parts) {
                this._renderAnimParts(gpuMesh, modelMatrix, viewMatrix, projectionMatrix, teamColor, isSelected, allowTexture, allowXray, skipColorPass, overrideGlTexture, animState);
            }
            return;
        }

        if (gpuMesh.parts) {
            this._renderAnimParts(gpuMesh, modelMatrix, viewMatrix, projectionMatrix, teamColor, isSelected, allowTexture, allowXray, skipColorPass, overrideGlTexture, animState);
        }

        const boundTex = overrideGlTexture || (gpuMesh.texReady ? gpuMesh.glTexture : null);
        const useTex = !!(wantTex && gpuMesh.uvBuffer && boundTex);
        const activeVBuf = (useTex && !overrideGlTexture && gpuMesh.texVertexBuffer) ? gpuMesh.texVertexBuffer : gpuMesh.vertexBuffer;
        const activeIBuf = (useTex && !overrideGlTexture && gpuMesh.texIndexBuffer) ? gpuMesh.texIndexBuffer : gpuMesh.indexBuffer;
        const activeICount = (useTex && !overrideGlTexture && gpuMesh.texIndexCount) ? gpuMesh.texIndexCount : gpuMesh.indexCount;

        if (!activeVBuf || !activeIBuf) return;

        // Record leaf mesh for next shadow pass (reuses exact world/turret matrix)
        if (!this._inXrayPass && this._shadowCasters) {
            this._shadowCasters.push({
                vBuf: activeVBuf,
                iBuf: activeIBuf,
                iCount: activeICount,
                modelMatrix: modelMatrix
            });
        }

        // Queue leaf mesh for occluded-only X-Ray pass (reuses exact world/turret matrix)
        if (allowXray && this._xrayQueue && !this._inXrayPass) {
            this._xrayQueue.push({
                mesh: gpuMesh,
                modelMatrix: modelMatrix,
                teamColor: teamColor,
                isSelected: isSelected
            });
        }

        if (skipColorPass) return;

        // 1. Main Model Pass (Render solid team color or lazy-loaded authentic faction/vehicle texture)
        gl.useProgram(this.program);

        gl.bindBuffer(gl.ARRAY_BUFFER, activeVBuf);
        gl.vertexAttribPointer(this.aVertexPosition, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(this.aVertexPosition);

        gl.vertexAttribPointer(this.aVertexNormal, 3, gl.FLOAT, false, 24, 12);
        gl.enableVertexAttribArray(this.aVertexNormal);

        if (useTex && this.aVertexUV !== -1 && this.aVertexUV !== null) {
            gl.bindBuffer(gl.ARRAY_BUFFER, gpuMesh.uvBuffer);
            gl.vertexAttribPointer(this.aVertexUV, 2, gl.FLOAT, false, 8, 0);
            gl.enableVertexAttribArray(this.aVertexUV);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, boundTex);
            if (this.uEntityTex !== null) gl.uniform1i(this.uEntityTex, 0);
            if (this.uUseTexture !== null) gl.uniform1i(this.uUseTexture, 1);
            if (this.uUvScroll !== null) {
                const sc = this._activeUvScroll;
                if (sc) gl.uniform4f(this.uUvScroll, sc[0], sc[1], sc[2], sc[3]);
                else gl.uniform4f(this.uUvScroll, 0.0, 0.0, 1.0, 0.0);
            }
        } else {
            if (this.aVertexUV !== -1 && this.aVertexUV !== null) {
                gl.disableVertexAttribArray(this.aVertexUV);
                gl.vertexAttrib2f(this.aVertexUV, 0.0, 0.0);
            }
            if (this.uUseTexture !== null) gl.uniform1i(this.uUseTexture, 0);
            if (this.uUvScroll !== null) gl.uniform4f(this.uUvScroll, 0.0, 0.0, 1.0, 0.0);
        }

        gl.uniformMatrix4fv(this.uModelMatrix, false, modelMatrix);
        gl.uniformMatrix4fv(this.uViewMatrix, false, viewMatrix);
        gl.uniformMatrix4fv(this.uProjectionMatrix, false, projectionMatrix);
        gl.uniform3fv(this.uTeamColor, teamColor);
        if (this.uIsSelected) {
            gl.uniform1f(this.uIsSelected, isSelected ? 1.0 : 0.0);
        }
        if (isSelected) {
            this.hasSelection = true;
        }

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, activeIBuf);
        gl.drawElements(gl.TRIANGLES, activeICount, gl.UNSIGNED_INT, 0);

        if (useTex && this.aVertexUV !== -1 && this.aVertexUV !== null) {
            gl.disableVertexAttribArray(this.aVertexUV);
        }

        // 2. Selection Outline Pass (Fallback only if WebGL2 MRT Selection Mask is unavailable)
        const useMrtMask = (typeof renderer3d !== "undefined" && renderer3d.selectionFboReady);
        if (isSelected && !useMrtMask && this.outlineProgram) {
            gl.useProgram(this.outlineProgram);

            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.FRONT);

            gl.bindBuffer(gl.ARRAY_BUFFER, activeVBuf);
            gl.vertexAttribPointer(this.aOutlineVertexPosition, 3, gl.FLOAT, false, 24, 0);
            gl.enableVertexAttribArray(this.aOutlineVertexPosition);

            gl.vertexAttribPointer(this.aOutlineVertexNormal, 3, gl.FLOAT, false, 24, 12);
            gl.enableVertexAttribArray(this.aOutlineVertexNormal);

            gl.uniformMatrix4fv(this.uOutlineModelMatrix, false, modelMatrix);
            gl.uniformMatrix4fv(this.uOutlineViewMatrix, false, viewMatrix);
            gl.uniformMatrix4fv(this.uOutlineProjectionMatrix, false, projectionMatrix);
            gl.uniform3fv(this.uOutlineColor, this.colorOutline);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, activeIBuf);
            gl.drawElements(gl.TRIANGLES, activeICount, gl.UNSIGNED_INT, 0);

            gl.disable(gl.CULL_FACE);
        }
    }

    drawShadowPass(lightViewProj) {
        if (!this.initialized || !this.shadowProgram || !this._shadowCasters || this._shadowCasters.length === 0) return;
        const gl = renderer3d.gl;
        if (!gl) return;

        gl.useProgram(this.shadowProgram);
        gl.uniformMatrix4fv(this.sLightSpaceMatrix, false, lightViewProj);
        gl.enableVertexAttribArray(this.sVertexPosition);

        for (let i = 0; i < this._shadowCasters.length; i++) {
            const c = this._shadowCasters[i];
            if (!c || !c.vBuf || !c.iBuf || !c.iCount) continue;
            gl.uniformMatrix4fv(this.sModelMatrix, false, c.modelMatrix);
            gl.bindBuffer(gl.ARRAY_BUFFER, c.vBuf);
            gl.vertexAttribPointer(this.sVertexPosition, 3, gl.FLOAT, false, 24, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.iBuf);
            gl.drawElements(gl.TRIANGLES, c.iCount, gl.UNSIGNED_INT, 0);
        }

        gl.disableVertexAttribArray(this.sVertexPosition);
    }
}

$(() => { entities3dRenderer = new Entities3dRenderer(); });
