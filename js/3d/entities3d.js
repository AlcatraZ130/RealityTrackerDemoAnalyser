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
    rawModelCache = {};
    pendingFetches = new Set();
    failedModels = new Set();
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
            uniform vec3 uSunDir;
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
                float sunDiff = max(dot(norm, sunDir), 0.0);
                if (uUseShadows == 1 && sunDiff > 0.001) {
                    float sh = sampleEntityShadow(vWorldPos, norm, sunDiff);
                    sunDiff *= mix(0.18, 1.0, sh);
                }

                vec3 skyDir = normalize(vec3(-sunDir.x, 0.65, -sunDir.z));
                float skyDiff = max(dot(norm, skyDir), 0.0);

                float skyFactor = clamp(norm.y * 0.5 + 0.5, 0.0, 1.0);
                float lighting = 0.30 + (0.44 * sunDiff) + (0.16 * skyDiff) + (0.10 * skyFactor);

                vec3 baseCol = (uUseTexture == 1) ? texture(uEntityTex, vUV).rgb : uTeamColor;
                fragColor = vec4(baseCol * lighting, 1.0);
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
        this.uSunDir = gl.getUniformLocation(prog, 'uSunDir');
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
        return true;
    }

    uploadToGpu(modelKey, raw) {
        const gl = renderer3d.gl;
        if (!gl || !raw || !raw.data) return null;

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

    _loadEntityTexture(texKey, wrapMode) {
        const cacheKey = `${texKey}_${wrapMode ? 1 : 0}`;
        if (this.texCache[cacheKey]) {
            return Promise.resolve(this.texCache[cacheKey]);
        }
        if (this.pendingTexPaths[cacheKey]) {
            return this.pendingTexPaths[cacheKey];
        }
        const p = new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const gl = renderer3d.gl;
                if (!gl) {
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
                gl.bindTexture(gl.TEXTURE_2D, null);
                this.texCache[cacheKey] = tex;
                delete this.pendingTexPaths[cacheKey];
                resolve(tex);
            };
            img.onerror = () => {
                delete this.pendingTexPaths[cacheKey];
                resolve(null);
            };
            img.src = `Textures/entities/${texKey}.webp?v=5.0_soldiers_fix`;
        });
        this.pendingTexPaths[cacheKey] = p;
        return p;
    }

    async fetchModelTexAsync(modelKey) {
        if (!modelKey || modelKey.startsWith("proj_") || modelKey.includes("rallypoint") ||
            modelKey === "cache" || modelKey === "vehicle_dummy" ||
            this.pendingTexFetches.has(modelKey) || this.failedTexModels.has(modelKey)) return;
        const gpuMesh = this.gpuMeshCache[modelKey];
        if (!gpuMesh || gpuMesh.texReady || gpuMesh.hasTex === false || gpuMesh.isNullMesh) return;

        this.pendingTexFetches.add(modelKey);
        try {
            const resp = await fetch(`models_3d_tex/${modelKey}.json?v=5.0_soldiers_fix`);
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
            const resp = await fetch(`models_3d/${modelKey}.json?v=16.0_soldiers_fix`);
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
            const allV = isMulti ? data.hull.v.concat(data.turret.v) : (data.v || []);
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
        if (!player) return `soldier_${stance}`;
        
        // Team 1 is OpFor (Red), Team 2 is BluFor (Blue)
        let rawFaction = (player.team == 1 ? (window.OpForTeam || 'ru') : (window.BluForTeam || 'us'));
        let cleanFaction = this.normalizeFaction(rawFaction);

        let kitSlot = 2; // Default to standard Rifleman (Fusilero)
        const kit = (player.kit || '').toLowerCase();
        if (player.isSquadLeader || kit.includes('officer') || kit.includes('sl') || kit.includes('lead')) {
            kitSlot = 1; // Officer / Squad Leader
        } else if (kit.includes('medic')) {
            kitSlot = 3; // Medic
        } else if (kit.includes('support') || kit.includes('ar') || kit.includes('mg') || kit.includes('autorifleman')) {
            kitSlot = 4; // Support / Automatic Rifleman
        } else if (kit.includes('lat') || kit.includes('hat') || kit.includes('at') || kit.includes('rpg') || kit.includes('smaw')) {
            kitSlot = 5; // Anti-Tank
        } else if (kit.includes('marksman') || kit.includes('sniper')) {
            kitSlot = 6; // Marksman / Sniper
        } else {
            kitSlot = 2; // Standard Rifleman
        }

        return `soldier_pr_${cleanFaction}_soldier${kitSlot}_${stance}`;
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

    _getElevatedEntityY(rawObjY, groundY) {
        const objY = (typeof rawObjY === "number") ? rawObjY : parseFloat(rawObjY);
        return (Number.isFinite(objY) && objY > groundY + 0.25) ? objY : groundY;
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
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        this._xrayQueue = isWallhack ? [] : null;
        this._inXrayPass = false;
        this._shadowCasters = [];

        // Bind per-frame sun direction & shadow map once on unit 5
        const sunDir = (typeof renderer3d.getMapSunDirection === "function") ? renderer3d.getMapSunDirection() : [0.4508, 0.8515, -0.3005];
        const useShadows = !!(renderer3d.shadowsActiveThisFrame && renderer3d.shadowDepthTex);
        gl.useProgram(this.program);
        if (this.uSunDir !== null) gl.uniform3f(this.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
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
        if (!hasLiveDemoEntities && this.mapSpawnEntities.length > 0) {
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
        // 2. Render Live Demo Vehicles (Dynamic Terrain Following: Pitch, Roll & Altitude)
        // ---------------------------------------------------------------------
        if (typeof AllVehicles !== "undefined") {
            const showEmptyVehicles = (typeof options_DrawEmptyVehicles !== "undefined") ? options_DrawEmptyVehicles : true;
            for (const vId in AllVehicles) {
                const v = AllVehicles[vId];
                if (!v) continue;
                if (!showEmptyVehicles && (!v.Passengers || v.Passengers.size === 0)) continue;

                let posX = (typeof v.getX === "function") ? v.getX() : v.X;
                let posY = (typeof v.getY === "function") ? v.getY() : (v.Y || 0);
                let posZ = (typeof v.getZ === "function") ? v.getZ() : v.Z;

                // Fallback to raw coordinates
                if (posX == null || isNaN(posX)) posX = v.X;
                if (posZ == null || isNaN(posZ)) posZ = v.Z;
                if (posY == null || isNaN(posY)) posY = v.Y || 0;

                if (posX == null || isNaN(posX) || posZ == null || isNaN(posZ)) continue;
                if (v.isClimbingVehicle) continue;

                const meshKey = this.getVehicleMeshKey(v);
                if (!meshKey) continue;

                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }
                if (activeMesh.isNullMesh) continue;

                const groundOffset = (typeof activeMesh.groundOffset === "number") ? activeMesh.groundOffset : 0.0;
                const halfLen = Math.max(1.5, Math.min(4.5, (activeMesh.length || 6.0) * 0.40));
                const halfWidth = Math.max(0.8, Math.min(2.2, (activeMesh.width || 2.8) * 0.40));

                const rotDeg = (typeof v.getRotation === "function") ? v.getRotation() : (v.rotation || 0);
                const yawRad = -(rotDeg * Math.PI / 180);
                const gameRad = (rotDeg * Math.PI / 180);

                // 2D Game Forward and Right vectors (0 deg = North +Z, 90 deg = East +X)
                const fGameX = Math.sin(gameRad);
                const fGameZ = Math.cos(gameRad);
                const rGameX = fGameZ;
                const rGameZ = -fGameX;

                let targetY = posY;
                let targetPitch = 0.0;
                let targetRoll = 0.0;

                const isDeployable = this._isDeployableOrTurret(meshKey);
                const hasHm = (typeof heightmap !== "undefined" && heightmap && heightmap.initialized);
                const hasBh = (typeof buildingHeightmap !== "undefined" && buildingHeightmap && buildingHeightmap.initialized && typeof buildingHeightmap.getSupportSurfaceY === "function");

                if (isDeployable) {
                    // Deployable Stationary Weapons sit firmly at ground/structure height without chassis tilt
                    const supportCenter = (hasHm || hasBh) ? this._sampleVehicleSupportY(posX, posY, posZ, hasHm, hasBh, true) : posY;
                    targetY = ((posY <= supportCenter + 2.4) ? supportCenter : posY) + groundOffset;
                    targetPitch = 0.0;
                    targetRoll = 0.0;
                } else if (hasHm || hasBh) {
                    const groundCenter = hasHm ? heightmap.getHeightFromCoords(posX, posZ) : posY;
                    const supportCenter = this._sampleVehicleSupportY(posX, posY, posZ, hasHm, hasBh, true);

                    if (!v.isFlyingVehicle) {
                        if (posY <= supportCenter + 2.4) {
                            // Vehicle is grounded on terrain or bridge/structure deck (clamp directly, ignore BF2 chassis-origin +1m offset)
                            const onStructure = (supportCenter > groundCenter + 0.35);
                            const pitchSampleHalfL = Math.max(2.0, halfLen);
                            const rollSampleHalfW = Math.max(1.25, halfWidth);

                            const frontLeftY = this._sampleVehicleSupportY(posX + fGameX * pitchSampleHalfL - rGameX * rollSampleHalfW, posY, posZ + fGameZ * pitchSampleHalfL - rGameZ * rollSampleHalfW, hasHm, hasBh, onStructure);
                            const frontRightY = this._sampleVehicleSupportY(posX + fGameX * pitchSampleHalfL + rGameX * rollSampleHalfW, posY, posZ + fGameZ * pitchSampleHalfL + rGameZ * rollSampleHalfW, hasHm, hasBh, onStructure);
                            const rearLeftY = this._sampleVehicleSupportY(posX - fGameX * pitchSampleHalfL - rGameX * rollSampleHalfW, posY, posZ - fGameZ * pitchSampleHalfL - rGameZ * rollSampleHalfW, hasHm, hasBh, onStructure);
                            const rearRightY = this._sampleVehicleSupportY(posX - fGameX * pitchSampleHalfL + rGameX * rollSampleHalfW, posY, posZ - fGameZ * pitchSampleHalfL + rGameZ * rollSampleHalfW, hasHm, hasBh, onStructure);

                            const avgFront = (frontLeftY + frontRightY) * 0.5;
                            const avgRear = (rearLeftY + rearRightY) * 0.5;
                            const avgRight = (frontRightY + rearRightY) * 0.5;
                            const avgLeft = (frontLeftY + rearLeftY) * 0.5;

                            const supportAvgY = (supportCenter * 0.5) + ((avgFront + avgRear) * 0.25);
                            targetY = supportAvgY + groundOffset;

                            // Target Pitch and Roll from stabilized 4-corner slope
                            targetPitch = Math.atan2(avgFront - avgRear, pitchSampleHalfL * 2.0);
                            targetRoll = Math.atan2(avgRight - avgLeft, rollSampleHalfW * 2.0);
                            if (Math.abs(targetRoll) < 0.015) targetRoll = 0.0;
                        } else {
                            // Genuinely airborne / falling off cliff
                            targetY = posY + groundOffset;
                        }
                    } else {
                        // Flying vehicle (Helicopter, Jet, Drone)
                        const minAirY = supportCenter + groundOffset;
                        if (targetY <= minAirY + 1.2) {
                            // Landed on runway, terrain, or carrier/helipad deck
                            const onStructure = (supportCenter > groundCenter + 0.35);
                            targetY = minAirY;
                            const frontY = this._sampleVehicleSupportY(posX + fGameX * halfLen, posY, posZ + fGameZ * halfLen, hasHm, hasBh, onStructure);
                            const rearY = this._sampleVehicleSupportY(posX - fGameX * halfLen, posY, posZ - fGameZ * halfLen, hasHm, hasBh, onStructure);
                            targetPitch = Math.atan2(frontY - rearY, halfLen * 2.0);
                        }
                    }
                } else {
                    targetY += groundOffset;
                }

                // Clamp angles to realistic maximum limits (max 35 deg pitch, 25 deg roll)
                targetPitch = Math.max(-0.61, Math.min(0.61, targetPitch));
                targetRoll = Math.max(-0.44, Math.min(0.44, targetRoll));

                // Time-based heavy suspension damping filter (eliminates FPS-dependent jitter & side-to-side wobble)
                if (v._smoothPitch == null || isNaN(v._smoothPitch)) v._smoothPitch = targetPitch;
                else v._smoothPitch = v._smoothPitch * (1.0 - pitchAlpha) + targetPitch * pitchAlpha;

                if (v._smoothRoll == null || isNaN(v._smoothRoll)) v._smoothRoll = targetRoll;
                else v._smoothRoll = v._smoothRoll * (1.0 - rollAlpha) + targetRoll * rollAlpha;

                if (v._smoothY == null || isNaN(v._smoothY) || Math.abs(targetY - v._smoothY) > 6.0) v._smoothY = targetY;
                else v._smoothY = v._smoothY * (1.0 - altAlpha) + targetY * altAlpha;

                const isSelected = (typeof SelectedVehicle !== "undefined" && SelectedVehicle == v.id);
                // Team 1 is OpFor/Red, Team 2 is BluFor/Blue
                let teamCol = (v.team == 1) ? this.colorTeam1 : this.colorTeam2;

                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, v._smoothY, -posZ]);
                mat4.rotateY(modelMatrix, modelMatrix, yawRad);
                if (Math.abs(v._smoothPitch) > 0.001) mat4.rotateX(modelMatrix, modelMatrix, v._smoothPitch);
                if (Math.abs(v._smoothRoll) > 0.001) mat4.rotateZ(modelMatrix, modelMatrix, v._smoothRoll);

                // Compute relative turret yaw (in radians) from the main turret gunner seat
                const turretRelYawRad = activeMesh.isMultiPart ? this.getVehicleTurretRelYawRad(v, rotDeg) : 0.0;

                // Render Vehicle Model
                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, isSelected, turretRelYawRad);
            }
        }

        // ---------------------------------------------------------------------
        // 3. Render Live Demo Soldiers (Alive with Stances & Dead in T-Pose)
        // ---------------------------------------------------------------------
        if (typeof AllPlayers !== "undefined") {
            for (const pId in AllPlayers) {
                const p = AllPlayers[pId];
                if (!p || p.isJoining || (p.vehicleid && p.vehicleid >= 0)) continue;

                let posX = (typeof p.getX === "function") ? p.getX() : p.X;
                let posY = (typeof p.getY === "function") ? p.getY() : (p.Y || 0);
                let posZ = (typeof p.getZ === "function") ? p.getZ() : p.Z;

                if (posX == null || isNaN(posX)) posX = p.X;
                if (posZ == null || isNaN(posZ)) posZ = p.Z;
                if (posY == null || isNaN(posY)) posY = p.Y || 0;

                if (posX == null || isNaN(posX) || posZ == null || isNaN(posZ)) continue;

                let terrainH = 0;
                if (typeof heightmap !== "undefined") {
                    terrainH = heightmap.getHeightFromCoords(posX, posZ);
                }

                // Resolve supporting surface (terrain vs elevated walkable roof/bridge/bunker/interior floor)
                let supportY = terrainH;
                if (typeof buildingHeightmap !== "undefined" && buildingHeightmap.initialized && typeof buildingHeightmap.getSupportSurfaceY === "function") {
                    supportY = buildingHeightmap.getSupportSurfaceY(posX, posY, posZ, terrainH);
                }
                const relSurfaceY = posY - supportY;

                const isSelected = (typeof SelectedPlayer !== "undefined" && SelectedPlayer == p.id);
                const isSquad = (typeof SelectedSquadTeam !== "undefined" && typeof SelectedSquadNumber !== "undefined" &&
                                 p.team == SelectedSquadTeam && p.squad == SelectedSquadNumber);
                const rotDeg = (typeof p.getRotation === "function") ? p.getRotation() : (p.rotation || 0);

                if (!p.isAlive) {
                    // -------------------------------------------------------------
                    // A. Dead Soldier: Lying Flat on Surface/Terrain, Tinted Gray
                    // -------------------------------------------------------------
                    const deadMeshKey = 'soldier_stand';
                    let activeMesh = this.gpuMeshCache[deadMeshKey];
                    if (!activeMesh) {
                        this.fetchModelAsync(deadMeshKey);
                        continue;
                    }

                    // rotateX(+PI/2) flips local +Z into -Y, so lift by front chest/arm thickness above floor
                    const deadFloorY = Math.max(supportY, posY - 0.85);
                    const deadLift = (typeof activeMesh.maxZ === "number" && activeMesh.maxZ > 0.1)
                        ? Math.min(0.48, Math.max(0.25, activeMesh.maxZ * 0.60))
                        : 0.25;
                    const deadTeamCol = (p.team === 1) ? this.colorDeadTeam1 : this.colorDeadTeam2;
                    const modelMatrix = mat4.create();
                    mat4.translate(modelMatrix, modelMatrix, [posX, deadFloorY + deadLift, -posZ]);
                    mat4.rotateY(modelMatrix, modelMatrix, -(rotDeg * Math.PI / 180));
                    mat4.rotateX(modelMatrix, modelMatrix, Math.PI / 2); // Rotate 90 deg flat onto terrain/deck/roof

                    this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, deadTeamCol, isSelected, 0.0, false);
                } else {
                    // -------------------------------------------------------------
                    // B. Alive Soldier: Authentic Baked Meshes with Kits & Weapons
                    // 1. soldier_stand  (De pie con fusil, casco y chaleco)
                    // 2. soldier_crouch (Agachado táctico con fusil, casco y chaleco)
                    // 3. soldier_prone  (Tirado cuerpo a tierra con fusil y chaleco)
                    // -------------------------------------------------------------
                    let teamCol = isSquad ? this.colorSquad : ((p.team == 1) ? this.colorTeam1 : this.colorTeam2);

                    const spdKmh = (typeof getEntitySpeedKmh === "function") ? getEntitySpeedKmh(p) : 0;

                    let stance = "stand";
                    if (spdKmh >= 6.0) {
                        // Corriendo o caminando rápido: Siempre de pie erguido
                        stance = "stand";
                    } else if (spdKmh >= 1.8) {
                        // Movimiento táctico
                        stance = (relSurfaceY <= 0.65) ? "crouch" : "stand";
                    } else {
                        // Estacionario o reptando muy lento (< 1.8 km/h):
                        if (relSurfaceY <= 0.25) {
                            stance = "prone";   // Tirado / Acostado en el suelo
                        } else if (relSurfaceY <= 0.65) {
                            stance = "crouch";  // Agachado táctico
                        } else {
                            stance = "stand";   // De pie
                        }
                    }

                    // Stance-calibrated BF2 pelvis/root offset so crouching/proning on elevated slabs stays flush
                    const stancePelvisOffset = (stance === "prone") ? 0.15 : ((stance === "crouch") ? 0.50 : 0.85);
                    const floorY = Math.max(supportY, posY - stancePelvisOffset);

                    const meshKey = this.getSoldierMeshKey(p, stance);
                    let activeMesh = this.gpuMeshCache[meshKey];
                    if (!activeMesh) {
                        this.fetchModelAsync(meshKey);
                        // Fallback to universal stance mesh or base stand mesh while loading
                        activeMesh = this.gpuMeshCache[`soldier_${stance}`] || this.gpuMeshCache['soldier_stand'];
                        if (!activeMesh) {
                            this.fetchModelAsync(`soldier_${stance}`);
                            this.fetchModelAsync('soldier_stand');
                            continue;
                        }
                    }

                    const modelLift = (typeof activeMesh.groundOffset === "number") ? activeMesh.groundOffset : 0.0;
                    const modelMatrix = mat4.create();
                    mat4.translate(modelMatrix, modelMatrix, [posX, floorY + modelLift, -posZ]);
                    mat4.rotateY(modelMatrix, modelMatrix, -(rotDeg * Math.PI / 180));

                    this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, isSelected);
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
                const baseElevY = this._getElevatedEntityY(fob.Y, groundY);

                let isInsurgentFaction = (typeof window.OpForTeam !== "undefined") && 
                    ['hamas', 'taliban', 'meinsurgent', 'fsa', 'arf'].includes(window.OpForTeam.toLowerCase());
                let meshKey = (fob.team === 1 && isInsurgentFaction) ? "fob_insurgent_hideout" : "fob_deployable_firebase";

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
                const baseElevY = this._getElevatedEntityY(rally.Y, groundY);

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
                const baseElevY = this._getElevatedEntityY(cache.Y, groundY);

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
        // 7. Render Active Projectiles in 3D (AllProj: RPGs, Missiles, Shells, Grenades, Mines)
        // ---------------------------------------------------------------------
        if (typeof AllProj !== "undefined") {
            for (const projId in AllProj) {
                const proj = AllProj[projId];
                if (!proj) continue;

                let posX = (typeof proj.getX === "function") ? proj.getX() : proj.X;
                let posY = (typeof proj.getY === "function") ? proj.getY() : (proj.Y || 0);
                let posZ = (typeof proj.getZ === "function") ? proj.getZ() : proj.Z;

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
                const rotDeg = (typeof proj.getYaw === "function") ? proj.getYaw() : (proj.yaw || proj.rotation || 0);

                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, posY, -posZ]);
                mat4.rotateY(modelMatrix, modelMatrix, -(rotDeg * Math.PI / 180));

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, false, 0.0, false);
            }
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

    renderSingleMesh(gpuMesh, modelMatrix, viewMatrix, projectionMatrix, teamColor, isSelected, turretRelYawRad = 0.0, allowTexture = true) {
        const gl = renderer3d.gl;
        if (!gl || !gpuMesh) return;

        const wantTex = allowTexture && (typeof options_FactionTextures !== "undefined" ? options_FactionTextures : false);
        if (wantTex && gpuMesh.modelKey && !gpuMesh.texReady) {
            this.fetchModelTexAsync(gpuMesh.modelKey);
        }

        if (gpuMesh.isMultiPart) {
            if (gpuMesh.hull) {
                this.renderSingleMesh(gpuMesh.hull, modelMatrix, viewMatrix, projectionMatrix, teamColor, isSelected, 0.0, allowTexture);
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
                this.renderSingleMesh(gpuMesh.turret, turretMatrix, viewMatrix, projectionMatrix, teamColor, isSelected, 0.0, allowTexture);
            }
            return;
        }

        const useTex = wantTex && gpuMesh.texReady && gpuMesh.uvBuffer && gpuMesh.glTexture;
        const activeVBuf = (useTex && gpuMesh.texVertexBuffer) ? gpuMesh.texVertexBuffer : gpuMesh.vertexBuffer;
        const activeIBuf = (useTex && gpuMesh.texIndexBuffer) ? gpuMesh.texIndexBuffer : gpuMesh.indexBuffer;
        const activeICount = (useTex && gpuMesh.texIndexCount) ? gpuMesh.texIndexCount : gpuMesh.indexCount;

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
        if (this._xrayQueue && !this._inXrayPass) {
            this._xrayQueue.push({
                mesh: gpuMesh,
                modelMatrix: modelMatrix,
                teamColor: teamColor,
                isSelected: isSelected
            });
        }

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
            gl.bindTexture(gl.TEXTURE_2D, gpuMesh.glTexture);
            if (this.uEntityTex !== null) gl.uniform1i(this.uEntityTex, 0);
            if (this.uUseTexture !== null) gl.uniform1i(this.uUseTexture, 1);
        } else {
            if (this.aVertexUV !== -1 && this.aVertexUV !== null) {
                gl.disableVertexAttribArray(this.aVertexUV);
                gl.vertexAttrib2f(this.aVertexUV, 0.0, 0.0);
            }
            if (this.uUseTexture !== null) gl.uniform1i(this.uUseTexture, 0);
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
