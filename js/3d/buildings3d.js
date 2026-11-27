// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// 3D Building & Volumetric Foliage Mesh Renderer in WebGL2 (Mode G)
// Memory-Safe Architecture: Pre-allocated typed arrays, organic geodesic foliage volumes, solid trunks/buildings.

var building3dRenderer;

// Build degree-1 subdivided octahedron unit spheroid once (18 shared directions, 32 outward CCW tris)
const _FV_UNIT_SPHEROID = (() => {
    const verts = [
        [0, 1, 0],   // 0 +Y
        [1, 0.000064, 0],   // 1 +X
        [-0.000084, 0, 1],   // 2 +Z
        [-1, 0, 0],  // 3 -X
        [0, 0, -1],  // 4 -Z
        [0, -1, 0],  // 5 -Y
    ];
    const baseFaces = [
        [2, 1, 0], [1, 4, 0], [4, 3, 0], [3, 2, 0],
        [1, 2, 5], [4, 1, 5], [3, 4, 5], [2, 3, 5],
    ];
    const midCache = new Map();
    const getMid = (a, b) => {
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        let idx = midCache.get(k);
        if (idx !== undefined) return idx;
        const va = verts[a], vb = verts[b];
        const mx = va[0] + vb[0], my = va[1] + vb[1], mz = va[2] + vb[2];
        const len = Math.hypot(mx, my, mz) || 1.0;
        idx = verts.length;
        verts.push([mx / len, my / len, mz / len]);
        midCache.set(k, idx);
        return idx;
    };
    const indices = [];
    for (let f = 0; f < baseFaces.length; f++) {
        const [a, b, c] = baseFaces[f];
        const mab = getMid(a, b);
        const mbc = getMid(b, c);
        const mca = getMid(c, a);
        indices.push(
            a, mab, mca,
            b, mbc, mab,
            c, mca, mbc,
            mab, mbc, mca
        );
    }
    const dirs = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
        dirs[i * 3] = verts[i][0];
        dirs[i * 3 + 1] = verts[i][1];
        dirs[i * 3 + 2] = verts[i][2];
    }
    return {
        vertCount: verts.length,
        idxCount: indices.length,
        dirs,
        indices: new Uint16Array(indices),
    };
})();

class Building3dRenderer extends Initializable {
    program = null;
    bushProgram = null;
    texOpaqueProgram = null;
    texAlphaProgram = null;
    chunkOpaqueProgram = null;
    chunkAlphaProgram = null;
    lastDrawStats = { instOpaqueCalls: 0, instAlphaCalls: 0, chunkOpaqueCalls: 0, chunkAlphaCalls: 0, visInstances: 0 };
    chunks = []; // All solid geometry chunks (treeChunks + structChunks) used for LOS depth pass
    treeChunks = []; // Solid tree & custom object chunks (always drawn in Pass 1A)
    structChunks = []; // Untextured solid structure chunks (drawn in Pass 1A when Structure Textures is OFF)
    bushChunks = []; // Translucent foliage volume chunks: bushes, shrubs, hedgerows (depthMask = false)
    hasGeometry = false;
    currentMap = null;
    _meshCache = new Map(); // Cache of spatially clustered 3D meshes per template
    _mapTex3dCache = new Map(); // mapKey -> instanced GPU package & spatial grid
    _mapTex3dPending = new Set();

    aVertexPosition = null;
    aVertexNormal = null;
    aVertexColor = null;

    uProjectionMatrix = null;
    uViewMatrix = null;
    uUseStructureColors = null;

    bVertexPosition = null;
    bVertexNormal = null;
    bVertexColor = null;
    bProjectionMatrix = null;
    bViewMatrix = null;
    bCameraPos = null;

    dataReady = true;
    initialized = false;

    // Bush keywords: small/medium/elongated ground-level foliage rendered as organic 3D foliage mounds
    static BUSH_KEYWORDS = [
        'bush', 'grass', 'plant', 'leaf', 'flower', 'foliage', 'weed', 
        'shrub', 'undergrowth', 'fern', 'reed', 'hedge_small', 'hedgerow', 'hedge',
        'poppies', 'wheat', 'corn_maize', 'crops', 'clump', 'groundplant', 'wildgrass',
        'tallgrass', 'shortgrass', 'drybush', 'bushtree', 'highleaf', 'ground_plant',
        'medbush', 'leafybush', 'wildbush', 'bramble', 'heather', 'scrub', 'palmbush'
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
        'hangar', 'stairs', 'stair', 'roof', 'door', 'window', 'chimney', 'lamp', 'sign',
        'rubble', 'ruin', 'corrugated', 'concrete', 'hotel', 'barrack', 'block',
        'container', 'fort', 'base', 'dock', 'pier', 'depot', 'wreck', 'vehicle',
        'hedgehog', 'plant_box', 'flower_pot', 'flowerpot', 'burlap_sack', 'afghan_baskets',
        'table', 'log_barr', 'log_mg_barr', 'treestand', 'tree_stand'
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
        // 2. Explicit bush/shrub/hedgerow/fern names without 'tree' are ALWAYS bushes
        // (even if they contain 'jungle', 'palm', or 'pine', e.g. jungle_bush_10m_bc, af_palmbush_01, bush_pine)
        if (!n.includes('tree') && (n.includes('bush') || n.includes('shrub') || n.includes('hedgerow') || n.includes('groundfern') || n.includes('undergrowth'))) {
            return true;
        }
        // 3. Tree guard: Trees are NEVER bushes!
        if (this._isTree(n)) return false;
        // 4. Match pure bush keywords
        for (let i = 0; i < Building3dRenderer.BUSH_KEYWORDS.length; i++) {
            if (n.includes(Building3dRenderer.BUSH_KEYWORDS[i])) return true;
        }
        return false;
    }

    _isFlatFieldGrid(name) {
        const n = (name || "").toLowerCase();
        if (n.includes('hedgerow') || n.includes('ditch') || n.includes('strip') || n.includes('obst_') || n.includes('airfield')) return false;
        return (n.includes('wheat_field') || n.includes('wheatfield') || n.includes('grid') || n.includes('grassfield') || n.includes('wildgrass_50m') || n.includes('wildgrass_100m'));
    }

    _isLinearInfrastructure(name) {
        const n = (name || "").toLowerCase();
        return (
            n.includes("fence") || n.includes("wall") || n.includes("railing") ||
            n.includes("seawall") || n.includes("rail") || n.includes("track") ||
            n.includes("road") || n.includes("sidewalk") || n.includes("bridge") ||
            n.includes("curb") || n.includes("divider") || n.includes("hesco") ||
            n.includes("sandbag") || n.includes("trench") || n.includes("wire") ||
            n.includes("pipe") || n.includes("powerline") || n.includes("interchange") ||
            n.includes("24m") || n.includes("12m") || n.includes("4m") || n.includes("driveway")
        );
    }

    _getFoliageEntry(name) {
        if (typeof FOLIAGE_VOLUMES_3D === "undefined" || !FOLIAGE_VOLUMES_3D) return null;
        const map = FOLIAGE_VOLUMES_3D.bushes;
        if (!map) return null;
        const n = (name || "").toLowerCase();
        if (map[n]) return map[n];
        if (n.endsWith("_bc")) {
            const stripped = n.slice(0, -3);
            if (map[stripped]) return map[stripped];
        }
        return null;
    }

    _buildFallbackLobeEntry(obb) {
        const name = (obb.name || "").toLowerCase();
        const b = obb.bounds3d || (obb.mesh3d && obb.mesh3d.b) || null;
        let offX = 0, offY = 0.75, offZ = 0;
        let rawW = obb.realWidth || obb.width || 2.4;
        let rawL = obb.realLength || obb.length || 2.4;
        let rawH = (obb.height && obb.height > 0.25) ? obb.height : 1.5;

        if (b && b.length === 6) {
            offX = (b[0] + b[3]) * 0.5;
            offY = (b[1] + b[4]) * 0.5;
            offZ = (b[2] + b[5]) * 0.5;
            rawW = Math.max(0.9, Math.abs(b[3] - b[0]));
            rawL = Math.max(0.9, Math.abs(b[5] - b[2]));
            rawH = Math.max(0.7, Math.abs(b[4] - b[1]));
        }

        const isSnow = name.includes('snow') || name.includes('winter');
        const isDead = name.includes('branches') || name.includes('noleafs') || name.includes('dead');
        const isGrass = name.includes('grass') || name.includes('fern') || name.includes('flower') || name.includes('poppies') || name.includes('wheat') || name.includes('reed') || name.includes('corn_maize') || name.includes('groundplant') || name.includes('ground_plant');
        const isDry = name.includes('dry') || name.includes('desert') || name.includes('scrub') || name.includes('sand') || name.includes('straw');

        let kind = "lush", c = [42, 130, 42], a = 0.42;
        if (isSnow) { kind = "snow"; c = [112, 134, 124]; a = isDead ? 0.16 : 0.25; }
        else if (isDead) { kind = "dead"; c = [116, 88, 62]; a = 0.20; }
        else if (isGrass) { kind = "grass"; c = [94, 136, 52]; a = 0.19; }
        else if (isDry) { kind = "dry"; c = [128, 118, 70]; a = 0.24; }

        const alongX = rawW >= rawL;
        const longSpan = alongX ? rawW : rawL;
        const shortSpan = alongX ? rawL : rawW;
        const aspect = longSpan / Math.max(0.8, shortSpan);
        const numK = (longSpan >= 7.5 && aspect >= 2.1)
            ? Math.min(14, Math.max(3, Math.round(longSpan / 2.6)))
            : (longSpan >= 6.0 ? 2 : 1);

        const lobes = [];
        const rMaj = (numK === 1) ? Math.max(0.55, longSpan * 0.46) : Math.max(0.75, (longSpan / numK) * 0.68);
        const rMin = Math.max(0.50, shortSpan * 0.46);
        const rY = Math.max(0.45, Math.min(3.0, rawH * 0.46));
        const spanRange = Math.max(0, longSpan - rMaj * 1.4);
        for (let k = 0; k < numK; k++) {
            const t = (numK === 1) ? 0.0 : (-0.5 + k / (numK - 1));
            const off = t * spanRange;
            lobes.push([
                offX + (alongX ? off : 0),
                offY,
                offZ + (alongX ? 0 : off),
                alongX ? rMaj : rMin,
                rY,
                alongX ? rMin : rMaj,
            ]);
        }
        return { l: lobes, c, a, k: kind };
    }

    _composeD3dBasis(obb) {
        const rad = Math.PI / 180.0;
        const y = (obb.yaw || 0) * rad;
        const p = (obb.pitch || 0) * rad;
        const r = (obb.roll || 0) * rad;
        const cy = Math.cos(y), sy = Math.sin(y);

        if (Math.abs(p) < 0.0009 && Math.abs(r) < 0.0009) {
            return {
                r00: cy, r01: 0, r02: -sy,
                r10: 0,  r11: 1, r12: 0,
                r20: sy, r21: 0, r22: cy,
            };
        }

        const cp = Math.cos(p), sp = Math.sin(p);
        const cr = Math.cos(r), sr = Math.sin(r);

        // BF2 D3DXMatrixRotationYawPitchRoll: Rz(roll) * Rx(pitch) * Ry(yaw)
        const a00 = cr,  a01 = sr * cp, a02 = sr * sp;
        const a10 = -sr, a11 = cr * cp, a12 = cr * sp;
        const a21 = -sp, a22 = cp;

        return {
            r00: a00 * cy + a02 * sy, r01: a01, r02: -a00 * sy + a02 * cy,
            r10: a10 * cy + a12 * sy, r11: a11, r12: -a10 * sy + a12 * cy,
            r20: a22 * sy,            r21: a21, r22: a22 * cy,
        };
    }

    _isTree(name) {
        const n = (name || "").toLowerCase();
        for (let i = 0; i < Building3dRenderer.STRUCTURE_KEYWORDS.length; i++) {
            if (n.includes(Building3dRenderer.STRUCTURE_KEYWORDS[i])) return false;
        }
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

    static STRUCTURE_COLOR_PALETTE = [
        [0.92, 0.68, 0.24], // Warm Amber
        [0.85, 0.74, 0.30], // Ochre Gold
        [0.84, 0.76, 0.56], // Desert Sand
        [0.86, 0.84, 0.75], // Limestone Cream
        [0.72, 0.71, 0.67], // Warm Concrete
        [0.58, 0.60, 0.56], // Slate Stone
        [0.66, 0.74, 0.42], // Pale Olive
        [0.56, 0.76, 0.52], // Light Sage
        [0.44, 0.80, 0.64], // Mint Jade
        [0.52, 0.82, 0.70], // Seafoam
        [0.78, 0.84, 0.34], // Sunlit Citron
        [0.78, 0.62, 0.22], // Mustard
        [0.82, 0.56, 0.34], // Copper Tan
        [0.80, 0.55, 0.34], // Clay Ochre
        [0.74, 0.68, 0.46], // Khaki
        [0.76, 0.52, 0.72], // Dusty Mauve
        [0.72, 0.46, 0.74], // Plum Orchid
        [0.66, 0.58, 0.50], // Warm Taupe
        [0.64, 0.66, 0.63], // Pewter Grey
        [0.86, 0.64, 0.30], // Honey Bronze
        [0.64, 0.80, 0.46], // Pistachio
        [0.72, 0.82, 0.48], // Chartreuse Mist
        [0.80, 0.70, 0.50], // Sandstone Buff
        [0.80, 0.58, 0.74]  // Pale Lavender-Rose
    ];

    _resolveStructurePaletteColor(obb) {
        const pal = Building3dRenderer.STRUCTURE_COLOR_PALETTE;
        let tpl = (obb.template || obb.name || "struct").toLowerCase();
        // Normalize sub-parts / destructible / numbered segments of the same structure (e.g. bridges, compound walls)
        // so that all parts and instances of a given structure share one single consistent color.
        tpl = tpl
            .replace(/(_nondestroyable|_nondest|_destroyable|_destructible|_dest|_ruin|_bc|_lod|_nl)$/g, "")
            .replace(/(_part\d*|_seg\d*|_sec\d*|_piece\d*|_sub\d*|_v\d+|_\d+[a-z]?)$/g, "");
        let h = 2166136261 >>> 0;
        for (let i = 0; i < tpl.length; i++) {
            h ^= tpl.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        const base = pal[h % pal.length];
        return [base[0], base[1], base[2]];
    }

    _resolveStructureColor(obb, instanceIndex) {
        if (typeof options_StructureColors === "undefined" || !options_StructureColors) {
            return [0.0, 0.898, 1.0];
        }
        return this._resolveStructurePaletteColor(obb);
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

    _buildTexFragmentShader(withAlphaDiscard, withLodFade = false, fastShadowPcf = false) {
        const shadowBody = fastShadowPcf ? `
                // Fast 4-tap rotated PCF for distant chunks, fading batches & foliage cutouts
                float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
                float ca = cos(ang), sa = sin(ang);
                mat2 rot = mat2(ca, -sa, sa, ca);
                const float rad = 1.50 / 2048.0;
                float s = texture(uShadowMap, vec3(proj.xy + (rot * vec2( 0.85,  0.30)) * rad, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2(-0.82,  0.36)) * rad, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2( 0.30, -0.84)) * rad, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2(-0.34, -0.80)) * rad, zRef));
                s *= 0.25;
        ` : `
                // 5-tap rotated Poisson PCF (with hardware LINEAR depth comparison)
                float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
                float ca = cos(ang), sa = sin(ang);
                mat2 rot = mat2(ca, -sa, sa, ca);
                const float rad = 1.55 / 2048.0;
                float s = texture(uShadowMap, vec3(proj.xy, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2( 0.85,  0.32)) * rad, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2(-0.82,  0.38)) * rad, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2( 0.28, -0.86)) * rad, zRef));
                s += texture(uShadowMap, vec3(proj.xy + (rot * vec2(-0.34, -0.80)) * rad, zRef));
                s *= 0.2;
        `;
        const lodFadeBlock = withLodFade ? `
                if (vFadeCode != 0) {
                    ivec2 p = ivec2(gl_FragCoord.xy) & 3;
                    int xm = p.x ^ p.y;
                    int bayerInt = ((p.y & 1) << 3) | ((xm & 1) << 2) | (p.y & 2) | ((xm & 2) >> 1);
                    float bayer = (float(bayerInt) + 0.5) * 0.0625;
                    if (vFadeCode <= 64) {
                        float alpha = float(vFadeCode) / 64.0;
                        if (bayer >= alpha) discard;
                    } else {
                        float alpha = float(vFadeCode - 64) / 64.0;
                        if (bayer < alpha) discard;
                    }
                }
        ` : "";
        return `#version 300 es
            precision highp float;
            precision highp int;
            precision highp sampler2DArray;
            precision highp sampler2DShadow;

            in highp vec3 vNormal;
            in highp vec3 vColor;
            in highp vec2 vUV;
            in highp vec3 vWorldPos;
            in highp float vVertexAO;
            flat in highp int vLayer;
            flat in highp int vFadeCode;

            uniform sampler2DArray uTexArray;
            uniform int uPassMode;
            uniform vec3 uSunDir;
            uniform vec3 uCameraPos;
            uniform int uUsePrReflections;
            uniform mat4 uLightSpaceMatrix;
            uniform sampler2DShadow uShadowMap;
            uniform int uUseShadows;
            uniform int uUseVertexAO;

            layout(location = 0) out vec4 fragColor;

            float sampleBldgShadow(vec3 worldPos, vec3 norm, float ndotl) {
                float nOff = mix(0.09, 0.03, ndotl);
                vec4 ls = uLightSpaceMatrix * vec4(worldPos + norm * nOff, 1.0);
                vec3 proj = (ls.xyz / ls.w) * 0.5 + 0.5;
                if (proj.x <= 0.002 || proj.x >= 0.998 || proj.y <= 0.002 || proj.y >= 0.998 || proj.z <= 0.0 || proj.z >= 1.0) {
                    return 1.0;
                }
                float edge = min(min(proj.x, 1.0 - proj.x), min(proj.y, 1.0 - proj.y));
                float edgeFade = smoothstep(0.0, 0.12, edge);
                float zRef = proj.z - mix(0.00038, 0.00014, ndotl);
${shadowBody}
                return mix(1.0, s, edgeFade);
            }

            void main(void) {
${lodFadeBlock}
                vec3 albedo;
                if (uPassMode == 2) {
                    // LOD2 distant proxy fallback
                    albedo = clamp(vColor, 0.0, 1.0);
                } else {
                    vec4 texSample = texture(uTexArray, vec3(vUV, float(vLayer)));
                    ${withAlphaDiscard ? "float viewDist = 1.0 / max(gl_FragCoord.w, 1e-6); float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); float nearCut = mix(0.16, 0.48, ign); float farCut = 0.14; float alphaCutoff = mix(nearCut, farCut, clamp((viewDist - 45.0) / 340.0, 0.0, 1.0)); if (texSample.a < alphaCutoff) discard;" : ""}
                    albedo = clamp(vColor * texSample.rgb * 1.85, 0.0, 1.0);
                }

                highp vec3 norm = normalize(vNormal);
                if (!gl_FrontFacing) norm = -norm;

                highp vec3 sunDir = normalize(uSunDir);
                highp float rawNdotL = max(dot(norm, sunDir), 0.0);
                // PR RealityShaders Half-Lambert (RDirectXTK_GetHalfNL)
                highp float halfNL = dot(norm, sunDir) * 0.5 + 0.5;
                highp float sunDiff = halfNL * halfNL;
                highp float shadowVis = 1.0;
                if (uUseShadows == 1 && rawNdotL > 0.001) {
                    shadowVis = sampleBldgShadow(vWorldPos, norm, rawNdotL);
                    sunDiff *= mix(0.16, 1.0, shadowVis);
                }

                highp vec3 skyDir = normalize(vec3(-sunDir.x, 0.65, -sunDir.z));
                highp float skyDiff = max(dot(norm, skyDir), 0.0);

                highp float skyFactor = clamp(norm.y * 0.5 + 0.5, 0.0, 1.0);
                highp float ambient = 0.32 + (0.15 * skyDiff) + (0.14 * skyFactor);
                if (uUseVertexAO == 1 && vVertexAO > 0.002) {
                    ambient *= mix(0.28, 1.0, vVertexAO);
                }
                highp float lighting = ambient + (0.50 * sunDiff);
                highp vec3 finalCol = albedo * lighting;

                if (uUsePrReflections == 1 && uPassMode != 2) {
                    highp vec3 V = normalize(uCameraPos - vWorldPos);
                    highp vec3 H = normalize(sunDir + V);
                    highp float luma = dot(albedo, vec3(0.299, 0.587, 0.114));
                    highp float spec = pow(max(dot(norm, H), 0.0), 26.0) * rawNdotL * shadowVis * smoothstep(0.10, 0.55, luma);
                    highp float fres = pow(1.0 - max(dot(norm, V), 0.0), 3.6);
                    finalCol += vec3(1.0, 0.95, 0.86) * (spec * 0.18);
                    finalCol += vec3(0.62, 0.72, 0.84) * (fres * 0.09 * skyFactor);
                    finalCol = clamp(finalCol, 0.0, 1.0);
                }

                fragColor = vec4(finalCol, 1.0);
            }
        `;
    }

    _compileInstancedTexProgram(gl, withAlphaDiscard, withLodFade = false, fastShadowPcf = false) {
        const vsSource = `#version 300 es
            layout(location = 0) in vec3 aVertexPosition;
            layout(location = 1) in vec3 aVertexNormal;
            layout(location = 2) in vec2 aVertexUV;
            layout(location = 3) in vec4 aVertexColor;
            layout(location = 4) in uint aVertexLayer;
            layout(location = 6) in float aVertexAO;

            uniform mat4 uProjectionMatrix;
            uniform mat4 uViewMatrix;
            uniform highp sampler2D uInstanceDataTex;
            uniform highp isampler2D uVisibleIdsTex;
            uniform int uBaseInstance;
            uniform int uUseStructureColors;
            ${withAlphaDiscard ? "uniform float uWindTime;" : ""}

            out highp vec3 vNormal;
            out highp vec3 vColor;
            out highp vec2 vUV;
            out highp vec3 vWorldPos;
            out highp float vVertexAO;
            flat out highp int vLayer;
            flat out highp int vFadeCode;

            void main(void) {
                int visIdx = uBaseInstance + gl_InstanceID;
                int packedVis = texelFetch(uVisibleIdsTex, ivec2(visIdx & 1023, visIdx >> 10), 0).r;
                int instId = packedVis & 0xFFFFF;
                vFadeCode = (packedVis >> 20) & 0xFF;
                int baseTexel = instId * 4;
                vec4 row0 = texelFetch(uInstanceDataTex, ivec2(baseTexel & 1023, baseTexel >> 10), 0);
                vec4 row1 = texelFetch(uInstanceDataTex, ivec2((baseTexel + 1) & 1023, (baseTexel + 1) >> 10), 0);
                vec4 row2 = texelFetch(uInstanceDataTex, ivec2((baseTexel + 2) & 1023, (baseTexel + 2) >> 10), 0);
                vec4 instCol = texelFetch(uInstanceDataTex, ivec2((baseTexel + 3) & 1023, (baseTexel + 3) >> 10), 0);

                vec4 pos4 = vec4(aVertexPosition, 1.0);
                vec3 worldPos = vec3(dot(row0, pos4), dot(row1, pos4), dot(row2, pos4));
                ${withAlphaDiscard ? `
                if (uWindTime > 0.001) {
                    // PR RaShaderLeaf.fx wind formula: ObjRadii = ObjRadius + Pos.y; taller canopies sway slower
                    float hPos = max(aVertexPosition.y, 0.0);
                    float objRadii = 2.0 + hPos;
                    float phase = worldPos.x * 0.11 + worldPos.z * 0.09;
                    float sway = sin((uWindTime / objRadii) * 4.5 + phase) * (objRadii * objRadii) / 260.0;
                    float hMask = smoothstep(0.25, 2.2, hPos);
                    worldPos.x += sway * hMask;
                    worldPos.z += cos((uWindTime / objRadii) * 3.8 + phase * 1.15) * (objRadii * objRadii) / 340.0 * hMask;
                }
                ` : ""}
                vWorldPos = worldPos;
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(worldPos, 1.0);

                vec3 wn = vec3(
                    dot(row0.xyz, aVertexNormal),
                    dot(row1.xyz, aVertexNormal),
                    dot(row2.xyz, aVertexNormal)
                );
                float wnLen = length(wn);
                vNormal = (wnLen > 1e-4) ? (wn / wnLen) : vec3(0.0, 1.0, 0.0);

                vec3 col = aVertexColor.rgb;
                if (uUseStructureColors == 1 && instCol.a > 0.5) {
                    col = mix(col, instCol.rgb, 0.45);
                }
                vColor = col;
                vUV = aVertexUV;
                vVertexAO = aVertexAO;
                vLayer = int(aVertexLayer);
            }
        `;

        const fsSource = this._buildTexFragmentShader(withAlphaDiscard, withLodFade, fastShadowPcf);
        const vs = renderer3d.loadShader(gl.VERTEX_SHADER, vsSource);
        const fs = renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Unable to initialize instanced textured structure shader program: ' + gl.getProgramInfoLog(prog));
            return null;
        }
        return {
            program: prog,
            uProjectionMatrix: gl.getUniformLocation(prog, 'uProjectionMatrix'),
            uViewMatrix: gl.getUniformLocation(prog, 'uViewMatrix'),
            uInstanceDataTex: gl.getUniformLocation(prog, 'uInstanceDataTex'),
            uVisibleIdsTex: gl.getUniformLocation(prog, 'uVisibleIdsTex'),
            uBaseInstance: gl.getUniformLocation(prog, 'uBaseInstance'),
            uUseStructureColors: gl.getUniformLocation(prog, 'uUseStructureColors'),
            uTexArray: gl.getUniformLocation(prog, 'uTexArray'),
            uPassMode: gl.getUniformLocation(prog, 'uPassMode'),
            uSunDir: gl.getUniformLocation(prog, 'uSunDir'),
            uCameraPos: gl.getUniformLocation(prog, 'uCameraPos'),
            uUsePrReflections: gl.getUniformLocation(prog, 'uUsePrReflections'),
            uWindTime: withAlphaDiscard ? gl.getUniformLocation(prog, 'uWindTime') : null,
            uLightSpaceMatrix: gl.getUniformLocation(prog, 'uLightSpaceMatrix'),
            uShadowMap: gl.getUniformLocation(prog, 'uShadowMap'),
            uUseShadows: gl.getUniformLocation(prog, 'uUseShadows'),
            uUseVertexAO: gl.getUniformLocation(prog, 'uUseVertexAO')
        };
    }

    _compileStaticChunkProgram(gl, withAlphaDiscard) {
        const vsSource = `#version 300 es
            layout(location = 0) in vec3 aVertexPosition;
            layout(location = 1) in vec3 aVertexNormal;
            layout(location = 2) in vec2 aVertexUV;
            layout(location = 3) in vec4 aVertexColor;
            layout(location = 4) in uint aVertexLayer;
            layout(location = 5) in vec4 aStructTint;
            layout(location = 6) in float aVertexAO;

            uniform mat4 uProjectionMatrix;
            uniform mat4 uViewMatrix;
            uniform int uUseStructureColors;

            out highp vec3 vNormal;
            out highp vec3 vColor;
            out highp vec2 vUV;
            out highp vec3 vWorldPos;
            out highp float vVertexAO;
            flat out highp int vLayer;
            flat out highp int vFadeCode;

            void main(void) {
                vWorldPos = aVertexPosition;
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(aVertexPosition, 1.0);
                float wnLen = length(aVertexNormal);
                vNormal = (wnLen > 1e-4) ? (aVertexNormal / wnLen) : vec3(0.0, 1.0, 0.0);

                vec3 col = aVertexColor.rgb;
                if (uUseStructureColors == 1 && aStructTint.a > 0.5) {
                    col = mix(col, aStructTint.rgb, 0.45);
                }
                vColor = col;
                vUV = aVertexUV;
                vVertexAO = aVertexAO;
                vLayer = int(aVertexLayer);
                vFadeCode = 0;
            }
        `;

        // Static world chunks never use LOD fade (vFadeCode == 0); zero discard restores hardware Early-Z!
        const fsSource = this._buildTexFragmentShader(withAlphaDiscard, false, true);
        const vs = renderer3d.loadShader(gl.VERTEX_SHADER, vsSource);
        const fs = renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Unable to initialize static chunk structure shader program: ' + gl.getProgramInfoLog(prog));
            return null;
        }
        return {
            program: prog,
            uProjectionMatrix: gl.getUniformLocation(prog, 'uProjectionMatrix'),
            uViewMatrix: gl.getUniformLocation(prog, 'uViewMatrix'),
            uUseStructureColors: gl.getUniformLocation(prog, 'uUseStructureColors'),
            uTexArray: gl.getUniformLocation(prog, 'uTexArray'),
            uPassMode: gl.getUniformLocation(prog, 'uPassMode'),
            uSunDir: gl.getUniformLocation(prog, 'uSunDir'),
            uCameraPos: gl.getUniformLocation(prog, 'uCameraPos'),
            uUsePrReflections: gl.getUniformLocation(prog, 'uUsePrReflections'),
            uWindTime: withAlphaDiscard ? gl.getUniformLocation(prog, 'uWindTime') : null,
            uLightSpaceMatrix: gl.getUniformLocation(prog, 'uLightSpaceMatrix'),
            uShadowMap: gl.getUniformLocation(prog, 'uShadowMap'),
            uUseShadows: gl.getUniformLocation(prog, 'uUseShadows'),
            uUseVertexAO: gl.getUniformLocation(prog, 'uUseVertexAO')
        };
    }

    _compileShadowPrograms(gl) {
        const emptyFs = `#version 300 es
            precision lowp float;
            void main(void) {}
        `;
        const alphaFs = `#version 300 es
            precision highp float;
            precision highp sampler2DArray;
            in highp vec2 vUV;
            flat in highp int vLayer;
            uniform sampler2DArray uTexArray;
            void main(void) {
                float a = texture(uTexArray, vec3(vUV, float(vLayer))).a;
                if (a < 0.30) discard;
            }
        `;

        // 1. Solid chunk shadow caster
        const solidVs = `#version 300 es
            in vec3 aVertexPosition;
            uniform mat4 uLightSpaceMatrix;
            void main(void) {
                gl_Position = uLightSpaceMatrix * vec4(aVertexPosition, 1.0);
            }
        `;
        const sSolid = gl.createProgram();
        gl.attachShader(sSolid, renderer3d.loadShader(gl.VERTEX_SHADER, solidVs));
        gl.attachShader(sSolid, renderer3d.loadShader(gl.FRAGMENT_SHADER, emptyFs));
        gl.linkProgram(sSolid);
        this.shadowSolidProgram = gl.getProgramParameter(sSolid, gl.LINK_STATUS) ? {
            program: sSolid,
            aPos: gl.getAttribLocation(sSolid, 'aVertexPosition'),
            uLightSpaceMatrix: gl.getUniformLocation(sSolid, 'uLightSpaceMatrix')
        } : null;

        // 2. Instanced textured shadow caster (opaque & alpha)
        const instVs = `#version 300 es
            layout(location = 0) in vec3 aVertexPosition;
            layout(location = 2) in vec2 aVertexUV;
            layout(location = 4) in uint aVertexLayer;
            uniform mat4 uLightSpaceMatrix;
            uniform highp sampler2D uInstanceDataTex;
            uniform highp isampler2D uVisibleIdsTex;
            uniform int uBaseInstance;
            out highp vec2 vUV;
            flat out highp int vLayer;
            void main(void) {
                int visIdx = uBaseInstance + gl_InstanceID;
                int packedVis = texelFetch(uVisibleIdsTex, ivec2(visIdx & 1023, visIdx >> 10), 0).r;
                int instId = packedVis & 0xFFFFF;
                int baseTexel = instId * 4;
                vec4 row0 = texelFetch(uInstanceDataTex, ivec2(baseTexel & 1023, baseTexel >> 10), 0);
                vec4 row1 = texelFetch(uInstanceDataTex, ivec2((baseTexel + 1) & 1023, (baseTexel + 1) >> 10), 0);
                vec4 row2 = texelFetch(uInstanceDataTex, ivec2((baseTexel + 2) & 1023, (baseTexel + 2) >> 10), 0);
                vec4 pos4 = vec4(aVertexPosition, 1.0);
                vec3 worldPos = vec3(dot(row0, pos4), dot(row1, pos4), dot(row2, pos4));
                gl_Position = uLightSpaceMatrix * vec4(worldPos, 1.0);
                vUV = aVertexUV;
                vLayer = int(aVertexLayer);
            }
        `;
        const buildInst = (withAlpha) => {
            const p = gl.createProgram();
            gl.attachShader(p, renderer3d.loadShader(gl.VERTEX_SHADER, instVs));
            gl.attachShader(p, renderer3d.loadShader(gl.FRAGMENT_SHADER, withAlpha ? alphaFs : emptyFs));
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
            return {
                program: p,
                uLightSpaceMatrix: gl.getUniformLocation(p, 'uLightSpaceMatrix'),
                uInstanceDataTex: gl.getUniformLocation(p, 'uInstanceDataTex'),
                uVisibleIdsTex: gl.getUniformLocation(p, 'uVisibleIdsTex'),
                uBaseInstance: gl.getUniformLocation(p, 'uBaseInstance'),
                uTexArray: gl.getUniformLocation(p, 'uTexArray')
            };
        };
        this.shadowInstOpaqueProgram = buildInst(false);
        this.shadowInstAlphaProgram = buildInst(true);

        // 3. Static 256m chunk shadow caster (opaque & alpha)
        const chunkVs = `#version 300 es
            layout(location = 0) in vec3 aVertexPosition;
            layout(location = 2) in vec2 aVertexUV;
            layout(location = 4) in uint aVertexLayer;
            uniform mat4 uLightSpaceMatrix;
            out highp vec2 vUV;
            flat out highp int vLayer;
            void main(void) {
                gl_Position = uLightSpaceMatrix * vec4(aVertexPosition, 1.0);
                vUV = aVertexUV;
                vLayer = int(aVertexLayer);
            }
        `;
        const buildChunk = (withAlpha) => {
            const p = gl.createProgram();
            gl.attachShader(p, renderer3d.loadShader(gl.VERTEX_SHADER, chunkVs));
            gl.attachShader(p, renderer3d.loadShader(gl.FRAGMENT_SHADER, withAlpha ? alphaFs : emptyFs));
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
            return {
                program: p,
                uLightSpaceMatrix: gl.getUniformLocation(p, 'uLightSpaceMatrix'),
                uTexArray: gl.getUniformLocation(p, 'uTexArray')
            };
        };
        this.shadowChunkOpaqueProgram = buildChunk(false);
        this.shadowChunkAlphaProgram = buildChunk(true);
    }

    init() {
        if (this.initialized) return true;

        const gl = renderer3d.gl;
        if (!gl) return false;

        const vsSource = `#version 300 es
            in vec3 aVertexPosition;
            in vec3 aVertexNormal;
            in vec4 aVertexColor;

            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;

            out highp vec3 vNormal;
            out highp vec4 vColor;
            out highp vec3 vWorldPos;

            void main(void) {
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(aVertexPosition, 1.0);
                vNormal = aVertexNormal;
                vColor = aVertexColor;
                vWorldPos = aVertexPosition;
            }
        `;

        const fsSource = `#version 300 es
            precision highp float;
            precision highp sampler2DShadow;

            in highp vec3 vNormal;
            in highp vec4 vColor;
            in highp vec3 vWorldPos;

            uniform int uUseStructureColors;
            uniform vec3 uSunDir;
            uniform mat4 uLightSpaceMatrix;
            uniform sampler2DShadow uShadowMap;
            uniform int uUseShadows;

            out vec4 fragColor;

            float sampleSolidShadow(vec3 worldPos, vec3 norm, float ndotl) {
                float nOff = mix(0.09, 0.03, ndotl);
                vec4 ls = uLightSpaceMatrix * vec4(worldPos + norm * nOff, 1.0);
                vec3 proj = (ls.xyz / ls.w) * 0.5 + 0.5;
                if (proj.x <= 0.002 || proj.x >= 0.998 || proj.y <= 0.002 || proj.y >= 0.998 || proj.z <= 0.0 || proj.z >= 1.0) {
                    return 1.0;
                }
                float edge = min(min(proj.x, 1.0 - proj.x), min(proj.y, 1.0 - proj.y));
                float edgeFade = smoothstep(0.0, 0.12, edge);
                float zRef = proj.z - mix(0.00038, 0.00014, ndotl);
                float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
                float ca = cos(ang), sa = sin(ang);
                mat2 rot = mat2(ca, -sa, sa, ca);
                const float rad = 1.65 / 2048.0;
                const vec2 POISSON[9] = vec2[9](
                    vec2( 0.000,  0.000),
                    vec2( 0.52989,  0.21538),
                    vec2(-0.460,  0.340),
                    vec2( 0.180, -0.580),
                    vec2(-0.290, -0.490),
                    vec2( 0.89604, -0.35385),
                    vec2(-0.850, -0.220),
                    vec2( 0.340,  0.880),
                    vec2(-0.41562,  0.84698)
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
                highp vec3 norm = normalize(vNormal);
                if (!gl_FrontFacing) norm = -norm;

                highp vec3 sunDir = normalize(uSunDir);
                highp float rawNdotL = max(dot(norm, sunDir), 0.0);
                // PR RealityShaders Half-Lambert (RDirectXTK_GetHalfNL)
                highp float halfNL = dot(norm, sunDir) * 0.5 + 0.5;
                highp float sunDiff = halfNL * halfNL;
                if (uUseShadows == 1 && rawNdotL > 0.001) {
                    float sh = sampleSolidShadow(vWorldPos, norm, rawNdotL);
                    sunDiff *= mix(0.18, 1.0, sh);
                }

                highp vec3 skyDir = normalize(vec3(-sunDir.x, 0.65, -sunDir.z));
                highp float skyDiff = max(dot(norm, skyDir), 0.0);

                highp float skyFactor = clamp(norm.y * 0.5 + 0.5, 0.0, 1.0);
                highp float lighting = 0.22 + (0.48 * sunDiff) + (0.15 * skyDiff) + (0.15 * skyFactor);

                highp vec3 baseCol = vColor.rgb;
                if (vColor.a < 0.75) {
                    baseCol = (uUseStructureColors == 1) ? vColor.rgb : vec3(0.0, 0.898, 1.0);
                }

                fragColor = vec4(baseCol * lighting, 1.0);
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
        this.uUseStructureColors = gl.getUniformLocation(prog, 'uUseStructureColors');
        this.uSunDir = gl.getUniformLocation(prog, 'uSunDir');
        this.uLightSpaceMatrix = gl.getUniformLocation(prog, 'uLightSpaceMatrix');
        this.uShadowMap = gl.getUniformLocation(prog, 'uShadowMap');
        this.uUseShadows = gl.getUniformLocation(prog, 'uUseShadows');

        const bushVsSource = `#version 300 es
            in vec3 aVertexPosition;
            in vec3 aVertexNormal;
            in vec4 aVertexColor;

            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;
            uniform float uWindTime;

            out highp vec3 vNormal;
            out highp vec4 vColor;
            out highp vec3 vWorldPos;

            void main(void) {
                vec3 wp = aVertexPosition;
                if (uWindTime > 0.001) {
                    float wFactor = clamp(aVertexNormal.y * 0.5 + 0.5, 0.0, 1.0);
                    float phase = wp.x * 0.23 + wp.z * 0.19;
                    float sway = sin(uWindTime * 1.7 + phase) + 0.4 * sin(uWindTime * 3.6 + phase * 1.6);
                    wp.x += sway * 0.085 * wFactor;
                    wp.z += cos(uWindTime * 1.45 + phase * 0.85) * 0.065 * wFactor;
                }
                gl_Position = uProjectionMatrix * uViewMatrix * vec4(wp, 1.0);
                vNormal = aVertexNormal;
                vColor = aVertexColor;
                vWorldPos = wp;
            }
        `;

        const bushFsSource = `#version 300 es
            precision highp float;
            precision highp int;

            in highp vec3 vNormal;
            in highp vec4 vColor;
            in highp vec3 vWorldPos;
            uniform highp vec3 uCameraPos;
            uniform highp vec3 uSunDir;
            uniform int uUseFog;
            uniform highp vec3 uFogOrigin;
            uniform highp vec4 uFogRange;
            uniform highp float uFogAlphaFloor;

            out highp vec4 fragColor;

            void main(void) {
                highp float fogVis = 1.0;
                if (uUseFog == 1) {
                    highp float fogDist = length(vWorldPos - uFogOrigin);
                    highp vec2 fv = fogDist * uFogRange.xy + uFogRange.zw;
                    highp float closeF = max(fv.y, uFogAlphaFloor);
                    highp float fx = max(fv.x, 0.0);
                    fogVis = smoothstep(0.0, 1.0, closeF - fx * fx * fx);
                    if (fogVis <= 0.0040949) discard;
                }

                highp vec3 smoothNorm = normalize(vNormal);
                if (!gl_FrontFacing) smoothNorm = -smoothNorm;

                // Geometric flat normal blends subtle leaf/twig facets without extra vertices
                highp vec3 dp = cross(dFdx(vWorldPos), dFdy(vWorldPos));
                highp float dpLen2 = dot(dp, dp);
                highp vec3 flatNorm = (dpLen2 > 1e-10) ? (dp * inversesqrt(dpLen2)) : smoothNorm;
                if (dot(flatNorm, smoothNorm) < 0.0) flatNorm = -flatNorm;

                highp vec3 norm = normalize(mix(smoothNorm, flatNorm, 0.34));

                highp vec3 viewDir = normalize(uCameraPos - vWorldPos);
                highp float ndotv = clamp(abs(dot(smoothNorm, viewDir)), 0.0, 1.0);
                // Center-to-rim falloff: denser interior core, cleaner outer twig/leaf rim
                highp float thickness = pow(ndotv, 0.60);

                highp vec3 sunDir = normalize(uSunDir);
                highp float sunDiff = max(dot(norm, sunDir), 0.0);

                highp vec3 skyDir = normalize(vec3(-sunDir.x, 0.65, -sunDir.z));
                highp float skyDiff = max(dot(norm, skyDir), 0.0);

                highp float skyFactor = clamp(norm.y * 0.5 + 0.5, 0.0, 1.0);
                highp float lighting = 0.42 + (0.46 * sunDiff) + (0.14 * skyDiff) + (0.12 * skyFactor);

                highp vec3 coreCol = vColor.rgb * 0.94 * lighting;
                highp vec3 edgeCol = vColor.rgb * 1.16 * lighting;
                highp vec3 finalCol = mix(edgeCol, coreCol, thickness * 0.72);

                highp float alpha = mix(vColor.a * 0.62, vColor.a, thickness) * fogVis;
                fragColor = vec4(finalCol, clamp(alpha, 0.0, 0.92));
            }
        `;

        const bushVertShader = renderer3d.loadShader(gl.VERTEX_SHADER, bushVsSource);
        const bushFragShader = renderer3d.loadShader(gl.FRAGMENT_SHADER, bushFsSource);
        const bushProg = gl.createProgram();
        gl.attachShader(bushProg, bushVertShader);
        gl.attachShader(bushProg, bushFragShader);
        gl.linkProgram(bushProg);

        if (!gl.getProgramParameter(bushProg, gl.LINK_STATUS)) {
            console.error('Unable to initialize foliage volume shader program: ' + gl.getProgramInfoLog(bushProg));
            return false;
        }

        this.bushProgram = bushProg;
        this.bVertexPosition = gl.getAttribLocation(bushProg, 'aVertexPosition');
        this.bVertexNormal = gl.getAttribLocation(bushProg, 'aVertexNormal');
        this.bVertexColor = gl.getAttribLocation(bushProg, 'aVertexColor');
        this.bProjectionMatrix = gl.getUniformLocation(bushProg, 'uProjectionMatrix');
        this.bViewMatrix = gl.getUniformLocation(bushProg, 'uViewMatrix');
        this.bCameraPos = gl.getUniformLocation(bushProg, 'uCameraPos');
        this.bSunDir = gl.getUniformLocation(bushProg, 'uSunDir');
        this.bWindTime = gl.getUniformLocation(bushProg, 'uWindTime');
        this.bUseFog = gl.getUniformLocation(bushProg, 'uUseFog');
        this.bFogOrigin = gl.getUniformLocation(bushProg, 'uFogOrigin');
        this.bFogRange = gl.getUniformLocation(bushProg, 'uFogRange');
        this.bFogAlphaFloor = gl.getUniformLocation(bushProg, 'uFogAlphaFloor');

        // Separate zero-discard Early-Z opaque program from LOD-fade opaque program
        this.texOpaqueProgram = this._compileInstancedTexProgram(gl, false, false, false);
        this.texOpaqueFadeProgram = this._compileInstancedTexProgram(gl, false, true, true);
        this.texAlphaProgram = this._compileInstancedTexProgram(gl, true, true, true);
        this.chunkOpaqueProgram = this._compileStaticChunkProgram(gl, false);
        this.chunkAlphaProgram = this._compileStaticChunkProgram(gl, true);
        this._compileShadowPrograms(gl);

        this.initialized = true;

        this.rebuildBuffers();
        return true;
    }

    _disposeChunkList(gl, list) {
        if (!list) return;
        for (let c = 0; c < list.length; c++) {
            if (list[c].vertexBuffer) gl.deleteBuffer(list[c].vertexBuffer);
            if (list[c].indexBuffer) gl.deleteBuffer(list[c].indexBuffer);
        }
        list.length = 0;
    }

    _disposeBushChunks(gl) {
        this._disposeChunkList(gl, this.bushChunks);
        this.bushChunks = [];
    }

    _disposeStaticChunkGpu(gl, texEntry) {
        if (!texEntry) return;
        if (texEntry.chunkVao) {
            gl.deleteVertexArray(texEntry.chunkVao);
            texEntry.chunkVao = null;
        }
        if (texEntry.chunkVbo) {
            gl.deleteBuffer(texEntry.chunkVbo);
            texEntry.chunkVbo = null;
        }
        if (texEntry.chunkIbo) {
            gl.deleteBuffer(texEntry.chunkIbo);
            texEntry.chunkIbo = null;
        }
        texEntry.staticChunks = [];
        texEntry.chunkOpaqueBatches = [];
        texEntry.chunkAlphaBatches = [];
    }

    _evictOtherMapTexEntries(gl, keepMapKey) {
        for (const [k, entry] of this._mapTex3dCache.entries()) {
            if (k === keepMapKey) continue;
            if (entry && entry.ready) {
                if (entry.texArray) gl.deleteTexture(entry.texArray);
                if (entry.vao) gl.deleteVertexArray(entry.vao);
                if (entry.vbo) gl.deleteBuffer(entry.vbo);
                if (entry.ibo) gl.deleteBuffer(entry.ibo);
                if (entry.instanceDataTex) gl.deleteTexture(entry.instanceDataTex);
                if (entry.visibleIdsTex) gl.deleteTexture(entry.visibleIdsTex);
                this._disposeChunkList(gl, entry.fallbackChunks);
                this._disposeChunkList(gl, entry.fallbackTreeChunks);
                this._disposeChunkList(gl, entry.fallbackBushChunks);
                this._disposeStaticChunkGpu(gl, entry);
            }
            this._mapTex3dCache.delete(k);
        }
    }

    _lookupTexTemplateName(name, templatesMap) {
        if (!name || !templatesMap) return null;
        const n = name.toLowerCase();
        if (templatesMap[n]) return n;
        // Safe PR destructible/LOD/no-lightmap suffix fallback — never strip floor/variant numbers (_1floor, _v1)
        const s1 = n.replace(/(_nondestroyable|_nondest|_destroyable|_destructible|_dest|_pr|_bc|_lod|_nl)$/g, "");
        if (s1 && templatesMap[s1]) return s1;
        const s2 = n.replace(/_rw\d+_low$/g, "");
        if (s2 && templatesMap[s2]) return s2;
        return null;
    }

    _getActiveTexProfiles() {
        const wantStructs = (typeof options_StructureTextures !== "undefined" && !!options_StructureTextures);
        const wantTrees = (typeof options_TreeTextures !== "undefined" && !!options_TreeTextures);
        const wantBushes = (typeof options_BushTextures !== "undefined" && !!options_BushTextures);
        return {
            wantStructs,
            wantTrees,
            wantBushes,
            sig: `${wantStructs ? 1 : 0}${wantTrees ? 1 : 0}${wantBushes ? 1 : 0}`
        };
    }

    markCullDirty() {
        for (const entry of this._mapTex3dCache.values()) {
            if (entry && entry.ready) entry.cullDirty = true;
        }
    }

    onTextureProfileChanged() {
        if (!this.initialized) return;
        const mapKey = (typeof buildingHeightmap !== "undefined" && buildingHeightmap._mapKey)
            ? buildingHeightmap._mapKey.toLowerCase()
            : (this.currentMap || "").toLowerCase();
        if (!mapKey) return;

        const { wantStructs, wantTrees, wantBushes } = this._getActiveTexProfiles();
        const anyEnabled = wantStructs || wantTrees || wantBushes;
        const cachedTex = this._mapTex3dCache.get(mapKey);

        if (anyEnabled && (!cachedTex || (cachedTex.ready === undefined && !this._mapTex3dPending.has(mapKey)))) {
            this._ensureStructureTexturesLoaded(mapKey);
        } else if (cachedTex && cachedTex.ready) {
            this._buildMapTexInstances(mapKey, cachedTex, true);
            cachedTex.cullDirty = true;
        }

        if (typeof requestUpdate === "function") requestUpdate();
    }

    async _ensureStructureTexturesLoaded(mapKey) {
        if (!mapKey || this._mapTex3dCache.has(mapKey) || this._mapTex3dPending.has(mapKey)) return;
        this._mapTex3dPending.add(mapKey);
        try {
            // Fetch meta.json first with no-cache so meta and bin can NEVER desync across Firefox's 50MB cache limit
            const metaResp = await fetch(`MapsStaticobjects/${mapKey}/${mapKey}_tex3d.meta.json?v=8.1_ao_lm_sync`, { cache: "no-cache" });
            if (!metaResp.ok) {
                this._mapTex3dCache.set(mapKey, { ready: false });
                return;
            }
            const meta = await metaResp.json();
            if (!meta || !Array.isArray(meta.textures) || !meta.templates || !meta.vertBytes) {
                this._mapTex3dCache.set(mapKey, { ready: false });
                return;
            }
            const binTag = `vb=${meta.vertBytes}&ti=${meta.totalIndices || 0}`;
            const binResp = await fetch(`MapsStaticobjects/${mapKey}/${mapKey}_tex3d.bin?v=8.1_ao_lm_sync&${binTag}`, { cache: "no-cache" });
            if (!binResp.ok) {
                this._mapTex3dCache.set(mapKey, { ready: false });
                return;
            }
            const binBuf = await binResp.arrayBuffer();
            const expectedBinBytes = meta.totalIndices ? (meta.vertBytes + meta.totalIndices * 4) : 0;
            if (binBuf.byteLength <= meta.vertBytes || (expectedBinBytes > 0 && binBuf.byteLength !== expectedBinBytes)) {
                console.error(`STRUCT_TEX: meta/bin byte-length mismatch for ${mapKey} (got ${binBuf.byteLength}, expected ${expectedBinBytes})`);
                this._mapTex3dCache.set(mapKey, { ready: false });
                return;
            }

            const texNames = meta.textures;
            const loadImg = (texKey) => new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = `Textures/statics/${texKey}.webp?v=2.0_trees_alpha`;
            });

            const images = await Promise.all(texNames.map(loadImg));
            const gl = renderer3d.gl;
            if (!gl) return;
            this._evictOtherMapTexEntries(gl, mapKey);

            const layerCount = Math.max(1, images.length);
            const texArray = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, texArray);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            const mipLevels = Math.floor(Math.log2(256)) + 1;
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mipLevels, gl.RGBA8, 256, 256, layerCount);

            const fallbackPixels = new Uint8Array(256 * 256 * 4);
            fallbackPixels.fill(200);
            for (let idx = 0; idx < images.length; idx++) {
                const img = images[idx];
                if (img) {
                    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, idx, 256, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, img);
                } else {
                    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, idx, 256, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, fallbackPixels);
                }
            }

            gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic')
                || gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
                || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
            if (anisoExt) {
                const maxAniso = gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
                gl.texParameterf(gl.TEXTURE_2D_ARRAY, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, maxAniso));
            }
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

            // Upload single shared template VBO + IBO into a dedicated VAO (32 bytes per vertex)
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);

            const vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(binBuf, 0, meta.vertBytes), gl.STATIC_DRAW);

            const ibo = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(binBuf, meta.vertBytes), gl.STATIC_DRAW);

            // loc 0: aVertexPosition (3x float32 @ offset 0)
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
            // loc 1: aVertexNormal (3x int8 normalized @ offset 12)
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 3, gl.BYTE, true, 32, 12);
            // loc 2: aVertexUV (2x float32 @ offset 16)
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 16);
            // loc 3: aVertexColor (4x uint8 normalized @ offset 24)
            gl.enableVertexAttribArray(3);
            gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 32, 24);
            // loc 4: aVertexLayer (1x uint16 integer @ offset 28)
            gl.enableVertexAttribArray(4);
            gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_SHORT, 32, 28);
            // loc 6: aVertexAO (1x uint8 normalized @ offset 15 free padding byte)
            gl.enableVertexAttribArray(6);
            gl.vertexAttribPointer(6, 1, gl.UNSIGNED_BYTE, true, 32, 15);

            gl.bindVertexArray(null);

            const srcVertF32 = new Float32Array(binBuf, 0, Math.floor(meta.vertBytes / 4));
            const srcVertI8 = new Int8Array(binBuf, 0, meta.vertBytes);
            const srcVertU8 = new Uint8Array(binBuf, 0, meta.vertBytes);
            const srcVertU32 = new Uint32Array(binBuf, 0, Math.floor(meta.vertBytes / 4));
            const srcIdxU32 = new Uint32Array(binBuf, meta.vertBytes, Math.floor((binBuf.byteLength - meta.vertBytes) / 4));

            const templateList = [];
            const templateNameToIndex = new Map();
            for (const [tName, tMeta] of Object.entries(meta.templates)) {
                const cat = (typeof tMeta.cat === "number")
                    ? tMeta.cat
                    : (this._isTree(tName) ? 1 : (this._isBush(tName) ? 2 : 0));
                let lod2Raw = null;
                if (cat === 0 && tMeta.lods) {
                    let r = tMeta.lods[2];
                    if (!r || (r[1] + r[3]) === 0) r = tMeta.lods[0];
                    if (r && (r[1] + r[3]) > 0) {
                        const opStart = r[0], opCount = r[1];
                        const alStart = r[2], alCount = r[3];
                        const srcToLocal = new Map();
                        const localSrcIds = [];
                        const opIdx = new Uint32Array(opCount);
                        const alIdx = new Uint32Array(alCount);

                        for (let j = 0; j < opCount; j++) {
                            const sv = srcIdxU32[opStart + j];
                            let lv = srcToLocal.get(sv);
                            if (lv === undefined) {
                                lv = localSrcIds.length;
                                srcToLocal.set(sv, lv);
                                localSrcIds.push(sv);
                            }
                            opIdx[j] = lv;
                        }
                        for (let j = 0; j < alCount; j++) {
                            const sv = srcIdxU32[alStart + j];
                            let lv = srcToLocal.get(sv);
                            if (lv === undefined) {
                                lv = localSrcIds.length;
                                srcToLocal.set(sv, lv);
                                localSrcIds.push(sv);
                            }
                            alIdx[j] = lv;
                        }

                        const nV = localSrcIds.length;
                        const pos = new Float32Array(nV * 3);
                        const norm = new Float32Array(nV * 3);
                        const aoU8 = new Uint8Array(nV);
                        const tailU32 = new Uint32Array(nV * 4);
                        for (let v = 0; v < nV; v++) {
                            const sv = localSrcIds[v];
                            const sF32 = sv * 8;
                            const sByte = sv * 32;
                            const d3 = v * 3;
                            const d4 = v * 4;
                            pos[d3]     = srcVertF32[sF32];
                            pos[d3 + 1] = srcVertF32[sF32 + 1];
                            pos[d3 + 2] = srcVertF32[sF32 + 2];
                            norm[d3]     = srcVertI8[sByte + 12] / 127.0;
                            norm[d3 + 1] = srcVertI8[sByte + 13] / 127.0;
                            norm[d3 + 2] = srcVertI8[sByte + 14] / 127.0;
                            aoU8[v]      = srcVertU8[sByte + 15];
                            tailU32[d4]     = srcVertU32[sF32 + 4];
                            tailU32[d4 + 1] = srcVertU32[sF32 + 5];
                            tailU32[d4 + 2] = srcVertU32[sF32 + 6];
                            tailU32[d4 + 3] = srcVertU32[sF32 + 7];
                        }
                        lod2Raw = { nVerts: nV, pos, norm, aoU8, tailU32, opIdx, alIdx };
                    }
                }
                templateNameToIndex.set(tName, templateList.length);
                const rad = Math.max(0.5, tMeta.r || 4.0);
                const isLinear = this._isLinearInfrastructure(tName);
                const isMicroProp = (cat === 0 && !isLinear && rad < 3.0);
                const l0 = tMeta.lods[0], l1 = tMeta.lods[1], l2 = tMeta.lods[2];
                const hasUniqueLod1 = !!(l1 && (l1[1] + l1[3]) > 0 && (l1[0] !== l0[0] || l1[1] !== l0[1] || l1[2] !== l0[2] || l1[3] !== l0[3]));
                const hasUniqueLod2 = !!(l2 && (l2[1] + l2[3]) > 0 && (
                    hasUniqueLod1
                        ? (l2[0] !== l1[0] || l2[1] !== l1[1] || l2[2] !== l1[2] || l2[3] !== l1[3])
                        : (l2[0] !== l0[0] || l2[1] !== l0[1] || l2[2] !== l0[2] || l2[3] !== l0[3])
                ));
                templateList.push({
                    name: tName,
                    cat: cat,
                    isLinear,
                    isMicroProp,
                    hasUniqueLod1,
                    hasUniqueLod2,
                    c: tMeta.c || [0, 0, 0],
                    r: rad,
                    lods: tMeta.lods,
                    lod2Raw
                });
            }

            const texEntry = {
                ready: true,
                mapKey,
                totalVerts: meta.totalVerts || Math.floor(meta.vertBytes / 32),
                textures: texNames,
                templates: meta.templates,
                templateList,
                templateNameToIndex,
                texArray,
                vao,
                vbo,
                ibo,
                instancesBuiltForCount: -1,
                profileSig: "",
                instanceCount: 0,
                instanceDataTex: null,
                visibleIdsTex: null,
                visibleIdsBuf: null,
                fallbackChunks: [],
                fallbackTreeChunks: [],
                fallbackBushChunks: [],
                chunkVao: null,
                chunkVbo: null,
                chunkIbo: null,
                staticChunks: [],
                chunkOpaqueBatches: [],
                chunkAlphaBatches: [],
                cells: [],
                opaqueBatches: [],
                lod2Batches: [],
                alphaBatches: [],
                cullDirty: true,
                lastCamState: new Float64Array(16)
            };

            this._mapTex3dCache.set(mapKey, texEntry);
            this._buildMapTexInstances(mapKey, texEntry, true);

            if (typeof requestUpdate === "function") requestUpdate();
        } catch (err) {
            console.warn("STRUCT_TEX: Failed to load instanced structure package for " + mapKey, err);
            this._mapTex3dCache.set(mapKey, { ready: false });
        } finally {
            this._mapTex3dPending.delete(mapKey);
        }
    }

    _buildMapTexInstances(mapKey, texEntry, forceRebuild = false) {
        if (!texEntry || !texEntry.ready || typeof buildingHeightmap === "undefined" || !buildingHeightmap.initialized || !buildingHeightmap.obbs) {
            return;
        }
        const gl = renderer3d.gl;
        const obbs = buildingHeightmap.obbs;
        const { wantStructs, wantTrees, wantBushes, sig: profileSig } = this._getActiveTexProfiles();
        const anyTexEnabled = wantStructs || wantTrees || wantBushes;

        if (!forceRebuild &&
            texEntry.instancesBuiltForCount === obbs.length &&
            texEntry.profileSig === profileSig &&
            (texEntry.instanceDataTex || texEntry.instanceCount === 0)) {
            return;
        }

        if (texEntry.instanceDataTex) {
            gl.deleteTexture(texEntry.instanceDataTex);
            texEntry.instanceDataTex = null;
        }
        if (texEntry.visibleIdsTex) {
            gl.deleteTexture(texEntry.visibleIdsTex);
            texEntry.visibleIdsTex = null;
        }
        this._disposeChunkList(gl, texEntry.fallbackChunks);
        this._disposeChunkList(gl, texEntry.fallbackTreeChunks);
        this._disposeChunkList(gl, texEntry.fallbackBushChunks);
        this._disposeStaticChunkGpu(gl, texEntry);

        const matchedObbs = [];
        const matchedTmplIdx = [];
        const unmatchedTreeIndices = [];
        const unmatchedStructIndices = [];
        const unmatchedBushIndices = [];

        for (let i = 0; i < obbs.length; i++) {
            const obb = obbs[i];
            if (!obb || obb.hidden || obb.ignoreLOS) continue;
            const name = (obb.name || "").toLowerCase();
            if (this._isFlatFieldGrid(name)) continue;

            const isBush = this._isBush(name);
            const isTree = !isBush && this._isTree(name);

            if (anyTexEnabled && !obb.isCustom) {
                const resolvedName = this._lookupTexTemplateName(obb.name, texEntry.templates);
                if (resolvedName !== null) {
                    const tIdx = texEntry.templateNameToIndex.get(resolvedName);
                    if (tIdx !== undefined) {
                        const tmplCat = texEntry.templateList[tIdx].cat;
                        const wantThis = (tmplCat === 1 && wantTrees) || (tmplCat === 2 && wantBushes) || (tmplCat === 0 && wantStructs);
                        if (wantThis) {
                            matchedObbs.push(obb);
                            matchedTmplIdx.push(tIdx);
                            continue;
                        }
                    }
                }
            }
            if (isBush) {
                unmatchedBushIndices.push(i);
            } else if (isTree || obb.isCustom) {
                unmatchedTreeIndices.push(i);
            } else {
                unmatchedStructIndices.push(i);
            }
        }

        const numInstances = matchedObbs.length;
        texEntry.instanceCount = numInstances;
        texEntry.instancesBuiltForCount = obbs.length;
        texEntry.profileSig = profileSig;
        texEntry.opaqueBatches = [];
        texEntry.lod2Batches = [];
        texEntry.alphaBatches = [];
        texEntry.cullDirty = true;

        if (numInstances > 0) {
            const dataTexRows = Math.max(1, Math.ceil((numInstances * 4) / 1024));
            const instDataBuf = new Float32Array(1024 * dataTexRows * 4);

            const instSphereX = new Float32Array(numInstances);
            const instSphereY = new Float32Array(numInstances);
            const instSphereZ = new Float32Array(numInstances);
            const instSphereR = new Float32Array(numInstances);
            const instTmpl = new Int32Array(numInstances);
            const instOrigX = new Float32Array(numInstances);
            const instOrigY = new Float32Array(numInstances);
            const instOrigZ = new Float32Array(numInstances);

            const CELL_SIZE = 128.0;
            const cellMap = new Map();
            const superCellMap = new Map();

            for (let idx = 0; idx < numInstances; idx++) {
                const obb = matchedObbs[idx];
                const tIdx = matchedTmplIdx[idx];
                const tmpl = texEntry.templateList[tIdx];

                const basis = this._composeD3dBasis(obb);
                const ssx = obb.scaleX || 1.0;
                const ssz = obb.scaleZ || 1.0;
                const bY = (obb.y !== undefined && !isNaN(obb.y)) ? obb.y : 0.0;
                const ox = obb.x || 0.0;
                const oz = obb.z || 0.0;

                // 3x4 world transform rows with WebGL -Z flip baked into row2
                const r00 = ssx * basis.r00, r01 = basis.r10, r02 = ssz * basis.r20, r03 = ox;
                const r10 = ssx * basis.r01, r11 = basis.r11, r12 = ssz * basis.r21, r13 = bY;
                const r20 = -ssx * basis.r02, r21 = -basis.r12, r22 = -ssz * basis.r22, r23 = -oz;

                const scol = this._resolveStructurePaletteColor(obb);
                const allowStructTint = (tmpl.cat === 0) ? 1.0 : 0.0;
                const baseFloat = idx * 16;
                instDataBuf[baseFloat]      = r00; instDataBuf[baseFloat + 1]  = r01; instDataBuf[baseFloat + 2]  = r02; instDataBuf[baseFloat + 3]  = r03;
                instDataBuf[baseFloat + 4]  = r10; instDataBuf[baseFloat + 5]  = r11; instDataBuf[baseFloat + 6]  = r12; instDataBuf[baseFloat + 7]  = r13;
                instDataBuf[baseFloat + 8]  = r20; instDataBuf[baseFloat + 9]  = r21; instDataBuf[baseFloat + 10] = r22; instDataBuf[baseFloat + 11] = r23;
                instDataBuf[baseFloat + 12] = scol[0]; instDataBuf[baseFloat + 13] = scol[1]; instDataBuf[baseFloat + 14] = scol[2]; instDataBuf[baseFloat + 15] = allowStructTint;

                // World-space bounding sphere in WebGL coordinates (wx, wy, -wz)
                const lc = tmpl.c;
                const scx = r00 * lc[0] + r01 * lc[1] + r02 * lc[2] + r03;
                const scy = r10 * lc[0] + r11 * lc[1] + r12 * lc[2] + r13;
                const scz = r20 * lc[0] + r21 * lc[1] + r22 * lc[2] + r23;
                const maxScale = Math.max(1.0, Math.max(Math.abs(ssx), Math.abs(ssz)));
                const srad = tmpl.r * maxScale;

                instSphereX[idx] = scx;
                instSphereY[idx] = scy;
                instSphereZ[idx] = scz;
                instSphereR[idx] = srad;
                instTmpl[idx] = tIdx;
                instOrigX[idx] = ox;
                instOrigY[idx] = bY;
                instOrigZ[idx] = oz;

                const cx = Math.floor(scx / CELL_SIZE);
                const cz = Math.floor(scz / CELL_SIZE);
                const cKey = (cx << 16) ^ (cz & 0xffff);
                const scKey = ((cx >> 1) << 16) ^ ((cz >> 1) & 0xffff);
                let cell = cellMap.get(cKey);
                if (!cell) {
                    cell = {
                        minX: scx - srad, minY: scy - srad, minZ: scz - srad,
                        maxX: scx + srad, maxY: scy + srad, maxZ: scz + srad,
                        scKey,
                        list: [idx],
                        foliageList: tmpl.cat !== 0 ? [idx] : []
                    };
                    cellMap.set(cKey, cell);
                } else {
                    if (scx - srad < cell.minX) cell.minX = scx - srad;
                    if (scy - srad < cell.minY) cell.minY = scy - srad;
                    if (scz - srad < cell.minZ) cell.minZ = scz - srad;
                    if (scx + srad > cell.maxX) cell.maxX = scx + srad;
                    if (scy + srad > cell.maxY) cell.maxY = scy + srad;
                    if (scz + srad > cell.maxZ) cell.maxZ = scz + srad;
                    cell.list.push(idx);
                    if (tmpl.cat !== 0) cell.foliageList.push(idx);
                }

                if (tmpl.cat === 0 && !tmpl.isMicroProp && wantStructs) {
                    let sc = superCellMap.get(scKey);
                    if (!sc) {
                        sc = {
                            scKey,
                            minX: scx - srad, minY: scy - srad, minZ: scz - srad,
                            maxX: scx + srad, maxY: scy + srad, maxZ: scz + srad,
                            maxStructR: srad,
                            structList: [],
                            vertTotal: 0,
                            opTotal: 0,
                            alTotal: 0,
                            hasAllLod2Raw: true
                        };
                        superCellMap.set(scKey, sc);
                    } else {
                        if (scx - srad < sc.minX) sc.minX = scx - srad;
                        if (scy - srad < sc.minY) sc.minY = scy - srad;
                        if (scz - srad < sc.minZ) sc.minZ = scz - srad;
                        if (scx + srad > sc.maxX) sc.maxX = scx + srad;
                        if (scy + srad > sc.maxY) sc.maxY = scy + srad;
                        if (scz + srad > sc.maxZ) sc.maxZ = scz + srad;
                        if (srad > sc.maxStructR) sc.maxStructR = srad;
                    }
                    if (!tmpl.lod2Raw) {
                        sc.hasAllLod2Raw = false;
                    } else {
                        sc.structList.push(idx);
                        sc.vertTotal += tmpl.lod2Raw.nVerts;
                        sc.opTotal += tmpl.lod2Raw.opIdx.length;
                        sc.alTotal += tmpl.lod2Raw.alIdx.length;
                    }
                }
            }

            const cells = [];
            for (const c of cellMap.values()) {
                cells.push({
                    minX: c.minX, minY: c.minY, minZ: c.minZ,
                    maxX: c.maxX, maxY: c.maxY, maxZ: c.maxZ,
                    scKey: c.scKey,
                    parentChunkIdx: -1,
                    indices: new Int32Array(c.list),
                    foliageIndices: new Int32Array(c.foliageList)
                });
            }

            if (wantStructs && superCellMap.size > 0) {
                this._buildStaticChunksForTexEntry(gl, texEntry, superCellMap, instDataBuf, instTmpl, cells);
            }

            const instanceDataTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, instanceDataTex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, dataTexRows, 0, gl.RGBA, gl.FLOAT, instDataBuf);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            const visRows = Math.max(1, Math.ceil((numInstances * 2) / 1024));
            const visibleIdsBuf = new Int32Array(1024 * visRows);
            const visibleIdsTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, visibleIdsTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32I, 1024, visRows, 0, gl.RED_INTEGER, gl.INT, visibleIdsBuf);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.bindTexture(gl.TEXTURE_2D, null);

            const numBuckets = texEntry.templateList.length * 3;
            texEntry.instanceDataTex = instanceDataTex;
            texEntry.visibleIdsTex = visibleIdsTex;
            texEntry.visibleIdsBuf = visibleIdsBuf;
            texEntry.instSphereX = instSphereX;
            texEntry.instSphereY = instSphereY;
            texEntry.instSphereZ = instSphereZ;
            texEntry.instSphereR = instSphereR;
            texEntry.instTmpl = instTmpl;
            texEntry.cells = cells;
            texEntry.bucketCounts = new Int32Array(numBuckets);
            texEntry.bucketOffsets = new Int32Array(numBuckets);
            texEntry.bucketCursors = new Int32Array(numBuckets);
            texEntry.bucketHasFade = new Uint8Array(numBuckets);
            const prevLodArr = new Uint8Array(numInstances);
            prevLodArr.fill(255);
            texEntry.instPrevLod = prevLodArr;
            texEntry.visInstIdx = new Int32Array(numInstances * 2);
            texEntry.visInstBucket = new Int32Array(numInstances * 2);
            texEntry.frustumPlanes = new Float32Array(24);
        }

        // Build fallback chunks for custom/unmatched OBBs or disabled profiles
        if (anyTexEnabled) {
            if (unmatchedTreeIndices.length > 0) {
                texEntry.fallbackTreeChunks = this._buildSolidChunksForSubset(gl, obbs, unmatchedTreeIndices, true);
            }
            if (unmatchedStructIndices.length > 0) {
                texEntry.fallbackChunks = this._buildSolidChunksForSubset(gl, obbs, unmatchedStructIndices, false);
            }
            if (wantBushes && unmatchedBushIndices.length > 0) {
                texEntry.fallbackBushChunks = this._buildVolumetricBushChunks(gl, obbs, unmatchedBushIndices);
            }
        }

        const unmatchedTotal = unmatchedTreeIndices.length + unmatchedStructIndices.length;
        console.log(`%c[Building3dRenderer v7.0] GPU Instanced Package ready for ${mapKey} (profiles=${profileSig}) | Templates: ${texEntry.templateList.length} | Instances: ${numInstances.toLocaleString()} | StaticChunks(256m): ${texEntry.staticChunks ? texEntry.staticChunks.length : 0} | Unmatched Fallback: ${unmatchedTotal}`, 'color: #76ff03; font-weight: bold;');
    }

    _buildStaticChunksForTexEntry(gl, texEntry, superCellMap, instDataBuf, instTmpl, cells) {
        const eligibleSC = [];
        const superCellChunkIdx = new Map();
        let totalChunkVerts = 0;
        let totalChunkIndices = 0;

        for (const sc of superCellMap.values()) {
            if (!sc.hasAllLod2Raw || sc.structList.length === 0 || sc.vertTotal === 0 || (sc.opTotal + sc.alTotal) === 0) {
                continue;
            }
            superCellChunkIdx.set(sc.scKey, eligibleSC.length);
            eligibleSC.push(sc);
            totalChunkVerts += sc.vertTotal;
            totalChunkIndices += sc.opTotal + sc.alTotal;
        }

        if (totalChunkVerts === 0 || totalChunkIndices === 0 || totalChunkVerts * 36 > 250 * 1024 * 1024) {
            return;
        }

        for (let c = 0; c < cells.length; c++) {
            const ci = superCellChunkIdx.get(cells[c].scKey);
            if (ci !== undefined) cells[c].parentChunkIdx = ci;
        }

        const chunkVertBuf = new ArrayBuffer(totalChunkVerts * 36);
        const chunkF32 = new Float32Array(chunkVertBuf);
        const chunkI8 = new Int8Array(chunkVertBuf);
        const chunkU8 = new Uint8Array(chunkVertBuf);
        const chunkU32 = new Uint32Array(chunkVertBuf);
        const chunkIdxArr = new Uint32Array(totalChunkIndices);

        const staticChunks = [];
        let runningVertOffset = 0;
        let runningIdxOffset = 0;

        for (let i = 0; i < eligibleSC.length; i++) {
            const sc = eligibleSC[i];
            const cellOpStart = runningIdxOffset;
            let scOpCursor = cellOpStart;
            let scAlCursor = cellOpStart + sc.opTotal;

            for (let k = 0; k < sc.structList.length; k++) {
                const idx = sc.structList[k];
                const lr = texEntry.templateList[instTmpl[idx]].lod2Raw;
                const baseF = idx * 16;
                const r00 = instDataBuf[baseF],     r01 = instDataBuf[baseF + 1], r02 = instDataBuf[baseF + 2],  r03 = instDataBuf[baseF + 3];
                const r10 = instDataBuf[baseF + 4], r11 = instDataBuf[baseF + 5], r12 = instDataBuf[baseF + 6],  r13 = instDataBuf[baseF + 7];
                const r20 = instDataBuf[baseF + 8], r21 = instDataBuf[baseF + 9], r22 = instDataBuf[baseF + 10], r23 = instDataBuf[baseF + 11];
                const tintR = Math.max(0, Math.min(255, Math.round(instDataBuf[baseF + 12] * 255))) & 255;
                const tintG = Math.max(0, Math.min(255, Math.round(instDataBuf[baseF + 13] * 255))) & 255;
                const tintB = Math.max(0, Math.min(255, Math.round(instDataBuf[baseF + 14] * 255))) & 255;
                const tintA = instDataBuf[baseF + 15] > 0.5 ? 255 : 0;
                const tintPack = (tintR | (tintG << 8) | (tintB << 16) | (tintA << 24)) >>> 0;

                const vBase = runningVertOffset;
                const nV = lr.nVerts;
                const srcPos = lr.pos;
                const srcNorm = lr.norm;
                const srcTail = lr.tailU32;

                for (let v = 0; v < nV; v++) {
                    const v3 = v * 3;
                    const lx = srcPos[v3], ly = srcPos[v3 + 1], lz = srcPos[v3 + 2];
                    const lnx = srcNorm[v3], lny = srcNorm[v3 + 1], lnz = srcNorm[v3 + 2];

                    const dstByte = (vBase + v) * 36;
                    const dstU32 = dstByte >> 2;

                    chunkF32[dstU32]     = r00 * lx + r01 * ly + r02 * lz + r03;
                    chunkF32[dstU32 + 1] = r10 * lx + r11 * ly + r12 * lz + r13;
                    chunkF32[dstU32 + 2] = r20 * lx + r21 * ly + r22 * lz + r23;

                    let nx = r00 * lnx + r01 * lny + r02 * lnz;
                    let ny = r10 * lnx + r11 * lny + r12 * lnz;
                    let nz = r20 * lnx + r21 * lny + r22 * lnz;
                    const nlen = Math.hypot(nx, ny, nz);
                    if (nlen > 1e-4) {
                        nx /= nlen; ny /= nlen; nz /= nlen;
                    } else {
                        nx = 0.0; ny = 1.0; nz = 0.0;
                    }
                    chunkI8[dstByte + 12] = Math.max(-127, Math.min(127, Math.round(nx * 127.0)));
                    chunkI8[dstByte + 13] = Math.max(-127, Math.min(127, Math.round(ny * 127.0)));
                    chunkI8[dstByte + 14] = Math.max(-127, Math.min(127, Math.round(nz * 127.0)));
                    chunkU8[dstByte + 15] = (lr.aoU8 && v < lr.aoU8.length) ? lr.aoU8[v] : 0;

                    const tOff = v * 4;
                    chunkU32[dstU32 + 4] = srcTail[tOff];
                    chunkU32[dstU32 + 5] = srcTail[tOff + 1];
                    chunkU32[dstU32 + 6] = srcTail[tOff + 2];
                    chunkU32[dstU32 + 7] = srcTail[tOff + 3];
                    chunkU32[dstU32 + 8] = tintPack;
                }

                const opSrc = lr.opIdx;
                for (let j = 0; j < opSrc.length; j++) {
                    chunkIdxArr[scOpCursor++] = vBase + opSrc[j];
                }
                const alSrc = lr.alIdx;
                for (let j = 0; j < alSrc.length; j++) {
                    chunkIdxArr[scAlCursor++] = vBase + alSrc[j];
                }
                runningVertOffset += nV;
            }

            staticChunks.push({
                minX: sc.minX, minY: sc.minY, minZ: sc.minZ,
                maxX: sc.maxX, maxY: sc.maxY, maxZ: sc.maxZ,
                effRadius: Math.min(sc.maxStructR, 8.0),
                opOffsetBytes: cellOpStart * 4,
                opCount: sc.opTotal,
                alOffsetBytes: (cellOpStart + sc.opTotal) * 4,
                alCount: sc.alTotal,
                wasChunkMode: false,
                activeMode: 0
            });
            runningIdxOffset += sc.opTotal + sc.alTotal;
        }

        const chunkVao = gl.createVertexArray();
        gl.bindVertexArray(chunkVao);

        const chunkVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, chunkVbo);
        gl.bufferData(gl.ARRAY_BUFFER, chunkVertBuf, gl.STATIC_DRAW);

        const chunkIbo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunkIbo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chunkIdxArr, gl.STATIC_DRAW);

        // loc 0: world pos (3f @ 0)
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
        // loc 1: world normal (3b @ 12)
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.BYTE, true, 36, 12);
        // loc 2: uv (2f @ 16)
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 36, 16);
        // loc 3: color (4B @ 24)
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 36, 24);
        // loc 4: layer (1H @ 28)
        gl.enableVertexAttribArray(4);
        gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_SHORT, 36, 28);
        // loc 5: struct tint (4B @ 32)
        gl.enableVertexAttribArray(5);
        gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, true, 36, 32);
        // loc 6: vertex AO (1B normalized @ 15)
        gl.enableVertexAttribArray(6);
        gl.vertexAttribPointer(6, 1, gl.UNSIGNED_BYTE, true, 36, 15);

        gl.bindVertexArray(null);

        texEntry.chunkVao = chunkVao;
        texEntry.chunkVbo = chunkVbo;
        texEntry.chunkIbo = chunkIbo;
        texEntry.staticChunks = staticChunks;
    }

    _extractFrustumPlanes(projMat, viewMat, outPlanes) {
        // Multiply column-major M = projMat * viewMat
        const m0  = projMat[0]*viewMat[0]  + projMat[4]*viewMat[1]  + projMat[8]*viewMat[2]   + projMat[12]*viewMat[3];
        const m1  = projMat[1]*viewMat[0]  + projMat[5]*viewMat[1]  + projMat[9]*viewMat[2]   + projMat[13]*viewMat[3];
        const m2  = projMat[2]*viewMat[0]  + projMat[6]*viewMat[1]  + projMat[10]*viewMat[2]  + projMat[14]*viewMat[3];
        const m3  = projMat[3]*viewMat[0]  + projMat[7]*viewMat[1]  + projMat[11]*viewMat[2]  + projMat[15]*viewMat[3];

        const m4  = projMat[0]*viewMat[4]  + projMat[4]*viewMat[5]  + projMat[8]*viewMat[6]   + projMat[12]*viewMat[7];
        const m5  = projMat[1]*viewMat[4]  + projMat[5]*viewMat[5]  + projMat[9]*viewMat[6]   + projMat[13]*viewMat[7];
        const m6  = projMat[2]*viewMat[4]  + projMat[6]*viewMat[5]  + projMat[10]*viewMat[6]  + projMat[14]*viewMat[7];
        const m7  = projMat[3]*viewMat[4]  + projMat[7]*viewMat[5]  + projMat[11]*viewMat[6]  + projMat[15]*viewMat[7];

        const m8  = projMat[0]*viewMat[8]  + projMat[4]*viewMat[9]  + projMat[8]*viewMat[10]  + projMat[12]*viewMat[11];
        const m9  = projMat[1]*viewMat[8]  + projMat[5]*viewMat[9]  + projMat[9]*viewMat[10]  + projMat[13]*viewMat[11];
        const m10 = projMat[2]*viewMat[8]  + projMat[6]*viewMat[9]  + projMat[10]*viewMat[10] + projMat[14]*viewMat[11];
        const m11 = projMat[3]*viewMat[8]  + projMat[7]*viewMat[9]  + projMat[11]*viewMat[10] + projMat[15]*viewMat[11];

        const m12 = projMat[0]*viewMat[12] + projMat[4]*viewMat[13] + projMat[8]*viewMat[14]  + projMat[12]*viewMat[15];
        const m13 = projMat[1]*viewMat[12] + projMat[5]*viewMat[13] + projMat[9]*viewMat[14]  + projMat[13]*viewMat[15];
        const m14 = projMat[2]*viewMat[12] + projMat[6]*viewMat[13] + projMat[10]*viewMat[14] + projMat[14]*viewMat[15];
        const m15 = projMat[3]*viewMat[12] + projMat[7]*viewMat[13] + projMat[11]*viewMat[14] + projMat[15]*viewMat[15];

        // Gribb-Hartmann planes: Left, Right, Bottom, Top, Near, Far
        outPlanes[0]  = m3 + m0; outPlanes[1]  = m7 + m4; outPlanes[2]  = m11 + m8;  outPlanes[3]  = m15 + m12;
        outPlanes[4]  = m3 - m0; outPlanes[5]  = m7 - m4; outPlanes[6]  = m11 - m8;  outPlanes[7]  = m15 - m12;
        outPlanes[8]  = m3 + m1; outPlanes[9]  = m7 + m5; outPlanes[10] = m11 + m9;  outPlanes[11] = m15 + m13;
        outPlanes[12] = m3 - m1; outPlanes[13] = m7 - m5; outPlanes[14] = m11 - m9;  outPlanes[15] = m15 - m13;
        outPlanes[16] = m3 + m2; outPlanes[17] = m7 + m6; outPlanes[18] = m11 + m10; outPlanes[19] = m15 + m14;
        outPlanes[20] = m3 - m2; outPlanes[21] = m7 - m6; outPlanes[22] = m11 - m10; outPlanes[23] = m15 - m14;

        for (let p = 0; p < 24; p += 4) {
            const invLen = 1.0 / (Math.hypot(outPlanes[p], outPlanes[p + 1], outPlanes[p + 2]) || 1.0);
            outPlanes[p]     *= invLen;
            outPlanes[p + 1] *= invLen;
            outPlanes[p + 2] *= invLen;
            outPlanes[p + 3] *= invLen;
        }
    }

    _updateVisibleTexBatches(texEntry, projMat, viewMat) {
        if (!texEntry || !texEntry.ready || texEntry.instanceCount === 0) return;

        const camPos = renderer3d.cameraPos;
        const cx = camPos[0], cy = camPos[1], cz = camPos[2];
        const isTopDown = renderer3d.isTopDown ? 1.0 : 0.0;
        const lodPreset = (typeof options_LodDistancePreset !== "undefined")
            ? Math.max(0, Math.min(4, Math.round(options_LodDistancePreset)))
            : 2;
        const useLodFade = (typeof options_LodFade === "undefined") ? 1 : (options_LodFade ? 1 : 0);
        const fogCullActive = !!(renderer3d.fogCullActive && renderer3d.fogCullDist > 0);
        const fogDist = fogCullActive ? renderer3d.fogCullDist : 0.0;
        const fogDistSq = fogDist * fogDist;
        const fo = (fogCullActive && renderer3d.fogCullOrigin) ? renderer3d.fogCullOrigin : camPos;
        const fox = fo[0], foy = fo[1], foz = fo[2];
        const st = texEntry.lastCamState;

        if (!texEntry.cullDirty &&
            Math.abs(st[0] - cx) < 0.02 &&
            Math.abs(st[1] - cy) < 0.02 &&
            Math.abs(st[2] - cz) < 0.02 &&
            Math.abs(st[3] - viewMat[2]) < 1e-4 &&
            Math.abs(st[4] - viewMat[6]) < 1e-4 &&
            Math.abs(st[5] - viewMat[10]) < 1e-4 &&
            Math.abs(st[6] - projMat[0]) < 1e-4 &&
            Math.abs(st[7] - projMat[5]) < 1e-4 &&
            st[8] === isTopDown &&
            st[9] === lodPreset &&
            st[10] === useLodFade &&
            st[11] === (fogCullActive ? 1.0 : 0.0) &&
            Math.abs(st[12] - fogDist) < 1.0 &&
            (!fogCullActive || (Math.abs(st[13] - fox) < 2.0 && Math.abs(st[14] - foy) < 2.0 && Math.abs(st[15] - foz) < 2.0))) {
            return;
        }
        st[0] = cx; st[1] = cy; st[2] = cz;
        st[3] = viewMat[2]; st[4] = viewMat[6]; st[5] = viewMat[10];
        st[6] = projMat[0]; st[7] = projMat[5]; st[8] = isTopDown;
        st[9] = lodPreset; st[10] = useLodFade;
        st[11] = fogCullActive ? 1.0 : 0.0;
        st[12] = fogDist;
        st[13] = fox; st[14] = foy; st[15] = foz;
        texEntry.cullDirty = false;

        // 0=Very Low (2.20x), 1=Low (1.65x original), 2=Balanced (1.0x), 3=High (~1.8x further), 4=Ultra (~5x further, no micro-cull)
        const presetScales = [2.20013, 1.65096, 1.00093, 0.55023, 0.20052];
        const rScale = presetScales[lodPreset];
        const disableMicroCull = (lodPreset === 4);

        const planes = texEntry.frustumPlanes;
        this._extractFrustumPlanes(projMat, viewMat, planes);
        const projScale = Math.max(1.0, projMat[5] || 1.0);

        const cells = texEntry.cells;
        const sx = texEntry.instSphereX;
        const sy = texEntry.instSphereY;
        const sz = texEntry.instSphereZ;
        const sr = texEntry.instSphereR;
        const stmpl = texEntry.instTmpl;
        const tmplList = texEntry.templateList;

        const bucketCounts = texEntry.bucketCounts;
        const bucketOffsets = texEntry.bucketOffsets;
        const bucketCursors = texEntry.bucketCursors;
        const bucketHasFade = texEntry.bucketHasFade;
        const visInstIdx = texEntry.visInstIdx;
        const visInstBucket = texEntry.visInstBucket;
        bucketCounts.fill(0);
        if (bucketHasFade) bucketHasFade.fill(0);

        let visCount = 0;
        const topDownMode = (isTopDown > 0.5);
        const staticChunks = texEntry.staticChunks;
        const chunkOpaqueBatches = [];
        const chunkAlphaBatches = [];

        if (staticChunks && staticChunks.length > 0) {
            for (let s = 0; s < staticChunks.length; s++) {
                const chunk = staticChunks[s];
                let chunkVisible = true;
                for (let p = 0; p < 24; p += 4) {
                    const a = planes[p], b = planes[p + 1], cc = planes[p + 2], d = planes[p + 3];
                    const px = (a >= 0.0) ? chunk.maxX : chunk.minX;
                    const py = (b >= 0.0) ? chunk.maxY : chunk.minY;
                    const pz = (cc >= 0.0) ? chunk.maxZ : chunk.minZ;
                    if (a * px + b * py + cc * pz + d < 0.0) {
                        chunkVisible = false;
                        break;
                    }
                }
                if (!chunkVisible) {
                    chunk.activeMode = 0;
                    continue;
                }

                // 1:1 Fog-Wall Culling: skip entire 256m chunk if completely past opaque fog distance
                if (fogCullActive) {
                    const fdx = Math.max(0.0, Math.max(chunk.minX - fox, fox - chunk.maxX));
                    const fdy = Math.max(0.0, Math.max(chunk.minY - foy, foy - chunk.maxY));
                    const fdz = Math.max(0.0, Math.max(chunk.minZ - foz, foz - chunk.maxZ));
                    if (fdx * fdx + fdy * fdy + fdz * fdz > fogDistSq) {
                        chunk.activeMode = 0;
                        continue;
                    }
                }

                const dx = Math.max(0.0, Math.max(chunk.minX - cx, cx - chunk.maxX));
                const dy = Math.max(0.0, Math.max(chunk.minY - cy, cy - chunk.maxY));
                const dz = Math.max(0.0, Math.max(chunk.minZ - cz, cz - chunk.maxZ));
                const minDist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;

                const cRatio = (chunk.effRadius / minDist) * projScale;
                if (cRatio < 0.0005) {
                    chunk.activeMode = 0;
                    continue;
                }

                const cThresh = (chunk.wasChunkMode ? 0.037 : 0.032) * rScale;
                if (cRatio < cThresh) {
                    chunk.wasChunkMode = true;
                    chunk.activeMode = 2;
                    if (chunk.opCount > 0) {
                        chunkOpaqueBatches.push({
                            indexOffsetBytes: chunk.opOffsetBytes,
                            indexCount: chunk.opCount,
                            minX: chunk.minX, maxX: chunk.maxX,
                            minZ: chunk.minZ, maxZ: chunk.maxZ
                        });
                    }
                    if (chunk.alCount > 0) {
                        chunkAlphaBatches.push({
                            indexOffsetBytes: chunk.alOffsetBytes,
                            indexCount: chunk.alCount,
                            minX: chunk.minX, maxX: chunk.maxX,
                            minZ: chunk.minZ, maxZ: chunk.maxZ
                        });
                    }
                } else {
                    chunk.wasChunkMode = false;
                    chunk.activeMode = 1;
                }
            }
        }

        for (let c = 0; c < cells.length; c++) {
            const cell = cells[c];
            const pChunk = (cell.parentChunkIdx >= 0 && staticChunks) ? staticChunks[cell.parentChunkIdx] : null;
            // Static chunks only bound structures, NEVER foliage. If pChunk is culled (activeMode === 0)
            // or drawn as a merged distant chunk (activeMode === 2), only skip structures and still test
            // the cell's own AABB for its trees/foliage so trees never pop out when a distant building leaves frustum!
            const skipStructsInCell = !!(pChunk && (pChunk.activeMode === 0 || pChunk.activeMode === 2));
            const activeIndices = skipStructsInCell ? cell.foliageIndices : cell.indices;
            if (!activeIndices || activeIndices.length === 0) continue;

            // 1. Test 128m x 128m cell AABB against 6 frustum planes
            let cellVisible = true;
            for (let p = 0; p < 24; p += 4) {
                const a = planes[p], b = planes[p + 1], cc = planes[p + 2], d = planes[p + 3];
                const px = (a >= 0.0) ? cell.maxX : cell.minX;
                const py = (b >= 0.0) ? cell.maxY : cell.minY;
                const pz = (cc >= 0.0) ? cell.maxZ : cell.minZ;
                if (a * px + b * py + cc * pz + d < 0.0) {
                    cellVisible = false;
                    break;
                }
            }
            if (!cellVisible) continue;

            // 1b. 1:1 Fog-Wall Culling for 128m spatial cell
            if (fogCullActive) {
                const fdx = Math.max(0.0, Math.max(cell.minX - fox, fox - cell.maxX));
                const fdy = Math.max(0.0, Math.max(cell.minY - foy, foy - cell.maxY));
                const fdz = Math.max(0.0, Math.max(cell.minZ - foz, foz - cell.maxZ));
                if (fdx * fdx + fdy * fdy + fdz * fdz > fogDistSq) continue;
            }

            for (let k = 0; k < activeIndices.length; k++) {
                const idx = activeIndices[k];
                const ix = sx[idx], iy = sy[idx], iz = sz[idx], ir = sr[idx];

                // 2. Test instance bounding sphere against 6 frustum planes
                let instVisible = true;
                for (let p = 0; p < 24; p += 4) {
                    if (planes[p] * ix + planes[p + 1] * iy + planes[p + 2] * iz + planes[p + 3] < -ir) {
                        instVisible = false;
                        break;
                    }
                }
                if (!instVisible) continue;

                // 2b. 1:1 Fog-Wall Culling for individual instance
                if (fogCullActive) {
                    const fdx = ix - fox, fdy = iy - foy, fdz = iz - foz;
                    const maxR = fogDist + ir;
                    if (fdx * fdx + fdy * fdy + fdz * fdz > maxR * maxR) continue;
                }

                // 3. Zoom-Aware Screen-Space Size Ratio & Category-Specific 3-Tier LOD selection with 15% Hysteresis
                const dx = ix - cx, dy = iy - cy, dz = iz - cz;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;
                const ratio = (ir / dist) * projScale;

                const tIdx = stmpl[idx];
                const tmpl = tmplList[tIdx];
                const cat = tmpl.cat;
                const prevLod = texEntry.instPrevLod ? texEntry.instPrevLod[idx] : 255;

                let lod = 0;
                let effRatio = ratio;
                let t0Low = 0.0, t0High = 0.0;
                let t1Low = 0.0, t1High = 0.0;
                let cutoff = 0.0;

                if (cat === 1) {
                    // Trees
                    t0Low = 0.036 * rScale; t0High = 0.042 * rScale;
                    t1Low = 0.0115 * rScale; t1High = 0.0135 * rScale;
                    cutoff = (topDownMode ? ((ir < 2.2) ? 0.0010 : 0.0006) : 0.0007) * rScale;
                    const t0 = (prevLod === 0) ? t0Low : t0High;
                    const t1 = (prevLod <= 1) ? t1Low : t1High;
                    if (effRatio >= t0) lod = 0;
                    else if (effRatio >= t1) lod = 1;
                    else if (effRatio >= cutoff) lod = 2;
                    else continue;
                } else if (cat === 2) {
                    // Bushes
                    t0Low = 0.021 * rScale; t0High = 0.025 * rScale;
                    t1Low = 0.0068 * rScale; t1High = 0.0080 * rScale;
                    cutoff = (topDownMode ? 0.00025 : 0.00030) * rScale;
                    const t0 = (prevLod === 0) ? t0Low : t0High;
                    const t1 = (prevLod <= 1) ? t1Low : t1High;
                    if (effRatio >= t0) lod = 0;
                    else if (effRatio >= t1) lod = 1;
                    else if (effRatio >= cutoff) lod = 2;
                    else continue;
                } else {
                    if (tmpl.isMicroProp && !disableMicroCull) {
                        if (ir < 1.6) {
                            t0Low = 0.040 * rScale; t0High = 0.046 * rScale;
                            t1Low = 0.020 * rScale; t1High = 0.024 * rScale;
                            cutoff = (topDownMode ? 0.014 : 0.0115) * rScale;
                        } else {
                            t0Low = 0.036 * rScale; t0High = 0.042 * rScale;
                            t1Low = 0.018 * rScale; t1High = 0.022 * rScale;
                            cutoff = (topDownMode ? 0.010 : 0.0080) * rScale;
                        }
                        if (effRatio < cutoff) continue;
                        const t0 = (prevLod === 0) ? t0Low : t0High;
                        const t1 = (prevLod <= 1) ? t1Low : t1High;
                        lod = (effRatio >= t0) ? 0 : ((effRatio >= t1) ? 1 : 2);
                    } else {
                        // Buildings, linear infrastructure, and Ultra micro-props
                        const structR = Math.min(ir, 8.0);
                        effRatio = (structR / dist) * projScale;
                        t0Low = 0.052 * rScale; t0High = 0.060 * rScale;
                        t1Low = 0.032 * rScale; t1High = 0.037 * rScale;
                        cutoff = (disableMicroCull && tmpl.isMicroProp)
                            ? 0.0004
                            : ((topDownMode ? ((ir < 1.8) ? 0.0009 : 0.0006) : 0.0006) * rScale);
                        if (effRatio < cutoff) continue;
                        const t0 = (prevLod === 0) ? t0Low : t0High;
                        const t1 = (prevLod <= 1) ? t1Low : t1High;
                        if (effRatio >= t0) lod = 0;
                        else if (effRatio >= t1) lod = 1;
                        else lod = 2;
                    }
                }

                const lods = tmpl.lods;
                // Fallback to LOD0 if a small mesh kept identical geometry
                if ((lods[lod][1] + lods[lod][3]) === 0) {
                    lod = 0;
                }
                if (texEntry.instPrevLod) {
                    texEntry.instPrevLod[idx] = lod;
                }

                if (useLodFade === 1 && visCount + 2 <= visInstIdx.length) {
                    let fadeCode = 0;
                    if (cutoff > 0.0001 && effRatio < cutoff * 1.30) {
                        const tFade = (effRatio - cutoff) / (cutoff * 0.30);
                        fadeCode = Math.max(1, Math.min(63, Math.round(tFade * 64)));
                    }

                    let crossHandled = false;
                    if (fadeCode === 0) {
                        const t0Mid = 0.5 * (t0Low + t0High);
                        const band0 = t0Mid * 0.12;
                        const t1Mid = 0.5 * (t1Low + t1High);
                        const band1 = t1Mid * 0.12;

                        if (tmpl.hasUniqueLod1 && Math.abs(effRatio - t0Mid) < band0) {
                            const alpha0 = (effRatio - (t0Mid - band0)) / (2.0 * band0);
                            const code0 = Math.max(1, Math.min(63, Math.round(alpha0 * 64)));
                            const b0 = tIdx * 3;
                            const b1 = tIdx * 3 + 1;
                            visInstIdx[visCount] = idx | (code0 << 20);
                            visInstBucket[visCount] = b0;
                            bucketCounts[b0]++;
                            if (bucketHasFade) bucketHasFade[b0] = 1;
                            visCount++;
                            visInstIdx[visCount] = idx | ((64 + code0) << 20);
                            visInstBucket[visCount] = b1;
                            bucketCounts[b1]++;
                            if (bucketHasFade) bucketHasFade[b1] = 1;
                            visCount++;
                            crossHandled = true;
                        } else if (tmpl.hasUniqueLod2 && Math.abs(effRatio - t1Mid) < band1) {
                            const alpha1 = (effRatio - (t1Mid - band1)) / (2.0 * band1);
                            const code1 = Math.max(1, Math.min(63, Math.round(alpha1 * 64)));
                            const lodA = tmpl.hasUniqueLod1 ? 1 : 0;
                            const bA = tIdx * 3 + lodA;
                            const b2 = tIdx * 3 + 2;
                            visInstIdx[visCount] = idx | (code1 << 20);
                            visInstBucket[visCount] = bA;
                            bucketCounts[bA]++;
                            if (bucketHasFade) bucketHasFade[bA] = 1;
                            visCount++;
                            visInstIdx[visCount] = idx | ((64 + code1) << 20);
                            visInstBucket[visCount] = b2;
                            bucketCounts[b2]++;
                            if (bucketHasFade) bucketHasFade[b2] = 1;
                            visCount++;
                            crossHandled = true;
                        }
                    }

                    if (!crossHandled) {
                        const bucket = tIdx * 3 + lod;
                        visInstIdx[visCount] = idx | (fadeCode << 20);
                        visInstBucket[visCount] = bucket;
                        bucketCounts[bucket]++;
                        if (fadeCode !== 0 && bucketHasFade) bucketHasFade[bucket] = 1;
                        visCount++;
                    }
                } else {
                    const bucket = tIdx * 3 + lod;
                    visInstIdx[visCount] = idx;
                    visInstBucket[visCount] = bucket;
                    bucketCounts[bucket]++;
                    visCount++;
                }
            }
        }

        const opaqueBatches = [];
        const lod2Batches = [];
        const alphaBatches = [];

        if (visCount > 0) {
            let runningOffset = 0;
            const numBuckets = bucketCounts.length;
            for (let b = 0; b < numBuckets; b++) {
                bucketOffsets[b] = runningOffset;
                bucketCursors[b] = runningOffset;
                runningOffset += bucketCounts[b];
            }

            const visibleIdsBuf = texEntry.visibleIdsBuf;
            for (let v = 0; v < visCount; v++) {
                const b = visInstBucket[v];
                visibleIdsBuf[bucketCursors[b]++] = visInstIdx[v];
            }

            const rowsUsed = Math.max(1, Math.ceil(visCount / 1024));
            const gl = renderer3d.gl;
            gl.bindTexture(gl.TEXTURE_2D, texEntry.visibleIdsTex);
            gl.texSubImage2D(
                gl.TEXTURE_2D, 0, 0, 0, 1024, rowsUsed,
                gl.RED_INTEGER, gl.INT,
                visibleIdsBuf.subarray(0, rowsUsed * 1024)
            );
            gl.bindTexture(gl.TEXTURE_2D, null);

            for (let tIdx = 0; tIdx < tmplList.length; tIdx++) {
                const lods = tmplList[tIdx].lods;
                for (let lod = 0; lod < 3; lod++) {
                    const b = tIdx * 3 + lod;
                    const instCount = bucketCounts[b];
                    if (instCount === 0) continue;

                    const baseInstance = bucketOffsets[b];
                    const range = lods[lod];
                    const opStart = range[0], opCount = range[1];
                    const alStart = range[2], alCount = range[3];

                    if (opCount > 0) {
                        opaqueBatches.push({
                            indexOffsetBytes: opStart * 4,
                            indexCount: opCount,
                            baseInstance,
                            instanceCount: instCount,
                            hasFade: !!(bucketHasFade && bucketHasFade[b])
                        });
                    }
                    if (alCount > 0) {
                        alphaBatches.push({ indexOffsetBytes: alStart * 4, indexCount: alCount, baseInstance, instanceCount: instCount });
                    }
                }
            }
        }

        texEntry.opaqueBatches = opaqueBatches;
        texEntry.lod2Batches = lod2Batches;
        texEntry.alphaBatches = alphaBatches;
        texEntry.chunkOpaqueBatches = chunkOpaqueBatches;
        texEntry.chunkAlphaBatches = chunkAlphaBatches;
        texEntry.lastVisCount = visCount;
    }

    _buildSolidChunksForSubset(gl, obbs, subsetIndices, isTreeSubset) {
        const MAX_CHUNK_INDICES = 1500000;
        const MAX_TREE_POLY_PTS = 8;

        const subLen = subsetIndices.length;
        const subVertCounts = new Uint32Array(subLen);
        const subIdxCounts = new Uint32Array(subLen);
        const subPtCounts = new Uint16Array(subLen);
        const subMeshes = new Array(subLen);

        for (let s = 0; s < subLen; s++) {
            const i = subsetIndices[s];
            const obb = obbs[i];
            if (obb.mesh3d && obb.mesh3d.i && obb.mesh3d.i.length > 0) {
                const cMesh = isTreeSubset ? this._getClusteredMesh(obb.name, obb.mesh3d) : obb.mesh3d;
                subMeshes[s] = cMesh;
                const tc = Math.floor(cMesh.i.length / 3);
                subVertCounts[s] = tc * 3;
                subIdxCounts[s] = tc * 3;
                continue;
            }
            const rawFp = obb.customPolygon || (typeof buildingHeightmap !== "undefined" ? buildingHeightmap._getFootprint(obb.name) : null);
            let poly = (rawFp && rawFp.poly) ? rawFp.poly : rawFp;
            let n = (poly && Array.isArray(poly) && poly.length >= 3) ? poly.length : 4;
            if (isTreeSubset && n > MAX_TREE_POLY_PTS) n = MAX_TREE_POLY_PTS;
            subPtCounts[s] = n;
            subVertCounts[s] = n * 4 + n;
            subIdxCounts[s] = n * 6 + Math.max(0, n - 2) * 3;
        }

        const outChunks = [];
        let start = 0;
        while (start < subLen) {
            let solidIndices = 0;
            let solidVerts = 0;
            let end = start;
            while (end < subLen) {
                const sIdx = subIdxCounts[end];
                if (solidIndices > 0 && solidIndices + sIdx > MAX_CHUNK_INDICES) break;
                solidIndices += sIdx;
                solidVerts += subVertCounts[end];
                end++;
            }
            if (solidIndices === 0) {
                start = end + 1;
                continue;
            }

            const VD = new Float32Array(solidVerts * 10);
            const ID = new Uint32Array(solidIndices);
            let vp = 0, ip = 0, vo = 0;

            for (let s = start; s < end; s++) {
                const i = subsetIndices[s];
                const obb = obbs[i];
                const rad = -(obb.yaw || 0) * Math.PI / 180;
                const cosR = Math.cos(rad), sinR = Math.sin(rad);
                const ssx = obb.scaleX || 1.0, ssz = obb.scaleZ || 1.0;
                const name = (obb.name || "").toLowerCase();
                const isTree = isTreeSubset && !obb.isCustom;
                const structCol = (!isTree && !obb.isCustom) ? this._resolveStructurePaletteColor(obb) : null;

                const cMesh = subMeshes[s];
                if (cMesh && cMesh.i && cMesh.i.length > 0) {
                    const verts = cMesh.v;
                    const mIdx = cMesh.i;
                    const bY = obb.y || 0;

                    const isDeadTree = isTree && (name.includes('dead') || name.includes('branches') || name.includes('noleafs') || name.includes('broken') || name.includes('stump') || name.includes('log'));
                    const isPine = isTree && !isDeadTree && (name.includes('pine') || name.includes('fir') || name.includes('spruce') || name.includes('conifer') || name.includes('cedar'));
                    const isBirch = isTree && !isDeadTree && name.includes('birch');
                    const isPalm = isTree && !isDeadTree && name.includes('palm');
                    const hasTilt = (Math.abs(obb.pitch || 0) > 0.05 || Math.abs(obb.roll || 0) > 0.05);
                    const basis = hasTilt ? this._composeD3dBasis(obb) : null;

                    for (let k = 0; k < mIdx.length; k += 3) {
                        const i0 = mIdx[k] * 3, i1 = mIdx[k + 1] * 3, i2 = mIdx[k + 2] * 3;
                        let w0x, w0y, w0z, w1x, w1y, w1z, w2x, w2y, w2z;
                        if (basis) {
                            const x0 = verts[i0] * ssx, y0 = verts[i0 + 1], z0 = verts[i0 + 2] * ssz;
                            w0x = obb.x + x0 * basis.r00 + y0 * basis.r10 + z0 * basis.r20;
                            w0y = bY    + x0 * basis.r01 + y0 * basis.r11 + z0 * basis.r21;
                            w0z = obb.z + x0 * basis.r02 + y0 * basis.r12 + z0 * basis.r22;

                            const x1 = verts[i1] * ssx, y1 = verts[i1 + 1], z1 = verts[i1 + 2] * ssz;
                            w1x = obb.x + x1 * basis.r00 + y1 * basis.r10 + z1 * basis.r20;
                            w1y = bY    + x1 * basis.r01 + y1 * basis.r11 + z1 * basis.r21;
                            w1z = obb.z + x1 * basis.r02 + y1 * basis.r12 + z1 * basis.r22;

                            const x2 = verts[i2] * ssx, y2 = verts[i2 + 1], z2 = verts[i2 + 2] * ssz;
                            w2x = obb.x + x2 * basis.r00 + y2 * basis.r10 + z2 * basis.r20;
                            w2y = bY    + x2 * basis.r01 + y2 * basis.r11 + z2 * basis.r21;
                            w2z = obb.z + x2 * basis.r02 + y2 * basis.r12 + z2 * basis.r22;
                        } else {
                            w0x = obb.x + (verts[i0] * cosR - verts[i0 + 2] * sinR) * ssx;
                            w0z = obb.z + (verts[i0] * sinR + verts[i0 + 2] * cosR) * ssz;
                            w0y = bY + verts[i0 + 1];

                            w1x = obb.x + (verts[i1] * cosR - verts[i1 + 2] * sinR) * ssx;
                            w1z = obb.z + (verts[i1] * sinR + verts[i1 + 2] * cosR) * ssz;
                            w1y = bY + verts[i1 + 1];

                            w2x = obb.x + (verts[i2] * cosR - verts[i2 + 2] * sinR) * ssx;
                            w2z = obb.z + (verts[i2] * sinR + verts[i2 + 2] * cosR) * ssz;
                            w2y = bY + verts[i2 + 1];
                        }

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

                        let cr, cg, cb, ca;
                        if (isTree) {
                            const avgRelY = (verts[i0 + 1] + verts[i1 + 1] + verts[i2 + 1]) / 3.0;
                            const avgX = (verts[i0] + verts[i1] + verts[i2]) / 3.0;
                            const avgZ = (verts[i0 + 2] + verts[i1 + 2] + verts[i2 + 2]) / 3.0;
                            const avgR = Math.hypot(avgX, avgZ);

                            if (isDeadTree) {
                                cr = 0.30; cg = 0.24; cb = 0.19; ca = 1.0;
                            } else if (isPine) {
                                if (avgRelY < 0.6 && avgR < 0.35) {
                                    cr = 0.24; cg = 0.16; cb = 0.10; ca = 1.0;
                                } else {
                                    cr = 0.04; cg = 0.18; cb = 0.07; ca = 1.0;
                                }
                            } else if (isBirch) {
                                if (avgRelY < 0.9 && avgR < 0.40) {
                                    cr = 0.48; cg = 0.47; cb = 0.43; ca = 1.0;
                                } else {
                                    cr = 0.10; cg = 0.26; cb = 0.08; ca = 1.0;
                                }
                            } else if (isPalm) {
                                if (avgRelY < 4.0 && avgR < 0.40) {
                                    cr = 0.28; cg = 0.22; cb = 0.14; ca = 1.0;
                                } else {
                                    cr = 0.09; cg = 0.25; cb = 0.08; ca = 1.0;
                                }
                            } else {
                                if (avgRelY < 0.8 && avgR < 0.40) {
                                    cr = 0.24; cg = 0.16; cb = 0.10; ca = 1.0;
                                } else {
                                    cr = 0.05; cg = 0.20; cb = 0.08; ca = 1.0;
                                }
                            }
                        } else if (obb.isCustom) {
                            cr = 0.66; cg = 0.33; cb = 0.97; ca = 1.0;
                        } else {
                            // ca = 0.5 marks structure vertices so uUseStructureColors toggles colors in 0ms
                            cr = structCol[0]; cg = structCol[1]; cb = structCol[2]; ca = 0.5;
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

                // 2D Footprint Extrusion
                const rawFp = obb.customPolygon || (typeof buildingHeightmap !== "undefined" ? buildingHeightmap._getFootprint(obb.name) : null);
                let poly = (rawFp && rawFp.poly) ? rawFp.poly : rawFp;
                if (!poly || !Array.isArray(poly) || poly.length < 3) {
                    const hw = (obb.width || 8) / 2, hl = (obb.length || 8) / 2;
                    poly = [{ x: -hw, z: -hl }, { x: hw, z: -hl }, { x: hw, z: hl }, { x: -hw, z: hl }];
                }

                const rawN = poly.length;
                const targetN = subPtCounts[s] || rawN;

                const bY = (obb.y !== undefined && !isNaN(obb.y)) ? obb.y : 0;
                const minY = (obb.minY !== undefined && !isNaN(obb.minY)) ? obb.minY : (bY - 0.2);
                let maxY = (obb.maxY !== undefined && !isNaN(obb.maxY)) ? obb.maxY : (bY + (obb.height || 6));
                if (maxY - minY < 0.3) maxY = minY + 0.5;

                let cr = 0.0, cg = 0.898, cb = 1.0, ca = 0.5;
                if (isTree) {
                    cr = 0.05; cg = 0.20; cb = 0.08; ca = 1.0;
                } else if (obb.isCustom) {
                    cr = 0.66; cg = 0.33; cb = 0.97; ca = 1.0;
                } else if (structCol) {
                    cr = structCol[0]; cg = structCol[1]; cb = structCol[2]; ca = 0.5;
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

                outChunks.push({
                    vertexBuffer: vb,
                    indexBuffer: ib,
                    indexCount: ip,
                    vertCount: Math.floor(vp / 10)
                });
            }
            start = end;
        }
        return outChunks;
    }

    _buildVolumetricBushChunks(gl, obbs, bushIndicesList) {
        if (!gl || !bushIndicesList || bushIndicesList.length === 0) return [];
        const MAX_CHUNK_INDICES = 1500000;
        const lobeVerts = _FV_UNIT_SPHEROID.vertCount;
        const lobeIdxs = _FV_UNIT_SPHEROID.idxCount;

        const bushVolEntries = new Array(bushIndicesList.length);
        for (let i = 0; i < bushIndicesList.length; i++) {
            const obb = obbs[bushIndicesList[i]];
            const name = (obb.name || "").toLowerCase();
            bushVolEntries[i] = this._getFoliageEntry(name) || this._buildFallbackLobeEntry(obb);
        }

        const outChunks = [];
        let bStart = 0;
        while (bStart < bushIndicesList.length) {
            let bushIdxTotal = 0;
            let bushVertTotal = 0;
            let bEnd = bStart;
            while (bEnd < bushIndicesList.length) {
                const entry = bushVolEntries[bEnd];
                const bIdx = entry.l.length * lobeIdxs;
                if (bushIdxTotal > 0 && bushIdxTotal + bIdx > MAX_CHUNK_INDICES) break;
                bushIdxTotal += bIdx;
                bushVertTotal += entry.l.length * lobeVerts;
                bEnd++;
            }
            if (bushIdxTotal === 0) {
                bStart = bEnd + 1;
                continue;
            }

            const BVD = new Float32Array(bushVertTotal * 10);
            const BID = new Uint32Array(bushIdxTotal);
            const state = { bvp: 0, bip: 0, bvo: 0 };

            for (let b = bStart; b < bEnd; b++) {
                const obbIdx = bushIndicesList[b];
                this._appendVolumetricFoliage(obbs[obbIdx], obbIdx, bushVolEntries[b], BVD, BID, state);
            }

            const usedBVD = (state.bvp < BVD.length) ? BVD.subarray(0, state.bvp) : BVD;
            const usedBID = (state.bip < BID.length) ? BID.subarray(0, state.bip) : BID;
            if (usedBID.length > 0) {
                const bvb = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, bvb);
                gl.bufferData(gl.ARRAY_BUFFER, usedBVD, gl.STATIC_DRAW);

                const bib = gl.createBuffer();
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bib);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, usedBID, gl.STATIC_DRAW);

                outChunks.push({
                    vertexBuffer: bvb,
                    indexBuffer: bib,
                    indexCount: state.bip
                });
            }
            bStart = bEnd;
        }
        return outChunks;
    }

    rebuildBuffers() {
        if (!this.initialized || typeof buildingHeightmap === "undefined" || !buildingHeightmap.initialized || !buildingHeightmap.obbs) {
            return;
        }

        const gl = renderer3d.gl;
        const obbs = buildingHeightmap.obbs;
        if (obbs.length === 0) return;

        // Cleanup old GPU buffers
        this._disposeChunkList(gl, this.treeChunks);
        this._disposeChunkList(gl, this.structChunks);
        this.chunks = [];
        this._disposeBushChunks(gl);

        if (this.currentMap !== buildingHeightmap._mapKey) {
            this._meshCache.clear();
        }

        const treeOrCustomIndices = [];
        const structIndices = [];
        const bushIndicesList = [];

        for (let i = 0; i < obbs.length; i++) {
            const obb = obbs[i];
            if (obb.hidden || obb.ignoreLOS) continue;

            const name = (obb.name || "").toLowerCase();
            if (this._isFlatFieldGrid(name)) continue;

            const isBush = this._isBush(name);
            if (isBush) {
                bushIndicesList.push(i);
                continue;
            }

            const isTree = this._isTree(name);
            if (isTree || obb.isCustom) {
                treeOrCustomIndices.push(i);
            } else {
                structIndices.push(i);
            }
        }

        this.treeChunks = this._buildSolidChunksForSubset(gl, obbs, treeOrCustomIndices, true);
        this.structChunks = this._buildSolidChunksForSubset(gl, obbs, structIndices, false);
        this.chunks = [...this.treeChunks, ...this.structChunks];
        this.bushChunks = this._buildVolumetricBushChunks(gl, obbs, bushIndicesList);

        let totalMapVerts = 0, totalMapIndices = 0;
        for (const c of this.chunks) { totalMapVerts += (c.vertCount || 0); totalMapIndices += c.indexCount; }
        for (const c of this.bushChunks) { totalMapIndices += c.indexCount; }

        this.hasGeometry = (this.chunks.length > 0 || this.bushChunks.length > 0);
        this.currentMap = buildingHeightmap._mapKey;
        this._builtWithHeightmap = !!(typeof heightmap !== "undefined" && heightmap && heightmap.initialized);

        const mapKey = (buildingHeightmap._mapKey || "").toLowerCase();
        const { wantStructs, wantTrees, wantBushes } = this._getActiveTexProfiles();
        const anyTexEnabled = wantStructs || wantTrees || wantBushes;
        if (anyTexEnabled && mapKey && !this._mapTex3dCache.has(mapKey)) {
            this._ensureStructureTexturesLoaded(mapKey);
        } else if (mapKey && this._mapTex3dCache.has(mapKey)) {
            const cachedTex = this._mapTex3dCache.get(mapKey);
            if (cachedTex && cachedTex.ready) {
                this._buildMapTexInstances(mapKey, cachedTex, true);
            }
        }

        console.log(`%c[Building3dRenderer v6.0] Buffers ready for ${this.currentMap} | Tree Chunks: ${this.treeChunks.length} | Struct Chunks: ${this.structChunks.length} | Volume Chunks: ${this.bushChunks.length} | Indices: ${totalMapIndices.toLocaleString()} (${(totalMapIndices / 1000000).toFixed(2)}M)`, 'color: #00e5ff; font-weight: bold;');
    }

    _appendVolumetricFoliage(obb, obbIndex, entry, BVD, BID, state) {
        let { bvp, bip, bvo } = state;
        const name = (obb.name || "").toLowerCase();
        const mapKey = (this.currentMap || "").toLowerCase();
        const dbClimate = (typeof PR_MAPS_DATABASE !== "undefined" && PR_MAPS_DATABASE[mapKey]) ? PR_MAPS_DATABASE[mapKey].climate : null;
        const isDesertMap = dbClimate === "desert" || ['albasrah_2', 'fallujah', 'fallujah_west', 'muttrah_city_2', 'karbala', 'khamisiyah', 'ramiel', 'lashkar_valley', 'gaza_2', 'ras_el_masri_2', 'bijar_canyons', 'bamyan', 'iron_ridge', 'vadso_city', 'shijiavalley'].includes(mapKey);

        let baseR = (entry.c && entry.c[0] !== undefined ? entry.c[0] : 80) / 255.0;
        let baseG = (entry.c && entry.c[1] !== undefined ? entry.c[1] : 90) / 255.0;
        let baseB = (entry.c && entry.c[2] !== undefined ? entry.c[2] : 50) / 255.0;
        let alpha = (entry.a !== undefined) ? entry.a : 0.25;

        // Keep desert biomes sandy unless the template is explicitly lush/dead/snow
        if (isDesertMap && entry.k === "lush" && !name.includes("lush") && !name.includes("jungle") && !name.includes("river")) {
            baseR = 0.46; baseG = 0.44; baseB = 0.26;
            alpha = Math.min(alpha, 0.28);
        }

        const basis = this._composeD3dBasis(obb);
        const ssx = obb.scaleX || 1.0;
        const ssz = obb.scaleZ || 1.0;
        const ssy = Math.max(0.55, (ssx + ssz) * 0.5);
        const ox = obb.x || 0;
        const oy = (obb.y !== undefined && !isNaN(obb.y)) ? obb.y : 0;
        const oz = obb.z || 0;

        const hasHm = (typeof heightmap !== "undefined" && heightmap && heightmap.initialized);
        const seedBase = (ox * 12.9898 + oz * 78.233) || (obbIndex * 17.13);
        // Subtle per-instance hue/value variation for organic heterogeneity
        const hInst = Math.sin(seedBase * 1.13) * 46229.5267;
        const instVar = 0.91 + 0.18 * (hInst - Math.floor(hInst));
        const cr = Math.min(1.0, baseR * instVar);
        const cg = Math.min(1.0, baseG * instVar);
        const cb = Math.min(1.0, baseB * (instVar * 0.98 + 0.02));

        const dirs = _FV_UNIT_SPHEROID.dirs;
        const uIdx = _FV_UNIT_SPHEROID.indices;
        const vCount = _FV_UNIT_SPHEROID.vertCount;
        const iCount = _FV_UNIT_SPHEROID.idxCount;
        const lobes = entry.l;

        for (let lIdx = 0; lIdx < lobes.length; lIdx++) {
            const lb = lobes[lIdx];
            const cx = lb[0] * ssx;
            const cy = lb[1] * ssy;
            const cz = lb[2] * ssz;
            const rx = lb[3] * ssx;
            const ry = lb[4] * ssy;
            const rz = lb[5] * ssz;

            // Lobe world center in BF2 space
            const wcx = ox + cx * basis.r00 + cy * basis.r10 + cz * basis.r20;
            const wcy = oy + cx * basis.r01 + cy * basis.r11 + cz * basis.r21;
            const wcz = oz + cx * basis.r02 + cy * basis.r12 + cz * basis.r22;

            if (hasHm) {
                const groundY = heightmap.getHeightFromCoords(wcx, wcz);
                // Prune lobes buried completely underneath terrain (e.g. deeply sunk bushes)
                if (wcy + Math.max(ry, Math.max(rx, rz) * 0.35) < groundY + 0.06) {
                    continue;
                }
            }

            const vBase = bvo;
            // Extend lower hemisphere slightly downward so bushes on slopes/pivots contact terrain
            const ryDown = ry * 1.25 + 0.55;
            const invRx = 1.0 / Math.max(0.15, rx);
            const invRyUp = 1.0 / Math.max(0.15, ry);
            const invRyDown = 1.0 / Math.max(0.15, ryDown);
            const invRz = 1.0 / Math.max(0.15, rz);

            for (let v = 0; v < vCount; v++) {
                const dx = dirs[v * 3];
                const dy = dirs[v * 3 + 1];
                const dz = dirs[v * 3 + 2];

                const hw = Math.sin(seedBase + lIdx * 7.31 + v * 3.73) * 15731.743;
                const wob = 0.91 + 0.18 * (hw - Math.floor(hw));

                const ryEff = (dy < 0.0) ? ryDown : ry;
                const invRy = (dy < 0.0) ? invRyDown : invRyUp;

                const lx = dx * rx * wob;
                const ly = dy * ryEff * wob;
                const lz = dz * rz * wob;

                const wx = wcx + lx * basis.r00 + ly * basis.r10 + lz * basis.r20;
                const wy = wcy + lx * basis.r01 + ly * basis.r11 + lz * basis.r21;
                const wz = wcz + lx * basis.r02 + ly * basis.r12 + lz * basis.r22;

                // Local ellipsoid normal transformed to world space
                const lnx = dx * invRx;
                const lny = dy * invRy;
                const lnz = dz * invRz;
                let wnx = lnx * basis.r00 + lny * basis.r10 + lnz * basis.r20;
                let wny = lnx * basis.r01 + lny * basis.r11 + lnz * basis.r21;
                let wnz = lnx * basis.r02 + lny * basis.r12 + lnz * basis.r22;
                const nLen = Math.hypot(wnx, wny, wnz) || 1.0;
                wnx /= nLen;
                wny /= nLen;
                wnz /= nLen;

                // Subtle vertical foliage shadow lift: slightly brighter sunlit top than base
                const vShade = 0.90 + 0.16 * (dy * 0.5 + 0.5);

                BVD[bvp++] = wx;
                BVD[bvp++] = wy;
                BVD[bvp++] = -wz;
                BVD[bvp++] = wnx;
                BVD[bvp++] = wny;
                BVD[bvp++] = -wnz;
                BVD[bvp++] = Math.min(1.0, cr * vShade);
                BVD[bvp++] = Math.min(1.0, cg * vShade);
                BVD[bvp++] = Math.min(1.0, cb * vShade);
                BVD[bvp++] = alpha;
            }

            for (let t = 0; t < iCount; t++) {
                BID[bip++] = vBase + uIdx[t];
            }
            bvo += vCount;
        }

        state.bvp = bvp;
        state.bip = bip;
        state.bvo = bvo;
    }

    _drawSolidChunkArray(gl, chunkList, stride) {
        if (!chunkList || chunkList.length === 0) return;
        for (let c = 0; c < chunkList.length; c++) {
            const chunk = chunkList[c];
            if (!chunk || chunk.indexCount === 0) continue;

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
    }

    draw() {
        if (!this.initialized) return;

        if (typeof buildingHeightmap !== "undefined" && buildingHeightmap.initialized) {
            const hmReady = !!(typeof heightmap !== "undefined" && heightmap && heightmap.initialized);
            if (this.currentMap !== buildingHeightmap._mapKey || !this.hasGeometry || (!this._builtWithHeightmap && hmReady)) {
                this.rebuildBuffers();
            }
        }

        if (!this.hasGeometry || this.chunks.length === 0) return;

        const gl = renderer3d.gl;
        const projMat = renderer3d.getCurrentProjectionMatrix();
        const viewMat = renderer3d.getCurrentViewMatrix();

        const mapKey = (this.currentMap || "").toLowerCase();
        const { wantStructs, wantTrees, wantBushes } = this._getActiveTexProfiles();
        const anyTexEnabled = wantStructs || wantTrees || wantBushes;
        if (anyTexEnabled && mapKey && !this._mapTex3dCache.has(mapKey)) {
            this._ensureStructureTexturesLoaded(mapKey);
        }
        const texEntry = (anyTexEnabled && mapKey && this._mapTex3dCache.has(mapKey))
            ? this._mapTex3dCache.get(mapKey)
            : null;
        if (texEntry && texEntry.ready) {
            this._buildMapTexInstances(mapKey, texEntry);
        }
        const useInstancedTex = !!(anyTexEnabled && texEntry && texEntry.ready && texEntry.vao && texEntry.instanceCount > 0 && this.texOpaqueProgram);
        const useStructColors = (typeof options_StructureColors !== "undefined" && options_StructureColors) ? 1 : 0;
        const sunDir = (typeof renderer3d.getMapSunDirection === "function") ? renderer3d.getMapSunDirection() : [0.4508, 0.8515, -0.3005];
        const useShadows = !!(renderer3d.shadowsActiveThisFrame && renderer3d.shadowDepthTex);
        // Combined Ambient Occlusion toggle activates both real-time SSAO and baked Vertex AO
        const useVertexAO = (typeof options_3dAoSsao !== "undefined" && options_3dAoSsao) ? 1 : 0;
        const usePrRefl = (typeof options_3dPrReflections !== "undefined" && !!options_3dPrReflections) ? 1 : 0;
        const windTime = (typeof options_3dWind !== "undefined" && !!options_3dWind) ? ((performance.now() * 0.001) % 10000.0 + 0.01) : 0.0;
        const cam = renderer3d.cameraPos;

        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, useShadows ? renderer3d.shadowDepthTex : (renderer3d.shadowDummyTex || null));
        gl.activeTexture(gl.TEXTURE0);

        const bindLightingUniforms = (progInfo) => {
            if (progInfo.uSunDir !== null) gl.uniform3f(progInfo.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
            if (progInfo.uCameraPos !== null && progInfo.uCameraPos !== undefined) gl.uniform3f(progInfo.uCameraPos, cam[0], cam[1], cam[2]);
            if (progInfo.uUsePrReflections !== null && progInfo.uUsePrReflections !== undefined) gl.uniform1i(progInfo.uUsePrReflections, usePrRefl);
            if (progInfo.uWindTime !== null && progInfo.uWindTime !== undefined) gl.uniform1f(progInfo.uWindTime, windTime);
            if (progInfo.uShadowMap !== null) gl.uniform1i(progInfo.uShadowMap, 5);
            if (progInfo.uUseShadows !== null) gl.uniform1i(progInfo.uUseShadows, useShadows ? 1 : 0);
            if (useShadows && progInfo.uLightSpaceMatrix !== null) {
                gl.uniformMatrix4fv(progInfo.uLightSpaceMatrix, false, renderer3d.lightViewProjMatrix);
            }
            if (progInfo.uUseVertexAO !== null && progInfo.uUseVertexAO !== undefined) {
                gl.uniform1i(progInfo.uUseVertexAO, useVertexAO);
            }
        };

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.disable(gl.BLEND);

        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(-1.0, -1.0);

        // Pass 1A: Solid Tree Chunks + (Untextured Structure Chunks OR Fallback Unmatched Chunks)
        const activeTreeChunks = useInstancedTex ? texEntry.fallbackTreeChunks : this.treeChunks;
        const activeStructChunks = useInstancedTex ? texEntry.fallbackChunks : this.structChunks;
        if ((activeTreeChunks && activeTreeChunks.length > 0) || (activeStructChunks && activeStructChunks.length > 0)) {
            gl.useProgram(this.program);
            gl.uniformMatrix4fv(this.uProjectionMatrix, false, projMat);
            gl.uniformMatrix4fv(this.uViewMatrix, false, viewMat);
            gl.uniform1i(this.uUseStructureColors, useStructColors);
            if (this.uSunDir !== null) gl.uniform3f(this.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
            if (this.uShadowMap !== null) gl.uniform1i(this.uShadowMap, 5);
            if (this.uUseShadows !== null) gl.uniform1i(this.uUseShadows, useShadows ? 1 : 0);
            if (useShadows && this.uLightSpaceMatrix !== null) {
                gl.uniformMatrix4fv(this.uLightSpaceMatrix, false, renderer3d.lightViewProjMatrix);
            }

            const stride = 10 * 4;
            this._drawSolidChunkArray(gl, activeTreeChunks, stride);
            this._drawSolidChunkArray(gl, activeStructChunks, stride);

            gl.disableVertexAttribArray(this.aVertexPosition);
            gl.disableVertexAttribArray(this.aVertexNormal);
            gl.disableVertexAttribArray(this.aVertexColor);
        }

        // Pass 1B: GPU-Instanced Textured Structures + 256m Static World Chunks
        if (useInstancedTex) {
            this._updateVisibleTexBatches(texEntry, projMat, viewMat);

            const opBatches = texEntry.opaqueBatches;
            const l2Batches = texEntry.lod2Batches;
            const alBatches = texEntry.alphaBatches;
            const chunkOpBatches = texEntry.chunkOpaqueBatches || [];
            const chunkAlBatches = texEntry.chunkAlphaBatches || [];

            if (opBatches.length > 0 || l2Batches.length > 0 || alBatches.length > 0 || chunkOpBatches.length > 0 || chunkAlBatches.length > 0) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, texEntry.texArray);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, texEntry.instanceDataTex);
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, texEntry.visibleIdsTex);

                // 1. Opaque Pass (Instanced LOD0/LOD1 + 256m Static Chunks for distant LOD2) — True Hardware Early-Z active!
                if (opBatches.length > 0 || l2Batches.length > 0) {
                    gl.bindVertexArray(texEntry.vao);
                    let anyFadingOp = false;
                    const progInfo = this.texOpaqueProgram;
                    gl.useProgram(progInfo.program);
                    gl.uniformMatrix4fv(progInfo.uProjectionMatrix, false, projMat);
                    gl.uniformMatrix4fv(progInfo.uViewMatrix, false, viewMat);
                    gl.uniform1i(progInfo.uTexArray, 0);
                    gl.uniform1i(progInfo.uInstanceDataTex, 1);
                    gl.uniform1i(progInfo.uVisibleIdsTex, 2);
                    gl.uniform1i(progInfo.uUseStructureColors, useStructColors);
                    bindLightingUniforms(progInfo);

                    if (opBatches.length > 0) {
                        gl.uniform1i(progInfo.uPassMode, 0);
                        for (let i = 0; i < opBatches.length; i++) {
                            const b = opBatches[i];
                            if (b.hasFade && this.texOpaqueFadeProgram) {
                                anyFadingOp = true;
                                continue;
                            }
                            gl.uniform1i(progInfo.uBaseInstance, b.baseInstance);
                            gl.drawElementsInstanced(gl.TRIANGLES, b.indexCount, gl.UNSIGNED_INT, b.indexOffsetBytes, b.instanceCount);
                        }
                    }
                    if (l2Batches.length > 0) {
                        gl.uniform1i(progInfo.uPassMode, 2);
                        for (let i = 0; i < l2Batches.length; i++) {
                            const b = l2Batches[i];
                            gl.uniform1i(progInfo.uBaseInstance, b.baseInstance);
                            gl.drawElementsInstanced(gl.TRIANGLES, b.indexCount, gl.UNSIGNED_INT, b.indexOffsetBytes, b.instanceCount);
                        }
                    }
                    // Only the small subset of batches actively cross-fading uses the discard fade shader
                    if (anyFadingOp && this.texOpaqueFadeProgram) {
                        const fp = this.texOpaqueFadeProgram;
                        gl.useProgram(fp.program);
                        gl.uniformMatrix4fv(fp.uProjectionMatrix, false, projMat);
                        gl.uniformMatrix4fv(fp.uViewMatrix, false, viewMat);
                        gl.uniform1i(fp.uTexArray, 0);
                        gl.uniform1i(fp.uInstanceDataTex, 1);
                        gl.uniform1i(fp.uVisibleIdsTex, 2);
                        gl.uniform1i(fp.uUseStructureColors, useStructColors);
                        gl.uniform1i(fp.uPassMode, 0);
                        bindLightingUniforms(fp);
                        for (let i = 0; i < opBatches.length; i++) {
                            const b = opBatches[i];
                            if (!b.hasFade) continue;
                            gl.uniform1i(fp.uBaseInstance, b.baseInstance);
                            gl.drawElementsInstanced(gl.TRIANGLES, b.indexCount, gl.UNSIGNED_INT, b.indexOffsetBytes, b.instanceCount);
                        }
                    }
                }

                if (chunkOpBatches.length > 0 && texEntry.chunkVao && this.chunkOpaqueProgram) {
                    gl.bindVertexArray(texEntry.chunkVao);
                    const progInfo = this.chunkOpaqueProgram;
                    gl.useProgram(progInfo.program);
                    gl.uniformMatrix4fv(progInfo.uProjectionMatrix, false, projMat);
                    gl.uniformMatrix4fv(progInfo.uViewMatrix, false, viewMat);
                    gl.uniform1i(progInfo.uTexArray, 0);
                    gl.uniform1i(progInfo.uUseStructureColors, useStructColors);
                    gl.uniform1i(progInfo.uPassMode, 0);
                    bindLightingUniforms(progInfo);
                    for (let i = 0; i < chunkOpBatches.length; i++) {
                        const cb = chunkOpBatches[i];
                        gl.drawElements(gl.TRIANGLES, cb.indexCount, gl.UNSIGNED_INT, cb.indexOffsetBytes);
                    }
                }

                // 2. Alpha-Cutout Pass (Double-sided leaf cards, gratings, chainlink fences, railings, ladders)
                if ((alBatches.length > 0 && this.texAlphaProgram) || (chunkAlBatches.length > 0 && texEntry.chunkVao && this.chunkAlphaProgram)) {
                    const wasCullEnabled = gl.isEnabled(gl.CULL_FACE);
                    if (wasCullEnabled) gl.disable(gl.CULL_FACE);

                    if (alBatches.length > 0 && this.texAlphaProgram) {
                        gl.bindVertexArray(texEntry.vao);
                        const progInfo = this.texAlphaProgram;
                        gl.useProgram(progInfo.program);
                        gl.uniformMatrix4fv(progInfo.uProjectionMatrix, false, projMat);
                        gl.uniformMatrix4fv(progInfo.uViewMatrix, false, viewMat);
                        gl.uniform1i(progInfo.uTexArray, 0);
                        gl.uniform1i(progInfo.uInstanceDataTex, 1);
                        gl.uniform1i(progInfo.uVisibleIdsTex, 2);
                        gl.uniform1i(progInfo.uUseStructureColors, useStructColors);
                        gl.uniform1i(progInfo.uPassMode, 0);
                        bindLightingUniforms(progInfo);

                        for (let i = 0; i < alBatches.length; i++) {
                            const b = alBatches[i];
                            gl.uniform1i(progInfo.uBaseInstance, b.baseInstance);
                            gl.drawElementsInstanced(gl.TRIANGLES, b.indexCount, gl.UNSIGNED_INT, b.indexOffsetBytes, b.instanceCount);
                        }
                    }

                    if (chunkAlBatches.length > 0 && texEntry.chunkVao && this.chunkAlphaProgram) {
                        gl.bindVertexArray(texEntry.chunkVao);
                        const progInfo = this.chunkAlphaProgram;
                        gl.useProgram(progInfo.program);
                        gl.uniformMatrix4fv(progInfo.uProjectionMatrix, false, projMat);
                        gl.uniformMatrix4fv(progInfo.uViewMatrix, false, viewMat);
                        gl.uniform1i(progInfo.uTexArray, 0);
                        gl.uniform1i(progInfo.uUseStructureColors, useStructColors);
                        gl.uniform1i(progInfo.uPassMode, 0);
                        bindLightingUniforms(progInfo);

                        for (let i = 0; i < chunkAlBatches.length; i++) {
                            const cb = chunkAlBatches[i];
                            gl.drawElements(gl.TRIANGLES, cb.indexCount, gl.UNSIGNED_INT, cb.indexOffsetBytes);
                        }
                    }

                    if (wasCullEnabled) gl.enable(gl.CULL_FACE);
                }

                gl.bindVertexArray(null);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.activeTexture(gl.TEXTURE5);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.activeTexture(gl.TEXTURE0);
            }

            this.lastDrawStats = {
                instOpaqueCalls: opBatches.length,
                instAlphaCalls: alBatches.length,
                chunkOpaqueCalls: chunkOpBatches.length,
                chunkAlphaCalls: chunkAlBatches.length,
                visInstances: texEntry.lastVisCount || 0
            };
        } else {
            this.lastDrawStats = {
                instOpaqueCalls: 0,
                instAlphaCalls: 0,
                chunkOpaqueCalls: 0,
                chunkAlphaCalls: 0,
                visInstances: 0
            };
        }

        gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    drawBushes() {
        if (!this.initialized || !this.hasGeometry) return;

        const mapKey = (this.currentMap || "").toLowerCase();
        const { wantBushes } = this._getActiveTexProfiles();
        const texEntry = (wantBushes && mapKey && this._mapTex3dCache.has(mapKey))
            ? this._mapTex3dCache.get(mapKey)
            : null;
        const activeBushChunks = (texEntry && texEntry.ready && texEntry.profileSig && texEntry.profileSig[2] === "1")
            ? texEntry.fallbackBushChunks
            : this.bushChunks;
        if (!activeBushChunks || activeBushChunks.length === 0) return;

        const gl = renderer3d.gl;
        const stride = 10 * 4;

        gl.useProgram(this.bushProgram);
        gl.uniformMatrix4fv(this.bProjectionMatrix, false, renderer3d.getCurrentProjectionMatrix());
        gl.uniformMatrix4fv(this.bViewMatrix, false, renderer3d.getCurrentViewMatrix());
        gl.uniform3f(this.bCameraPos, renderer3d.cameraPos[0], renderer3d.cameraPos[1], renderer3d.cameraPos[2]);
        if (this.bSunDir !== null) {
            const sunDir = (typeof renderer3d.getMapSunDirection === "function") ? renderer3d.getMapSunDirection() : [0.4508, 0.8515, -0.3005];
            gl.uniform3f(this.bSunDir, sunDir[0], sunDir[1], sunDir[2]);
        }
        if (this.bWindTime !== null && this.bWindTime !== undefined) {
            const windT = (typeof options_3dWind !== "undefined" && !!options_3dWind) ? ((performance.now() * 0.001) % 10000.0 + 0.01) : 0.0;
            gl.uniform1f(this.bWindTime, windT);
        }
        if (this.bUseFog !== null) {
            const fogOn = !!(renderer3d.fogCullActive && typeof renderer3d.getMapFogConfig === "function");
            if (fogOn) {
                const fCfg = renderer3d.getMapFogConfig();
                const fo = renderer3d.fogCullOrigin || renderer3d.cameraPos;
                gl.uniform1i(this.bUseFog, 1);
                gl.uniform3f(this.bFogOrigin, fo[0], fo[1], fo[2]);
                gl.uniform4fv(this.bFogRange, fCfg.fogRange);
                gl.uniform1f(this.bFogAlphaFloor, fCfg.fogColor[3]);
            } else {
                gl.uniform1i(this.bUseFog, 0);
            }
        }

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(-1.0, -1.0);

        for (let c = 0; c < activeBushChunks.length; c++) {
            const chunk = activeBushChunks[c];
            if (chunk.indexCount === 0) continue;

            gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertexBuffer);

            gl.enableVertexAttribArray(this.bVertexPosition);
            gl.vertexAttribPointer(this.bVertexPosition, 3, gl.FLOAT, false, stride, 0);

            gl.enableVertexAttribArray(this.bVertexNormal);
            gl.vertexAttribPointer(this.bVertexNormal, 3, gl.FLOAT, false, stride, 3 * 4);

            gl.enableVertexAttribArray(this.bVertexColor);
            gl.vertexAttribPointer(this.bVertexColor, 4, gl.FLOAT, false, stride, 6 * 4);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.indexBuffer);
            gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0);
        }

        gl.disableVertexAttribArray(this.bVertexPosition);
        gl.disableVertexAttribArray(this.bVertexNormal);
        gl.disableVertexAttribArray(this.bVertexColor);

        gl.depthMask(true);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.disable(gl.BLEND);
    }

    drawShadowPass(lightViewProj) {
        if (!this.initialized || !this.hasGeometry) return;
        const gl = renderer3d.gl;
        if (!gl) return;

        const projMat = renderer3d.getCurrentProjectionMatrix();
        const viewMat = renderer3d.getCurrentViewMatrix();
        const mapKey = (this.currentMap || "").toLowerCase();
        const { wantStructs, wantTrees, wantBushes } = this._getActiveTexProfiles();
        const anyTexEnabled = wantStructs || wantTrees || wantBushes;
        const texEntry = (anyTexEnabled && mapKey && this._mapTex3dCache.has(mapKey))
            ? this._mapTex3dCache.get(mapKey)
            : null;
        if (texEntry && texEntry.ready) {
            this._buildMapTexInstances(mapKey, texEntry);
        }
        const useInstancedTex = !!(anyTexEnabled && texEntry && texEntry.ready && texEntry.vao && texEntry.instanceCount > 0 && this.shadowInstOpaqueProgram);

        // 1. Solid fallback/untextured chunks
        const activeTreeChunks = useInstancedTex ? texEntry.fallbackTreeChunks : this.treeChunks;
        const activeStructChunks = useInstancedTex ? texEntry.fallbackChunks : this.structChunks;
        if (this.shadowSolidProgram && ((activeTreeChunks && activeTreeChunks.length > 0) || (activeStructChunks && activeStructChunks.length > 0))) {
            const sp = this.shadowSolidProgram;
            gl.useProgram(sp.program);
            gl.uniformMatrix4fv(sp.uLightSpaceMatrix, false, lightViewProj);
            const stride = 10 * 4;
            const drawSolidList = (list) => {
                if (!list) return;
                for (let c = 0; c < list.length; c++) {
                    const chunk = list[c];
                    if (!chunk || chunk.indexCount === 0) continue;
                    gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertexBuffer);
                    gl.enableVertexAttribArray(sp.aPos);
                    gl.vertexAttribPointer(sp.aPos, 3, gl.FLOAT, false, stride, 0);
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.indexBuffer);
                    gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0);
                }
            };
            drawSolidList(activeTreeChunks);
            drawSolidList(activeStructChunks);
            gl.disableVertexAttribArray(sp.aPos);
        }

        // 2. Instanced textured structures/trees + 256m static chunks
        if (useInstancedTex) {
            this._updateVisibleTexBatches(texEntry, projMat, viewMat);
            const opBatches = texEntry.opaqueBatches || [];
            const l2Batches = texEntry.lod2Batches || [];
            const alBatches = texEntry.alphaBatches || [];
            const chunkOpBatches = texEntry.chunkOpaqueBatches || [];
            const chunkAlBatches = texEntry.chunkAlphaBatches || [];

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, texEntry.texArray);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, texEntry.instanceDataTex);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, texEntry.visibleIdsTex);

            if ((opBatches.length > 0 || l2Batches.length > 0) && this.shadowInstOpaqueProgram) {
                gl.bindVertexArray(texEntry.vao);
                const p = this.shadowInstOpaqueProgram;
                gl.useProgram(p.program);
                gl.uniformMatrix4fv(p.uLightSpaceMatrix, false, lightViewProj);
                gl.uniform1i(p.uInstanceDataTex, 1);
                gl.uniform1i(p.uVisibleIdsTex, 2);
                for (let i = 0; i < opBatches.length; i++) {
                    const b = opBatches[i];
                    gl.uniform1i(p.uBaseInstance, b.baseInstance);
                    gl.drawElementsInstanced(gl.TRIANGLES, b.indexCount, gl.UNSIGNED_INT, b.indexOffsetBytes, b.instanceCount);
                }
                for (let i = 0; i < l2Batches.length; i++) {
                    const b = l2Batches[i];
                    gl.uniform1i(p.uBaseInstance, b.baseInstance);
                    gl.drawElementsInstanced(gl.TRIANGLES, b.indexCount, gl.UNSIGNED_INT, b.indexOffsetBytes, b.instanceCount);
                }
            }

            if (chunkOpBatches.length > 0 && texEntry.chunkVao && this.shadowChunkOpaqueProgram) {
                const sfx = (typeof renderer3d.shadowFocusX === "number") ? renderer3d.shadowFocusX : renderer3d.cameraPos[0];
                const sfz = (typeof renderer3d.shadowFocusZ === "number") ? renderer3d.shadowFocusZ : renderer3d.cameraPos[2];
                const sRad = ((typeof renderer3d.shadowHalfExtent === "number") ? renderer3d.shadowHalfExtent : 240.0) + 45.0;
                const sMinX = sfx - sRad, sMaxX = sfx + sRad;
                const sMinZ = sfz - sRad, sMaxZ = sfz + sRad;

                let boundChunkProg = false;
                for (let i = 0; i < chunkOpBatches.length; i++) {
                    const cb = chunkOpBatches[i];
                    // Skip distant 256m static chunks outside the directional shadow ortho box
                    if (cb.maxX < sMinX || cb.minX > sMaxX || cb.maxZ < sMinZ || cb.minZ > sMaxZ) continue;
                    if (!boundChunkProg) {
                        gl.bindVertexArray(texEntry.chunkVao);
                        const p = this.shadowChunkOpaqueProgram;
                        gl.useProgram(p.program);
                        gl.uniformMatrix4fv(p.uLightSpaceMatrix, false, lightViewProj);
                        boundChunkProg = true;
                    }
                    gl.drawElements(gl.TRIANGLES, cb.indexCount, gl.UNSIGNED_INT, cb.indexOffsetBytes);
                }
            }

            if (alBatches.length > 0 && this.shadowInstAlphaProgram) {
                gl.bindVertexArray(texEntry.vao);
                const p = this.shadowInstAlphaProgram;
                gl.useProgram(p.program);
                gl.uniformMatrix4fv(p.uLightSpaceMatrix, false, lightViewProj);
                gl.uniform1i(p.uTexArray, 0);
                gl.uniform1i(p.uInstanceDataTex, 1);
                gl.uniform1i(p.uVisibleIdsTex, 2);
                for (let i = 0; i < alBatches.length; i++) {
                    const b = alBatches[i];
                    gl.uniform1i(p.uBaseInstance, b.baseInstance);
                    gl.drawElementsInstanced(gl.TRIANGLES, b.indexCount, gl.UNSIGNED_INT, b.indexOffsetBytes, b.instanceCount);
                }
            }
            // Note: distant LOD2 chunkAlphaBatches (>180m) are omitted from shadow pass as sub-pixel cutouts

            gl.bindVertexArray(null);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.activeTexture(gl.TEXTURE0);
        }
    }

    drawDepth(aPosLoc) {
        if (!this.hasGeometry) return;
        const gl = renderer3d.gl;
        const stride = 10 * 4; // 40 bytes: pos at offset 0

        if (this.chunks) {
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

        gl.disableVertexAttribArray(aPosLoc);
    }
}

$(() => {
    building3dRenderer = new Building3dRenderer();
});
