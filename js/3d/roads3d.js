// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Ultra-Optimized WebGL2 Compiled Roads Renderer (PR RoadCompiled.fx style)
// Single VAO/VBO/IBO per map, prio-sorted merged GPU batches (3-12 draw calls/map),
// 16x Anisotropic Filtering, Dynamic Shadows, and Fog/AABB culling.

var roads3dRenderer;

class Roads3dRenderer extends Initializable {
    program = null;
    mapCache = new Map(); // mapKey -> { ready, vao, vbo, ibo, batches, ... }
    pendingMaps = new Set();
    texCache = new Map(); // "key|clampU" -> WebGLTexture
    pendingTex = new Set();
    dummyWhiteTex = null;
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

        // 1x1 neutral grey dummy texture for roads without a secondary detail map
        this.dummyWhiteTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.dummyWhiteTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([140, 140, 140, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, null);

        const vsSource = `#version 300 es
            precision highp float;
            layout(location = 0) in vec3 aPosition;
            layout(location = 1) in vec2 aUv0;
            layout(location = 2) in vec2 aUv1;
            layout(location = 3) in float aAlpha;

            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;

            out vec3 vWorldPos;
            out vec2 vUv0;
            out vec2 vUv1;
            out float vAlpha;

            void main() {
                // PR_ROAD_Y_BIAS (+12cm + polygonOffset clears coarse terrain triangles on steep 4km mountain slopes)
                vec3 wp = aPosition;
                wp.y += 0.12;
                vWorldPos = wp;
                // Unpack quantized int16 UVs (u0*1024, v0*16, u1*1024, v1*8 -> supports 2000+ road repeats with 0 overflow)
                vUv0 = vec2(aUv0.x * (1.0 / 1024.0), aUv0.y * (1.0 / 16.0));
                vUv1 = vec2(aUv1.x * (1.0 / 1024.0), aUv1.y * (1.0 / 8.0));
                vAlpha = aAlpha;
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(wp, 1.0);
            }
        `;

        const fsSource = `#version 300 es
            precision highp float;
            precision highp int;
            precision highp sampler2DShadow;

            in vec3 vWorldPos;
            in vec2 vUv0;
            in vec2 vUv1;
            in float vAlpha;

            uniform sampler2D uDetailMap0;
            uniform sampler2D uDetailMap1;
            uniform float uBlendFactor;
            uniform int uHasDetail1;
            uniform vec3 uCameraPos;
            uniform vec3 uLightTint;
            uniform vec3 uSunDir;
            uniform int uUsePrReflections;

            uniform mat4 uLightSpaceMatrix;
            uniform sampler2DShadow uShadowMap;
            uniform int uUseShadows;

            out vec4 fragColor;

            float sampleRoadShadow(vec3 worldPos) {
                vec4 ls = uLightSpaceMatrix * vec4(worldPos + vec3(0.0, 0.08, 0.0), 1.0);
                vec3 proj = (ls.xyz / ls.w) * 0.5 + 0.5;
                if (proj.x <= 0.002 || proj.x >= 0.998 || proj.y <= 0.002 || proj.y >= 0.998 || proj.z <= 0.0 || proj.z >= 1.0) {
                    return 1.0;
                }
                float edge = min(min(proj.x, 1.0 - proj.x), min(proj.y, 1.0 - proj.y));
                float edgeFade = smoothstep(0.0, 0.12, edge);
                float zRef = proj.z - 0.00035;
                float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
                float ca = cos(ang), sa = sin(ang);
                mat2 rot = mat2(ca, -sa, sa, ca);
                const float rad = 1.55 / 2048.0;
                float s = texture(uShadowMap, vec3(proj.xy, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2( 0.85217,  0.32419)) * rad, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2(-0.82292,  0.38165)) * rad, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2( 0.28898, -0.86354)) * rad, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2(-0.34467, -0.80801)) * rad, zRef));
                s *= 0.2;
                return mix(1.0, s, edgeFade);
            }

            void main() {
                vec4 d0 = texture(uDetailMap0, vUv0);
                float alpha = d0.a * clamp(vAlpha, 0.0, 1.0);
                if (alpha <= 0.015) discard;

                // Exact PR RoadCompiled.fx blending: lerp(Detail1(uv1 * 0.1), Detail0(uv0), _TexBlendFactor)
                vec3 rgb = d0.rgb;
                if (uHasDetail1 == 1) {
                    vec3 d1 = texture(uDetailMap1, vUv1 * 0.1).rgb;
                    rgb = mix(d1, d0.rgb, uBlendFactor);
                }

                // Match map lighting (day / dusk / night)
                rgb *= uLightTint;

                if (uUsePrReflections == 1) {
                    vec3 V = normalize(uCameraPos - vWorldPos);
                    vec3 sunDir = normalize(uSunDir);
                    vec3 H = normalize(sunDir + V);
                    float spec = pow(max(H.y, 0.0), 28.0) * max(sunDir.y, 0.0);
                    float fres = pow(1.0 - max(V.y, 0.0), 4.0);
                    rgb += vec3(0.95, 0.92, 0.86) * (spec * 0.10) + vec3(0.55, 0.65, 0.78) * (fres * 0.06);
                }

                if (uUseShadows == 1) {
                    float sh = sampleRoadShadow(vWorldPos);
                    rgb *= mix(0.62, 1.0, sh);
                }

                // Smooth far-distance fade so roads blend cleanly into terrain horizon
                float dist = distance(vWorldPos, uCameraPos);
                float distFade = 1.0 - smoothstep(900.0, 1750.0, dist);
                alpha *= distFade;
                if (alpha <= 0.01) discard;

                fragColor = vec4(clamp(rgb, 0.0, 1.0), alpha);
            }
        `;

        const prog = gl.createProgram();
        gl.attachShader(prog, renderer3d.loadShader(gl.VERTEX_SHADER, vsSource));
        gl.attachShader(prog, renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error("Roads3d shader link failed:", gl.getProgramInfoLog(prog));
            return false;
        }
        this.program = prog;
        this.uViewMatrix = gl.getUniformLocation(prog, "uViewMatrix");
        this.uProjectionMatrix = gl.getUniformLocation(prog, "uProjectionMatrix");
        this.uDetailMap0 = gl.getUniformLocation(prog, "uDetailMap0");
        this.uDetailMap1 = gl.getUniformLocation(prog, "uDetailMap1");
        this.uBlendFactor = gl.getUniformLocation(prog, "uBlendFactor");
        this.uHasDetail1 = gl.getUniformLocation(prog, "uHasDetail1");
        this.uCameraPos = gl.getUniformLocation(prog, "uCameraPos");
        this.uLightTint = gl.getUniformLocation(prog, "uLightTint");
        this.uSunDir = gl.getUniformLocation(prog, "uSunDir");
        this.uUsePrReflections = gl.getUniformLocation(prog, "uUsePrReflections");
        this.uLightSpaceMatrix = gl.getUniformLocation(prog, "uLightSpaceMatrix");
        this.uShadowMap = gl.getUniformLocation(prog, "uShadowMap");
        this.uUseShadows = gl.getUniformLocation(prog, "uUseShadows");

        this.initialized = true;
        return true;
    }

    _getActiveMapKey() {
        if (typeof buildingHeightmap !== "undefined" && buildingHeightmap && buildingHeightmap._mapKey) {
            return String(buildingHeightmap._mapKey).toLowerCase();
        }
        if (typeof MapName !== "undefined" && MapName) {
            return String(MapName).toLowerCase();
        }
        return "";
    }

    _requestRoadTexture(texKey, clampU) {
        if (!texKey) return null;
        const cacheKey = `${texKey}|${clampU ? 1 : 0}`;
        if (this.texCache.has(cacheKey)) return this.texCache.get(cacheKey);
        if (this.pendingTex.has(cacheKey)) return null;
        this.pendingTex.add(cacheKey);

        const img = new Image();
        img.onload = () => {
            this.pendingTex.delete(cacheKey);
            const gl = renderer3d.gl;
            if (!gl) return;
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, clampU ? gl.CLAMP_TO_EDGE : gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            const anisoExt = gl.getExtension("EXT_texture_filter_anisotropic")
                || gl.getExtension("MOZ_EXT_texture_filter_anisotropic")
                || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
            if (anisoExt) {
                const maxAniso = gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
                gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, maxAniso));
            }
            gl.bindTexture(gl.TEXTURE_2D, null);
            this.texCache.set(cacheKey, tex);
            if (typeof requestUpdate === "function") requestUpdate();
        };
        img.onerror = () => {
            this.pendingTex.delete(cacheKey);
            this.texCache.set(cacheKey, null);
        };
        img.src = `RoadTextures/${texKey}.webp`;
        return null;
    }

    _requestMapRoads(mapKey) {
        if (!mapKey || this.mapCache.has(mapKey) || this.pendingMaps.has(mapKey)) return;
        if (typeof ROADS_DB !== "undefined" && ROADS_DB && !ROADS_DB[mapKey]) {
            this.mapCache.set(mapKey, { empty: true });
            return;
        }
        this.pendingMaps.add(mapKey);

        Promise.all([
            fetch(`Roads3D/${mapKey}.json`).then((r) => (r.ok ? r.json() : null)),
            fetch(`Roads3D/${mapKey}.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)),
        ]).then(([meta, binBuf]) => {
            this.pendingMaps.delete(mapKey);
            const gl = renderer3d.gl;
            if (!gl || !meta || !binBuf || !Array.isArray(meta.batches) || meta.batches.length === 0) {
                this.mapCache.set(mapKey, { empty: true });
                return;
            }

            const vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(binBuf, 0, meta.vertBytes), gl.STATIC_DRAW);

            const ibo = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(binBuf, meta.vertBytes), gl.STATIC_DRAW);

            // Create 1 lightweight VAO per 256m chunk (24-byte compact vertex + uint16 indices)
            const stride = 24;
            for (const b of meta.batches) {
                const vao = gl.createVertexArray();
                gl.bindVertexArray(vao);
                gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
                const off = b.vertOffsetBytes || 0;
                gl.enableVertexAttribArray(0);
                gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, off);
                gl.enableVertexAttribArray(1);
                gl.vertexAttribPointer(1, 2, gl.SHORT, false, stride, off + 12);
                gl.enableVertexAttribArray(2);
                gl.vertexAttribPointer(2, 2, gl.SHORT, false, stride, off + 16);
                gl.enableVertexAttribArray(3);
                gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, true, stride, off + 20);
                b._vao = vao;
                if (b.tex0) this._requestRoadTexture(b.tex0, true);
                if (b.tex1) this._requestRoadTexture(b.tex1, false);
            }

            gl.bindVertexArray(null);
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

            this.mapCache.set(mapKey, {
                ready: true,
                vbo,
                ibo,
                batches: meta.batches,
            });
            console.log(`[Roads3D] Loaded ${mapKey}: ${meta.batches.length} spatial chunks (256m), ${(meta.idxCount / 3) | 0} tris`);
            if (typeof requestUpdate === "function") requestUpdate();
        }).catch(() => {
            this.pendingMaps.delete(mapKey);
            this.mapCache.set(mapKey, { empty: true });
        });
    }

    _computeMapLightTint() {
        // Approximate map ambient/sun tint from SKY_DB horizon color so night/dusk/overcast roads match terrain
        const entry = (typeof renderer3d !== "undefined" && typeof renderer3d.getActiveSkyEntry === "function")
            ? renderer3d.getActiveSkyEntry()
            : null;
        if (!entry || !Array.isArray(entry.fog)) return [0.92, 0.90, 0.88];
        const fr = entry.fog[0], fg = entry.fog[1], fb = entry.fog[2];
        const fogLuma = 0.299 * fr + 0.587 * fg + 0.114 * fb;
        // Night maps have fogLuma ~0.10-0.22; bright daylight maps have fogLuma ~0.55-0.90
        const bright = Math.max(0.28, Math.min(1.02, 0.22 + fogLuma * 1.05));
        return [
            bright * (0.86 + 0.18 * fr),
            bright * (0.86 + 0.18 * fg),
            bright * (0.86 + 0.18 * fb),
        ];
    }

    draw() {
        if (!this.initialized || !this.program) return;
        if (typeof options_3dRoads === "undefined" || !options_3dRoads) return;

        const mapKey = this._getActiveMapKey();
        if (!mapKey) return;

        const pkg = this.mapCache.get(mapKey);
        if (!pkg) {
            this._requestMapRoads(mapKey);
            return;
        }
        if (pkg.empty || !pkg.ready) return;

        const gl = renderer3d.gl;
        const projMat = renderer3d.getCurrentProjectionMatrix();
        const viewMat = renderer3d.getCurrentViewMatrix();
        const cam = renderer3d.cameraPos;
        const sunDir = (typeof renderer3d.getMapSunDirection === "function") ? renderer3d.getMapSunDirection() : [0.4508, 0.8515, -0.3005];
        const useShadows = !!(renderer3d.shadowsActiveThisFrame && renderer3d.shadowDepthTex);
        const usePrRefl = (typeof options_3dPrReflections !== "undefined" && !!options_3dPrReflections) ? 1 : 0;
        const tint = this._computeMapLightTint();

        const fogCull = !!(renderer3d.fogCullActive && renderer3d.fogCullDist > 0);
        const fogDistSq = fogCull ? (renderer3d.fogCullDist * renderer3d.fogCullDist) : 0;
        const fo = (fogCull && renderer3d.fogCullOrigin) ? renderer3d.fogCullOrigin : cam;

        // 6-plane frustum extraction for per-256m chunk culling (skips ~85% of off-screen road tris!)
        if (!this._frustumPlanes) this._frustumPlanes = new Float32Array(24);
        const planes = this._frustumPlanes;
        const hasFrustum = (typeof building3dRenderer !== "undefined" && typeof building3dRenderer._extractFrustumPlanes === "function");
        if (hasFrustum) {
            building3dRenderer._extractFrustumPlanes(projMat, viewMat, planes);
        }

        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uProjectionMatrix, false, projMat);
        gl.uniformMatrix4fv(this.uViewMatrix, false, viewMat);
        gl.uniform3f(this.uCameraPos, cam[0], cam[1], cam[2]);
        gl.uniform3f(this.uLightTint, tint[0], tint[1], tint[2]);
        gl.uniform3f(this.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
        gl.uniform1i(this.uUsePrReflections, usePrRefl);

        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, useShadows ? renderer3d.shadowDepthTex : (renderer3d.shadowDummyTex || null));
        gl.uniform1i(this.uShadowMap, 4);
        gl.uniform1i(this.uUseShadows, useShadows ? 1 : 0);
        if (useShadows) {
            gl.uniformMatrix4fv(this.uLightSpaceMatrix, false, renderer3d.lightViewProjMatrix);
        }

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(-4.0, -4.0);

        let lastT0 = null;
        let lastT1 = null;
        let lastBlend = -1;

        for (let i = 0; i < pkg.batches.length; i++) {
            const b = pkg.batches[i];
            const aabb = b.aabb;
            if (aabb) {
                // 1. 6-plane frustum culling
                if (hasFrustum) {
                    let vis = true;
                    for (let p = 0; p < 24; p += 4) {
                        const a = planes[p], pb = planes[p + 1], pc = planes[p + 2], pd = planes[p + 3];
                        const px = (a >= 0.0) ? aabb[3] : aabb[0];
                        const py = (pb >= 0.0) ? aabb[4] : aabb[1];
                        const pz = (pc >= 0.0) ? aabb[5] : aabb[2];
                        if (a * px + pb * py + pc * pz + pd < 0.0) {
                            vis = false;
                            break;
                        }
                    }
                    if (!vis) continue;
                }
                // 2. 1:1 Fog-wall culling
                if (fogCull) {
                    const fdx = Math.max(0.0, Math.max(aabb[0] - fo[0], fo[0] - aabb[3]));
                    const fdy = Math.max(0.0, Math.max(aabb[1] - fo[1], fo[1] - aabb[4]));
                    const fdz = Math.max(0.0, Math.max(aabb[2] - fo[2], fo[2] - aabb[5]));
                    if (fdx * fdx + fdy * fdy + fdz * fdz > fogDistSq) continue;
                }
            }

            const t0 = this._requestRoadTexture(b.tex0, true);
            if (!t0) continue;

            if (t0 !== lastT0) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, t0);
                gl.uniform1i(this.uDetailMap0, 0);
                lastT0 = t0;
            }

            const t1 = b.tex1 ? this._requestRoadTexture(b.tex1, false) : null;
            const bindT1 = t1 || this.dummyWhiteTex;
            if (bindT1 !== lastT1) {
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, bindT1);
                gl.uniform1i(this.uDetailMap1, 1);
                gl.uniform1i(this.uHasDetail1, t1 ? 1 : 0);
                lastT1 = bindT1;
            }
            if (b.blend !== lastBlend) {
                gl.uniform1f(this.uBlendFactor, b.blend);
                lastBlend = b.blend;
            }

            gl.bindVertexArray(b._vao);
            gl.drawElements(gl.TRIANGLES, b.idxCount, gl.UNSIGNED_SHORT, b.idxOffsetBytes);
        }

        gl.bindVertexArray(null);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.depthMask(true);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
    }
}

$(() => {
    roads3dRenderer = new Roads3dRenderer();
});
