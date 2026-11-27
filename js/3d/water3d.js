// Part of RealityTracker Demo Analyser
// Lightweight, camera-stable 3D Water Surface Renderer using exact heightmap depth encoding,
// shallow-to-deep PR water color absorption, Fresnel sky reflection, sun specular, and zero-drift shorelines.

"use strict";

var water3dRenderer;

class Water3dRenderer extends Initializable {
    dataReady = true;
    initialized = false;

    program = null;
    aPos = -1;
    uProj = null;
    uView = null;
    uCamPos = null;
    uSunDir = null;
    uWaterColor = null;
    uSkyColor = null;
    uSeaLevel = null;
    uHalfTerrain = null;
    uInvScaleX = null;
    uInvScaleZ = null;
    uHmapSize = null;
    uTime = null;
    uIsTopDown = null;
    uDepthTex = null;
    uDodSampler = null;
    uUseDodOverlay = null;

    vbo = null;
    ibo = null;
    indexCount = 0;
    depthTex = null;

    _builtMapKey = null;
    _builtHeightDataView = null;
    _hasActiveWater = false;
    _seaLevel = 0.0;
    _waterColor = [0.15, 0.25, 0.35];
    _hasOuterOcean = false;
    _halfTerrain = 1024.0;
    _scaleX = 2.0;
    _scaleZ = 2.0;
    _hmapSize = 513;

    getIsDataReady() {
        return true;
    }

    init() {
        if (this.initialized) return true;
        const gl = renderer3d.gl;
        if (!gl) return false;

        const vsSource = `#version 300 es
            precision highp float;
            in vec3 aPosition;
            uniform mat4 uProjectionMatrix;
            uniform mat4 uViewMatrix;
            out vec3 vWorldPos;
            void main() {
                vWorldPos = aPosition;
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(aPosition, 1.0);
            }
        `;

        const fsSource = `#version 300 es
            precision highp float;
            precision highp int;
            precision highp sampler2D;

            in vec3 vWorldPos;
            out vec4 fragColor;

            uniform vec3 uCamPos;
            uniform vec3 uSunDir;
            uniform vec3 uWaterColor;
            uniform vec3 uSkyColor;
            uniform float uSeaLevel;
            uniform float uHalfTerrain;
            uniform float uInvScaleX;
            uniform float uInvScaleZ;
            uniform float uHmapSize;
            uniform float uTime;
            uniform int uIsTopDown;
            uniform sampler2D uDepthTex;
            uniform sampler2D uDodSampler;
            uniform int uUseDodOverlay;

            // Domain-warped 6-wave irrational-frequency ripple normal (zero texture reads, non-repeating)
            vec3 calcWaveNormal(vec2 p, float t, float strength) {
                if (strength <= 0.001) return vec3(0.0, 1.0, 0.0);
                // Slow large-scale domain warp breaks up periodic grid patterns at medium/high altitude
                vec2 warp = vec2(
                    sin(p.x * 0.031 + p.y * 0.047 + t * 0.23) * 2.4 + cos(p.y * 0.019 - t * 0.17) * 1.8,
                    cos(p.x * 0.043 - p.y * 0.029 - t * 0.19) * 2.4 + sin(p.x * 0.021 + t * 0.15) * 1.8
                );
                vec2 pw = p + warp;

                // 6 directional swells & ripples with mutually irrational frequencies/angles
                float a1 = pw.x * 0.1731 + pw.y * 0.1297 + t * 0.72;
                float a2 = -pw.x * 0.1387 + pw.y * 0.2193 - t * 0.59;
                float a3 = pw.x * 0.3119 - pw.y * 0.2741 + t * 0.91;
                float a4 = pw.x * 0.4873 + pw.y * 0.3821 - t * 1.13;
                float a5 = -pw.x * 0.6317 + pw.y * 0.5179 + t * 1.37;
                float a6 = pw.x * 0.2413 + pw.y * 0.7619 - t * 1.05;

                float dx = cos(a1) * 0.1731 * 0.34
                         - cos(a2) * 0.1387 * 0.30
                         + cos(a3) * 0.3119 * 0.17
                         + cos(a4) * 0.4873 * 0.10
                         - cos(a5) * 0.6317 * 0.06
                         + cos(a6) * 0.2413 * 0.07;
                float dz = cos(a1) * 0.1297 * 0.34
                         + cos(a2) * 0.2193 * 0.30
                         - cos(a3) * 0.2741 * 0.17
                         + cos(a4) * 0.3821 * 0.10
                         + cos(a5) * 0.5179 * 0.06
                         + cos(a6) * 0.7619 * 0.07;

                return normalize(vec3(-dx * strength, 1.0, -dz * strength));
            }

            void main() {
                float fx = (vWorldPos.x + uHalfTerrain) * uInvScaleX;
                float fz = (vWorldPos.z + uHalfTerrain) * uInvScaleZ;
                float maxCoord = uHmapSize - 1.0;

                bool inMap = (fx >= 0.0 && fx <= maxCoord && fz >= 0.0 && fz <= maxCoord);

                float shoreDepth = 1.5;
                float deepDepth = 14.0;
                if (inMap) {
                    vec2 uv = vec2((fx + 0.5) / uHmapSize, (fz + 0.5) / uHmapSize);
                    vec2 dTex = texture(uDepthTex, uv).rg;
                    shoreDepth = dTex.r * 2.0 - 0.5;
                    if (shoreDepth <= 0.005) discard;
                    deepDepth = dTex.g * 14.0;
                }

                vec3 viewVec = uCamPos - vWorldPos;
                float camDist = length(viewVec);
                vec3 V = viewVec / max(camDist, 1e-4);

                // Distance-damped subtle ripples (prevents aliasing far away and keeps 3D TOP super calm)
                float distFade = smoothstep(850.0, 45.0, camDist);
                float shoreCalm = smoothstep(0.01, 0.35, shoreDepth);
                float waveAmp = ((uIsTopDown == 1) ? 0.16 : 0.42) * distFade * shoreCalm;
                vec3 N = calcWaveNormal(vWorldPos.xz, uTime, waveAmp);
                if (V.y < 0.0) N = -N;

                // Shallow-to-deep authentic PR water color absorption
                vec3 shallowCol = mix(uWaterColor * 1.25 + vec3(0.035, 0.035, 0.02), uWaterColor, 0.42);
                vec3 deepCol = uWaterColor * 0.66;
                float depthT = smoothstep(0.0, 4.2, deepDepth);
                vec3 waterBody = mix(shallowCol, deepCol, depthT);

                // Subtle sky ambient modulation from wave slopes
                float skyLuma = dot(uSkyColor, vec3(0.299, 0.587, 0.114));
                float sunScale = smoothstep(0.08, 0.42, skyLuma); // Dim reflections/specular on night layers

                // Schlick Fresnel sky reflection (subtle in top-down, natural at grazing angles in 3D FREE)
                float NdotV = max(dot(N, V), 0.0);
                float fresnel = (0.04 + 0.52 * pow(1.0 - NdotV, 4.0)) * ((uIsTopDown == 1) ? 0.45 : 1.0);
                vec3 skyRefl = mix(uWaterColor * 0.85, uSkyColor, 0.72);
                vec3 col = mix(waterBody, skyRefl, fresnel * shoreCalm);

                // Gentle sun-aligned diffuse & specular shimmer (distance specular-AA widens highlight smoothly)
                vec3 L = normalize(uSunDir);
                vec3 H = normalize(L + V);
                float specExp = mix(88.0, 26.0, smoothstep(80.0, 750.0, camDist));
                float specGain = mix(0.42, 0.20, smoothstep(80.0, 750.0, camDist));
                float spec = pow(max(dot(N, H), 0.0), specExp) * specGain * sunScale * distFade * shoreCalm;
                if (uIsTopDown == 1) spec *= 0.25;
                col += vec3(1.0, 0.97, 0.90) * spec;

                // Subtle shoreline wet-edge transition
                float foamBand = smoothstep(0.005, 0.06, shoreDepth) * (1.0 - smoothstep(0.06, 0.24, shoreDepth));
                col += vec3(0.06, 0.06, 0.05) * foamBand * sunScale;

                // Exact concave DOD overlay (shared with TerrainRenderer -> zero Z-fighting, 1:1 with 2D map)
                if (uUseDodOverlay == 1 && inMap) {
                    vec2 dodUv = vec2(fx / maxCoord, fz / maxCoord);
                    vec4 dod = texture(uDodSampler, dodUv);
                    if (dod.a > 0.004) {
                        vec3 dodColor = dod.rgb / max(dod.a, 0.004);
                        col = mix(col, dodColor, 0.24 * dod.a);
                    }
                }

                // Smooth alpha feathering at exact heightmap shoreline -> zero Z-fighting, zero drift
                float edgeAlpha = inMap ? smoothstep(0.005, 0.26, shoreDepth) : 1.0;
                float bodyAlpha = inMap ? mix(0.56, 0.93, smoothstep(0.0, 3.0, deepDepth)) : 0.97;
                float finalAlpha = edgeAlpha * clamp(bodyAlpha + fresnel * 0.28, 0.0, 0.98);

                fragColor = vec4(col, finalAlpha);
            }
        `;

        const vs = renderer3d.loadShader(gl.VERTEX_SHADER, vsSource);
        const fs = renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return false;

        const p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            console.error("WATER3D: Shader link failed:", gl.getProgramInfoLog(p));
            return false;
        }

        this.program = p;
        this.aPos = gl.getAttribLocation(p, "aPosition");
        this.uProj = gl.getUniformLocation(p, "uProjectionMatrix");
        this.uView = gl.getUniformLocation(p, "uViewMatrix");
        this.uCamPos = gl.getUniformLocation(p, "uCamPos");
        this.uSunDir = gl.getUniformLocation(p, "uSunDir");
        this.uWaterColor = gl.getUniformLocation(p, "uWaterColor");
        this.uSkyColor = gl.getUniformLocation(p, "uSkyColor");
        this.uSeaLevel = gl.getUniformLocation(p, "uSeaLevel");
        this.uHalfTerrain = gl.getUniformLocation(p, "uHalfTerrain");
        this.uInvScaleX = gl.getUniformLocation(p, "uInvScaleX");
        this.uInvScaleZ = gl.getUniformLocation(p, "uInvScaleZ");
        this.uHmapSize = gl.getUniformLocation(p, "uHmapSize");
        this.uTime = gl.getUniformLocation(p, "uTime");
        this.uIsTopDown = gl.getUniformLocation(p, "uIsTopDown");
        this.uDepthTex = gl.getUniformLocation(p, "uDepthTex");
        this.uDodSampler = gl.getUniformLocation(p, "uDodSampler");
        this.uUseDodOverlay = gl.getUniformLocation(p, "uUseDodOverlay");

        this.initialized = true;
        return true;
    }

    _resolveMapKey() {
        if (typeof window.CurrentMapName !== "undefined" && window.CurrentMapName) {
            return String(window.CurrentMapName).toLowerCase();
        }
        if (typeof buildingHeightmap !== "undefined" && buildingHeightmap && buildingHeightmap._mapKey) {
            return String(buildingHeightmap._mapKey).toLowerCase();
        }
        if (typeof MapName !== "undefined" && MapName) {
            return String(MapName).toLowerCase();
        }
        return "";
    }

    _buildForMap(mapKey) {
        const gl = renderer3d.gl;
        if (!gl || !heightmap || !heightmap.initialized) return;

        this._builtMapKey = mapKey;
        this._builtHeightDataView = heightmap.heightdataview;
        this._hasActiveWater = false;
        this.indexCount = 0;

        if (!mapKey || typeof PR_WATER_DATABASE === "undefined" || !PR_WATER_DATABASE[mapKey]) {
            return;
        }
        const wInfo = PR_WATER_DATABASE[mapKey];
        if (!wInfo.hasWater || !(typeof wInfo.seaLevel === "number") || wInfo.seaLevel <= 0.0) {
            return;
        }

        const seaLevel = wInfo.seaLevel;
        this._seaLevel = seaLevel;
        this._waterColor = [
            (wInfo.color && wInfo.color[0] != null) ? Number(wInfo.color[0]) : 0.15,
            (wInfo.color && wInfo.color[1] != null) ? Number(wInfo.color[1]) : 0.25,
            (wInfo.color && wInfo.color[2] != null) ? Number(wInfo.color[2]) : 0.35,
        ];

        const hSize = heightmap.size || 513;
        const scaleX = heightmap.scalex || 2.0;
        const scaleZ = heightmap.scalez || 2.0;
        const halfT = (heightmap.terrainSize || ((hSize - 1) * scaleX)) * 0.5;

        this._hmapSize = hSize;
        this._scaleX = scaleX;
        this._scaleZ = scaleZ;
        this._halfTerrain = halfT;

        // 1. Encode exact heightmap water depth into RG8 texture:
        //    R = signed depth in [-0.5m, +1.5m] (7.8mm shoreline precision, hardware LINEAR)
        //    G = deep water depth in [0m, 14.0m]
        // Also measure perimeter submergence to decide whether to generate an outer ocean skirt.
        const texData = new Uint8Array(hSize * hSize * 2);
        let borderTotal = 0;
        let borderUnder = 0;
        let ptr = 0;

        for (let j = 0; j < hSize; j++) {
            const safeRow = (hSize - 1) - j;
            const isBorderRow = (j === 0 || j === hSize - 1);
            for (let i = 0; i < hSize; i++) {
                const terrainY = heightmap.getHeightFromOffset(safeRow, i);
                const depth = seaLevel - terrainY;

                const rNorm = Math.max(0.0, Math.min(1.0, (depth + 0.5) * 0.5));
                const gNorm = Math.max(0.0, Math.min(1.0, depth / 14.0));
                texData[ptr++] = Math.round(rNorm * 255.0);
                texData[ptr++] = Math.round(gNorm * 255.0);

                if (isBorderRow || i === 0 || i === hSize - 1) {
                    borderTotal++;
                    if (depth > 0.05) borderUnder++;
                }
            }
        }

        this._hasOuterOcean = (borderTotal > 0) && ((borderUnder / borderTotal) >= 0.10);

        if (!this.depthTex) {
            this.depthTex = gl.createTexture();
        }
        gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, hSize, hSize, 0, gl.RG, gl.UNSIGNED_BYTE, texData);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        // 2. Build subdivided static water mesh (eliminates 24km-triangle perspective depth drift!)
        //    Slight +1.5cm lift avoids coplanar grazing Z-fighting on ultra-flat riverbanks while keeping
        //    bridges, piers, and boats cleanly above water.
        const waterY = seaLevel + 0.015995;
        const verts = [];
        const indices = [];

        const addSubdividedGrid = (xMin, xMax, zMin, zMax, nx, nz) => {
            const baseVert = verts.length / 3;
            for (let rz = 0; rz <= nz; rz++) {
                const z = zMin + (zMax - zMin) * (rz / nz);
                for (let cx = 0; cx <= nx; cx++) {
                    const x = xMin + (xMax - xMin) * (cx / nx);
                    verts.push(x, waterY, z);
                }
            }
            const stride = nx + 1;
            for (let rz = 0; rz < nz; rz++) {
                for (let cx = 0; cx < nx; cx++) {
                    const i0 = baseVert + rz * stride + cx;
                    const i1 = i0 + 1;
                    const i2 = i0 + stride;
                    const i3 = i2 + 1;
                    indices.push(i0, i2, i1, i1, i2, i3);
                }
            }
        };

        // Playable map interior: 32x32 grid (~32-64m cell size -> rock-solid perspective Z/W!)
        addSubdividedGrid(-halfT, halfT, -halfT, halfT, 32, 32);

        // Coastal/island maps: 4 subdivided outer ocean aprons reaching 14km out to the fog horizon
        if (this._hasOuterOcean) {
            const outerR = Math.max(halfT * 6.0, 14044.25);
            // North & South full-width strips
            addSubdividedGrid(-outerR, outerR, -outerR, -halfT, 16, 8);
            addSubdividedGrid(-outerR, outerR, halfT, outerR, 16, 8);
            // West & East inner-height strips
            addSubdividedGrid(-outerR, -halfT, -halfT, halfT, 8, 8);
            addSubdividedGrid(halfT, outerR, -halfT, halfT, 8, 8);
        }

        if (!this.vbo) this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

        if (!this.ibo) this.ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        this.indexCount = indices.length;
        this._hasActiveWater = true;

        console.log(`[Water3dRenderer] Ready for ${mapKey} | seaLevel=${seaLevel.toFixed(1)}m | outerOcean=${this._hasOuterOcean} | tris=${indices.length / 3}`);
    }

    draw() {
        if (!this.initialized || !this.program) return;
        if (typeof heightmap === "undefined" || !heightmap || !heightmap.initialized) return;

        const mapKey = this._resolveMapKey();
        if (!mapKey) return;
        if (mapKey !== this._builtMapKey || heightmap.heightdataview !== this._builtHeightDataView) {
            this._buildForMap(mapKey);
        }
        if (!this._hasActiveWater || this.indexCount === 0 || !this.depthTex) return;

        const gl = renderer3d.gl;
        gl.useProgram(this.program);

        const projMatrix = renderer3d.getCurrentProjectionMatrix();
        const viewMatrix = renderer3d.getCurrentViewMatrix();
        const sunDir = (typeof renderer3d.getMapSunDirection === "function")
            ? renderer3d.getMapSunDirection()
            : [0.45, 0.85, -0.30];
        const skyEntry = (typeof renderer3d.getActiveSkyEntry === "function")
            ? renderer3d.getActiveSkyEntry()
            : null;
        const skyCol = (skyEntry && Array.isArray(skyEntry.horizon) && skyEntry.horizon.length === 3)
            ? skyEntry.horizon
            : ((skyEntry && Array.isArray(skyEntry.fog) && skyEntry.fog.length === 3) ? skyEntry.fog : [0.55, 0.62, 0.70]);

        // Drive gentle wave motion from demo playback time -> smooth while playing, 100% frozen & stable when paused
        const simTime = (typeof CurrentTime === "number" && Number.isFinite(CurrentTime)) ? CurrentTime : 0.0;

        gl.uniformMatrix4fv(this.uProj, false, projMatrix);
        gl.uniformMatrix4fv(this.uView, false, viewMatrix);
        gl.uniform3f(this.uCamPos, renderer3d.cameraPos[0], renderer3d.cameraPos[1], renderer3d.cameraPos[2]);
        gl.uniform3f(this.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
        gl.uniform3f(this.uWaterColor, this._waterColor[0], this._waterColor[1], this._waterColor[2]);
        gl.uniform3f(this.uSkyColor, skyCol[0], skyCol[1], skyCol[2]);
        gl.uniform1f(this.uSeaLevel, this._seaLevel);
        gl.uniform1f(this.uHalfTerrain, this._halfTerrain);
        gl.uniform1f(this.uInvScaleX, 1.0 / Math.max(1e-4, this._scaleX));
        gl.uniform1f(this.uInvScaleZ, 1.0 / Math.max(1e-4, this._scaleZ));
        gl.uniform1f(this.uHmapSize, this._hmapSize);
        gl.uniform1f(this.uTime, simTime);
        gl.uniform1i(this.uIsTopDown, renderer3d.isTopDown ? 1 : 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
        gl.uniform1i(this.uDepthTex, 0);

        const useDod = !!(typeof terrainRenderer !== "undefined" && terrainRenderer && terrainRenderer.dodTexture && terrainRenderer.hasDodPolygons
            && (typeof options_DrawDOD === "undefined" || options_DrawDOD));
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, (useDod ? terrainRenderer.dodTexture : this.depthTex));
        if (this.uDodSampler !== null) gl.uniform1i(this.uDodSampler, 1);
        if (this.uUseDodOverlay !== null) gl.uniform1i(this.uUseDodOverlay, useDod ? 1 : 0);

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.CULL_FACE);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.enableVertexAttribArray(this.aPos);
        gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);

        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

        gl.disableVertexAttribArray(this.aPos);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
}

$(() => {
    water3dRenderer = new Water3dRenderer();
});
