// Part of RealityTracker Demo Analyser
// Per-map 3D Skybox dome renderer using sky.con panoramic textures and horizon fog blending.

"use strict";

var skyboxRenderer;

class SkyboxRenderer extends Initializable {
    dataReady = true;
    initialized = false;
    program = null;
    vertexBuffer = null;
    indexBuffer = null;

    aPosition = -1;
    uProjectionMatrix = null;
    uViewMatrix = null;
    uCameraPos = null;
    uSkySampler = null;
    uHasTexture = null;
    uFogColor = null;
    uHorizonColor = null;
    uUseFog = null;
    uFogHorizonBand = null;

    currentSkyCacheKey = null;
    skyTexture = null;
    hasTexture = false;
    fogColor = [0.45, 0.50, 0.55];
    horizonColor = [0.45, 0.50, 0.55];
    fogEnd = 700.0;
    _loadingSkyKey = null;
    _imageCache = {};

    getIsDataReady() {
        return true;
    }

    init() {
        const gl = renderer3d.gl;
        if (!gl) return false;

        const vsSource = `
            attribute vec3 aPosition;
            uniform mat4 uProjectionMatrix;
            uniform mat4 uViewMatrix;
            uniform vec3 uCameraPos;
            varying highp vec3 vWorldDir;

            void main(void) {
                vWorldDir = aPosition;
                vec3 worldPos = uCameraPos + aPosition * 500.224;
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(worldPos, 1.0);
            }
        `;

        const fsSource = `
            precision highp float;
            varying highp vec3 vWorldDir;
            uniform sampler2D uSkySampler;
            uniform int uHasTexture;
            uniform vec3 uFogColor;
            uniform vec3 uHorizonColor;
            uniform int uUseFog;
            uniform float uFogHorizonBand;

            const float PI = 3.141592653589793;

            void main(void) {
                vec3 d = normalize(vWorldDir);
                float u = atan(d.z, d.x) / (2.0 * PI) + 0.5;
                float elev = asin(clamp(d.y, 0.0, 1.0)) / (0.5 * PI);
                float v = clamp(1.0 - elev, 0.0020976, 0.9979024);

                vec3 skyCol;
                if (uUseFog == 1) {
                    // Seamless 1:1 PR horizon match: nadir & horizon = exact map fogColor
                    skyCol = uFogColor;
                    if (d.y > 0.0) {
                        if (uHasTexture == 1) {
                            vec3 texCol = texture2D(uSkySampler, vec2(u, v)).rgb;
                            float horizonBlend = smoothstep(0.0, uFogHorizonBand, d.y);
                            skyCol = mix(uFogColor, texCol, horizonBlend);
                        } else {
                            vec3 zenithCol = uFogColor * 0.65;
                            skyCol = mix(uFogColor, zenithCol, clamp(elev, 0.0, 1.0));
                        }
                    }
                } else {
                    vec3 baseHorizon = mix(uHorizonColor, uFogColor, 0.45);
                    skyCol = baseHorizon;

                    if (uHasTexture == 1) {
                        vec3 texCol = texture2D(uSkySampler, vec2(u, v)).rgb;
                        float horizonBlend = smoothstep(-0.02, 0.035, d.y);
                        skyCol = mix(baseHorizon, texCol, horizonBlend);
                    } else {
                        vec3 zenithCol = uFogColor * 0.65;
                        skyCol = mix(baseHorizon, zenithCol, clamp(elev, 0.0, 1.0));
                    }

                    if (d.y < 0.0) {
                        float nadirFactor = clamp(-d.y * 2.50409, 0.0, 1.0);
                        vec3 groundHaze = baseHorizon * 0.72;
                        skyCol = mix(skyCol, groundHaze, nadirFactor);
                    }
                }

                gl_FragColor = vec4(skyCol, 1.0);
            }
        `;

        const vertShader = renderer3d.loadShader(gl.VERTEX_SHADER, vsSource);
        const fragShader = renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource);
        if (!vertShader || !fragShader) return false;

        const prog = gl.createProgram();
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error("SKYBOX: Unable to link shader program:", gl.getProgramInfoLog(prog));
            return false;
        }

        this.program = prog;
        this.aPosition = gl.getAttribLocation(prog, "aPosition");
        this.uProjectionMatrix = gl.getUniformLocation(prog, "uProjectionMatrix");
        this.uViewMatrix = gl.getUniformLocation(prog, "uViewMatrix");
        this.uCameraPos = gl.getUniformLocation(prog, "uCameraPos");
        this.uSkySampler = gl.getUniformLocation(prog, "uSkySampler");
        this.uHasTexture = gl.getUniformLocation(prog, "uHasTexture");
        this.uFogColor = gl.getUniformLocation(prog, "uFogColor");
        this.uHorizonColor = gl.getUniformLocation(prog, "uHorizonColor");
        this.uUseFog = gl.getUniformLocation(prog, "uUseFog");
        this.uFogHorizonBand = gl.getUniformLocation(prog, "uFogHorizonBand");

        const vertices = new Float32Array([
            -1, -1, -1,
             1, -1, -1,
             1,  1, -1,
            -1,  1, -1,
            -1, -1,  1,
             1, -1,  1,
             1,  1,  1,
            -1,  1,  1
        ]);

        const indices = new Uint16Array([
            0, 1, 2,  0, 2, 3,
            1, 5, 6,  1, 6, 2,
            5, 4, 7,  5, 7, 6,
            4, 0, 3,  4, 3, 7,
            3, 2, 6,  3, 6, 7,
            4, 5, 1,  4, 1, 0
        ]);

        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        this.initialized = true;
        return true;
    }

    _syncMapSky(cacheKey, entry) {
        if (!cacheKey || cacheKey === this.currentSkyCacheKey) return;
        this.currentSkyCacheKey = cacheKey;
        this.hasTexture = false;

        if (!entry) {
            this.fogColor = [0.45, 0.50, 0.55];
            this.horizonColor = [0.45, 0.50, 0.55];
            this.fogEnd = 700.0;
            return;
        }

        this.fogColor = Array.isArray(entry.fog) && entry.fog.length === 3 ? entry.fog : [0.45, 0.50, 0.55];
        this.horizonColor = Array.isArray(entry.horizon) && entry.horizon.length === 3 ? entry.horizon : this.fogColor;
        this.fogEnd = (Array.isArray(entry.fogParams) && entry.fogParams.length >= 2 && entry.fogParams[1] > 0)
            ? Number(entry.fogParams[1])
            : 700.0;

        const skyKey = entry.sky;
        if (!skyKey) return;

        if (this._imageCache[skyKey]) {
            this._uploadSkyTexture(this._imageCache[skyKey]);
            return;
        }

        this._loadingSkyKey = skyKey;
        const img = new Image();
        img.onload = () => {
            this._imageCache[skyKey] = img;
            if (this._loadingSkyKey === skyKey && this.currentSkyCacheKey === cacheKey) {
                this._uploadSkyTexture(img);
                if (typeof requestUpdate === "function") {
                    requestUpdate();
                }
            }
        };
        img.onerror = () => {
            console.warn("SKYBOX: Failed to load Skyboxes/" + skyKey + ".webp");
        };
        img.src = "Skyboxes/" + skyKey + ".webp?v=2";
    }

    _uploadSkyTexture(img) {
        const gl = renderer3d.gl;
        if (!gl || !img) return;

        if (!this.skyTexture) {
            this.skyTexture = gl.createTexture();
        }
        gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.hasTexture = true;
    }

    draw() {
        if (!this.initialized || !this.program) return;
        if (typeof options_DrawSkybox !== "undefined" && !options_DrawSkybox) return;
        if (renderer3d.isTopDown) return;

        const mapKey = (typeof MapName !== "undefined" && MapName) ? MapName.toLowerCase() : "";
        if (!mapKey) return;
        const mode = (typeof GameMode !== "undefined" && GameMode) ? String(GameMode).toLowerCase() : "";
        const layer = (typeof Layer !== "undefined" && Layer != null) ? String(Layer) : "";
        const cacheKey = mapKey + "|" + mode + "|" + layer;
        if (cacheKey !== this.currentSkyCacheKey) {
            const entry = (typeof renderer3d !== "undefined" && renderer3d && typeof renderer3d.getActiveSkyEntry === "function")
                ? renderer3d.getActiveSkyEntry()
                : ((typeof SKY_DB !== "undefined" && SKY_DB) ? SKY_DB[mapKey] : null);
            this._syncMapSky(cacheKey, entry);
        }

        const gl = renderer3d.gl;
        gl.useProgram(this.program);

        gl.depthMask(false);
        gl.disable(gl.BLEND);

        const projMatrix = renderer3d.getCurrentProjectionMatrix();
        const viewMatrix = renderer3d.getCurrentViewMatrix();
        gl.uniformMatrix4fv(this.uProjectionMatrix, false, projMatrix);
        gl.uniformMatrix4fv(this.uViewMatrix, false, viewMatrix);
        gl.uniform3f(this.uCameraPos, renderer3d.cameraPos[0], renderer3d.cameraPos[1], renderer3d.cameraPos[2]);
        gl.uniform3fv(this.uFogColor, this.fogColor);
        gl.uniform3fv(this.uHorizonColor, this.horizonColor);
        const useFog = (typeof options_3dFog !== "undefined" && !!options_3dFog) ? 1 : 0;
        if (this.uUseFog !== null) gl.uniform1i(this.uUseFog, useFog);
        // Tighter maps (e.g. Stalingrad 200m, Blizzard 270m) get a softer/taller horizon haze band; long-range maps stay crisp
        const fogBand = Math.max(0.045, Math.min(0.16, 42.445 / Math.max(200.0, this.fogEnd || 700.0)));
        if (this.uFogHorizonBand !== null) gl.uniform1f(this.uFogHorizonBand, fogBand);

        if (this.hasTexture && this.skyTexture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);
            gl.uniform1i(this.uSkySampler, 0);
            gl.uniform1i(this.uHasTexture, 1);
        } else {
            gl.uniform1i(this.uHasTexture, 0);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.vertexAttribPointer(this.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.aPosition);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);

        gl.disableVertexAttribArray(this.aPosition);
        gl.depthMask(true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
}

$(() => {
    skyboxRenderer = new SkyboxRenderer();
});
