// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// 3D Building Mesh Renderer in WebGL2 (Mode G)
// Memory-Safe Architecture: Pre-allocated typed arrays, bush cross-billboards, solid trees.

var building3dRenderer;

class Building3dRenderer extends Initializable {
    program = null;
    chunks = []; // Array of { vertexBuffer, indexBuffer, indexCount }
    hasGeometry = false;
    currentMap = null;
    _meshCache = new Map(); // Cache of spatially clustered 3D meshes per template

    aVertexPosition = null;
    aVertexNormal = null;
    aVertexColor = null;

    uProjectionMatrix = null;
    uViewMatrix = null;

    dataReady = true;
    initialized = false;

    // Bush keywords: small ground-level foliage rendered as semi-transparent crossed billboards + top cap
    static BUSH_KEYWORDS = [
        'bush', 'grass', 'plant', 'leaf', 'flower', 'foliage', 'weed', 
        'shrub', 'undergrowth', 'fern', 'reed', 'hedge_small', 'poppies', 'wheat', 
        'corn_maize', 'crops', 'clump', 'groundplant', 'wildgrass', 'tallgrass', 'shortgrass',
        'drybush', 'bushtree', 'highleaf', 'ground_plant', 'medbush', 'leafybush', 'wildbush'
    ];

    // Tree keywords: tall solid vegetation
    static TREE_KEYWORDS = [
        'tree', 'palm', 'birch', 'fir', 'pine', 'oak', 'poplar', 'willow', 'spruce', 
        'cedar', 'maple', 'cypress', 'baobab', 'jungle', 'mangrove', 'eucalyptus', 
        'elm', 'beech', 'linden', 'alder', 'ash_tree', 'chestnut', 'weeping', 'bamboo', 
        'conifer', 'wood', 'log', 'stump', 'cluster', 'group_mixed', 'fir_mixed', 'olive'
    ];

    // Structure keywords: walls, fences, hesco, sandbags, corners, bunkers, and all static buildings
    static STRUCTURE_KEYWORDS = [
        'fence', 'wall', 'hesco', 'sandbag', 'barrier', 'wire', 'rail', 'trench', 
        'gate', 'pipe', 'corner', 'bunker', 'building', 'house', 'shed', 'tower',
        'bridge', 'ladder', 'pole', 'post', 'crate', 'barrel', 'pallet', 'tent',
        'hangar', 'stairs', 'roof', 'door', 'window', 'chimney', 'lamp', 'sign',
        'rubble', 'ruin', 'corrugated', 'concrete', 'hotel', 'barrack', 'block',
        'container', 'fort', 'base', 'dock', 'pier', 'depot', 'wreck', 'vehicle'
    ];

    constructor() {
        super();
    }

    getIsDataReady() {
        return true;
    }

    _isBush(name) {
        const n = (name || "").toLowerCase();
        // 1. Structure guard: Walls, fences, hesco, corners are NEVER bushes!
        for (let i = 0; i < Building3dRenderer.STRUCTURE_KEYWORDS.length; i++) {
            if (n.includes(Building3dRenderer.STRUCTURE_KEYWORDS[i])) return false;
        }
        // 2. Tree guard: Trees are NEVER bushes!
        if (this._isTree(n)) return false;
        // 3. Match pure bush keywords
        for (let i = 0; i < Building3dRenderer.BUSH_KEYWORDS.length; i++) {
            if (n.includes(Building3dRenderer.BUSH_KEYWORDS[i])) return true;
        }
        return false;
    }

    _isTree(name) {
        const n = (name || "").toLowerCase();
        for (let i = 0; i < Building3dRenderer.TREE_KEYWORDS.length; i++) {
            if (n.includes(Building3dRenderer.TREE_KEYWORDS[i])) return true;
        }
        return false;
    }

    _isFence(name) {
        const n = (name || "").toLowerCase();
        for (let i = 0; i < Building3dRenderer.STRUCTURE_KEYWORDS.length; i++) {
            if (n.includes(Building3dRenderer.STRUCTURE_KEYWORDS[i])) return true;
        }
        return false;
    }

    /**
     * Spatially clusters massive multi-tree forest clumps (>3000 tris) to protect VRAM.
     * Standard trees and ALL buildings/structures are NEVER clustered and remain 100% untouched.
     */
    _getClusteredMesh(name, rawMesh) {
        if (!rawMesh || !rawMesh.i || !rawMesh.v) return null;
        if (this._meshCache.has(name)) return this._meshCache.get(name);

        const rawTc = Math.floor(rawMesh.i.length / 3);
        if (rawTc <= 3000) {
            this._meshCache.set(name, rawMesh);
            return rawMesh;
        }

        const gridSize = 0.9;
        const v = rawMesh.v;
        const idx = rawMesh.i;
        const nV = Math.floor(v.length / 3);
        const nTris = Math.floor(idx.length / 3);

        const gridMap = new Map();
        const remap = new Uint32Array(nV);
        const newV = [];

        for (let i = 0; i < nV; i++) {
            const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
            const gx = Math.round(x / gridSize);
            const gy = Math.round(y / gridSize);
            const gz = Math.round(z / gridSize);
            const key = `${gx}_${gy}_${gz}`;

            let targetIdx = gridMap.get(key);
            if (targetIdx === undefined) {
                targetIdx = Math.floor(newV.length / 3);
                gridMap.set(key, targetIdx);
                newV.push(gx * gridSize, gy * gridSize, gz * gridSize);
            }
            remap[i] = targetIdx;
        }

        const newIdx = [];
        const seenTris = new Set();

        for (let t = 0; t < nTris; t++) {
            const i0 = remap[idx[t * 3]];
            const i1 = remap[idx[t * 3 + 1]];
            const i2 = remap[idx[t * 3 + 2]];

            if (i0 === i1 || i1 === i2 || i2 === i0) continue;

            const a = Math.min(i0, Math.min(i1, i2));
            const c = Math.max(i0, Math.max(i1, i2));
            const b = (i0 + i1 + i2) - (a + c);
            const triKey = `${a}_${b}_${c}`;

            if (seenTris.has(triKey)) continue;
            seenTris.add(triKey);

            newIdx.push(i0, i1, i2);
        }

        const result = {
            v: new Float32Array(newV),
            i: new Uint32Array(newIdx)
        };
        this._meshCache.set(name, result);
        return result;
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
            varying highp vec3 vWorldPos;

            void main(void) {
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(aVertexPosition, 1.0);
                vNormal = aVertexNormal;
                vColor = aVertexColor;
                vWorldPos = aVertexPosition;
            }
        `;

        const fsSource = `
            varying highp vec3 vNormal;
            varying highp vec4 vColor;
            varying highp vec3 vWorldPos;

            void main(void) {
                highp vec3 norm = normalize(vNormal);
                if (!gl_FrontFacing) norm = -norm;

                highp vec3 sunDir = normalize(vec3(0.45, 0.85, -0.30));
                highp float sunDiff = max(dot(norm, sunDir), 0.0);

                highp vec3 skyDir = normalize(vec3(-0.40, 0.60, 0.35));
                highp float skyDiff = max(dot(norm, skyDir), 0.0);

                highp float skyFactor = clamp(norm.y * 0.5 + 0.5, 0.0, 1.0);
                highp float lighting = 0.27 + (0.42 * sunDiff) + (0.16 * skyDiff) + (0.15 * skyFactor);

                gl_FragColor = vec4(vColor.rgb * lighting, vColor.a);
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

        // Cleanup old GPU buffers
        for (let c = 0; c < this.chunks.length; c++) {
            if (this.chunks[c].vertexBuffer) gl.deleteBuffer(this.chunks[c].vertexBuffer);
            if (this.chunks[c].indexBuffer) gl.deleteBuffer(this.chunks[c].indexBuffer);
        }
        this.chunks = [];

        // Clear mesh cache on new map load
        if (this.currentMap !== buildingHeightmap._mapKey) {
            this._meshCache.clear();
        }

        // =====================================================================
        // PASS 1: Classify each OBB and compute exact vertex & index requirements
        // =====================================================================
        const MAX_CHUNK_INDICES = 1500000; // 1.5M indices per WebGL draw chunk (~50 MB each)
        const MAX_TREE_POLY_PTS = 8;

        const obbCls = new Uint8Array(obbs.length); // 0=skip, 1=bldg, 2=tree, 3=bush, 4=fence
        const obbPtCounts = new Uint16Array(obbs.length);
        const obbVertCounts = new Uint32Array(obbs.length);
        const obbIdxCounts = new Uint32Array(obbs.length);
        const obbEffectiveMeshes = new Array(obbs.length);

        let totalMapIndices = 0;
        let totalMapVerts = 0;

        for (let i = 0; i < obbs.length; i++) {
            const obb = obbs[i];
            if (obb.hidden || obb.ignoreLOS) {
                obbCls[i] = 0;
                continue;
            }

            const name = (obb.name || "").toLowerCase();
            const isTree = this._isTree(name);
            const isBush = !isTree && this._isBush(name);
            const isFence = !isTree && !isBush && this._isFence(name);

            // Bush: 3 angled vertical foliage cards (0, 60, 120 deg) + 2 tiered leaf caps = 20 verts, 10 tris (30 indices)
            if (isBush) {
                obbCls[i] = 3;
                obbVertCounts[i] = 20;
                obbIdxCounts[i] = 30;
                totalMapVerts += 20;
                totalMapIndices += 30;
                continue;
            }

            // Authentic 3D Mesh
            // - Buildings, carriers, towers, antennas, vehicles, fences: 100% UNTOUCHED ORIGINAL GEOMETRY!
            // - Trees: Authentic 3D geometry (only giant clusters >3000 tris lightly simplified)
            if (obb.mesh3d && obb.mesh3d.i && obb.mesh3d.i.length > 0) {
                obbCls[i] = isTree ? 2 : (isFence ? 4 : 1);
                const cMesh = isTree ? this._getClusteredMesh(obb.name, obb.mesh3d) : obb.mesh3d;
                obbEffectiveMeshes[i] = cMesh;

                const tc = Math.floor(cMesh.i.length / 3);
                obbVertCounts[i] = tc * 3;
                obbIdxCounts[i] = tc * 3;
                totalMapVerts += tc * 3;
                totalMapIndices += tc * 3;
                continue;
            }

            // 2D Footprint Extrusion for Buildings / Walls / Trees without 3D mesh
            obbCls[i] = isTree ? 2 : (isFence ? 4 : 1);
            const rawFp = obb.customPolygon || (typeof buildingHeightmap !== "undefined" ? buildingHeightmap._getFootprint(obb.name) : null);
            let poly = (rawFp && rawFp.poly) ? rawFp.poly : rawFp;
            let n = (poly && Array.isArray(poly) && poly.length >= 3) ? poly.length : 4;
            if (isTree && n > MAX_TREE_POLY_PTS) n = MAX_TREE_POLY_PTS;
            obbPtCounts[i] = n;

            const vCount = n * 4 + n;
            const iCount = n * 6 + Math.max(0, n - 2) * 3;
            obbVertCounts[i] = vCount;
            obbIdxCounts[i] = iCount;
            totalMapVerts += vCount;
            totalMapIndices += iCount;
        }

        if (totalMapIndices === 0) {
            this.hasGeometry = false;
            return;
        }

        // =====================================================================
        // PASS 2: Chunk-based direct typed array population & GPU upload
        // =====================================================================
        let currentStart = 0;

        while (currentStart < obbs.length) {
            let chunkIndices = 0;
            let chunkVerts = 0;
            let currentEnd = currentStart;

            while (currentEnd < obbs.length) {
                const addedIdx = obbIdxCounts[currentEnd];
                if (chunkIndices > 0 && chunkIndices + addedIdx > MAX_CHUNK_INDICES) {
                    break;
                }
                chunkIndices += addedIdx;
                chunkVerts += obbVertCounts[currentEnd];
                currentEnd++;
            }

            if (chunkIndices === 0) {
                currentStart = currentEnd + 1;
                continue;
            }

            const VD = new Float32Array(chunkVerts * 10);
            const ID = new Uint32Array(chunkIndices);
            let vp = 0, ip = 0, vo = 0;

            for (let i = currentStart; i < currentEnd; i++) {
                const cls = obbCls[i];
                if (cls === 0) continue;

                const obb = obbs[i];
                const rad = -(obb.yaw || 0) * Math.PI / 180;
                const cosR = Math.cos(rad), sinR = Math.sin(rad);
                const ssx = obb.scaleX || 1.0, ssz = obb.scaleZ || 1.0;
                const name = (obb.name || "").toLowerCase();

                // -------------------------------------------------------------
                // 1. BUSH: Volumetric Multi-Plane Foliage Cards (3 Vertical + 2 Tiered Horizontal Caps)
                // -------------------------------------------------------------
                if (cls === 3) {
                    const isDesertMap = ['albasrah_2', 'fallujah', 'muttrah_city_2', 'karbala', 'khamisiyah', 'ramiel', 'lashkar_valley', 'gaza_2', 'ras_el_masri_2', 'bijar_canyons', 'bamyan', 'iron_ridge', 'vadso_city', 'shijiavalley'].includes(this.currentMap || '');
                    const isDryBush = name.includes('dry') || name.includes('desert') || name.includes('dead') || name.includes('sand') || name.includes('dust') || name.includes('straw') || name.includes('savanna') || name.includes('scrub') || (isDesertMap && !name.includes('lush') && !name.includes('jungle') && !name.includes('river'));
                    const isHuge = name.includes('huge') || name.includes('40m') || name.includes('large') || name.includes('20m') || name.includes('10m') || name.includes('hedgerow');
                    const isGrass = name.includes('grass') || name.includes('fern') || name.includes('flower') || name.includes('poppies') || name.includes('wheat') || name.includes('reed') || name.includes('plant');
                    const isDeadBare = name.includes('branches') || name.includes('noleafs') || name.includes('broken');

                    // Color Distinction: Desert dry vs Lush forest vs Autumn bare vs Grass
                    let cr, cg, cb, ca;
                    if (isDryBush) {
                        cr = 0.58; cg = 0.50; cb = 0.28; ca = 0.44; // Warm arid desert scrub
                    } else if (isDeadBare) {
                        cr = 0.38; cg = 0.34; cb = 0.24; ca = 0.44; // Weathered bare branches
                    } else if (isHuge) {
                        cr = 0.09; cg = 0.52; cb = 0.22; ca = 0.50; // Dense forest hedge matching trees
                    } else if (isGrass) {
                        cr = 0.20; cg = 0.60; cb = 0.20; ca = 0.38; // Fresh meadow grass
                    } else {
                        cr = 0.11; cg = 0.54; cb = 0.24; ca = 0.46; // Standard lush leafy green
                    }

                    // Strict height clamp: a bush billboard never exceeds 2.5m height
                    let rawH = (obb.height && obb.height > 0.3) ? obb.height : 1.1;
                    let h = Math.min(2.5, rawH);
                    let hw = Math.max(0.6, Math.min(8.0, ((obb.width || 2.0) * ssx + (obb.length || 2.0) * ssz) * 0.25));

                    if (isHuge) {
                        h = Math.min(2.5, Math.max(h, 1.8));
                        hw = Math.max(hw, 2.5);
                    } else if (isGrass || name.includes('small') || name.includes('short')) {
                        h = Math.min(h, 0.7);
                        hw = Math.min(hw, 1.1);
                    }

                    const bY = (obb.y !== undefined && !isNaN(obb.y)) ? obb.y : 0;
                    const top = bY + h;
                    const cx0 = obb.x, cz0 = -obb.z;

                    // 3 Angled Vertical Foliage Cards (0 deg, 60 deg, 120 deg)
                    for (let aIdx = 0; aIdx < 3; aIdx++) {
                        const ang = rad + (aIdx * Math.PI / 3);
                        const cAng = Math.cos(ang), sAng = Math.sin(ang);
                        const dx = cAng * hw, dz = sAng * hw;
                        const nx = -sAng, nz = cAng;

                        const b = vo;
                        VD[vp++] = cx0 - dx; VD[vp++] = bY;  VD[vp++] = cz0 + dz; VD[vp++] = nx; VD[vp++] = 0.2; VD[vp++] = nz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                        VD[vp++] = cx0 - dx; VD[vp++] = top; VD[vp++] = cz0 + dz; VD[vp++] = nx; VD[vp++] = 0.2; VD[vp++] = nz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                        VD[vp++] = cx0 + dx; VD[vp++] = top; VD[vp++] = cz0 - dz; VD[vp++] = nx; VD[vp++] = 0.2; VD[vp++] = nz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                        VD[vp++] = cx0 + dx; VD[vp++] = bY;  VD[vp++] = cz0 - dz; VD[vp++] = nx; VD[vp++] = 0.2; VD[vp++] = nz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                        ID[ip++] = b; ID[ip++] = b + 1; ID[ip++] = b + 2; ID[ip++] = b; ID[ip++] = b + 2; ID[ip++] = b + 3;
                        vo += 4;
                    }

                    // Tier 1: Mid-leaf horizontal cap (at 52% height)
                    const midY = bY + h * 0.52;
                    const mhw = hw * 0.95;
                    let b = vo;
                    VD[vp++] = cx0 - mhw; VD[vp++] = midY; VD[vp++] = cz0 - mhw; VD[vp++] = 0; VD[vp++] = 1; VD[vp++] = 0; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    VD[vp++] = cx0 - mhw; VD[vp++] = midY; VD[vp++] = cz0 + mhw; VD[vp++] = 0; VD[vp++] = 1; VD[vp++] = 0; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    VD[vp++] = cx0 + mhw; VD[vp++] = midY; VD[vp++] = cz0 + mhw; VD[vp++] = 0; VD[vp++] = 1; VD[vp++] = 0; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    VD[vp++] = cx0 + mhw; VD[vp++] = midY; VD[vp++] = cz0 - mhw; VD[vp++] = 0; VD[vp++] = 1; VD[vp++] = 0; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    ID[ip++] = b; ID[ip++] = b + 1; ID[ip++] = b + 2; ID[ip++] = b; ID[ip++] = b + 2; ID[ip++] = b + 3;
                    vo += 4;

                    // Tier 2: Top-leaf horizontal cap (at 88% height)
                    const topY = bY + h * 0.88;
                    const thw = hw * 0.75;
                    b = vo;
                    VD[vp++] = cx0 - thw; VD[vp++] = topY; VD[vp++] = cz0 - thw; VD[vp++] = 0; VD[vp++] = 1; VD[vp++] = 0; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    VD[vp++] = cx0 - thw; VD[vp++] = topY; VD[vp++] = cz0 + thw; VD[vp++] = 0; VD[vp++] = 1; VD[vp++] = 0; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    VD[vp++] = cx0 + thw; VD[vp++] = topY; VD[vp++] = cz0 + thw; VD[vp++] = 0; VD[vp++] = 1; VD[vp++] = 0; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    VD[vp++] = cx0 + thw; VD[vp++] = topY; VD[vp++] = cz0 - thw; VD[vp++] = 0; VD[vp++] = 1; VD[vp++] = 0; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    ID[ip++] = b; ID[ip++] = b + 1; ID[ip++] = b + 2; ID[ip++] = b; ID[ip++] = b + 2; ID[ip++] = b + 3;
                    vo += 4;

                    continue;
                }

                // -------------------------------------------------------------
                // 2. AUTHENTIC 3D MESH (Trees, Buildings, Fences)
                // -------------------------------------------------------------
                const cMesh = obbEffectiveMeshes[i];
                if (cMesh && cMesh.i && cMesh.i.length > 0) {
                    const verts = cMesh.v;
                    const mIdx = cMesh.i;
                    const bY = obb.y || 0;
                    const isTree = (cls === 2);

                    const isDeadTree = isTree && (name.includes('dead') || name.includes('branches') || name.includes('noleafs') || name.includes('broken') || name.includes('stump') || name.includes('log'));
                    const isPine = isTree && !isDeadTree && (name.includes('pine') || name.includes('fir') || name.includes('spruce') || name.includes('conifer') || name.includes('cedar'));
                    const isBirch = isTree && !isDeadTree && name.includes('birch');
                    const isPalm = isTree && !isDeadTree && name.includes('palm');

                    for (let k = 0; k < mIdx.length; k += 3) {
                        const i0 = mIdx[k] * 3, i1 = mIdx[k + 1] * 3, i2 = mIdx[k + 2] * 3;

                        const w0x = obb.x + (verts[i0] * cosR - verts[i0 + 2] * sinR) * ssx;
                        const w0z = obb.z + (verts[i0] * sinR + verts[i0 + 2] * cosR) * ssz;
                        const w0y = bY + verts[i0 + 1];

                        const w1x = obb.x + (verts[i1] * cosR - verts[i1 + 2] * sinR) * ssx;
                        const w1z = obb.z + (verts[i1] * sinR + verts[i1 + 2] * cosR) * ssz;
                        const w1y = bY + verts[i1 + 1];

                        const w2x = obb.x + (verts[i2] * cosR - verts[i2 + 2] * sinR) * ssx;
                        const w2z = obb.z + (verts[i2] * sinR + verts[i2 + 2] * cosR) * ssz;
                        const w2y = bY + verts[i2 + 1];

                        const p0x = w0x, p0y = w0y, p0z = -w0z;
                        const p1x = w1x, p1y = w1y, p1z = -w1z;
                        const p2x = w2x, p2y = w2y, p2z = -w2z;

                        const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
                        const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;
                        let nx = e1y * e2z - e1z * e2y;
                        let ny = e1z * e2x - e1x * e2z;
                        let nz = e1x * e2y - e1y * e2x;
                        const nl = Math.hypot(nx, ny, nz);
                        if (nl > 0.0001) { nx /= nl; ny /= nl; nz /= nl; } else { nx = 0; ny = 1; nz = 0; }

                        // Species-specific vertex colors & lowered trunk threshold
                        let cr, cg, cb, ca;
                        if (isTree) {
                            const avgRelY = (verts[i0 + 1] + verts[i1 + 1] + verts[i2 + 1]) / 3.0;
                            const avgX = (verts[i0] + verts[i1] + verts[i2]) / 3.0;
                            const avgZ = (verts[i0 + 2] + verts[i1 + 2] + verts[i2 + 2]) / 3.0;
                            const avgR = Math.hypot(avgX, avgZ);

                            if (isDeadTree) {
                                // Donbas & autumn dead/bare trees with branches
                                cr = 0.36; cg = 0.28; cb = 0.22; ca = 1.0;
                            } else if (isPine) {
                                // Pines: 100% evergreen forest green (only base stem < 0.6m and r < 0.35m is bark)
                                if (avgRelY < 0.6 && avgR < 0.35) {
                                    cr = 0.36; cg = 0.22; cb = 0.12; ca = 1.0;
                                } else {
                                    cr = 0.07; cg = 0.46; cb = 0.20; ca = 1.0;
                                }
                            } else if (isBirch) {
                                if (avgRelY < 0.9 && avgR < 0.40) {
                                    cr = 0.82; cg = 0.80; cb = 0.75; ca = 1.0; // Birch bark
                                } else {
                                    cr = 0.20; cg = 0.62; cb = 0.18; ca = 1.0; // Birch leaves
                                }
                            } else if (isPalm) {
                                if (avgRelY < 4.0 && avgR < 0.40) {
                                    cr = 0.42; cg = 0.32; cb = 0.20; ca = 1.0;
                                } else {
                                    cr = 0.12; cg = 0.62; cb = 0.24; ca = 1.0;
                                }
                            } else {
                                // Standard Deciduous: Low trunk threshold (y < 0.8m and r < 0.40m)
                                if (avgRelY < 0.8 && avgR < 0.40) {
                                    cr = 0.36; cg = 0.22; cb = 0.12; ca = 1.0;
                                } else {
                                    cr = 0.08; cg = 0.50; cb = 0.22; ca = 1.0;
                                }
                            }
                        } else if (obb.isCustom) {
                            cr = 0.66; cg = 0.33; cb = 0.97; ca = 1.0; // Custom purple
                        } else {
                            cr = 0.0; cg = 0.898; cb = 1.0; ca = 1.0; // Solid cyan
                        }

                        const b = vo;
                        VD[vp++] = p0x; VD[vp++] = p0y; VD[vp++] = p0z; VD[vp++] = nx; VD[vp++] = ny; VD[vp++] = nz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                        VD[vp++] = p1x; VD[vp++] = p1y; VD[vp++] = p1z; VD[vp++] = nx; VD[vp++] = ny; VD[vp++] = nz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                        VD[vp++] = p2x; VD[vp++] = p2y; VD[vp++] = p2z; VD[vp++] = nx; VD[vp++] = ny; VD[vp++] = nz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                        ID[ip++] = b; ID[ip++] = b + 1; ID[ip++] = b + 2;
                        vo += 3;
                    }
                    continue;
                }

                // -------------------------------------------------------------
                // 3. 2D FOOTPRINT EXTRUSION (Walls + Roof)
                // -------------------------------------------------------------
                const rawFp = obb.customPolygon || (typeof buildingHeightmap !== "undefined" ? buildingHeightmap._getFootprint(obb.name) : null);
                let poly = (rawFp && rawFp.poly) ? rawFp.poly : rawFp;

                if (!poly || !Array.isArray(poly) || poly.length < 3) {
                    const hw = (obb.width || 8) / 2, hl = (obb.length || 8) / 2;
                    poly = [{ x: -hw, z: -hl }, { x: hw, z: -hl }, { x: hw, z: hl }, { x: -hw, z: hl }];
                }

                const rawN = poly.length;
                const targetN = obbPtCounts[i] || rawN;

                const bY = (obb.y !== undefined && !isNaN(obb.y)) ? obb.y : 0;
                const minY = (obb.minY !== undefined && !isNaN(obb.minY)) ? obb.minY : (bY - 0.2);
                let maxY = (obb.maxY !== undefined && !isNaN(obb.maxY)) ? obb.maxY : (bY + (obb.height || 6));
                if (maxY - minY < 0.3) maxY = minY + 0.5;

                let cr = 0.0, cg = 0.898, cb = 1.0, ca = 1.0;
                if (cls === 2) {
                    cr = 0.08; cg = 0.50; cb = 0.22; ca = 1.0;
                } else if (obb.isCustom) {
                    cr = 0.66; cg = 0.33; cb = 0.97; ca = 1.0;
                }

                const wxA = new Float64Array(targetN);
                const wzA = new Float64Array(targetN);

                if (targetN === rawN) {
                    for (let j = 0; j < targetN; j++) {
                        const p = poly[j];
                        const ppx = p.x !== undefined ? p.x : p[0];
                        const ppz = p.z !== undefined ? p.z : p[1];
                        wxA[j] = obb.x + (ppx * cosR - ppz * sinR) * ssx;
                        wzA[j] = -(obb.z + (ppx * sinR + ppz * cosR) * ssz);
                    }
                } else {
                    const step = rawN / targetN;
                    for (let j = 0; j < targetN; j++) {
                        const idx = Math.floor(j * step);
                        const p = poly[idx];
                        const ppx = p.x !== undefined ? p.x : p[0];
                        const ppz = p.z !== undefined ? p.z : p[1];
                        wxA[j] = obb.x + (ppx * cosR - ppz * sinR) * ssx;
                        wzA[j] = -(obb.z + (ppx * sinR + ppz * cosR) * ssz);
                    }
                }

                // Walls
                for (let j = 0; j < targetN; j++) {
                    const j2 = (j + 1) % targetN;
                    const ddx = wxA[j2] - wxA[j], ddz = wzA[j2] - wzA[j];
                    const len = Math.hypot(ddx, ddz);
                    if (len < 0.001) continue;
                    const wnx = ddz / len, wnz = -ddx / len;

                    const b = vo;
                    VD[vp++] = wxA[j];  VD[vp++] = minY; VD[vp++] = wzA[j];  VD[vp++] = wnx; VD[vp++] = 0; VD[vp++] = wnz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    VD[vp++] = wxA[j];  VD[vp++] = maxY; VD[vp++] = wzA[j];  VD[vp++] = wnx; VD[vp++] = 0; VD[vp++] = wnz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    VD[vp++] = wxA[j2]; VD[vp++] = maxY; VD[vp++] = wzA[j2]; VD[vp++] = wnx; VD[vp++] = 0; VD[vp++] = wnz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    VD[vp++] = wxA[j2]; VD[vp++] = minY; VD[vp++] = wzA[j2]; VD[vp++] = wnx; VD[vp++] = 0; VD[vp++] = wnz; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                    ID[ip++] = b; ID[ip++] = b + 1; ID[ip++] = b + 2; ID[ip++] = b; ID[ip++] = b + 2; ID[ip++] = b + 3;
                    vo += 4;
                }

                // Roof
                const rb = vo;
                for (let j = 0; j < targetN; j++) {
                    VD[vp++] = wxA[j]; VD[vp++] = maxY; VD[vp++] = wzA[j]; VD[vp++] = 0; VD[vp++] = 1; VD[vp++] = 0; VD[vp++] = cr; VD[vp++] = cg; VD[vp++] = cb; VD[vp++] = ca;
                }
                vo += targetN;
                for (let j = 1; j < targetN - 1; j++) {
                    ID[ip++] = rb; ID[ip++] = rb + j; ID[ip++] = rb + j + 1;
                }
            }

            const usedVD = (vp < VD.length) ? VD.subarray(0, vp) : VD;
            const usedID = (ip < ID.length) ? ID.subarray(0, ip) : ID;

            if (usedID.length > 0) {
                const vb = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, vb);
                gl.bufferData(gl.ARRAY_BUFFER, usedVD, gl.STATIC_DRAW);

                const ib = gl.createBuffer();
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, usedID, gl.STATIC_DRAW);

                this.chunks.push({
                    vertexBuffer: vb,
                    indexBuffer: ib,
                    indexCount: ip
                });
            }

            currentStart = currentEnd;
        }

        this.hasGeometry = this.chunks.length > 0;
        this.currentMap = buildingHeightmap._mapKey;
        console.log(`%c[Building3dRenderer v2.6] Buffers ready for ${this.currentMap} | Chunks: ${this.chunks.length} | Vertices: ${totalMapVerts.toLocaleString()} | Indices: ${totalMapIndices.toLocaleString()} (${(totalMapIndices / 1000000).toFixed(2)}M)`, 'color: #00e5ff; font-weight: bold;');
    }

    draw() {
        if (!this.initialized) return;

        if (typeof buildingHeightmap !== "undefined" && buildingHeightmap.initialized) {
            if (this.currentMap !== buildingHeightmap._mapKey || !this.hasGeometry) {
                this.rebuildBuffers();
            }
        }

        if (!this.hasGeometry || this.chunks.length === 0) return;

        const gl = renderer3d.gl;

        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uProjectionMatrix, false, renderer3d.getCurrentProjectionMatrix());
        gl.uniformMatrix4fv(this.uViewMatrix, false, renderer3d.getCurrentViewMatrix());

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);

        // Enable alpha blending for semi-transparent bush cross-billboards
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(-1.0, -1.0);

        const stride = 10 * 4;

        for (let c = 0; c < this.chunks.length; c++) {
            const chunk = this.chunks[c];
            if (chunk.indexCount === 0) continue;

            gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertexBuffer);

            gl.enableVertexAttribArray(this.aVertexPosition);
            gl.vertexAttribPointer(this.aVertexPosition, 3, gl.FLOAT, false, stride, 0);

            gl.enableVertexAttribArray(this.aVertexNormal);
            gl.vertexAttribPointer(this.aVertexNormal, 3, gl.FLOAT, false, stride, 3 * 4);

            gl.enableVertexAttribArray(this.aVertexColor);
            gl.vertexAttribPointer(this.aVertexColor, 4, gl.FLOAT, false, stride, 6 * 4);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.indexBuffer);
            gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0);
        }

        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.disable(gl.BLEND);
    }

    drawDepth(aPosLoc) {
        if (!this.hasGeometry || !this.chunks || this.chunks.length === 0) return;
        const gl = renderer3d.gl;
        const stride = 10 * 4; // 40 bytes: pos at offset 0

        for (let c = 0; c < this.chunks.length; c++) {
            const chunk = this.chunks[c];
            if (!chunk || chunk.indexCount === 0) continue;

            gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertexBuffer);
            gl.enableVertexAttribArray(aPosLoc);
            gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, stride, 0);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.indexBuffer);
            gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0);
        }
    }
}

$(() => {
    building3dRenderer = new Building3dRenderer();
});
