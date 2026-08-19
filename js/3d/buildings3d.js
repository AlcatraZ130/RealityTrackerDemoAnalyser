// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// 3D Building Mesh Renderer in WebGL2 (Mode G)
// Batches all static structure footprints into a single 3D VBO/IBO for solid 60 FPS rendering.

var building3dRenderer;

class Building3dRenderer extends Initializable {
    program = null;
    vertexBuffer = null;
    indexBuffer = null;
    indexCount = 0;
    hasGeometry = false;
    currentMap = null;

    aVertexPosition = null;
    aVertexNormal = null;
    aVertexColor = null;

    uProjectionMatrix = null;
    uViewMatrix = null;

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

        const vsSource = `
            attribute vec3 aVertexPosition;
            attribute vec3 aVertexNormal;
            attribute vec4 aVertexColor;

            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;

            varying highp vec3 vNormal;
            varying highp vec4 vColor;

            void main(void) {
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(aVertexPosition, 1.0);
                vNormal = aVertexNormal;
                vColor = aVertexColor;
            }
        `;

        const fsSource = `
            varying highp vec3 vNormal;
            varying highp vec4 vColor;

            void main(void) {
                // Subtle directional lighting for clean architectural readability
                highp vec3 lightDir = normalize(vec3(0.5, 0.8, -0.4));
                highp float diffuse = max(dot(vNormal, lightDir), 0.0);
                highp float light = 0.72 + 0.28 * diffuse;
                gl_FragColor = vec4(vColor.rgb * light, 1.0);
            }
        `;

        const vertexShader = renderer3d.loadShader(gl.VERTEX_SHADER, vsSource);
        const fragmentShader = renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource);

        const prog = gl.createProgram();
        gl.attachShader(prog, vertexShader);
        gl.attachShader(prog, fragmentShader);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Unable to initialize building 3D shader program: ' + gl.getProgramInfoLog(prog));
            return false;
        }

        this.program = prog;
        this.aVertexPosition = gl.getAttribLocation(prog, 'aVertexPosition');
        this.aVertexNormal = gl.getAttribLocation(prog, 'aVertexNormal');
        this.aVertexColor = gl.getAttribLocation(prog, 'aVertexColor');

        this.uProjectionMatrix = gl.getUniformLocation(prog, 'uProjectionMatrix');
        this.uViewMatrix = gl.getUniformLocation(prog, 'uViewMatrix');

        this.initialized = true;

        this.rebuildBuffers();
        return true;
    }

    rebuildBuffers() {
        if (!this.initialized || typeof buildingHeightmap === "undefined" || !buildingHeightmap.initialized || !buildingHeightmap.obbs) {
            return;
        }

        const gl = renderer3d.gl;
        const obbs = buildingHeightmap.obbs;
        if (obbs.length === 0) return;

        const vertices = []; // x, y, z, nx, ny, nz, r, g, b, a
        const indices = [];
        let vertexOffset = 0;

        for (let i = 0; i < obbs.length; i++) {
            const obb = obbs[i];
            if (obb.hidden || obb.ignoreLOS) continue;

            const rad = -(obb.yaw || 0) * Math.PI / 180;
            const cosR = Math.cos(rad), sinR = Math.sin(rad);
            const sx = obb.scaleX || 1.0, sz = obb.scaleZ || 1.0;

            // Solid cyan style (#00e5ff)
            let color = [0.0, 0.898, 1.0, 1.0];
            if (obb.isVegetation) {
                color = [0.06, 0.72, 0.50, 1.0]; // Emerald green trunk
            } else if (obb.isCustom) {
                color = [0.66, 0.33, 0.97, 1.0]; // Purple
            }

            // 1. Render Authentic 1:1 3D Triangle Collision Geometry
            if (obb.mesh3d && obb.mesh3d.i && obb.mesh3d.i.length > 0) {
                const verts = obb.mesh3d.v;
                const mIndices = obb.mesh3d.i;
                const baseY = obb.y || 0;

                for (let k = 0; k < mIndices.length; k += 3) {
                    const i0 = mIndices[k] * 3;
                    const i1 = mIndices[k + 1] * 3;
                    const i2 = mIndices[k + 2] * 3;

                    // Vertex 0
                    const v0x = verts[i0], v0y = verts[i0 + 1], v0z = verts[i0 + 2];
                    const w0x = obb.x + (v0x * cosR - v0z * sinR) * sx;
                    const w0z = obb.z + (v0x * sinR + v0z * cosR) * sz;
                    const w0y = baseY + v0y;

                    // Vertex 1
                    const v1x = verts[i1], v1y = verts[i1 + 1], v1z = verts[i1 + 2];
                    const w1x = obb.x + (v1x * cosR - v1z * sinR) * sx;
                    const w1z = obb.z + (v1x * sinR + v1z * cosR) * sz;
                    const w1y = baseY + v1y;

                    // Vertex 2
                    const v2x = verts[i2], v2y = verts[i2 + 1], v2z = verts[i2 + 2];
                    const w2x = obb.x + (v2x * cosR - v2z * sinR) * sx;
                    const w2z = obb.z + (v2x * sinR + v2z * cosR) * sz;
                    const w2y = baseY + v2y;

                    // Calculate face normal in WebGL coordinates (Z is inverted)
                    const p0 = [w0x, w0y, -w0z];
                    const p1 = [w1x, w1y, -w1z];
                    const p2 = [w2x, w2y, -w2z];

                    const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
                    const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];

                    let nx = e1y * e2z - e1z * e2y;
                    let ny = e1z * e2x - e1x * e2z;
                    let nz = e1x * e2y - e1y * e2x;
                    const nlen = Math.hypot(nx, ny, nz);
                    if (nlen > 0.0001) {
                        nx /= nlen; ny /= nlen; nz /= nlen;
                    } else {
                        nx = 0.0; ny = 1.0; nz = 0.0;
                    }

                    const baseIdx = vertexOffset;
                    vertices.push(
                        p0[0], p0[1], p0[2],  nx, ny, nz,  color[0], color[1], color[2], color[3],
                        p1[0], p1[1], p1[2],  nx, ny, nz,  color[0], color[1], color[2], color[3],
                        p2[0], p2[1], p2[2],  nx, ny, nz,  color[0], color[1], color[2], color[3]
                    );
                    vertexOffset += 3;

                    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
                }
                continue;
            }

            // 2. 2D Footprint Fallback
            const rawFp = obb.customPolygon || buildingHeightmap._getFootprint(obb.name);
            let poly = (rawFp && rawFp.poly) ? rawFp.poly : rawFp;

            if (!poly || !Array.isArray(poly) || poly.length < 3) {
                const hw = (obb.width || 8) / 2;
                const hl = (obb.length || 8) / 2;
                poly = [
                    { x: -hw, z: -hl },
                    { x: hw, z: -hl },
                    { x: hw, z: hl },
                    { x: -hw, z: hl }
                ];
            }

            const baseY = (obb.y !== undefined && !isNaN(obb.y)) ? obb.y : 0;
            const minY = (obb.minY !== undefined && !isNaN(obb.minY)) ? obb.minY : (baseY - 0.2);
            let maxY = (obb.maxY !== undefined && !isNaN(obb.maxY)) ? obb.maxY : (baseY + (obb.height || 6));

            if (maxY - minY < 0.3) maxY = minY + 0.5;

            // Transform 2D polygon into 3D world coordinates (with WebGL Z = -Z_world)
            const n = poly.length;
            const worldPts = [];
            for (let j = 0; j < n; j++) {
                const p = poly[j];
                const px = p.x !== undefined ? p.x : p[0];
                const pz = p.z !== undefined ? p.z : p[1];

                const wx = obb.x + (px * cosR - pz * sinR) * sx;
                const wz = obb.z + (px * sinR + pz * cosR) * sz;
                worldPts.push({ x: wx, z: -wz });
            }

            // Build Wall Triangles
            for (let j = 0; j < n; j++) {
                const p1 = worldPts[j];
                const p2 = worldPts[(j + 1) % n];

                const dx = p2.x - p1.x;
                const dz = p2.z - p1.z;
                const len = Math.hypot(dx, dz);
                if (len < 0.001) continue;

                const nx = dz / len;
                const nz = -dx / len;

                const baseIdx = vertexOffset;

                vertices.push(
                    p1.x, minY, p1.z,  nx, 0.0, nz,  color[0], color[1], color[2], color[3],
                    p1.x, maxY, p1.z,  nx, 0.0, nz,  color[0], color[1], color[2], color[3],
                    p2.x, maxY, p2.z,  nx, 0.0, nz,  color[0], color[1], color[2], color[3],
                    p2.x, minY, p2.z,  nx, 0.0, nz,  color[0], color[1], color[2], color[3]
                );
                vertexOffset += 4;

                indices.push(
                    baseIdx, baseIdx + 1, baseIdx + 2,
                    baseIdx, baseIdx + 2, baseIdx + 3
                );
            }

            // Build Roof Cap Triangles (at maxY)
            const roofTriangles = this.triangulatePolygon(worldPts);
            if (roofTriangles && roofTriangles.length >= 3) {
                const roofBaseIdx = vertexOffset;
                for (let j = 0; j < n; j++) {
                    const pt = worldPts[j];
                    vertices.push(
                        pt.x, maxY, pt.z,  0.0, 1.0, 0.0,  color[0], color[1], color[2], color[3]
                    );
                }
                vertexOffset += n;

                for (let t = 0; t < roofTriangles.length; t++) {
                    indices.push(roofBaseIdx + roofTriangles[t]);
                }
            }
        }

        if (vertices.length === 0) {
            this.hasGeometry = false;
            return;
        }

        if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
        if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);

        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);

        this.indexCount = indices.length;
        this.hasGeometry = true;
        this.currentMap = buildingHeightmap._mapKey;
    }

    triangulatePolygon(vertices) {
        const n = vertices.length;
        if (n < 3) return [];
        if (n === 3) return [0, 1, 2];
        if (n === 4) return [0, 1, 2, 0, 2, 3];

        const indices = [];
        const V = [];
        for (let i = 0; i < n; i++) V.push(i);

        let nv = n;
        let count = 2 * nv;

        const isInside = (ax, az, bx, bz, cx, cz, px, pz) => {
            const v0x = cx - ax, v0z = cz - az;
            const v1x = bx - ax, v1z = bz - az;
            const v2x = px - ax, v2z = pz - az;

            const dot00 = v0x * v0x + v0z * v0z;
            const dot01 = v0x * v1x + v0z * v1z;
            const dot02 = v0x * v2x + v0z * v2z;
            const dot11 = v1x * v1x + v1z * v1z;
            const dot12 = v1x * v2x + v1z * v2z;

            const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
            const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
            const v = (dot00 * dot12 - dot01 * dot02) * invDenom;

            return (u >= 0) && (v >= 0) && (u + v <= 1);
        };

        const isEar = (u, v, w, nv, V, vertices) => {
            const ax = vertices[V[u]].x, az = vertices[V[u]].z;
            const bx = vertices[V[v]].x, bz = vertices[V[v]].z;
            const cx = vertices[V[w]].x, cz = vertices[V[w]].z;

            if (((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) <= 0.000001) return false;

            for (let p = 0; p < nv; p++) {
                if (p === u || p === v || p === w) continue;
                const px = vertices[V[p]].x, pz = vertices[V[p]].z;
                if (isInside(ax, az, bx, bz, cx, cz, px, pz)) return false;
            }
            return true;
        };

        while (nv > 2 && count > 0) {
            count--;
            for (let i = 0; i < nv; i++) {
                const u = (i > 0) ? i - 1 : nv - 1;
                const v = i;
                const w = (i + 1 < nv) ? i + 1 : 0;

                if (isEar(u, v, w, nv, V, vertices)) {
                    indices.push(V[u], V[v], V[w]);
                    V.splice(v, 1);
                    nv--;
                    break;
                }
            }
        }

        if (nv > 2) {
            for (let i = 1; i < nv - 1; i++) {
                indices.push(V[0], V[i], V[i + 1]);
            }
        }

        return indices;
    }

    draw() {
        if (!this.initialized) return;

        if (typeof buildingHeightmap !== "undefined" && buildingHeightmap.initialized) {
            if (this.currentMap !== buildingHeightmap._mapKey || !this.hasGeometry) {
                this.rebuildBuffers();
            }
        }

        if (!this.hasGeometry || this.indexCount === 0) return;

        const gl = renderer3d.gl;

        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uProjectionMatrix, false, renderer3d.getCurrentProjectionMatrix());
        gl.uniformMatrix4fv(this.uViewMatrix, false, renderer3d.getCurrentViewMatrix());

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

        const stride = 10 * 4;
        gl.enableVertexAttribArray(this.aVertexPosition);
        gl.vertexAttribPointer(this.aVertexPosition, 3, gl.FLOAT, false, stride, 0);

        gl.enableVertexAttribArray(this.aVertexNormal);
        gl.vertexAttribPointer(this.aVertexNormal, 3, gl.FLOAT, false, stride, 3 * 4);

        gl.enableVertexAttribArray(this.aVertexColor);
        gl.vertexAttribPointer(this.aVertexColor, 4, gl.FLOAT, false, stride, 6 * 4);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    }
}

$(() => {
    building3dRenderer = new Building3dRenderer();
});
