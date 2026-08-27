// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

/**
 * BuildingHeightmap Engine for RealityTracker
 *
 * Footprint-first visual overlay + spatial raycasting engine for building footprints.
 * Primary source : window.MAP_STATICS_DB + window.MESH_2D_FOOTPRINTS (from MapCollisionEditor)
 * Fallback source: MapsStaticobjects/{mapKey}/staticobjects.con
 * Overrides      : MapsStaticobjects/{mapKey}/{mapKey}_obb_overrides.json
 */

"use strict";

const EXCLUDE_NAMES = [
    "ambstat", "ambStat", "amdStat", "e_samb",
    "waterplane", "DefaultEnvMap", "waterfall", "fountain",
    "e_destruction", "burning", "wreckfire"
];

const PROFILES = [
    ["wallhigh01_32m",                            4,   32,    1.2 ],
    ["wallhigh01_24m",                            4,   24,    1.2 ],
    ["wallhigh01",                                4,    6,    1.2 ],
    ["wallhigh02",                                5,    6,    1.2 ],
    ["wallend",                                   4,    2,    1.2 ],
    ["brickwall_broken_30m",                      2,   30,    1.0 ],
    ["brickwall_broken_20m",                      2,   20,    1.0 ],
    ["brickwall_broken",                          2,    5,    1.0 ],
    ["brickwall_20m",                             3,   20,    1.0 ],
    ["brickwall_30m",                             3,   30,    1.0 ],
    ["brickwall_small",                           1.5,  2,    0.8 ],
    ["brickwall",                                 3,    4,    1.0 ],
    ["stonefence_10m",                            1.5, 10,    0.8 ],
    ["stonefence_5m",                             1.5,  5,    0.8 ],
    ["stonefence",                                1.5,  3,    0.8 ],
    ["muttrah_stonewall_30m",                     3,   30,    1.2 ],
    ["muttrah_stonewall_10m",                     3,   10,    1.2 ],
    ["muttrah_stonewall",                         3,    4,    1.2 ],
    ["fence_corrugated_3x72m",                    3,   72,    0.5 ],
    ["fence_corrugated_3x48m",                    3,   48,    0.5 ],
    ["fence_corrugated_3x36m",                    3,   36,    0.5 ],
    ["fence_corrugated_3x24m",                    3,   24,    0.5 ],
    ["fence_corrugated_3x12m",                    3,   12,    0.5 ],
    ["fence_corrugated_6x12m",                    6,   12,    0.5 ],
    ["fence_corrugated",                          3,    4,    0.5 ],
    ["constructionfence",                         2,    4,    0.5 ],
    ["hesco_l_05m",                               2.5,  5,    2.5 ],
    ["hesco_l_10m",                               2.5, 10,    2.5 ],
    ["hesco_l_20m",                               2.5, 20,    2.5 ],
    ["hesco_l_50m",                               2.5, 50,    2.5 ],
    ["hesco_low",                                 1.5,  4,    2.0 ],
    ["hesco_sangar",                              2.5,  3,    3.0 ],
    ["hesco",                                     2.5,  3,    2.5 ],
    ["jersey_barrier",                            1.5,  3,    0.8 ],
    ["conc_barrier",                              1.5,  3,    0.8 ],
    ["pipeline_60m",                              1,   60,    2.0 ],
    ["pipeline_30m",                              1,   30,    2.0 ],
    ["pipeline",                                  1,   10,    2.0 ],
    ["vw1a", 4, 12, 0.8], ["vw1b", 4, 12, 0.8],
    ["vw2a", 4, 12, 0.8], ["vw2b", 4, 12, 0.8],
    ["vw3_", 4, 12, 0.8], ["vw4_", 4, 12, 0.8], ["vw5b", 4, 12, 0.8],
    ["vpa",  4, 12, 0.8], ["vpb",  4, 12, 0.8], ["vp2",  4, 12, 0.8],
    ["mi_hangar",                                10,   28,    40 ],
    ["office_building",                          12,   18,    24 ],
    ["mosque",                                   14,   22,    28 ],
    ["military_container",                        2.5,  2.5,   6 ],
    ["truck_trailer",                             4,    3,    10 ],
    ["xp2_oilsilo",                              15,   14,    15 ],
    ["oilcistern",                               12,   10,    12 ]
];

class BuildingHeightmap {
    constructor() {
        this.initialized          = false;
        this.obbs                 = [];
        this.spatialGrid          = new Map();
        this.spatialCellSize      = 2;
        this.grid                 = null;
        this._meta                = null;
        this.templateOverrides    = {};
        this.overrides            = {};
        this.pendingCustomObjects = [];
        this._mapKey              = null;
        this._loading             = false;
        this._footprintCache      = new Map();
        this._footprintCacheBuilt = null;
        this._heightmapCacheCanvas = null;
        this._heightmapCacheMap    = null;
        this.selectedObb           = null;
        this.mesh3dDb              = {};
    }

    getTemplateKey(name) {
        const lc = (name || "").toLowerCase();
        return lc.replace(/_\d+/g, "").replace(/_v\d+/g, "").replace(/_nondest/g, "").replace(/_destructible/g, "");
    }

    classifyObject(name) {
        const lc = (name || "").toLowerCase();
        for (let i = 0; i < EXCLUDE_NAMES.length; i++) {
            if (lc.includes(EXCLUDE_NAMES[i].toLowerCase())) return null;
        }

        // Tree / Palm / Bush / Fir Conifer Vegetation Objects
        if (lc.includes("fir_tall") || lc.includes("pine_tall") || lc.includes("tree_tall")) {
            return { h: 18, w: 6, l: 6, isVegetation: true };
        }
        if (lc.includes("fir_medium") || lc.includes("fir_mixed") || lc.includes("pine_medium") || lc.includes("tree_medium")) {
            return { h: 12, w: 5, l: 5, isVegetation: true };
        }
        if (lc.includes("fir_small") || lc.includes("pine_small") || lc.includes("tree_small")) {
            return { h: 6, w: 4, l: 4, isVegetation: true };
        }
        if (lc.includes("tree") || lc.includes("palm") || lc.includes("bush") || lc.includes("shrub") || 
            lc.includes("birch") || lc.includes("pine") || lc.includes("fir") || lc.includes("spruce") ||
            lc.includes("cedar") || lc.includes("oak") || lc.includes("jungle") || lc.includes("foliage") || 
            lc.includes("almond") || lc.includes("hedge") || lc.includes("nc_deadlog")) {
            return { h: 10, w: 5, l: 5, isVegetation: true };
        }

        for (let i = 0; i < PROFILES.length; i++) {
            const prof = PROFILES[i];
            if (lc.includes(prof[0])) {
                return { h: prof[1], w: prof[2], l: prof.length > 3 ? prof[3] : prof[2] };
            }
        }

        if (lc.includes("wall") || lc.includes("fence") || lc.includes("barrier")) return { h: 3, w: 6, l: 1.0 };
        if (lc.includes("house") || lc.includes("building") || lc.includes("bldg") || lc.includes("hangar") || lc.includes("store") || lc.includes("shelter")) return { h: 8, w: 12, l: 12 };
        
        return { h: 6, w: 8, l: 8 };
    }

    // Footprint lookup  -  1:1 match with MapCollisionEditor

    _buildFootprintCache() {
        const db = window.MESH_2D_FOOTPRINTS;
        const statics = window.MAP_STATICS_DB;
        this._footprintCache = new Map();

        if (!db || !statics || !this._mapKey) {
            this._footprintCacheBuilt = this._mapKey;
            return;
        }

        const objects = statics[this._mapKey] || [];
        const seen = new Set();

        for (let i = 0; i < objects.length; i++) {
            const lower = (objects[i].name || objects[i][0] || "").toLowerCase();
            if (seen.has(lower)) continue;
            seen.add(lower);

            // 1. Exact match
            if (db[lower]) {
                this._footprintCache.set(lower, db[lower]);
                continue;
            }
            // 2. Starts with key
            let found = null;
            for (let k in db) {
                if (lower.startsWith(k)) {
                    found = db[k];
                    break;
                }
            }
            if (found) {
                this._footprintCache.set(lower, found);
                continue;
            }
            // 3. Key is substring (>5 chars)
            for (let k in db) {
                if (k.length > 5 && lower.includes(k)) {
                    found = db[k];
                    break;
                }
            }
            if (found) {
                this._footprintCache.set(lower, found);
            }
        }
        this._footprintCacheBuilt = this._mapKey;
    }

    _getFootprint(name) {
        const db = window.MESH_2D_FOOTPRINTS;
        if (!db) return null;
        if (this._footprintCacheBuilt !== this._mapKey) {
            this._buildFootprintCache();
        }
        const lc = (name || "").toLowerCase();
        if (this._footprintCache.has(lc)) {
            return this._footprintCache.get(lc);
        }
        // Fallback for names not in MAP_STATICS_DB (e.g. .con path)
        if (db[lc]) {
            this._footprintCache.set(lc, db[lc]);
            return db[lc];
        }
        let found = null;
        for (let k in db) {
            if (lc.startsWith(k)) {
                found = db[k];
                break;
            }
        }
        if (!found) {
            for (let k in db) {
                if (k.length > 5 && lc.includes(k)) {
                    found = db[k];
                    break;
                }
            }
        }
        this._footprintCache.set(lc, found || null);
        return found;
    }

    // Key helpers

    _getPosKey(name, x, z) {
        if (!name) return "";
        const fx = typeof x === "number" ? x.toFixed(1) : parseFloat(x || 0).toFixed(1);
        const fz = typeof z === "number" ? z.toFixed(1) : parseFloat(z || 0).toFixed(1);
        return `${name}_${fx}_${fz}`;
    }

    _migrateOverridesToPosKey(rawOverrides) {
        const migrated = {};
        for (let key in rawOverrides) {
            const ovr = rawOverrides[key];
            if (!ovr || typeof ovr !== "object") continue;
            migrated[key] = ovr;
            if (ovr.posKey) migrated[ovr.posKey] = ovr;
            if (ovr.name && ovr.x !== undefined && ovr.z !== undefined) {
                const pk = this._getPosKey(ovr.name, ovr.x, ovr.z);
                ovr.posKey = pk;
                migrated[pk] = ovr;
                migrated[`${ovr.name}_${Math.round(ovr.x)}_${Math.round(ovr.z)}`] = ovr;
            }
        }
        return migrated;
    }

    // Load

    _normalizeMapKey(mapKey) {
        if (!mapKey) return "";
        let k = mapKey.toLowerCase().replace(/[\s\-]+/g, "_");
        if (typeof window !== "undefined" && window.MAP_STATICS_DB && window.MAP_STATICS_DB[k]) return k;
        
        const aliases = {
            "albasrah": "albasrah_2",
            "al_basrah": "albasrah_2",
            "gaza": "gaza_2",
            "muttrah": "muttrah_city_2",
            "muttrah_city": "muttrah_city_2",
            "ras_el_masri": "ras_el_masri_2",
            "raselmasri": "ras_el_masri_2"
        };
        if (aliases[k]) return aliases[k];
        if (typeof window !== "undefined" && window.MAP_STATICS_DB && window.MAP_STATICS_DB[k + "_2"]) return k + "_2";
        return k;
    }

    async load(mapKey, heightmapConfig) {
        if (!mapKey || this._loading) return;
        mapKey = this._normalizeMapKey(mapKey);
        this._loading = true;
        this._mapKey  = mapKey;

        this.obbs    = [];
        this.spatialGrid.clear();
        this.templateOverrides = {};
        this.overrides = {};
        this.pendingCustomObjects = [];
        this._footprintCacheBuilt = null;

        // - 1. Load overrides JSON (MapCollisionEditor edits) --
        const cacheBuster  = `?t=${Date.now()}`;
        const overrideUrl  = `MapFootprintOverrides/${mapKey}/${mapKey}_obb_overrides.json`;
        const overrideUrlL = `MapFootprintOverrides/${mapKey}/${mapKey.toLowerCase()}_obb_overrides.json`;
        try {
            let res = await fetch(overrideUrl + cacheBuster);
            if (!res.ok) res = await fetch(overrideUrlL + cacheBuster);
            if (res && res.ok) {
                const data = await res.json();
                if (data) {
                    if (data.templateOverrides) {
                        this.templateOverrides = Object.assign({}, this.templateOverrides, data.templateOverrides);
                    }
                    if (data.individualOverrides) {
                        this.overrides = Object.assign({}, this.overrides,
                            this._migrateOverridesToPosKey(data.individualOverrides));
                    } else if (!data.templateOverrides) {
                        this.overrides = Object.assign({}, this.overrides,
                            this._migrateOverridesToPosKey(data));
                    }
                    if (data.customObjects) this.pendingCustomObjects = data.customObjects;
                }
            }
        } catch (e) {
            console.warn(`[BuildingHeightmap] Could not load overrides for ${mapKey}:`, e.message);
        }

        // -- 1b. Load 100% Authentic 3D Collision Meshes for the Map --
        this.mesh3dDb = {};
        try {
            const meshRes = await fetch(`MapsStaticobjects/${mapKey}/${mapKey}_mesh3d.json`);
            if (meshRes.ok) {
                this.mesh3dDb = await meshRes.json();
                for (const key in this.mesh3dDb) {
                    this._extract2DLinesFrom3D(this.mesh3dDb[key]);
                }
                console.log(`[BuildingHeightmap] Loaded ${Object.keys(this.mesh3dDb).length} 3D collision meshes for ${mapKey}`);
            }
        } catch (e) {
            console.warn(`[BuildingHeightmap] No 3D mesh file for ${mapKey}:`, e.message);
        }

        // -- 2a. Fast path: MAP_STATICS_DB (pre-compiled, instant) --
        const staticsKey = window.MAP_STATICS_DB ? (window.MAP_STATICS_DB[mapKey] ? mapKey : (window.MAP_STATICS_DB[mapKey.toLowerCase()] ? mapKey.toLowerCase() : null)) : null;
        if (staticsKey) {
            try {
                this._buildFromDb(staticsKey, heightmapConfig);
                this._addCustomObjects();
                this.initialized = true;
                this._loading = false;
                this.triggerCanvasRedraw();
                if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized) {
                    building3dRenderer.rebuildBuffers();
                }
                const withFp = this.obbs.filter(o => this._getObbCanvasPolygon(o).length >= 3).length;
                console.log(`[BuildingHeightmap] ${this.obbs.length} objects loaded from MAP_STATICS_DB for ${mapKey} | footprints: ${withFp}/${this.obbs.length} (${Math.round(withFp / this.obbs.length * 100)}%)`);
                return;
            } catch (err) {
                console.warn(`[BuildingHeightmap] MAP_STATICS_DB path failed for ${mapKey}:`, err.message);
            }
        }

        // -- 2b. Fallback: parse staticobjects.con --
        try {
            const res = await fetch(`MapsStaticobjects/${mapKey}/staticobjects.con`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this._buildFromCon(mapKey, await res.text(), heightmapConfig);
            this._addCustomObjects();
            this.initialized = true;
            this._loading = false;
            this.triggerCanvasRedraw();
            if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized) {
                building3dRenderer.rebuildBuffers();
            }
        } catch (err) {
            this._loading = false;
            console.warn(`[BuildingHeightmap] No building data for ${mapKey} (${err.message})`);
        }
    }

    // Build from MAP_STATICS_DB

    _buildFromDb(mapKey, config) {
        this._initGrid(config);
        const dbObjects = window.MAP_STATICS_DB[mapKey];
        if (!dbObjects) return;
        for (let i = 0; i < dbObjects.length; i++) {
            const o = dbObjects[i];
            this._addObject({
                name: (o.name || o[0] || "").toLowerCase(),
                x:    o.x   !== undefined ? o.x   : (o[1] !== undefined ? o[1] : 0),
                y:    o.y   !== undefined ? o.y   : (o[2] !== undefined ? o[2] : 0),
                z:    o.z   !== undefined ? o.z   : (o[3] !== undefined ? o[3] : 0),
                yaw:  o.yaw !== undefined ? o.yaw : (o[4] !== undefined ? o[4] : 0),
                scaleX: o.scaleX !== undefined ? o.scaleX : (o[5] !== undefined ? o[5] : 1),
                scaleZ: o.scaleZ !== undefined ? o.scaleZ : (o[6] !== undefined ? o[6] : 1),
            });
        }
    }

    // Build from staticobjects.con (fallback)

    _buildFromCon(mapKey, conText, config) {
        this._initGrid(config);
        const lines = conText.split(/\r?\n/);
        let cur = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("Object.create ")) {
                if (cur && cur.x !== undefined) this._addObject(cur);
                const parts = line.split(" ");
                cur = parts.length > 1
                    ? { name: parts[1].toLowerCase(), x: undefined, y: 0, z: 0, yaw: 0 }
                    : null;
                continue;
            }
            if (!cur) continue;
            if (line.startsWith("Object.absolutePosition ")) {
                const p = line.substring(24).split("/");
                if (p.length >= 3) {
                    cur.x = parseFloat(p[0]);
                    cur.y = parseFloat(p[1]);
                    cur.z = parseFloat(p[2]);
                }
            } else if (line.startsWith("Object.rotation ") || line.startsWith("Object.absoluteRotation ")) {
                const p = line.substring(line.indexOf(" ") + 1).split("/");
                if (p.length >= 1) cur.yaw = parseFloat(p[0]);
            }
        }
        if (cur && cur.x !== undefined) this._addObject(cur);
    }

    // Grid initializer

    _initGrid(config) {
        let terrainM = 2048;
        if (config) {
            if (config.fullsize) {
                terrainM = parseInt(config.fullsize);
            } else if (config.size && config.scale) {
                const s = parseInt(config.size.split(" ")[0]) || 1024;
                const sc = parseFloat(config.scale.split("/")[0]) || 2;
                terrainM = s * sc;
            }
        }
        const cellSize    = 2;
        const gridSize    = Math.ceil(terrainM / cellSize);
        const origin      = -terrainM / 2;
        this.grid = new Float32Array(gridSize * gridSize);
        this.grid.fill(-Infinity);
        this._meta = { gridSize, cellSize, origin, terrainM };
        this.obbs  = [];
        this.spatialGrid.clear();
    }

    // Add single static object

    _addObject(obj) {
        if (!obj || !obj.name) return;
        const prof = this.classifyObject(obj.name);
        if (!prof) return; // Skip excluded clutter objects

        const exactName = (obj.name || "").toLowerCase();
        const tplKey = this.getTemplateKey(obj.name);

        let width = prof ? prof.w : 6.0;
        let length = prof ? prof.l : 6.0;
        let height = (prof && prof.h !== undefined) ? prof.h : 6.0;
        let posX = obj.x, posZ = obj.z, yaw = obj.yaw || 0;
        let scaleX = obj.scaleX !== undefined ? obj.scaleX : 1.0;
        let scaleZ = obj.scaleZ !== undefined ? obj.scaleZ : 1.0;
        let customPolygon = null;

        // Apply template override if present
        let ignoreLOS = false;
        const tplOvr = this.templateOverrides[exactName] || this.templateOverrides[tplKey];
        if (tplOvr) {
            if (tplOvr.width !== undefined) width = parseFloat(tplOvr.width);
            if (tplOvr.length !== undefined) length = parseFloat(tplOvr.length);
            if (tplOvr.height !== undefined) height = parseFloat(tplOvr.height);
            if (tplOvr.ignoreLOS !== undefined) ignoreLOS = !!tplOvr.ignoreLOS;
        }

        // Individual override takes precedence
        const posKey       = this._getPosKey(obj.name, obj.x, obj.z);
        const roundedKey   = `${obj.name}_${Math.round(obj.x)}_${Math.round(obj.z)}`;
        const floorKey     = `${obj.name}_${Math.floor(obj.x)}_${Math.floor(obj.z)}`;
        const rawStringKey = `${obj.name}_${obj.x}_${obj.z}`;
        const ovr = this.overrides[posKey] || this.overrides[roundedKey] || this.overrides[floorKey] || this.overrides[rawStringKey];

        if (ovr && ovr.hidden) return;

        if (ovr) {
            if (ovr.x         !== undefined) posX   = ovr.x;
            if (ovr.z         !== undefined) posZ   = ovr.z;
            if (ovr.yaw       !== undefined) yaw    = ovr.yaw;
            if (ovr.width     !== undefined) width  = ovr.width;
            if (ovr.length    !== undefined) length = ovr.length;
            if (ovr.height    !== undefined) height = ovr.height;
            if (ovr.scaleX    !== undefined) scaleX = ovr.scaleX;
            if (ovr.scaleZ    !== undefined) scaleZ = ovr.scaleZ;
            if (ovr.customPolygon && Array.isArray(ovr.customPolygon) && ovr.customPolygon.length >= 3)
                customPolygon = ovr.customPolygon;
            if (ovr.ignoreLOS !== undefined) ignoreLOS = !!ovr.ignoreLOS;
        }

        const rawFp = customPolygon || this._getFootprint(obj.name);
        let fp = null;
        let fpH = null;
        let fpMinY = null;
        let fpMaxY = null;

        if (Array.isArray(rawFp)) {
            fp = rawFp;
        } else if (rawFp && typeof rawFp === "object") {
            fp = rawFp.poly;
            fpH = rawFp.h;
            fpMinY = rawFp.minY;
            fpMaxY = rawFp.maxY;
        }

        if (fp && fp.length >= 3) {
            let maxAbsX = 0, maxAbsZ = 0;
            for (let i = 0; i < fp.length; i++) {
                const px = (fp[i].x !== undefined ? fp[i].x : fp[i][0]);
                const pz = (fp[i].z !== undefined ? fp[i].z : fp[i][1]);
                if (Math.abs(px) > maxAbsX) maxAbsX = Math.abs(px);
                if (Math.abs(pz) > maxAbsZ) maxAbsZ = Math.abs(pz);
            }
            if (!ovr || ovr.width  === undefined) width  = (maxAbsX * 2) || width;
            if (!ovr || ovr.length === undefined) length = (maxAbsZ * 2) || length;
        }

        if (fpH != null && (!ovr || ovr.height === undefined)) {
            height = fpH;
        }

        let isVeg = (rawFp && rawFp.isVegetation !== undefined) ? !!rawFp.isVegetation : (prof ? !!prof.isVegetation : false);

        const tmplKey = this.getTemplateKey(obj.name);
        const mesh3d = (this.mesh3dDb && (this.mesh3dDb[obj.name] || this.mesh3dDb[tmplKey])) || null;

        const baseY = obj.y || 0;
        const obb = {
            id: this.obbs.length,
            name: obj.name,
            ns_originalPosKey: posKey,
            x: posX, y: baseY, z: posZ,
            yaw, width, length, height,
            scaleX, scaleZ,
            halfW: (width  / 2) * scaleX,
            halfL: (length / 2) * scaleZ,
            minY:  fpMinY != null ? (baseY + fpMinY) : baseY,
            maxY:  fpMaxY != null ? (baseY + fpMaxY) : (baseY + height),
            hidden: false,
            customPolygon: customPolygon || null,
            ignoreLOS: ignoreLOS,
            isVegetation: isVeg,
            mesh3d: mesh3d
        };

        this.obbs.push(obb);
        this._rasterizeObb(obb);
    }

    // Add custom (user-created) objects

    _addCustomObjects() {
        if (!this.pendingCustomObjects || !this.pendingCustomObjects.length) return;
        const seen = new Set(this.obbs.filter(o => o.isCustom).map(o => `${o.name}_${o.x}_${o.z}`));
        for (const c of this.pendingCustomObjects) {
            const fpKey = `${c.name}_${c.x}_${c.z}`;
            if (seen.has(fpKey)) continue;
            seen.add(fpKey);

            const rawFp = c.customPolygon || this._getFootprint(c.name);
            let fpH = c.height;
            let fpMinY = null, fpMaxY = null;
            if (rawFp && typeof rawFp === "object" && !Array.isArray(rawFp)) {
                if (fpH === undefined && rawFp.h != null) fpH = rawFp.h;
                fpMinY = rawFp.minY;
                fpMaxY = rawFp.maxY;
            }

            const tmplKey = this.getTemplateKey(c.name);
            const mesh3d = (this.mesh3dDb && (this.mesh3dDb[c.name] || this.mesh3dDb[tmplKey])) || null;

            const cBaseY = c.y || 0;
            const cHeight = fpH || 6;
            const obb = {
                id: this.obbs.length,
                name: c.name, isCustom: true,
                ns_originalPosKey: this._getPosKey(c.name, c.x, c.z),
                x: c.x, y: cBaseY, z: c.z,
                yaw: c.yaw || 0,
                width: c.width || 6, length: c.length || 6, height: cHeight,
                scaleX: c.scaleX || 1.0, scaleZ: c.scaleZ || 1.0,
                halfW: ((c.width  || 6) / 2) * (c.scaleX || 1.0),
                halfL: ((c.length || 6) / 2) * (c.scaleZ || 1.0),
                minY:  fpMinY != null ? (cBaseY + fpMinY) : cBaseY,
                maxY:  fpMaxY != null ? (cBaseY + fpMaxY) : (cBaseY + cHeight),
                hidden: !!c.hidden,
                customPolygon: (c.customPolygon && c.customPolygon.length >= 3) ? c.customPolygon : null,
                ignoreLOS: !!c.ignoreLOS,
                mesh3d: mesh3d
            };
            this.obbs.push(obb);
            this._rasterizeObb(obb);
        }
    }

    // Rasterizer  -  spatial/heightmap grid

    _rasterizeObb(obb) {
        if (!obb || obb.hidden || obb.ignoreLOS) return;
        if (this.grid && this._meta) {
            const { origin, cellSize, gridSize } = this._meta;
            const maxR = Math.hypot(obb.halfW, obb.halfL);
            const col0 = Math.max(0, Math.floor((obb.x - maxR - origin) / cellSize));
            const col1 = Math.min(gridSize - 1, Math.floor((obb.x + maxR - origin) / cellSize));
            const row0 = Math.max(0, Math.floor((obb.z - maxR - origin) / cellSize));
            const row1 = Math.min(gridSize - 1, Math.floor((obb.z + maxR - origin) / cellSize));

            const rad = -(obb.yaw || 0) * Math.PI / 180;
            const cosR = Math.cos(rad), sinR = Math.sin(rad);
            const sx = obb.scaleX || 1.0, sz = obb.scaleZ || 1.0;
            const rawFp = obb.customPolygon || this._getFootprint(obb.name);
            const poly = (rawFp && rawFp.poly) ? rawFp.poly : rawFp;
            const hasPoly = (poly && poly.length >= 3);
            const hw = (obb.width || 6) / 2;
            const hl = (obb.length || 6) / 2;

            for (let r = row0; r <= row1; r++) {
                const wz = origin + (r + 0.5) * cellSize;
                const dz = wz - obb.z;
                for (let c = col0; c <= col1; c++) {
                    const wx = origin + (c + 0.5) * cellSize;
                    const dx = wx - obb.x;

                    // Convert to local model space (matching BF2 -pz footprint orientation)
                    const lx = (dx * cosR + dz * sinR) / sx;
                    const lz = (dx * sinR - dz * cosR) / sz;

                    let inside = false;
                    if (hasPoly) {
                        inside = this.pointInPolygon(lx, lz, poly);
                    } else {
                        inside = (Math.abs(lx) <= hw && Math.abs(lz) <= hl);
                    }

                    if (inside) {
                        const idx = r * gridSize + c;
                        if (obb.maxY > this.grid[idx]) this.grid[idx] = obb.maxY;
                    }
                }
            }
        }
        const sCell = this.spatialCellSize;
        const maxR  = Math.hypot(obb.halfW, obb.halfL);
        const c0 = Math.floor((obb.x - maxR) / sCell), c1 = Math.floor((obb.x + maxR) / sCell);
        const r0 = Math.floor((obb.z - maxR) / sCell), r1 = Math.floor((obb.z + maxR) / sCell);
        for (let r = r0; r <= r1; r++)
            for (let c = c0; c <= c1; c++) {
                const key = c + "," + r;
                let list = this.spatialGrid.get(key);
                if (!list) { list = []; this.spatialGrid.set(key, list); }
                list.push(obb);
            }
    }

    // Canvas rendering  -  1:1 match with MapCollisionEditor

    triggerCanvasRedraw() {
        if (typeof requestUpdate === "function") requestUpdate();
    }

    toggleObbEditorPanel() {
        const panel = document.getElementById("devTestObbEditorPanel");
        if (panel) panel.style.display = "none";
    }

    _getObbCanvasPolygon(obb) {
        if (!obb) return [];

        let modelPoints = obb.customPolygon;
        if (!modelPoints) {
            const rawFp = this._getFootprint(obb.name);
            modelPoints = (rawFp && rawFp.poly) ? rawFp.poly : rawFp;
        }

        if (!modelPoints || modelPoints.length < 3) {
            const w = (obb.width || 6) / 2;
            const l = (obb.length || 6) / 2;
            modelPoints = [
                { x: -w, z: -l },
                { x:  w, z: -l },
                { x:  w, z:  l },
                { x: -w, z:  l }
            ];
        }

        const rad = -(obb.yaw || 0) * Math.PI / 180;
        const cosR = Math.cos(rad), sinR = Math.sin(rad);
        const sx = obb.scaleX || 1.0;
        const sz = obb.scaleZ || 1.0;

        return modelPoints.map(pt => {
            const px =  (pt.x !== undefined ? pt.x : pt[0]) * sx;
            const pz = -(pt.z !== undefined ? pt.z : pt[1]) * sz;
            const wx = obb.x + (px * cosR - pz * sinR);
            const wz = obb.z + (px * sinR + pz * cosR);
            return {
                x: XtoCanvas(wx),
                y: YtoCanvas(wz)
            };
        });
    }

    pointInPolygon(px, py, poly) {
        if (!poly || poly.length < 3) return false;
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x !== undefined ? poly[i].x : poly[i][0];
            const yi = poly[i].z !== undefined ? poly[i].z : (poly[i].y !== undefined ? poly[i].y : poly[i][1]);
            const xj = poly[j].x !== undefined ? poly[j].x : poly[j][0];
            const yj = poly[j].z !== undefined ? poly[j].z : (poly[j].y !== undefined ? poly[j].y : poly[j][1]);
            const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    getObbAtCanvasPos(canvasX, canvasY) {
        if (!this.initialized || !this.obbs || this.obbs.length === 0) return null;

        for (let i = this.obbs.length - 1; i >= 0; i--) {
            const obb = this.obbs[i];
            if (obb.hidden) continue;

            const cx = XtoCanvas(obb.x);
            const cy = YtoCanvas(obb.z);
            const radM = Math.max(obb.width || 8, obb.length || 8) * Math.max(obb.scaleX || 1.0, obb.scaleZ || 1.0);
            const radCanvas = (typeof MapSize !== "undefined" && typeof MapImageDrawSize !== "undefined") ? (radM / MapSize) * MapImageDrawSize + 30 : 45;

            if (Math.abs(cx - canvasX) > radCanvas || Math.abs(cy - canvasY) > radCanvas) continue;

            const poly = this._getObbCanvasPolygon(obb);
            if (!poly || poly.length < 3) continue;

            if (this.pointInPolygon(canvasX, canvasY, poly)) {
                obb._isBuildingObb = true;
                return obb;
            }

            // Boundary click tolerance
            for (let j = 0; j < poly.length; j++) {
                const p1 = poly[j];
                const p2 = poly[(j + 1) % poly.length];
                const distSq = this._distToSegmentSq(canvasX, canvasY, p1.x, p1.y, p2.x, p2.y);
                if (distSq <= 36) {
                    obb._isBuildingObb = true;
                    return obb;
                }
            }
        }
        return null;
    }

    setSelectedObb(obb) {
        this.selectedObb = obb || null;
        this.triggerCanvasRedraw();
    }

    _extract2DLinesFrom3D(mesh) {
        if (!mesh || !mesh.v || !mesh.i) return [];
        if (mesh.lines2d) return mesh.lines2d;

        const verts = mesh.v;
        const indices = mesh.i;
        const edgeMap = new Map();

        const addEdge = (x1, z1, x2, z2) => {
            const dx = x2 - x1, dz = z2 - z1;
            const len = Math.hypot(dx, dz);
            if (len < 0.6) return;

            const kx1 = Math.round(x1 * 4) / 4;
            const kz1 = Math.round(z1 * 4) / 4;
            const kx2 = Math.round(x2 * 4) / 4;
            const kz2 = Math.round(z2 * 4) / 4;
            if (kx1 === kx2 && kz1 === kz2) return;

            const key = (kx1 < kx2 || (kx1 === kx2 && kz1 < kz2))
                ? `${kx1},${kz1}_${kx2},${kz2}`
                : `${kx2},${kz2}_${kx1},${kz1}`;

            if (!edgeMap.has(key)) {
                edgeMap.set(key, [kx1, kz1, kx2, kz2]);
            }
        };

        for (let k = 0; k < indices.length; k += 3) {
            const i0 = indices[k] * 3;
            const i1 = indices[k + 1] * 3;
            const i2 = indices[k + 2] * 3;

            const v0x = verts[i0], v0y = verts[i0 + 1], v0z = verts[i0 + 2];
            const v1x = verts[i1], v1y = verts[i1 + 1], v1z = verts[i1 + 2];
            const v2x = verts[i2], v2y = verts[i2 + 1], v2z = verts[i2 + 2];

            const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
            const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
            const ny = Math.abs(e1z * e2x - e1x * e2z);
            const nx = e1y * e2z - e1z * e2y;
            const nz = e1x * e2y - e1y * e2x;
            const nlen = Math.hypot(nx, ny, nz);

            // If normal is mostly vertical wall (|ny| / nlen < 0.5)
            if (nlen > 0.001 && (ny / nlen) < 0.5) {
                addEdge(v0x, v0z, v1x, v1z);
                addEdge(v1x, v1z, v2x, v2z);
                addEdge(v2x, v2z, v0x, v0z);
            }
        }

        mesh.lines2d = Array.from(edgeMap.values());
        return mesh.lines2d;
    }

    drawBuildingWireframes(ctx) {
        if (!options_DrawBuildingWireframes || !this.initialized || this.obbs.length === 0) return;

        ctx.save();

        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;

        const cyanLines = [];
        const greenLines = [];
        const purpleLines = [];
        const pinkLines = [];

        const cyanPolys = [];
        const greenPolys = [];
        const purplePolys = [];
        const pinkPolys = [];

        for (let i = 0; i < this.obbs.length; i++) {
            const obb = this.obbs[i];
            if (obb.hidden) continue;

            const cx = XtoCanvas(obb.x);
            const cy = YtoCanvas(obb.z);
            const radM = Math.max(obb.width || 8, obb.length || 8) * Math.max(obb.scaleX || 1.0, obb.scaleZ || 1.0);
            const radCanvas = (typeof MapSize !== "undefined" && typeof MapImageDrawSize !== "undefined") ? (radM / MapSize) * MapImageDrawSize + 150 : 200;
            if (cx < -radCanvas || cx > canvasW + radCanvas || cy < -radCanvas || cy > canvasH + radCanvas) continue;

            // 1. Draw 3D-derived 2D wall lines (with exact doors, interior walls, and openings)
            if (obb.mesh3d && obb.mesh3d.lines2d && obb.mesh3d.lines2d.length > 0) {
                const targetLines = obb.ignoreLOS ? pinkLines : (obb.isCustom ? purpleLines : (obb.isVegetation ? greenLines : cyanLines));
                const lines = obb.mesh3d.lines2d;
                const rad = -(obb.yaw || 0) * Math.PI / 180;
                const cosR = Math.cos(rad), sinR = Math.sin(rad);
                const sx = obb.scaleX || 1.0, sz = obb.scaleZ || 1.0;

                for (let j = 0; j < lines.length; j++) {
                    const l = lines[j];
                    const wx1 = obb.x + (l[0] * cosR - l[1] * sinR) * sx;
                    const wz1 = obb.z + (l[0] * sinR + l[1] * cosR) * sz;
                    const wx2 = obb.x + (l[2] * cosR - l[3] * sinR) * sx;
                    const wz2 = obb.z + (l[2] * sinR + l[3] * cosR) * sz;

                    targetLines.push(XtoCanvas(wx1), YtoCanvas(wz1), XtoCanvas(wx2), YtoCanvas(wz2));
                }
                continue;
            }

            // 2. 2D Footprint Polygon Fallback
            const poly = this._getObbCanvasPolygon(obb);
            if (poly && poly.length >= 3) {
                const targetPolys = obb.ignoreLOS ? pinkPolys : (obb.isCustom ? purplePolys : (obb.isVegetation ? greenPolys : cyanPolys));
                targetPolys.push(poly);
            }
        }

        const renderBatch = (lines, polys, strokeColor, fillColor, lineWidth) => {
            if (polys.length > 0) {
                ctx.fillStyle = fillColor;
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                for (let i = 0; i < polys.length; i++) {
                    const p = polys[i];
                    ctx.moveTo(p[0].x, p[0].y);
                    for (let j = 1; j < p.length; j++) ctx.lineTo(p[j].x, p[j].y);
                    ctx.closePath();
                }
                ctx.fill();
                ctx.stroke();
            }

            if (lines.length > 0) {
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                for (let i = 0; i < lines.length; i += 4) {
                    ctx.moveTo(lines[i], lines[i + 1]);
                    ctx.lineTo(lines[i + 2], lines[i + 3]);
                }
                ctx.stroke();
            }
        };

        renderBatch(cyanLines, cyanPolys, "#00e5ff", "rgba(0, 229, 255, 0.12)", 1.2);
        renderBatch(greenLines, greenPolys, "#10b981", "rgba(16, 185, 129, 0.25)", 1.2);
        renderBatch(purpleLines, purplePolys, "#a855f7", "rgba(168, 85, 247, 0.20)", 1.5);
        renderBatch(pinkLines, pinkPolys, "#ec4899", "rgba(236, 72, 153, 0.20)", 1.5);

        // Draw Selected Building Highlight & Name Badge
        if (this.selectedObb && !this.selectedObb.hidden) {
            const selPoly = this._getObbCanvasPolygon(this.selectedObb);
            if (selPoly && selPoly.length >= 3) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(selPoly[0].x, selPoly[0].y);
                for (let j = 1; j < selPoly.length; j++) {
                    ctx.lineTo(selPoly[j].x, selPoly[j].y);
                }
                ctx.closePath();

                ctx.shadowColor = "#fbbf24";
                ctx.shadowBlur = 12;
                ctx.fillStyle = "rgba(251, 191, 36, 0.35)";
                ctx.strokeStyle = "#fbbf24";
                ctx.lineWidth = 2.5;
                ctx.fill();
                ctx.stroke();

                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                for (let j = 0; j < selPoly.length; j++) {
                    if (selPoly[j].x < minX) minX = selPoly[j].x;
                    if (selPoly[j].x > maxX) maxX = selPoly[j].x;
                    if (selPoly[j].y < minY) minY = selPoly[j].y;
                    if (selPoly[j].y > maxY) maxY = selPoly[j].y;
                }
                const labelX = (minX + maxX) / 2;
                const labelY = minY - 8;

                const nameText = this.selectedObb.name || "Unknown Structure";
                const infoText = `H: ${(this.selectedObb.height || 0).toFixed(1)}m | Y: ${(this.selectedObb.y || 0).toFixed(1)}m | Rot: ${(this.selectedObb.yaw || 0).toFixed(0)}°`;

                ctx.font = "bold 11px sans-serif";
                const textW = Math.max(ctx.measureText(nameText).width, ctx.measureText(infoText).width) + 18;
                const boxH = 32;
                const boxX = labelX - textW / 2;
                const boxY = labelY - boxH;

                ctx.shadowBlur = 6;
                ctx.fillStyle = "rgba(10, 15, 26, 0.92)";
                ctx.strokeStyle = "#fbbf24";
                ctx.lineWidth = 1.5;

                const r = 4;
                ctx.beginPath();
                ctx.moveTo(boxX + r, boxY);
                ctx.lineTo(boxX + textW - r, boxY);
                ctx.quadraticCurveTo(boxX + textW, boxY, boxX + textW, boxY + r);
                ctx.lineTo(boxX + textW, boxY + boxH - r);
                ctx.quadraticCurveTo(boxX + textW, boxY + boxH, boxX + textW - r, boxY + boxH);
                ctx.lineTo(boxX + r, boxY + boxH);
                ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r);
                ctx.lineTo(boxX, boxY + r);
                ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.shadowBlur = 0;
                ctx.textAlign = "center";
                ctx.fillStyle = "#fbbf24";
                ctx.fillText(nameText, labelX, boxY + 14);

                ctx.font = "10px sans-serif";
                ctx.fillStyle = "#cbd5e1";
                ctx.fillText(infoText, labelX, boxY + 27);

                ctx.restore();
            }
        }

        ctx.restore();
    }

    _buildHeightmapCache() {
        if (typeof heightmap === "undefined" || !heightmap.initialized || !heightmap.heightdataview) return;
        if (typeof MapSize === "undefined" || MapSize <= 0) return;

        const mapKey = this._mapKey || "default";
        if (this._heightmapCacheMap === mapKey && this._heightmapCacheCanvas) return;

        const terrainM = MapSize * 1024;
        const minW = -terrainM / 2;
        const maxW = terrainM / 2;

        const step = 6; // Crisp 6-meter grid resolution
        const canvasRes = 2048; // High resolution 2048x2048 offscreen canvas

        if (typeof document === "undefined") return;
        const offCanvas = document.createElement("canvas");
        offCanvas.width = canvasRes;
        offCanvas.height = canvasRes;
        const offCtx = offCanvas.getContext("2d");

        const pxPerMeter = canvasRes / terrainM;
        const tileSize = step * pxPerMeter;

        for (let wz = maxW; wz > minW; wz -= step) {
            const py = (maxW - wz) * pxPerMeter;
            for (let wx = minW; wx < maxW; wx += step) {
                const h = heightmap.getHeightFromCoords(wx, wz);
                if (h === -Infinity || isNaN(h)) continue;

                // Exaggerated height contrast gradient (0m -> 120m)
                const normH = Math.max(0, Math.min(1.0, (h - 2) / 120));
                const hue = Math.max(0, Math.min(240, 240 - normH * 240));

                const px = (wx - minW) * pxPerMeter;
                offCtx.fillStyle = `hsl(${hue}, 90%, 48%)`;
                offCtx.fillRect(px, py, tileSize + 0.4, tileSize + 0.4);
            }
        }

        this._heightmapCacheCanvas = offCanvas;
        this._heightmapCacheMap = mapKey;
        console.log(`[BuildingHeightmap] Heightmap overlay cached for ${mapKey} (Resolution: ${step}m grid, ${canvasRes}px canvas)`);
    }

    drawHeightmapOverlay(ctx) {
        if (!options_DrawHeightmapOverlay || typeof heightmap === "undefined" || !heightmap.initialized) return;
        if (typeof MapSize === "undefined" || MapSize <= 0) return;

        if (this._heightmapCacheMap !== this._mapKey || !this._heightmapCacheCanvas) {
            this._buildHeightmapCache();
        }

        if (!this._heightmapCacheCanvas) return;

        ctx.save();
        ctx.globalAlpha = 0.35;
        if (typeof CameraX !== "undefined" && typeof MapImageDrawSize !== "undefined") {
            ctx.drawImage(this._heightmapCacheCanvas, CameraX, CameraY, MapImageDrawSize, MapImageDrawSize);
        }
        ctx.restore();
    }

    drawLOSCollisionPoints(ctx) {
        if (!options_DrawLOSCollisionPoints || !devTestCollisionPoints || devTestCollisionPoints.length === 0) return;
        ctx.save();
        for (let i = 0; i < devTestCollisionPoints.length; i++) {
            const pt = devTestCollisionPoints[i];
            const cx = XtoCanvas(pt.x);
            const cy = YtoCanvas(pt.z);

            ctx.fillStyle = pt.type === "building" ? "#ff1744" : "#ffea00";
            ctx.beginPath();
            ctx.arc(cx, cy, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // LOS Raycasting  -  Fast 2D/3D Vector Polygon Collision Engine

    _intersectSegmentSegment(Ax, Az, Bx, Bz, Cx, Cz, Dx, Dz) {
        const det = (Bx - Ax) * (Dz - Cz) - (Bz - Az) * (Dx - Cx);
        if (det === 0) return null;
        const t = ((Cx - Ax) * (Dz - Cz) - (Cz - Az) * (Dx - Cx)) / det;
        const u = ((Cx - Ax) * (Bz - Az) - (Cz - Az) * (Bx - Ax)) / det;
        return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? t : null;
    }

    _intersectRayTriangle(origX, origY, origZ, dirX, dirY, dirZ, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z) {
        const EPS = 0.0000001;
        const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
        const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;

        const px = dirY * e2z - dirZ * e2y;
        const py = dirZ * e2x - dirX * e2z;
        const pz = dirX * e2y - dirY * e2x;

        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -EPS && det < EPS) return null;
        const invDet = 1.0 / det;

        const tx = origX - v0x, ty = origY - v0y, tz = origZ - v0z;
        const u = (tx * px + ty * py + tz * pz) * invDet;
        if (u < 0.0 || u > 1.0) return null;

        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;

        const v = (dirX * qx + dirY * qy + dirZ * qz) * invDet;
        if (v < 0.0 || u + v > 1.0) return null;

        const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        return (t >= 0.0 && t <= 1.0) ? t : null;
    }

    _intersectRayAABB(origX, origY, origZ, dirX, dirY, dirZ, bMinX, bMinY, bMinZ, bMaxX, bMaxY, bMaxZ) {
        let tmin = -Infinity, tmax = Infinity;

        if (Math.abs(dirX) > 1e-7) {
            const invD = 1.0 / dirX;
            let t1 = (bMinX - origX) * invD;
            let t2 = (bMaxX - origX) * invD;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) return false;
        } else if (origX < bMinX || origX > bMaxX) return false;

        if (Math.abs(dirY) > 1e-7) {
            const invD = 1.0 / dirY;
            let t1 = (bMinY - origY) * invD;
            let t2 = (bMaxY - origY) * invD;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) return false;
        } else if (origY < bMinY || origY > bMaxY) return false;

        if (Math.abs(dirZ) > 1e-7) {
            const invD = 1.0 / dirZ;
            let t1 = (bMinZ - origZ) * invD;
            let t2 = (bMaxZ - origZ) * invD;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) return false;
        } else if (origZ < bMinZ || origZ > bMaxZ) return false;

        return tmax >= 0.0 && tmin <= 1.0;
    }

    _distToSegmentSq(Px, Pz, Ax, Az, Bx, Bz) {
        const l2 = (Bx - Ax) * (Bx - Ax) + (Bz - Az) * (Bz - Az);
        if (l2 === 0) return (Px - Ax) * (Px - Ax) + (Pz - Az) * (Pz - Az);
        let t = Math.max(0, Math.min(1, ((Px - Ax) * (Bx - Ax) + (Pz - Az) * (Bz - Az)) / l2));
        const projX = Ax + t * (Bx - Ax);
        const projZ = Az + t * (Bz - Az);
        return (Px - projX) * (Px - projX) + (Pz - projZ) * (Pz - projZ);
    }

    checkRayPolygonIntersection(p1, p2, obb) {
        if (!obb || obb.hidden || obb.ignoreLOS) return null;

        const rad = -(obb.yaw || 0) * Math.PI / 180;
        const cosR = Math.cos(rad), sinR = Math.sin(rad);
        const sx = obb.scaleX || 1.0;
        const sz = obb.scaleZ || 1.0;

        const dx1 = p1.x - obb.x, dz1 = p1.z - obb.z;
        const dx2 = p2.x - obb.x, dz2 = p2.z - obb.z;

        const lx1 = (dx1 * cosR + dz1 * sinR) / sx;
        const lz1 = (-dx1 * sinR + dz1 * cosR) / sz;
        const lx2 = (dx2 * cosR + dz2 * sinR) / sx;
        const lz2 = (-dx2 * sinR + dz2 * cosR) / sz;

        // 1. Exact 3D Triangle Mesh Raycasting (100% physically authentic LOS with door & window openings)
        if (obb.mesh3d && obb.mesh3d.i && obb.mesh3d.i.length > 0) {
            const dy1 = (p1.y !== undefined ? p1.y : (obb.y || 0)) - (obb.y || 0);
            const dy2 = (p2.y !== undefined ? p2.y : (obb.y || 0)) - (obb.y || 0);
            const dirLX = lx2 - lx1;
            const dirLY = dy2 - dy1;
            const dirLZ = lz2 - lz1;

            const b = obb.mesh3d.b;
            if (b && !this._intersectRayAABB(lx1, dy1, lz1, dirLX, dirLY, dirLZ, b[0] - 0.2, b[1] - 0.2, b[2] - 0.2, b[3] + 0.2, b[4] + 0.2, b[5] + 0.2)) {
                return null;
            }

            const verts = obb.mesh3d.v;
            const indices = obb.mesh3d.i;
            let closestT = Infinity;

            for (let k = 0; k < indices.length; k += 3) {
                const i0 = indices[k] * 3;
                const i1 = indices[k + 1] * 3;
                const i2 = indices[k + 2] * 3;

                const t = this._intersectRayTriangle(
                    lx1, dy1, lz1, dirLX, dirLY, dirLZ,
                    verts[i0], verts[i0 + 1], verts[i0 + 2],
                    verts[i1], verts[i1 + 1], verts[i1 + 2],
                    verts[i2], verts[i2 + 1], verts[i2 + 2]
                );
                if (t !== null && t < closestT) {
                    closestT = t;
                }
            }

            if (closestT < Infinity) {
                return {
                    t: closestT,
                    hitX: p1.x + (p2.x - p1.x) * closestT,
                    hitY: (p1.y !== undefined ? p1.y : (obb.y || 0)) + ((p2.y !== undefined ? p2.y : (obb.y || 0)) - (p1.y !== undefined ? p1.y : (obb.y || 0))) * closestT,
                    hitZ: p1.z + (p2.z - p1.z) * closestT,
                    obb: obb
                };
            }
            return null;
        }

        // 2. 2D Vector Footprint Polygon Fallback
        const rawFp = obb.customPolygon || this._getFootprint(obb.name);
        let poly = (rawFp && rawFp.poly) ? rawFp.poly : rawFp;
        if (!poly || poly.length < 3) {
            const hw = obb.halfW / sx, hl = obb.halfL / sz;
            poly = [{x: -hw, z: -hl}, {x: hw, z: -hl}, {x: hw, z: hl}, {x: -hw, z: hl}];
        }

        // Bounding circle test around (0,0) in model space
        let maxR = obb.maxR;
        if (!maxR) {
            let r2 = 0;
            for (let i = 0; i < poly.length; i++) {
                const px = poly[i].x !== undefined ? poly[i].x : poly[i][0];
                const pz = poly[i].z !== undefined ? poly[i].z : poly[i][1];
                const distSq = px * px + pz * pz;
                if (distSq > r2) r2 = distSq;
            }
            maxR = Math.sqrt(r2);
            obb.maxR = maxR;
        }

        // Fast bounding circle exit check
        if (this._distToSegmentSq(0, 0, lx1, lz1, lx2, lz2) > maxR * maxR) {
            return null;
        }

        let closestT = Infinity;

        if (rawFp && rawFp.walls && rawFp.walls.length > 0) {
            for (let i = 0; i < rawFp.walls.length; i++) {
                const w = rawFp.walls[i];
                const t = this._intersectSegmentSegment(lx1, lz1, lx2, lz2, w[0], w[1], w[2], w[3]);
                if (t !== null && t < closestT) {
                    closestT = t;
                }
            }
        } else {
            const n = poly.length;
            for (let i = 0; i < n; i++) {
                const pA = poly[i], pB = poly[(i + 1) % n];
                const ax = pA.x !== undefined ? pA.x : pA[0];
                const az = pA.z !== undefined ? pA.z : pA[1];
                const bx = pB.x !== undefined ? pB.x : pB[0];
                const bz = pB.z !== undefined ? pB.z : pB[1];
                const t = this._intersectSegmentSegment(lx1, lz1, lx2, lz2, ax, az, bx, bz);
                if (t !== null && t < closestT) {
                    closestT = t;
                }
            }
        }

        if (closestT < Infinity) {
            const hitX = p1.x + (p2.x - p1.x) * closestT;
            const hitZ = p1.z + (p2.z - p1.z) * closestT;
            const hitY = p1.y + (p2.y - p1.y) * closestT;

            // 3D Height Check: If the ray flies above the top or below the bottom of the object, NO COLLISION!
            if (hitY > obb.maxY || hitY < obb.minY) {
                return null;
            }

            return {
                t: closestT,
                hitX: hitX,
                hitY: hitY,
                hitZ: hitZ,
                obb: obb
            };
        }

        return null;
    }

    // Alias for backward compatibility
    checkRayOBBIntersection(p1, p2, obb) {
        return this.checkRayPolygonIntersection(p1, p2, obb);
    }

    _rayMarch(x1, y1, z1, x2, y2, z2, onHit) {
        const p1 = { x: x1, y: y1, z: z1 }, p2 = { x: x2, y: y2, z: z2 };
        const sCell = this.spatialCellSize;
        let curC = Math.floor(x1 / sCell), curR = Math.floor(z1 / sCell);
        let endC = Math.floor(x2 / sCell), endR = Math.floor(z2 / sCell);

        const dx = x2 - x1, dz = z2 - z1;
        const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
        const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

        const dtx = dx !== 0 ? Math.abs(sCell / dx) : Infinity;
        const dtz = dz !== 0 ? Math.abs(sCell / dz) : Infinity;

        let tx = stepX > 0 ? ((Math.floor(x1 / sCell) + 1) * sCell - x1) / dx : (stepX < 0 ? (x1 - Math.floor(x1 / sCell) * sCell) / (-dx) : Infinity);
        let tz = stepZ > 0 ? ((Math.floor(z1 / sCell) + 1) * sCell - z1) / dz : (stepZ < 0 ? (z1 - Math.floor(z1 / sCell) * sCell) / (-dz) : Infinity);

        const checked = new Set();
        let closestHit = null;

        for (let step = 0; step < 4000; step++) {
            const list = this.spatialGrid.get(curC + "," + curR);
            if (list) {
                for (let i = 0; i < list.length; i++) {
                    const obb = list[i];
                    if (checked.has(obb.id) || obb.hidden || obb.ignoreLOS) continue;
                    checked.add(obb.id);

                    const hit = this.checkRayPolygonIntersection(p1, p2, obb);
                    if (hit) {
                        const r = onHit(hit);
                        if (r !== undefined) return r; // Early return for boolean LOS check (e.g. hasBuildingLOS)

                        // For getRayCollision: track closest hit and early-stop ray marching
                        if (!closestHit || hit.t < closestHit.t) {
                            closestHit = hit;
                            // Shorten end target cell to current hit cell to stop early!
                            endC = Math.floor(hit.hitX / sCell);
                            endR = Math.floor(hit.hitZ / sCell);
                        }
                    }
                }
            }

            if (curC === endC && curR === endR) break;

            if (tx < tz) { curC += stepX; tx += dtx; } else { curR += stepZ; tz += dtz; }
        }

        return closestHit;
    }

    hasBuildingLOS(x1, y1, z1, x2, y2, z2, eyeHeight = 1.65) {
        if (!this.initialized || this.obbs.length === 0) return true;
        const eye = (eyeHeight !== undefined) ? eyeHeight : 1.65;
        const res = this._rayMarch(x1, y1 + eye, z1, x2, y2 + eye, z2, hit => true);
        return res !== true; // Returns true (CLEAR) when no building hit (null), false (BLOCKED) when hit (true)
    }

    getRayCollision(x1, y1, z1, x2, y2, z2, eyeHeight = 1.65) {
        if (!this.initialized || this.obbs.length === 0) return null;
        const eye = (eyeHeight !== undefined) ? eyeHeight : 1.65;
        const hit = this._rayMarch(x1, y1 + eye, z1, x2, y2 + eye, z2, hit => undefined);
        return hit || null;
    }

    getHeightAt(x, z) {
        if (!this.grid || !this._meta) return -Infinity;
        const { origin, cellSize, gridSize } = this._meta;
        const col = Math.floor((x - origin) / cellSize);
        const row = Math.floor((z - origin) / cellSize);
        if (col < 0 || col >= gridSize || row < 0 || row >= gridSize) return -Infinity;
        return this.grid[row * gridSize + col];
    }
}

// Global singleton
var buildingHeightmap = new BuildingHeightmap();
if (typeof window !== "undefined") {
    window.BuildingHeightmap = BuildingHeightmap;
    window.buildingHeightmap = buildingHeightmap;
}
