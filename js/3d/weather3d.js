// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// GPU-Instanced PR Weather Particle System (Rain / Snow / Desert Dust — Rain.fx style)
// Single instanced draw call, 0 CPU per-particle updates, wraps seamlessly around camera.

var weather3dRenderer;

class Weather3dRenderer extends Initializable {
    program = null;
    vao = null;
    quadVbo = null;
    seedVbo = null;
    particleCount = 1800;
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

        const vsSource = `#version 300 es
            precision highp float;
            precision highp int;
            layout(location = 0) in vec2 aCorner;
            layout(location = 1) in vec4 aSeed;

            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;
            uniform vec3 uCameraPos;
            uniform vec3 uCamRight;
            uniform vec3 uCamUp;
            uniform float uTime;
            uniform int uWeatherMode; // 1=Rain, 2=Snow, 3=Blizzard

            out vec2 vUv;
            out float vAlpha;

            void main() {
                vec3 boxSize = (uWeatherMode == 1) ? vec3(52.0, 34.0, 52.0)
                             : (uWeatherMode == 2) ? vec3(60.0, 36.0, 60.0)
                             : vec3(48.0, 30.0, 48.0);

                float fallSpeed = (uWeatherMode == 1) ? 24.0
                                : (uWeatherMode == 2) ? 2.8
                                : 6.2;
                vec3 windVel = (uWeatherMode == 1) ? vec3(3.2, -fallSpeed, 1.4)
                             : (uWeatherMode == 2) ? vec3(1.4, -fallSpeed, 0.9)
                             : vec3(9.5, -fallSpeed, 5.4);

                vec3 basePos = aSeed.xyz * boxSize + windVel * uTime;
                if (uWeatherMode == 2) {
                    float sw = uTime * (1.2 + aSeed.w * 0.8) + aSeed.x * 12.0;
                    basePos.x += sin(sw) * 1.1;
                    basePos.z += cos(sw * 0.83) * 1.1;
                } else if (uWeatherMode == 3) {
                    float sw = uTime * (2.6 + aSeed.w * 1.4) + aSeed.z * 14.0;
                    basePos.x += sin(sw) * 1.8;
                    basePos.y += cos(sw * 0.9) * 0.9;
                }

                // Wrap seamlessly around camera
                vec3 rel = mod(basePos - uCameraPos, boxSize) - boxSize * 0.5;
                vec3 worldCenter = uCameraPos + rel;

                float dist = length(rel);
                float nearFade = smoothstep(1.2, 3.8, dist);
                float farFade = 1.0 - smoothstep(boxSize.x * 0.30, boxSize.x * 0.48, dist);
                vAlpha = nearFade * farFade * (0.45 + 0.55 * aSeed.w);

                vec3 worldPos;
                if (uWeatherMode == 1) {
                    // Elongated rain streak aligned with fall velocity
                    vec3 fallDir = normalize(windVel);
                    vec3 toCam = normalize(uCameraPos - worldCenter);
                    vec3 side = normalize(cross(fallDir, toCam));
                    float w = 0.018 + 0.012 * aSeed.w;
                    float h = 0.62 + 0.38 * aSeed.w;
                    worldPos = worldCenter + side * (aCorner.x * w) + fallDir * (aCorner.y * h);
                } else if (uWeatherMode == 2) {
                    // Soft snowflake billboard
                    float sz = 0.055 + 0.065 * aSeed.w;
                    worldPos = worldCenter + uCamRight * (aCorner.x * sz) + uCamUp * (aCorner.y * sz);
                } else {
                    // Dense wind-driven blizzard flake
                    float sz = 0.065 + 0.085 * aSeed.w;
                    worldPos = worldCenter + uCamRight * (aCorner.x * sz) + uCamUp * (aCorner.y * sz);
                }

                vUv = aCorner * 0.5 + 0.5;
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(worldPos, 1.0);
            }
        `;

        const fsSource = `#version 300 es
            precision highp float;
            precision highp int;

            in vec2 vUv;
            in float vAlpha;

            uniform int uWeatherMode;
            uniform sampler2D uSceneDepthTex;
            uniform vec2 uInvScreenSize;

            out vec4 fragColor;

            void main() {
                if (vAlpha <= 0.005) discard;

                // Respect opaque scene depth buffer (post-SSAO pass has depth test disabled)
                vec2 screenUv = gl_FragCoord.xy * uInvScreenSize;
                float sceneDepth = texture(uSceneDepthTex, screenUv).r;
                if (gl_FragCoord.z > sceneDepth) discard;

                vec2 p = vUv * 2.0 - 1.0;
                float shape = 0.0;
                vec3 col = vec3(1.0);

                if (uWeatherMode == 1) {
                    // Crisp translucent rain streak
                    float horiz = 1.0 - abs(p.x);
                    float vert = 1.0 - p.y * p.y;
                    shape = pow(clamp(horiz, 0.0, 1.0), 1.6) * clamp(vert, 0.0, 1.0) * 0.42;
                    col = vec3(0.76, 0.84, 0.92);
                } else if (uWeatherMode == 2) {
                    // Soft radial snowflake
                    float r2 = dot(p, p);
                    if (r2 > 1.0) discard;
                    shape = pow(1.0 - r2, 1.5) * 0.72;
                    col = vec3(0.95, 0.97, 1.0);
                } else {
                    // Dense wind-driven blizzard snow
                    float r2 = dot(p, p);
                    if (r2 > 1.0) discard;
                    shape = pow(1.0 - r2, 1.35) * 0.85;
                    col = vec3(0.92, 0.95, 1.0);
                }

                float a = shape * vAlpha;
                if (a <= 0.004) discard;
                fragColor = vec4(col, a);
            }
        `;

        const prog = gl.createProgram();
        gl.attachShader(prog, renderer3d.loadShader(gl.VERTEX_SHADER, vsSource));
        gl.attachShader(prog, renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error("Weather3d shader link failed:", gl.getProgramInfoLog(prog));
            return false;
        }
        this.program = prog;
        this.uViewMatrix = gl.getUniformLocation(prog, "uViewMatrix");
        this.uProjectionMatrix = gl.getUniformLocation(prog, "uProjectionMatrix");
        this.uCameraPos = gl.getUniformLocation(prog, "uCameraPos");
        this.uCamRight = gl.getUniformLocation(prog, "uCamRight");
        this.uCamUp = gl.getUniformLocation(prog, "uCamUp");
        this.uTime = gl.getUniformLocation(prog, "uTime");
        this.uWeatherMode = gl.getUniformLocation(prog, "uWeatherMode");
        this.uSceneDepthTex = gl.getUniformLocation(prog, "uSceneDepthTex");
        this.uInvScreenSize = gl.getUniformLocation(prog, "uInvScreenSize");

        // Unit quad (2 triangles)
        const quadVerts = new Float32Array([
            -1, -1,  1, -1,  1,  1,
            -1, -1,  1,  1, -1,  1
        ]);
        // Deterministic pseudo-random particle seeds
        const seeds = new Float32Array(this.particleCount * 4);
        let s = 133791;
        const nextRand = () => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s / 4294967296;
        };
        for (let i = 0; i < this.particleCount; i++) {
            seeds[i * 4 + 0] = nextRand();
            seeds[i * 4 + 1] = nextRand();
            seeds[i * 4 + 2] = nextRand();
            seeds[i * 4 + 3] = nextRand();
        }

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        this.quadVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
        gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(0, 0);

        this.seedVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.seedVbo);
        gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(1, 1);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this.initialized = true;
        return true;
    }

    _detectWeatherMode() {
        // Strict 1:1 PR map/layer weather lookup from SKY_DB (extracted from PR server.zip init/tmp/staticobjects).
        // Returns 0 (disabled) on all dry/clear maps and layers.
        const entry = (typeof renderer3d !== "undefined" && typeof renderer3d.getActiveSkyEntry === "function")
            ? renderer3d.getActiveSkyEntry()
            : null;
        const w = (entry && entry.weather) ? String(entry.weather).toLowerCase() : "";
        if (w === "rain") return 1;
        if (w === "snow") return 2;
        if (w === "blizzard") return 3;
        return 0;
    }

    isActiveOnCurrentMap() {
        return !!(this.initialized && typeof options_3dWeather !== "undefined" && options_3dWeather && this._detectWeatherMode() > 0);
    }

    draw() {
        if (!this.initialized || !this.program || !this.vao) return;
        if (typeof options_3dWeather === "undefined" || !options_3dWeather) return;
        if (renderer3d.isTopDown) return;

        const mode = this._detectWeatherMode();
        if (mode === 0) return;

        const gl = renderer3d.gl;
        if (!gl || !renderer3d.sceneDepthTex) return;
        const viewMat = renderer3d.getCurrentViewMatrix();
        const projMat = renderer3d.getCurrentProjectionMatrix();
        const cam = renderer3d.cameraPos;
        const camRight = [viewMat[0], viewMat[4], viewMat[8]];
        const camUp = [viewMat[1], viewMat[5], viewMat[9]];
        const t = (performance.now() * 0.001) % 10000.0;

        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uViewMatrix, false, viewMat);
        gl.uniformMatrix4fv(this.uProjectionMatrix, false, projMat);
        gl.uniform3f(this.uCameraPos, cam[0], cam[1], cam[2]);
        gl.uniform3f(this.uCamRight, camRight[0], camRight[1], camRight[2]);
        gl.uniform3f(this.uCamUp, camUp[0], camUp[1], camUp[2]);
        gl.uniform1f(this.uTime, t);
        gl.uniform1i(this.uWeatherMode, mode);
        gl.uniform2f(this.uInvScreenSize, 1.0 / Math.max(1, renderer3d.canvas.width), 1.0 / Math.max(1, renderer3d.canvas.height));

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, renderer3d.sceneDepthTex);
        gl.uniform1i(this.uSceneDepthTex, 0);

        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.bindVertexArray(this.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.particleCount);
        gl.bindVertexArray(null);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
}

$(() => {
    weather3dRenderer = new Weather3dRenderer();
});
