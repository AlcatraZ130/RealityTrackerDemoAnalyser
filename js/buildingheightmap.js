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

class BuildingHeightmap {
    constructor() {
        this.initialized          = false;
        this.obbs                 = [];
        this.spatialGrid          = new Map();
        this.spatialCellSize      = 2;
        this.grid                 = null;
        this._meta                = null;
        this.overrides            = {};
        this.pendingCustomObjects = [];
        this._mapKey              = null;
        this._loading             = false;
        this._footprintCache      = new Map();
        this._footprintCacheBuilt = null;
        this._heightmapCacheCanvas = null;
        this._heightmapCacheMap    = null;
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

    async load(mapKey, heightmapConfig) {
        if (!mapKey || this._loading) return;
        this._loading = true;
        this._mapKey  = mapKey;

        this.obbs    = [];
        this.spatialGrid.clear();
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

        // - 2a. Fast path: MAP_STATICS_DB (pre-compiled, instant) --
        if (window.MAP_STATICS_DB && window.MAP_STATICS_DB[mapKey]) {
            try {
                this._buildFromDb(mapKey, heightmapConfig);
                this._addCustomObjects();
                this.initialized = true;
                this._loading = false;
                this.triggerCanvasRedraw();
                const withFp = this.obbs.filter(o => this._getObbCanvasPolygon(o).length >= 3).length;
                console.log(`[BuildingHeightmap] ${this.obbs.length} objects loaded from MAP_STATICS_DB for ${mapKey} | footprints: ${withFp}/${this.obbs.length} (${Math.round(withFp / this.obbs.length * 100)}%)`);
                return;
            } catch (err) {
                console.warn(`[BuildingHeightmap] MAP_STATICS_DB path failed for ${mapKey}:`, err.message);
            }
        }

        // - 2b. Fallback: parse staticobjects.con --
        try {
            const res = await fetch(`MapsStaticobjects/${mapKey}/staticobjects.con`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this._buildFromCon(mapKey, await res.text(), heightmapConfig);
            this._addCustomObjects();
            this.initialized = true;
            this._loading = false;
            this.triggerCanvasRedraw();
        } catch (err) {
            this._loading = false;
            console.warn(`[BuildingHeightmap] No building data for ${mapKey} (${err.message})`);
        }
    }

    // Build from MAP_STATICS_DB

    _buildFromDb(mapKey, config) {
        this._initGrid(config);
        const dbObjects = window.MAP_STATICS_DB[mapKey];
        for (let i = 0; i < dbObjects.length; i++) {
            const o = dbObjects[i];
            this._addObject({
                name: (o.name || o[0] || "").toLowerCase(),
                x:    o.x   !== undefined ? o.x   : (o[1] !== undefined ? o[1] : 0),
                y:    o.y   !== undefined ? o.y   : (o[2] !== undefined ? o[2] : 0),
                z:    o.z   !== undefined ? o.z   : (o[3] !== undefined ? o[3] : 0),
                yaw:  o.yaw !== undefined ? o.yaw : (o[4] !== undefined ? o[4] : 0),
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
        const terrainSize = config ? parseInt(config.fullsize) : 1024;
        const scaleX      = config ? parseFloat(config.scale.split("/")[0]) : 2;
        const terrainM    = terrainSize * scaleX;
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
        const lc = obj.name.toLowerCase();

        // Skip vegetation and pure-visual objects
        if (lc.includes("tree")  || lc.includes("palm")    || lc.includes("bush")  ||
            lc.includes("shrub") || lc.includes("birch")   || lc.includes("pine")  ||
            lc.includes("oak")   || lc.includes("jungle")  || lc.includes("foliage") ||
            lc.includes("almond") || lc.includes("hedge")  || lc.includes("ambstat") ||
            lc.includes("amdstat") || lc.includes("e_samb") ||
            lc.includes("waterplane") || lc.includes("waterfall") || lc.includes("fountain") ||
            lc.includes("e_destruction") || lc.includes("burning") || lc.includes("wreckfire"))
            return;

        // Resolve override
        const posKey       = this._getPosKey(obj.name, obj.x, obj.z);
        const roundedKey   = `${obj.name}_${Math.round(obj.x)}_${Math.round(obj.z)}`;
        const floorKey     = `${obj.name}_${Math.floor(obj.x)}_${Math.floor(obj.z)}`;
        const rawStringKey = `${obj.name}_${obj.x}_${obj.z}`;
        const ovr = this.overrides[posKey] || this.overrides[roundedKey] || this.overrides[floorKey] || this.overrides[rawStringKey];

        if (ovr && ovr.hidden) return;

        let posX = obj.x, posZ = obj.z, yaw = obj.yaw || 0;
        let width = 6, length = 6, height = 6;
        let scaleX = 1.0, scaleZ = 1.0;
        let customPolygon = null;

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
            if (!ovr || ovr.width  === undefined) width  = (maxAbsX * 2) || 6;
            if (!ovr || ovr.length === undefined) length = (maxAbsZ * 2) || 6;
        }

        if (fpH != null && (!ovr || ovr.height === undefined)) {
            height = fpH;
        }

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
            customPolygon: customPolygon || null
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
                customPolygon: (c.customPolygon && c.customPolygon.length >= 3) ? c.customPolygon : null
            };
            this.obbs.push(obb);
            this._rasterizeObb(obb);
        }
    }

    // Rasterizer  -  spatial/heightmap grid

    _rasterizeObb(obb) {
        if (!obb || obb.hidden) return;
        if (this.grid && this._meta) {
            const { origin, cellSize, gridSize } = this._meta;
            const maxR = Math.hypot(obb.halfW, obb.halfL);
            const col0 = Math.max(0, Math.floor((obb.x - maxR - origin) / cellSize));
            const col1 = Math.min(gridSize - 1, Math.floor((obb.x + maxR - origin) / cellSize));
            const row0 = Math.max(0, Math.floor((obb.z - maxR - origin) / cellSize));
            const row1 = Math.min(gridSize - 1, Math.floor((obb.z + maxR - origin) / cellSize));
            for (let r = row0; r <= row1; r++)
                for (let c = col0; c <= col1; c++) {
                    const idx = r * gridSize + c;
                    if (obb.maxY > this.grid[idx]) this.grid[idx] = obb.maxY;
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
            const px = (pt.x !== undefined ? pt.x : pt[0]) * sx;
            const pz = (pt.z !== undefined ? pt.z : pt[1]) * sz;
            const wx = obb.x + (px * cosR - pz * sinR);
            const wz = obb.z + (px * sinR + pz * cosR);
            return {
                x: XtoCanvas(wx),
                y: YtoCanvas(wz)
            };
        });
    }

    drawBuildingWireframes(ctx) {
        if (!options_DrawBuildingWireframes || !this.initialized || this.obbs.length === 0) return;

        ctx.save();

        for (let i = 0; i < this.obbs.length; i++) {
            const obb = this.obbs[i];
            if (obb.hidden) continue;

            const cx = XtoCanvas(obb.x);
            const cy = YtoCanvas(obb.z);
            if (cx < -150 || cx > ctx.canvas.width + 150 || cy < -150 || cy > ctx.canvas.height + 150) continue;

            const poly = this._getObbCanvasPolygon(obb);
            if (!poly || poly.length < 3) continue;

            ctx.beginPath();
            ctx.moveTo(poly[0].x, poly[0].y);
            for (let j = 1; j < poly.length; j++) {
                ctx.lineTo(poly[j].x, poly[j].y);
            }
            ctx.closePath();

            if (obb.isCustom) {
                ctx.strokeStyle = "#a855f7";
                ctx.fillStyle   = "rgba(168, 85, 247, 0.20)";
                ctx.lineWidth   = 1.5;
            } else {
                ctx.strokeStyle = "#00e5ff";
                ctx.fillStyle   = "rgba(0, 229, 255, 0.10)";
                ctx.lineWidth   = 1.0;
            }

            ctx.fill();
            ctx.stroke();
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

    _distToSegmentSq(Px, Pz, Ax, Az, Bx, Bz) {
        const l2 = (Bx - Ax) * (Bx - Ax) + (Bz - Az) * (Bz - Az);
        if (l2 === 0) return (Px - Ax) * (Px - Ax) + (Pz - Az) * (Pz - Az);
        let t = Math.max(0, Math.min(1, ((Px - Ax) * (Bx - Ax) + (Pz - Az) * (Bz - Az)) / l2));
        const projX = Ax + t * (Bx - Ax);
        const projZ = Az + t * (Bz - Az);
        return (Px - projX) * (Px - projX) + (Pz - projZ) * (Pz - projZ);
    }

    checkRayPolygonIntersection(p1, p2, obb) {
        if (!obb || obb.hidden) return null;

        const rad = -obb.yaw * Math.PI / 180;
        const cosR = Math.cos(rad), sinR = Math.sin(rad);
        const sx = obb.scaleX || 1.0;
        const sz = obb.scaleZ || 1.0;

        const dx1 = p1.x - obb.x, dz1 = p1.z - obb.z;
        const dx2 = p2.x - obb.x, dz2 = p2.z - obb.z;

        const lx1 = (dx1 * cosR - dz1 * sinR) / sx;
        const lz1 = (dx1 * sinR + dz1 * cosR) / sz;
        const lx2 = (dx2 * cosR - dz2 * sinR) / sx;
        const lz2 = (dx2 * sinR + dz2 * cosR) / sz;

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
                    if (checked.has(obb.id) || obb.hidden) continue;
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
