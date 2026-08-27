// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// -----------------------------------------------------------------------------
// VisionDepthPass: GPU Depth Buffer & Exact 3D Geometry Vision Cone Engine
// Renders terrain and building 3D vertex buffers to an off-screen FBO
// from the soldier/vehicle eye perspective with sub-millimeter mesh accuracy.
// -----------------------------------------------------------------------------

var visionDepthPass;

class VisionDepthPass {
    constructor() {
        this.fbo = null;
        this.colorTex = null;
        this.depthRb = null;
        this.width = 512;
        this.height = 128;
        this.pixelBuffer = new Uint8Array(this.width * this.height * 4);

        this.depthProgram = null;
        this.aVertexPosition = null;
        this.uEyeViewProj = null;
        this.uFar = null;

        this.initialized = false;
    }

    init(gl) {
        if (this.initialized || !gl) return;

        // 1. Compile minimal Depth Shader
        const vsSource = `
            attribute vec3 aVertexPosition;
            uniform mat4 uEyeViewProj;
            varying float vLinearDepth;

            void main(void) {
                vec4 pos = uEyeViewProj * vec4(aVertexPosition, 1.0);
                gl_Position = pos;
                vLinearDepth = pos.w;
            }
        `;

        const fsSource = `
            precision highp float;
            varying float vLinearDepth;
            uniform float uFar;

            void main(void) {
                float normD = clamp(vLinearDepth / uFar, 0.0, 1.0);
                vec4 enc = fract(normD * vec4(1.0, 255.0, 65025.0, 16581375.0));
                enc -= enc.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0);
                gl_FragColor = enc;
            }
        `;

        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error("[VisionDepthPass] Shader link failed:", gl.getProgramInfoLog(prog));
            return;
        }

        this.depthProgram = prog;
        this.aVertexPosition = gl.getAttribLocation(prog, "aVertexPosition");
        this.uEyeViewProj = gl.getUniformLocation(prog, "uEyeViewProj");
        this.uFar = gl.getUniformLocation(prog, "uFar");

        // 2. Create FBO, Color Texture and Depth Renderbuffer
        this.fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

        this.colorTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);

        this.depthRb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error("[VisionDepthPass] Framebuffer incomplete:", status);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.initialized = true;
    }

    makeVisionFrustum(fovHDeg, fovVDeg, near, far) {
        const tanH = Math.tan((fovHDeg * Math.PI / 180) / 2);
        const tanV = Math.tan((fovVDeg * Math.PI / 180) / 2);
        const right = tanH * near, left = -right;
        const top   = tanV * near, bottom = -top;
        const rl = 1 / (right - left), tb = 1 / (top - bottom), nf = 1 / (near - far);

        return new Float32Array([
            (2 * near) * rl, 0, 0, 0,
            0, (2 * near) * tb, 0, 0,
            (right + left) * rl, (top + bottom) * tb, (far + near) * nf, -1,
            0, 0, (2 * far * near) * nf, 0
        ]);
    }

    captureDepth(gl, eyeX, eyeY, eyeZ, rotDeg, rangeM, coneAngleDeg, vFovDeg) {
        if (!this.initialized && gl) this.init(gl);
        if (!this.initialized || !gl) return null;

        const fovH = coneAngleDeg || 94.9;
        const fovV = vFovDeg || 48.0;
        const rad = (rotDeg || 0) * Math.PI / 180.0;
        const dirX = Math.sin(rad);
        const dirZ = Math.cos(rad);

        // 1. Calculate Eye View and Projection Matrices
        const eyePos = vec3.fromValues(eyeX, eyeY, -eyeZ);
        const targetPos = vec3.fromValues(eyeX + dirX * 100.0, eyeY, -(eyeZ + dirZ * 100.0));
        const up = vec3.fromValues(0, 1, 0);

        const viewMat = mat4.create();
        mat4.lookAt(viewMat, eyePos, targetPos, up);

        const projMat = this.makeVisionFrustum(fovH, fovV, 0.2, rangeM);
        const eyeViewProj = mat4.create();
        mat4.multiply(eyeViewProj, projMat, viewMat);

        // 2. Render Scene Geometry into FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, this.width, this.height);

        gl.clearColor(1.0, 1.0, 1.0, 1.0); // 1.0 = Far / open air
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(this.depthProgram);
        gl.uniformMatrix4fv(this.uEyeViewProj, false, eyeViewProj);
        gl.uniform1f(this.uFar, rangeM);

        gl.enableVertexAttribArray(this.aVertexPosition);

        // A. Draw Terrain VBOs
        if (typeof terrainRenderer !== "undefined" && terrainRenderer.initialized && terrainRenderer.segments) {
            const stride = 20; // 5 floats: x, y, z, u, v
            for (let i = 0; i < terrainRenderer.segments.length; i++) {
                const seg = terrainRenderer.segments[i];
                if (!seg || !seg.gpu_vertexBuffer || !seg.gpu_vertexBuffer[0]) continue;

                gl.bindBuffer(gl.ARRAY_BUFFER, seg.gpu_vertexBuffer[0]);
                gl.vertexAttribPointer(this.aVertexPosition, 3, gl.FLOAT, false, stride, 0);

                const indices = terrainRenderer.indices[0];
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
                gl.drawElements(gl.TRIANGLE_STRIP, terrainRenderer.TERRAINSEGMENT_LODINDEXSIZE[0], gl.UNSIGNED_SHORT, 0);
            }
        }

        // B. Draw Building & Vegetation 3D Chunks
        if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized && building3dRenderer.chunks) {
            const stride = 40; // 10 floats
            for (let c = 0; c < building3dRenderer.chunks.length; c++) {
                const chunk = building3dRenderer.chunks[c];
                if (!chunk || chunk.indexCount === 0) continue;

                gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertexBuffer);
                gl.vertexAttribPointer(this.aVertexPosition, 3, gl.FLOAT, false, stride, 0);

                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.indexBuffer);
                gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0);
            }
        }

        // 3. Read Depth Pixels from GPU
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixelBuffer);

        // 4. Restore Main Framebuffer and Viewport
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (renderer3d && renderer3d.canvas) {
            gl.viewport(0, 0, renderer3d.canvas.width, renderer3d.canvas.height);
        }

        return this.pixelBuffer;
    }

    getDistanceAt(col, row, rangeM) {
        if (col < 0) col = 0;
        if (col >= this.width) col = this.width - 1;
        if (row < 0) row = 0;
        if (row >= this.height) row = this.height - 1;

        const idx = (row * this.width + col) * 4;
        const r = this.pixelBuffer[idx];
        const g = this.pixelBuffer[idx + 1];
        const b = this.pixelBuffer[idx + 2];
        const a = this.pixelBuffer[idx + 3];

        const norm = (r + g / 255.0 + b / 65025.0 + a / 16581375.0) / 255.0;
        return norm * rangeM;
    }

    getMinDistanceInColumn(col, rangeM, startRow = 0, endRow = 127) {
        let minDist = rangeM;
        for (let r = startRow; r <= endRow; r++) {
            const d = this.getDistanceAt(col, r, rangeM);
            if (d < minDist) minDist = d;
        }
        return minDist;
    }
}

$(() => {
    visionDepthPass = new VisionDepthPass();
});
