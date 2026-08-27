// Part of RealityTracker Demo Analyser 3D ALPHA - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// High-Performance On-Demand 3D Entity Renderer in WebGL2 (Soldiers & Vehicles)
// Renders real 3D triangle meshes with Team Colors (Team 1 OpFor #ff0000 / Team 2 BluFor #0040ff),
// Selection Outlines (#bea425), Ground Offset Compensation, and Dynamic Terrain Following (Pitch & Roll).

var entities3dRenderer;

class Entities3dRenderer extends Initializable {
    program = null;
    outlineProgram = null;
    
    // WebGL GPU Buffers Cache: name -> { vertexBuffer, indexBuffer, indexCount, vertexCount, groundOffset, length, width }
    gpuMeshCache = {};
    rawModelCache = {};
    pendingFetches = new Set();
    failedModels = new Set();
    _preloadInProgress = false;
    _preloadFinished = false;
    
    // Active Map Spawns Cache
    currentMap = null;
    mapSpawnEntities = [];
    
    // Attribute & Uniform Locations
    aVertexPosition = null;
    aVertexNormal = null;
    uModelMatrix = null;
    uViewMatrix = null;
    uProjectionMatrix = null;
    uTeamColor = null;

    // Outline Shader Locations
    aOutlineVertexPosition = null;
    aOutlineVertexNormal = null;
    uOutlineModelMatrix = null;
    uOutlineViewMatrix = null;
    uOutlineProjectionMatrix = null;
    uOutlineColor = null;

    // RealityTracker Team Color Definitions:
    // Team 1: OpFor (Red #ff0000)
    // Team 2: BluFor (Blue #0040ff)
    colorTeam1 = vec3.set(vec3.create(), 1.0, 0.0, 0.0);   // #ff0000 (OpFor / Team 1 / Red)
    colorTeam2 = vec3.set(vec3.create(), 0.0, 0.25, 1.0);  // #0040ff (BluFor / Team 2 / Blue)
    colorSquad = vec3.set(vec3.create(), 0.22, 1.0, 0.08); // Green (#39ff14)
    colorOutline = vec3.set(vec3.create(), 0.745, 0.643, 0.145); // Golden Outline (#bea425)
    colorDeadTeam1 = vec3.set(vec3.create(), 0.52, 0.38, 0.38); // OpFor Dead (Gris rojizo apagado)
    colorDeadTeam2 = vec3.set(vec3.create(), 0.38, 0.42, 0.52); // BluFor Dead (Gris azulado apagado)
    colorCache = vec3.set(vec3.create(), 0.88, 0.72, 0.22);     // Insurgency Ammo Cache (Dorado)

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

        // ---------------------------------------------------------------------
        // 1. Main Entity Shader (Solid Color + Directional/Ambient Lighting)
        // ---------------------------------------------------------------------
        const vsSource = `
            attribute vec3 aVertexPosition;
            attribute vec3 aVertexNormal;

            uniform mat4 uModelMatrix;
            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;

            varying highp vec3 vNormal;
            varying highp vec3 vWorldPos;

            void main(void) {
                vec4 worldPos = uModelMatrix * vec4(aVertexPosition, 1.0);
                gl_Position = uProjectionMatrix * uViewMatrix * worldPos;
                vNormal = normalize(mat3(uModelMatrix) * aVertexNormal);
                vWorldPos = worldPos.xyz;
            }
        `;

        const fsSource = `
            varying highp vec3 vNormal;
            varying highp vec3 vWorldPos;

            uniform highp vec3 uTeamColor;

            void main(void) {
                highp vec3 norm = normalize(vNormal);
                if (!gl_FrontFacing) norm = -norm;

                highp vec3 sunDir = normalize(vec3(0.45, 0.85, -0.30));
                highp float sunDiff = max(dot(norm, sunDir), 0.0);

                highp vec3 skyDir = normalize(vec3(-0.40, 0.60, 0.35));
                highp float skyDiff = max(dot(norm, skyDir), 0.0);

                highp float skyFactor = clamp(norm.y * 0.5 + 0.5, 0.0, 1.0);
                highp float lighting = 0.30 + (0.44 * sunDiff) + (0.16 * skyDiff) + (0.10 * skyFactor);

                gl_FragColor = vec4(uTeamColor * lighting, 1.0);
            }
        `;

        const vertexShader = renderer3d.loadShader(gl.VERTEX_SHADER, vsSource);
        const fragmentShader = renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource);

        const prog = gl.createProgram();
        gl.attachShader(prog, vertexShader);
        gl.attachShader(prog, fragmentShader);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Unable to initialize Entity 3D shader program: ' + gl.getProgramInfoLog(prog));
            return false;
        }

        this.program = prog;
        this.aVertexPosition = gl.getAttribLocation(prog, 'aVertexPosition');
        this.aVertexNormal = gl.getAttribLocation(prog, 'aVertexNormal');
        this.uModelMatrix = gl.getUniformLocation(prog, 'uModelMatrix');
        this.uViewMatrix = gl.getUniformLocation(prog, 'uViewMatrix');
        this.uProjectionMatrix = gl.getUniformLocation(prog, 'uProjectionMatrix');
        this.uTeamColor = gl.getUniformLocation(prog, 'uTeamColor');

        // ---------------------------------------------------------------------
        // 2. Selection Outline Shader (Expanded Hull #bea425)
        // ---------------------------------------------------------------------
        const vsOutlineSource = `
            attribute vec3 aVertexPosition;
            attribute vec3 aVertexNormal;

            uniform mat4 uModelMatrix;
            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;

            void main(void) {
                vec3 norm = normalize(aVertexNormal);
                vec3 expanded = aVertexPosition + norm * 0.045;
                vec4 worldPos = uModelMatrix * vec4(expanded, 1.0);
                gl_Position = uProjectionMatrix * uViewMatrix * worldPos;
            }
        `;

        const fsOutlineSource = `
            uniform highp vec3 uOutlineColor;

            void main(void) {
                gl_FragColor = vec4(uOutlineColor, 1.0);
            }
        `;

        const vOutlineShader = renderer3d.loadShader(gl.VERTEX_SHADER, vsOutlineSource);
        const fOutlineShader = renderer3d.loadShader(gl.FRAGMENT_SHADER, fsOutlineSource);

        const outlineProg = gl.createProgram();
        gl.attachShader(outlineProg, vOutlineShader);
        gl.attachShader(outlineProg, fOutlineShader);
        gl.linkProgram(outlineProg);

        if (gl.getProgramParameter(outlineProg, gl.LINK_STATUS)) {
            this.outlineProgram = outlineProg;
            this.aOutlineVertexPosition = gl.getAttribLocation(outlineProg, 'aVertexPosition');
            this.aOutlineVertexNormal = gl.getAttribLocation(outlineProg, 'aVertexNormal');
            this.uOutlineModelMatrix = gl.getUniformLocation(outlineProg, 'uModelMatrix');
            this.uOutlineViewMatrix = gl.getUniformLocation(outlineProg, 'uViewMatrix');
            this.uOutlineProjectionMatrix = gl.getUniformLocation(outlineProg, 'uProjectionMatrix');
            this.uOutlineColor = gl.getUniformLocation(outlineProg, 'uOutlineColor');
        }

        // Upload any raw models already preloaded in the background to GPU buffers
        for (const modelKey in this.rawModelCache) {
            if (!this.gpuMeshCache[modelKey]) {
                this.uploadToGpu(modelKey, this.rawModelCache[modelKey]);
            }
        }

        this.initialized = true;
        return true;
    }

    uploadToGpu(modelKey, raw) {
        const gl = renderer3d.gl;
        if (!gl || !raw || !raw.data) return null;

        if (raw.data.hull && raw.data.turret) {
            // Multi-Part Vehicle (Chassis Hull + Rotating Turret)
            const hullData = raw.data.hull;
            const turretData = raw.data.turret;

            const hVBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, hVBuf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(hullData.v), gl.STATIC_DRAW);

            const hIBuf = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hIBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(hullData.i), gl.STATIC_DRAW);

            const tVBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, tVBuf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(turretData.v), gl.STATIC_DRAW);

            const tIBuf = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tIBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(turretData.i), gl.STATIC_DRAW);

            const gpuMesh = {
                isMultiPart: true,
                hull: {
                    vertexBuffer: hVBuf,
                    indexBuffer: hIBuf,
                    indexCount: hullData.i.length,
                    vertexCount: hullData.v.length / 6
                },
                turret: {
                    vertexBuffer: tVBuf,
                    indexBuffer: tIBuf,
                    indexCount: turretData.i.length,
                    vertexCount: turretData.v.length / 6,
                    pivot: turretData.pivot || [0.0, 1.5, 0.0]
                },
                groundOffset: raw.groundOffset,
                length: raw.length,
                width: raw.width
            };

            this.gpuMeshCache[modelKey] = gpuMesh;
            return gpuMesh;
        }

        // Standard Single-Mesh Model
        const vBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(raw.data.v), gl.STATIC_DRAW);

        const iBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(raw.data.i), gl.STATIC_DRAW);

        const gpuMesh = {
            isMultiPart: false,
            vertexBuffer: vBuf,
            indexBuffer: iBuf,
            indexCount: raw.data.i.length,
            vertexCount: raw.numVerts,
            groundOffset: raw.groundOffset,
            length: raw.length,
            width: raw.width
        };

        this.gpuMeshCache[modelKey] = gpuMesh;
        return gpuMesh;
    }

    async fetchModelAsync(modelKey) {
        if (!modelKey || this.gpuMeshCache[modelKey] || this.pendingFetches.has(modelKey) || this.failedModels.has(modelKey)) return;
        
        this.pendingFetches.add(modelKey);
        try {
            const resp = await fetch(`models_3d/${modelKey}.json?v=11.0_restored_clean_1787822000`);
            if (!resp.ok) {
                this.failedModels.add(modelKey);
                this.pendingFetches.delete(modelKey);
                return;
            }
            const data = await resp.json();
            if (!data || (!data.v && !data.hull)) {
                this.failedModels.add(modelKey);
                this.pendingFetches.delete(modelKey);
                return;
            }

            // Calculate precise bounding box and ground offset across all vertices
            let minY = Infinity, maxY = -Infinity;
            let minX = Infinity, maxX = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;

            const allV = (data.hull && data.turret) ? data.hull.v.concat(data.turret.v) : (data.v || []);
            const numVerts = allV.length / 6;
            for (let vIdx = 0; vIdx < numVerts; vIdx++) {
                const vx = allV[vIdx * 6];
                const vy = allV[vIdx * 6 + 1];
                const vz = allV[vIdx * 6 + 2];
                if (vy < minY) minY = vy;
                if (vy > maxY) maxY = vy;
                if (vx < minX) minX = vx;
                if (vx > maxX) maxX = vx;
                if (vz < minZ) minZ = vz;
                if (vz > maxZ) maxZ = vz;
            }

            const raw = {
                data: data,
                numVerts: numVerts,
                groundOffset: (minY < 0) ? -minY : 0.0,
                length: (maxZ > minZ) ? (maxZ - minZ) : 5.0,
                width: (maxX > minX) ? (maxX - minX) : 2.5
            };

            this.rawModelCache[modelKey] = raw;

            // If WebGL is already active, upload directly to GPU
            if (this.initialized && renderer3d.gl) {
                this.uploadToGpu(modelKey, raw);
                if (typeof requestUpdate === "function") requestUpdate();
            }
        } catch (e) {
            this.failedModels.add(modelKey);
        } finally {
            this.pendingFetches.delete(modelKey);
        }
    }

    normalizeFaction(fac) {
        if (!fac) return 'ru';
        let f = fac.toLowerCase().replace(/_vehicles|_iron|_night|_desert|_woodland|_winter/g, '').trim();
        const map = {
            'usmc': 'us',
            'russia': 'ru',
            'pla': 'ch',
            'china': 'ch',
            'british': 'gb',
            'uk': 'gb',
            'gb82': 'gb',
            'germany': 'ger',
            'france': 'fr',
            'canada': 'cf',
            'dutch': 'nl',
            'netherlands': 'nl',
            'poland': 'pl',
            'israel': 'idf',
            'insurgents': 'meinsurgent',
            'militia': 'meinsurgent',
            'syria': 'fsa',
            'nva': 'vnnva',
            'arf': 'meinsurgent',
            'arg82': 'cf',
            'chechen90': 'meinsurgent',
            'chinsurgent': 'meinsurgent',
            'chinsurgent90': 'meinsurgent',
            'vnusmc': 'vnusa',
            'ww2ger41': 'ww2ger',
            'ww2rusearly': 'ww2rus'
        };
        return map[f] || f;
    }

    startProgressiveBackgroundPreload() {
        if (this._preloadInProgress || this._preloadFinished) return;
        this._preloadInProgress = true;

        const queue = [];

        // Priority 1: Base Universal Fallbacks & Standard Riflemen
        queue.push('soldier_stand', 'soldier_crouch', 'soldier_prone');
        queue.push('vehicle_ammocache', 'vehicle_rallypoint_ru_placeable', 'vehicle_rallypoint_us_placeable');
        queue.push('fob_deployable_firebase', 'fob_insurgent_hideout');

        // Priority 2: Faction Rifleman Models (90% of soldiers on screen)
        const opforRaw = (typeof window.OpForTeam !== "undefined" && window.OpForTeam) || 'ru';
        const bluforRaw = (typeof window.BluForTeam !== "undefined" && window.BluForTeam) || 'us';
        const opforFaction = this.normalizeFaction(opforRaw);
        const bluforFaction = this.normalizeFaction(bluforRaw);
        const factions = new Set([opforFaction, bluforFaction]);

        factions.forEach(fac => {
            queue.push(`soldier_pr_${fac}_soldier2_stand`, `soldier_pr_${fac}_soldier2_crouch`, `soldier_pr_${fac}_soldier2_prone`);
        });

        // Priority 3: Core Projectiles
        queue.push('proj_tow', 'proj_lat', 'proj_aa', 'proj_grenadier', 'proj_frag', 'proj_smoke');

        // Priority 4: Other 5 kit roles for active factions
        factions.forEach(fac => {
            [1, 3, 4, 5, 6].forEach(kit => {
                queue.push(`soldier_pr_${fac}_soldier${kit}_stand`, `soldier_pr_${fac}_soldier${kit}_crouch`, `soldier_pr_${fac}_soldier${kit}_prone`);
            });
        });

        // Priority 5: Active Vehicles
        if (typeof AllVehicles !== "undefined") {
            for (const vid in AllVehicles) {
                const v = AllVehicles[vid];
                if (!v || !v.name) continue;
                const meshKey = this.getVehicleMeshKey(v.name);
                if (meshKey && !queue.includes(meshKey)) queue.push(meshKey);
            }
        }

        // Stream 1 single model every 70ms in background so 2D CPU usage is 0%
        let index = 0;
        const processNext = async () => {
            if (index >= queue.length) {
                this._preloadInProgress = false;
                this._preloadFinished = true;
                return;
            }

            const modelKey = queue[index++];
            if (!this.gpuMeshCache[modelKey] && !this.rawModelCache[modelKey]) {
                await this.fetchModelAsync(modelKey);
            }

            setTimeout(processNext, 70);
        };

        // Start progressive streaming after 1.5 seconds of 2D playback
        setTimeout(processNext, 1500);
    }

    getSoldierMeshKey(player, stance = "stand") {
        if (!player) return `soldier_${stance}`;
        
        // Team 1 is OpFor (Red), Team 2 is BluFor (Blue)
        let rawFaction = (player.team == 1 ? (window.OpForTeam || 'ru') : (window.BluForTeam || 'us'));
        let cleanFaction = this.normalizeFaction(rawFaction);

        let kitSlot = 2; // Default to standard Rifleman (Fusilero)
        const kit = (player.kit || '').toLowerCase();
        if (player.isSquadLeader || kit.includes('officer') || kit.includes('sl') || kit.includes('lead')) {
            kitSlot = 1; // Officer / Squad Leader
        } else if (kit.includes('medic')) {
            kitSlot = 3; // Medic
        } else if (kit.includes('support') || kit.includes('ar') || kit.includes('mg') || kit.includes('autorifleman')) {
            kitSlot = 4; // Support / Automatic Rifleman
        } else if (kit.includes('lat') || kit.includes('hat') || kit.includes('at') || kit.includes('rpg') || kit.includes('smaw')) {
            kitSlot = 5; // Anti-Tank
        } else if (kit.includes('marksman') || kit.includes('sniper')) {
            kitSlot = 6; // Marksman / Sniper
        } else {
            kitSlot = 2; // Standard Rifleman
        }

        return `soldier_pr_${cleanFaction}_soldier${kitSlot}_${stance}`;
    }

    getVehicleMeshKey(vehicle) {
        if (!vehicle) return null;
        let rawName = (vehicle.name || vehicle.templateName || '').toLowerCase().trim();
        if (!rawName) return null;

        if (typeof isClimbingVehicle === "function" && isClimbingVehicle(rawName)) return null;

        // 1. Direct Lookup via 1:1 Vehicle Dictionary Table
        if (typeof VEHICLE_DICTIONARY !== "undefined" && VEHICLE_DICTIONARY[rawName]) {
            return VEHICLE_DICTIONARY[rawName];
        }

        // 2. Direct model key match
        let directKey = 'vehicle_' + rawName;
        if (this.gpuMeshCache[directKey]) return directKey;

        // 3. Fallback: Normalized variant match
        let cleanName = rawName.replace(/_alt\d*|_sp|_bf2|_woodland|_desert|_camo|_cage|_desert_cage|_dfr|_rws|_pkp|_dshk|_m240[bd]|_atc/g, '');
        if (typeof VEHICLE_DICTIONARY !== "undefined" && VEHICLE_DICTIONARY[cleanName]) {
            return VEHICLE_DICTIONARY[cleanName];
        }

        let cleanKey = 'vehicle_' + cleanName;
        if (this.gpuMeshCache[cleanKey]) return cleanKey;

        return directKey;
    }

    categorizeVehicle(vName) {
        const name = (vName || '').toLowerCase();
        if (name.includes('crate') || name.includes('rallypoint') || name.includes('depot') || name.includes('post') || name.includes('artillery')) {
            return null; // Ignore deployables/crates
        }
        if (name.includes('ahe_') || name.includes('the_') || name.includes('air_') || name.includes('jet_') || name.includes('heli_') || name.includes('apache') || name.includes('blackhawk') || name.includes('chinook') || name.includes('mi24') || name.includes('mi17') || name.includes('ah1') || name.includes('ah64') || name.includes('uh1') || name.includes('uh60') || name.includes('a10') || name.includes('su25') || name.includes('mig29') || name.includes('tornado') || name.includes('harrier') || name.includes('mv22')) {
            return { cat: 'air', row: 4, spacing: 22 };
        }
        if (name.includes('tnk') || name.includes('t72') || name.includes('t55') || name.includes('t62') || name.includes('t90') || name.includes('m1a') || name.includes('leo') || name.includes('challenger') || name.includes('ztz') || name.includes('merkava') || name.includes('pt91') || name.includes('abrams') || name.includes('leopard')) {
            return { cat: 'tank', row: 3, spacing: 15 };
        }
        if (name.includes('apc') || name.includes('ifv') || name.includes('btr') || name.includes('bmp') || name.includes('marder') || name.includes('warrior') || name.includes('bradley') || name.includes('stryker') || name.includes('boxer') || name.includes('scimitar') || name.includes('lav') || name.includes('aav') || name.includes('mtlb') || name.includes('wz551') || name.includes('zbl08')) {
            return { cat: 'armor', row: 2, spacing: 13 };
        }
        return { cat: 'jeep', row: 1, spacing: 9 };
    }

    buildMapSpawns(mapName) {
        this.currentMap = mapName;
        this.buildActiveMapSpawnEntities(mapName);
    }

    buildActiveMapSpawnEntities(mapName) {
        if (!mapName || typeof PR_MAPS_DATABASE === "undefined") return;
        
        const mapData = PR_MAPS_DATABASE[mapName] || PR_MAPS_DATABASE[mapName.toLowerCase()];
        if (!mapData || !mapData.modes) return;

        this.mapSpawnEntities = [];

        const factionsMap = new Map();
        for (const modeKey in mapData.modes) {
            const modeObj = mapData.modes[modeKey];
            if (!modeObj.layers) continue;

            for (const layerKey in modeObj.layers) {
                const layerObj = modeObj.layers[layerKey];

                // Team 1 (OpFor / Red)
                const t1 = layerObj.team1 || {};
                const f1Id = (t1.faction_id || 'team1').toLowerCase();
                if (!factionsMap.has(f1Id)) {
                    factionsMap.set(f1Id, { id: f1Id, team: 1, name: t1.faction_name, vehicles: new Set() });
                }
                for (const v in (t1.vehicles || {})) factionsMap.get(f1Id).vehicles.add(v);

                // Team 2 (BluFor / Blue)
                const t2 = layerObj.team2 || {};
                const f2Id = (t2.faction_id || 'team2').toLowerCase();
                if (!factionsMap.has(f2Id)) {
                    factionsMap.set(f2Id, { id: f2Id, team: 2, name: t2.faction_name, vehicles: new Set() });
                }
                for (const v in (t2.vehicles || {})) factionsMap.get(f2Id).vehicles.add(v);
            }
        }

        const originX = 0;
        const originZ = 0;

        let teamBaseZ = -80;
        for (const fData of factionsMap.values()) {
            const team = fData.team;
            const cleanFId = this.normalizeFaction(fData.id);

            // A. Place an Infantry Squad of 7 soldiers in the front row
            const squadSize = 7;
            const soldierSpacing = 3.5;
            for (let sIdx = 0; sIdx < squadSize; sIdx++) {
                const soldierKey = `soldier_pr_${cleanFId}_soldier${(sIdx % 6) + 1}_stand`;
                const sX = originX + (sIdx - (squadSize - 1) * 0.5) * soldierSpacing;
                const sZ = originZ + teamBaseZ;
                const sY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(sX, sZ) + 0.1 : 5.0;

                this.mapSpawnEntities.push({
                    meshKey: soldierKey,
                    fallbackKey: (team === 2) ? 'soldier_pr_us_soldier1_stand' : 'soldier_pr_ru_soldier1_stand',
                    x: sX,
                    y: sY,
                    z: sZ,
                    yaw: (team === 2) ? 0 : 180,
                    team: team,
                    id: `spawn_soldier_${team}_${sIdx}`
                });
            }

            // B. Group combat vehicles by row/class
            const rowMap = new Map();
            for (const vName of fData.vehicles) {
                const catInfo = this.categorizeVehicle(vName);
                if (!catInfo) continue;
                
                const rNum = catInfo.row;
                if (!rowMap.has(rNum)) rowMap.set(rNum, []);
                const list = rowMap.get(rNum);
                if (list.length < 8) {
                    list.push({ name: vName, spacing: catInfo.spacing });
                }
            }

            // C. Place vehicles in organized rows behind infantry
            const rowOffsets = { 1: 20, 2: 44, 3: 68, 4: 94 };
            for (const [rNum, vList] of rowMap.entries()) {
                const rOffset = rowOffsets[rNum] || (rNum * 24);
                const rZ = originZ + teamBaseZ + (team === 2 ? -rOffset : rOffset);
                const avgSpacing = vList[0] ? vList[0].spacing : 14;
                const numInRow = vList.length;

                for (let vIdx = 0; vIdx < numInRow; vIdx++) {
                    const vItem = vList[vIdx];
                    const vKey = this.getVehicleMeshKey({ name: vItem.name, team: team });
                    const vX = originX + (vIdx - (numInRow - 1) * 0.5) * avgSpacing;
                    const vY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(vX, rZ) + 0.1 : 5.0;

                    this.mapSpawnEntities.push({
                        meshKey: vKey,
                        fallbackKey: null,
                        x: vX,
                        y: vY,
                        z: rZ,
                        yaw: (team === 2) ? 0 : 180,
                        team: team,
                        id: `spawn_veh_${team}_${rNum}_${vIdx}`
                    });
                }
            }

            teamBaseZ += 180;
        }

        // Trigger background pre-fetch for map spawns
        for (const ent of this.mapSpawnEntities) {
            this.fetchModelAsync(ent.meshKey);
            if (ent.fallbackKey) this.fetchModelAsync(ent.fallbackKey);
        }
    }

    draw() {
        if (!this.initialized || !this.program) return;

        const gl = renderer3d.gl;
        if (!gl) return;

        const viewMatrix = renderer3d.getCurrentViewMatrix();
        const projectionMatrix = renderer3d.getCurrentProjectionMatrix();

        const isWallhack = (typeof options_Wallhack !== "undefined" && options_Wallhack);
        if (isWallhack) {
            gl.disable(gl.DEPTH_TEST);
        } else {
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
        }

        // Check if map changed to rebuild spawns
        const activeMapKey = (typeof buildingHeightmap !== "undefined" && buildingHeightmap._mapKey) ? buildingHeightmap._mapKey : (window.CurrentMapName || null);
        if (activeMapKey && activeMapKey !== this.currentMap) {
            this.buildMapSpawns(activeMapKey);
        }

        const hasLiveDemoEntities = (typeof AllVehicles !== "undefined" && Object.keys(AllVehicles).length > 0) ||
                                   (typeof AllPlayers !== "undefined" && Object.keys(AllPlayers).length > 0);

        // ---------------------------------------------------------------------
        // 1. Render Map Spawn Positions (When browsing map without demo)
        // ---------------------------------------------------------------------
        if (!hasLiveDemoEntities && this.mapSpawnEntities.length > 0) {
            for (const ent of this.mapSpawnEntities) {
                let activeMesh = this.gpuMeshCache[ent.meshKey];
                if (!activeMesh && ent.fallbackKey) activeMesh = this.gpuMeshCache[ent.fallbackKey];

                if (!activeMesh) {
                    this.fetchModelAsync(ent.meshKey);
                    if (ent.fallbackKey) this.fetchModelAsync(ent.fallbackKey);
                    continue;
                }

                const groundOffset = activeMesh.groundOffset || 0.0;
                let finalY = ent.y + groundOffset;

                // Team 1 is Red, Team 2 is Blue
                let teamCol = (ent.team === 1) ? this.colorTeam1 : this.colorTeam2;
                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [ent.x, finalY, -ent.z]);
                mat4.rotateY(modelMatrix, modelMatrix, -(ent.yaw * Math.PI / 180));

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, false);
            }
        }

        // ---------------------------------------------------------------------
        // 2. Render Live Demo Vehicles (Dynamic Terrain Following: Pitch, Roll & Altitude)
        // ---------------------------------------------------------------------
        if (typeof AllVehicles !== "undefined") {
            for (const vId in AllVehicles) {
                const v = AllVehicles[vId];
                if (!v) continue;

                let posX = (typeof v.getX === "function") ? v.getX() : v.X;
                let posY = (typeof v.getY === "function") ? v.getY() : (v.Y || 0);
                let posZ = (typeof v.getZ === "function") ? v.getZ() : v.Z;

                // Fallback to raw coordinates
                if (posX == null || isNaN(posX)) posX = v.X;
                if (posZ == null || isNaN(posZ)) posZ = v.Z;
                if (posY == null || isNaN(posY)) posY = v.Y || 0;

                if (posX == null || isNaN(posX) || posZ == null || isNaN(posZ)) continue;
                if (v.isClimbingVehicle) continue;

                const meshKey = this.getVehicleMeshKey(v);
                if (!meshKey) continue;

                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }

                const groundOffset = activeMesh.groundOffset || 0.5;
                const halfLen = Math.max(1.5, Math.min(4.5, (activeMesh.length || 6.0) * 0.40));
                const halfWidth = Math.max(0.8, Math.min(2.2, (activeMesh.width || 2.8) * 0.40));

                const rotDeg = (typeof v.getRotation === "function") ? v.getRotation() : (v.rotation || 0);
                const yawRad = -(rotDeg * Math.PI / 180);
                const gameRad = (rotDeg * Math.PI / 180);

                // 2D Game Forward and Right vectors (0 deg = North +Z, 90 deg = East +X)
                const fGameX = Math.sin(gameRad);
                const fGameZ = Math.cos(gameRad);
                const rGameX = fGameZ;
                const rGameZ = -fGameX;

                let targetY = posY;
                let targetPitch = 0.0;
                let targetRoll = 0.0;

                const isDeployable = meshKey.includes('deployable') || meshKey.includes('ats_') || meshKey.includes('aaa_') || 
                                     meshKey.includes('tripod') || meshKey.includes('mortar') || meshKey.includes('zu23') || 
                                     meshKey.includes('spg') || meshKey.includes('tow') || meshKey.includes('kornet') || 
                                     meshKey.includes('m220') || meshKey.includes('m1910') || meshKey.includes('m1919') || 
                                     meshKey.includes('mg42') || meshKey.includes('dshk') || meshKey.includes('djigit') || 
                                     meshKey.includes('milan') || meshKey.includes('mistral') || meshKey.includes('stinger') || 
                                     meshKey.includes('spike');

                if (isDeployable) {
                    // Deployable Stationary Weapons sit firmly at ground/structure height without 4-corner vehicle chassis tilt
                    let baseH = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(posX, posZ) : 0;
                    targetY = Math.max(baseH, posY);
                    targetPitch = 0.0;
                    targetRoll = 0.0;
                } else if (typeof heightmap !== "undefined") {
                    const groundCenter = heightmap.getHeightFromCoords(posX, posZ);

                    if (!v.isFlyingVehicle) {
                        // 4-Corner Wheel Contact Model for Realistic Grounding
                        const frontLeftY = heightmap.getHeightFromCoords(posX + fGameX * halfLen - rGameX * halfWidth, posZ + fGameZ * halfLen - rGameZ * halfWidth);
                        const frontRightY = heightmap.getHeightFromCoords(posX + fGameX * halfLen + rGameX * halfWidth, posZ + fGameZ * halfLen + rGameZ * halfWidth);
                        const rearLeftY = heightmap.getHeightFromCoords(posX - fGameX * halfLen - rGameX * halfWidth, posZ - fGameZ * halfLen - rGameZ * halfWidth);
                        const rearRightY = heightmap.getHeightFromCoords(posX - fGameX * halfLen + rGameX * halfWidth, posZ - fGameZ * halfLen + rGameZ * halfWidth);

                        const avgFront = (frontLeftY + frontRightY) * 0.5;
                        const avgRear = (rearLeftY + rearRightY) * 0.5;
                        const avgRight = (frontRightY + rearRightY) * 0.5;
                        const avgLeft = (frontLeftY + rearLeftY) * 0.5;

                        targetY = Math.max(posY, (avgFront + avgRear) * 0.5) + groundOffset;

                        // Target Pitch and Roll from 4-corner slope
                        targetPitch = Math.atan2(avgFront - avgRear, halfLen * 2.0);
                        targetRoll = Math.atan2(avgRight - avgLeft, halfWidth * 2.0);
                    } else {
                        // Flying vehicle (Helicopter, Jet, Drone)
                        const minAirY = groundCenter + groundOffset;
                        if (targetY <= minAirY + 1.2) {
                            // Landed on runway or terrain
                            targetY = minAirY;
                            const frontY = heightmap.getHeightFromCoords(posX + fGameX * halfLen, posZ + fGameZ * halfLen);
                            const rearY = heightmap.getHeightFromCoords(posX - fGameX * halfLen, posZ - fGameZ * halfLen);
                            targetPitch = Math.atan2(frontY - rearY, halfLen * 2.0);
                        }
                    }
                } else {
                    targetY += groundOffset;
                }

                // Clamp angles to realistic maximum limits (max 35 deg pitch, 25 deg roll)
                targetPitch = Math.max(-0.61, Math.min(0.61, targetPitch));
                targetRoll = Math.max(-0.44, Math.min(0.44, targetRoll));

                // Smooth Suspension Damping Filter (alpha = 0.12 for natural, heavy chassis inertia)
                const smoothAlpha = 0.12;
                if (v._smoothPitch == null || isNaN(v._smoothPitch)) v._smoothPitch = targetPitch;
                else v._smoothPitch = v._smoothPitch * (1.0 - smoothAlpha) + targetPitch * smoothAlpha;

                if (v._smoothRoll == null || isNaN(v._smoothRoll)) v._smoothRoll = targetRoll;
                else v._smoothRoll = v._smoothRoll * (1.0 - smoothAlpha) + targetRoll * smoothAlpha;

                if (v._smoothY == null || isNaN(v._smoothY)) v._smoothY = targetY;
                else v._smoothY = v._smoothY * (1.0 - smoothAlpha) + targetY * smoothAlpha;

                const isSelected = (typeof SelectedVehicle !== "undefined" && SelectedVehicle == v.id);
                // Team 1 is OpFor/Red, Team 2 is BluFor/Blue
                let teamCol = (v.team == 1) ? this.colorTeam1 : this.colorTeam2;

                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, v._smoothY, -posZ]);
                mat4.rotateY(modelMatrix, modelMatrix, yawRad);
                if (Math.abs(v._smoothPitch) > 0.001) mat4.rotateX(modelMatrix, modelMatrix, v._smoothPitch);
                if (Math.abs(v._smoothRoll) > 0.001) mat4.rotateZ(modelMatrix, modelMatrix, v._smoothRoll);

                // Render Vehicle Model
                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, isSelected);
            }
        }

        // ---------------------------------------------------------------------
        // 3. Render Live Demo Soldiers (Alive with Stances & Dead in T-Pose)
        // ---------------------------------------------------------------------
        if (typeof AllPlayers !== "undefined") {
            for (const pId in AllPlayers) {
                const p = AllPlayers[pId];
                if (!p || p.isJoining || (p.vehicleid && p.vehicleid >= 0)) continue;

                let posX = (typeof p.getX === "function") ? p.getX() : p.X;
                let posY = (typeof p.getY === "function") ? p.getY() : (p.Y || 0);
                let posZ = (typeof p.getZ === "function") ? p.getZ() : p.Z;

                if (posX == null || isNaN(posX)) posX = p.X;
                if (posZ == null || isNaN(posZ)) posZ = p.Z;
                if (posY == null || isNaN(posY)) posY = p.Y || 0;

                if (posX == null || isNaN(posX) || posZ == null || isNaN(posZ)) continue;

                let terrainH = 0;
                if (typeof heightmap !== "undefined") {
                    terrainH = heightmap.getHeightFromCoords(posX, posZ);
                }

                // In BF2 demo packets, posY is pelvis height (~0.85m above ground/floor for standing).
                // The soldier 3D meshes start at the feet (y=0) up to helmet (y=1.58m).
                // Thus, the floor elevation where the boots stand is:
                const floorY = Math.max(terrainH, posY - 0.85);
                const relTerrainY = posY - terrainH;

                const isSelected = (typeof SelectedPlayer !== "undefined" && SelectedPlayer == p.id);
                const isSquad = (typeof SelectedSquadTeam !== "undefined" && typeof SelectedSquadNumber !== "undefined" &&
                                 p.team == SelectedSquadTeam && p.squad == SelectedSquadNumber);
                const rotDeg = (typeof p.getRotation === "function") ? p.getRotation() : (p.rotation || 0);

                if (!p.isAlive) {
                    // -------------------------------------------------------------
                    // A. Dead Soldier: Lying Flat on Surface/Terrain, Tinted Gray
                    // -------------------------------------------------------------
                    const deadMeshKey = 'soldier_stand';
                    let activeMesh = this.gpuMeshCache[deadMeshKey];
                    if (!activeMesh) {
                        this.fetchModelAsync(deadMeshKey);
                        continue;
                    }

                    const deadTeamCol = (p.team === 1) ? this.colorDeadTeam1 : this.colorDeadTeam2;
                    const modelMatrix = mat4.create();
                    mat4.translate(modelMatrix, modelMatrix, [posX, floorY + 0.10, -posZ]);
                    mat4.rotateY(modelMatrix, modelMatrix, -(rotDeg * Math.PI / 180));
                    mat4.rotateX(modelMatrix, modelMatrix, Math.PI / 2); // Rotate 90 deg flat onto terrain/deck/roof

                    this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, deadTeamCol, isSelected);
                } else {
                    // -------------------------------------------------------------
                    // B. Alive Soldier: Authentic Baked Meshes with Kits & Weapons
                    // 1. soldier_stand  (De pie con fusil, casco y chaleco)
                    // 2. soldier_crouch (Agachado táctico con fusil, casco y chaleco)
                    // 3. soldier_prone  (Tirado cuerpo a tierra con fusil y chaleco)
                    // -------------------------------------------------------------
                    let teamCol = isSquad ? this.colorSquad : ((p.team == 1) ? this.colorTeam1 : this.colorTeam2);

                    const spdKmh = (typeof getEntitySpeedKmh === "function") ? getEntitySpeedKmh(p) : 0;

                    let stance = "stand";
                    if (spdKmh >= 6.0) {
                        // Corriendo o caminando rápido: Siempre de pie erguido
                        stance = "stand";
                    } else if (spdKmh >= 1.8) {
                        // Movimiento táctico
                        stance = (relTerrainY <= 0.65) ? "crouch" : "stand";
                    } else {
                        // Estacionario o reptando muy lento (< 1.8 km/h):
                        if (relTerrainY <= 0.25) {
                            stance = "prone";   // Tirado / Acostado en el suelo
                        } else if (relTerrainY <= 0.65) {
                            stance = "crouch";  // Agachado táctico
                        } else {
                            stance = "stand";   // De pie
                        }
                    }

                    const meshKey = this.getSoldierMeshKey(p, stance);
                    let activeMesh = this.gpuMeshCache[meshKey];
                    if (!activeMesh) {
                        this.fetchModelAsync(meshKey);
                        // Fallback to universal stance mesh or base stand mesh while loading
                        activeMesh = this.gpuMeshCache[`soldier_${stance}`] || this.gpuMeshCache['soldier_stand'];
                        if (!activeMesh) {
                            this.fetchModelAsync(`soldier_${stance}`);
                            this.fetchModelAsync('soldier_stand');
                            continue;
                        }
                    }

                    const modelMatrix = mat4.create();
                    mat4.translate(modelMatrix, modelMatrix, [posX, floorY, -posZ]);
                    mat4.rotateY(modelMatrix, modelMatrix, -(rotDeg * Math.PI / 180));

                    this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, isSelected);
                }
            }
        }

        // ---------------------------------------------------------------------
        // 4. Render FOBs / Hideouts / Command Posts (AllFobs)
        // ---------------------------------------------------------------------
        if (typeof AllFobs !== "undefined") {
            for (const fobId in AllFobs) {
                const fob = AllFobs[fobId];
                if (!fob || fob.X == null || isNaN(fob.X)) continue;

                let posX = fob.X;
                let posZ = fob.Z;
                let groundY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(posX, posZ) : 0;

                let isInsurgentFaction = (typeof window.OpForTeam !== "undefined") && 
                    ['hamas', 'taliban', 'meinsurgent', 'fsa', 'arf'].includes(window.OpForTeam.toLowerCase());
                let meshKey = (fob.team === 1 && isInsurgentFaction) ? "fob_insurgent_hideout" : "fob_deployable_firebase";

                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }

                const groundOffset = activeMesh.groundOffset || 0.0;
                let teamCol = (fob.team === 1) ? this.colorTeam1 : this.colorTeam2;

                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, groundY + groundOffset, -posZ]);

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, false);
            }
        }

        // ---------------------------------------------------------------------
        // 5. Render Rally Points (AllRallies)
        // ---------------------------------------------------------------------
        if (typeof AllRallies !== "undefined") {
            for (const rId in AllRallies) {
                const rally = AllRallies[rId];
                if (!rally || rally.X == null || isNaN(rally.X)) continue;

                let posX = rally.X;
                let posZ = rally.Z;
                let groundY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(posX, posZ) : 0;

                let meshKey = (rally.team === 1) ? "vehicle_rallypoint_ru_placeable" : "vehicle_rallypoint_us_placeable";
                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }

                let isSquad = (typeof SelectedSquadTeam !== "undefined" && typeof SelectedSquadNumber !== "undefined" &&
                               rally.team == SelectedSquadTeam && rally.squad == SelectedSquadNumber);
                let teamCol = isSquad ? this.colorSquad : ((rally.team === 1) ? this.colorTeam1 : this.colorTeam2);
                const groundOffset = activeMesh.groundOffset || 0.0;

                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, groundY + groundOffset, -posZ]);

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, false);
            }
        }

        // ---------------------------------------------------------------------
        // 6. Render Insurgency Weapon Caches (AllCaches)
        // ---------------------------------------------------------------------
        if (typeof AllCaches !== "undefined") {
            for (const cId in AllCaches) {
                const cache = AllCaches[cId];
                if (!cache || cache.X == null || isNaN(cache.X)) continue;

                let posX = cache.X;
                let posZ = cache.Z;
                let groundY = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(posX, posZ) : 0;

                let meshKey = "vehicle_ammocache";
                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }

                const groundOffset = activeMesh.groundOffset || 0.0;
                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, groundY + groundOffset, -posZ]);

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, this.colorCache, false);
            }
        }

        // ---------------------------------------------------------------------
        // 7. Render Active Projectiles in 3D (AllProj: RPGs, Missiles, Shells, Grenades, Mines)
        // ---------------------------------------------------------------------
        if (typeof AllProj !== "undefined") {
            for (const projId in AllProj) {
                const proj = AllProj[projId];
                if (!proj) continue;

                let posX = (typeof proj.getX === "function") ? proj.getX() : proj.X;
                let posY = (typeof proj.getY === "function") ? proj.getY() : (proj.Y || 0);
                let posZ = (typeof proj.getZ === "function") ? proj.getZ() : proj.Z;

                if (posX == null || isNaN(posX)) posX = proj.X;
                if (posZ == null || isNaN(posZ)) posZ = proj.Z;
                if (posY == null || isNaN(posY)) posY = proj.Y || 0;

                if (posX == null || isNaN(posX) || posZ == null || isNaN(posZ)) continue;

                if (typeof heightmap !== "undefined") {
                    const gh = heightmap.getHeightFromCoords(posX, posZ);
                    posY = Math.max(posY, gh + 0.15);
                }

                let meshKey = (typeof ProjectileTypeToImageName !== "undefined" && ProjectileTypeToImageName[proj.type]) || "proj_lat";
                let activeMesh = this.gpuMeshCache[meshKey];
                if (!activeMesh) {
                    this.fetchModelAsync(meshKey);
                    continue;
                }

                let teamCol = (proj.team === 2) ? this.colorTeam2 : this.colorTeam1;
                const rotDeg = (typeof proj.getYaw === "function") ? proj.getYaw() : (proj.yaw || proj.rotation || 0);

                const modelMatrix = mat4.create();
                mat4.translate(modelMatrix, modelMatrix, [posX, posY, -posZ]);
                mat4.rotateY(modelMatrix, modelMatrix, -(rotDeg * Math.PI / 180));

                this.renderSingleMesh(activeMesh, modelMatrix, viewMatrix, projectionMatrix, teamCol, false);
            }
        }

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
    }

    renderSingleMesh(gpuMesh, modelMatrix, viewMatrix, projectionMatrix, teamColor, isSelected) {
        const gl = renderer3d.gl;
        if (!gl || !gpuMesh) return;

        if (gpuMesh.isMultiPart) {
            if (gpuMesh.hull) this.renderSingleMesh(gpuMesh.hull, modelMatrix, viewMatrix, projectionMatrix, teamColor, isSelected);
            if (gpuMesh.turret) this.renderSingleMesh(gpuMesh.turret, modelMatrix, viewMatrix, projectionMatrix, teamColor, isSelected);
            return;
        }

        if (!gpuMesh.vertexBuffer || !gpuMesh.indexBuffer) return;

        // 1. Main Model Pass (Render solid team color)
        gl.useProgram(this.program);

        gl.bindBuffer(gl.ARRAY_BUFFER, gpuMesh.vertexBuffer);
        gl.vertexAttribPointer(this.aVertexPosition, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(this.aVertexPosition);

        gl.vertexAttribPointer(this.aVertexNormal, 3, gl.FLOAT, false, 24, 12);
        gl.enableVertexAttribArray(this.aVertexNormal);

        gl.uniformMatrix4fv(this.uModelMatrix, false, modelMatrix);
        gl.uniformMatrix4fv(this.uViewMatrix, false, viewMatrix);
        gl.uniformMatrix4fv(this.uProjectionMatrix, false, projectionMatrix);
        gl.uniform3fv(this.uTeamColor, teamColor);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpuMesh.indexBuffer);
        gl.drawElements(gl.TRIANGLES, gpuMesh.indexCount, gl.UNSIGNED_INT, 0);

        // 2. Selection Outline Pass (Inverted Hull / Front-face Culling)
        // Culling FRONT faces means only the expanded outer edge of the hull behind the model is drawn!
        if (isSelected && this.outlineProgram) {
            gl.useProgram(this.outlineProgram);

            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.FRONT);

            gl.bindBuffer(gl.ARRAY_BUFFER, gpuMesh.vertexBuffer);
            gl.vertexAttribPointer(this.aOutlineVertexPosition, 3, gl.FLOAT, false, 24, 0);
            gl.enableVertexAttribArray(this.aOutlineVertexPosition);

            gl.vertexAttribPointer(this.aOutlineVertexNormal, 3, gl.FLOAT, false, 24, 12);
            gl.enableVertexAttribArray(this.aOutlineVertexNormal);

            gl.uniformMatrix4fv(this.uOutlineModelMatrix, false, modelMatrix);
            gl.uniformMatrix4fv(this.uOutlineViewMatrix, false, viewMatrix);
            gl.uniformMatrix4fv(this.uOutlineProjectionMatrix, false, projectionMatrix);
            gl.uniform3fv(this.uOutlineColor, this.colorOutline);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpuMesh.indexBuffer);
            gl.drawElements(gl.TRIANGLES, gpuMesh.indexCount, gl.UNSIGNED_INT, 0);

            gl.disable(gl.CULL_FACE);
        }
    }
}

$(() => { entities3dRenderer = new Entities3dRenderer(); });
