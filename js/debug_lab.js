// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE
// Developer Debug & Proving Ground Suite (Ctrl + Alt + D)
// - Lab 1: Continuous Mechanics Proving Ground (Real Binary .PRdemo Generator on test_airfield)
// - Lab 2: 3D Asset Museum (Vehicles, Aircraft, Deployables/Projectiles, Modular Soldiers & 361 Weapons on test_airfield)
// - Lab 3: 3D Structures Museum (Isolated Static Map Buildings, Fortifications, Props & Foliage on deagle5)

"use strict";

(function () {
    // =========================================================================
    // 1. Exact Protocol v3 Binary .PRdemo Encoder
    // =========================================================================
    class PRDemoBinaryWriter {
        constructor(initialCap = 2 * 1024 * 1024) {
            this.buf = new ArrayBuffer(initialCap);
            this.u8 = new Uint8Array(this.buf);
            this.dv = new DataView(this.buf);
            this.pos = 0;
        }

        _ensure(extra) {
            if (this.pos + extra <= this.buf.byteLength) return;
            let nextCap = this.buf.byteLength * 2;
            while (nextCap < this.pos + extra) nextCap *= 2;
            const nb = new ArrayBuffer(nextCap);
            new Uint8Array(nb).set(this.u8.subarray(0, this.pos));
            this.buf = nb;
            this.u8 = new Uint8Array(nb);
            this.dv = new DataView(nb);
        }

        beginMsg(msgType) {
            this._ensure(8);
            const lenOffset = this.pos;
            this.pos += 2; // Reserve uint16LE frame length
            this.u8[this.pos++] = msgType & 0xff;
            return lenOffset;
        }

        endMsg(lenOffset) {
            const msgLen = this.pos - (lenOffset + 2);
            this.dv.setUint16(lenOffset, msgLen, true);
        }

        u8v(v) { this._ensure(1); this.u8[this.pos++] = v & 0xff; }
        i8v(v) { this._ensure(1); this.dv.setInt8(this.pos++, Math.max(-128, Math.min(127, Math.round(v)))); }
        u16(v) { this._ensure(2); this.dv.setUint16(this.pos, v & 0xffff, true); this.pos += 2; }
        i16(v) {
            this._ensure(2);
            const c = Math.max(-32768, Math.min(32767, Math.round(v)));
            this.dv.setInt16(this.pos, c, true);
            this.pos += 2;
        }
        i32(v) { this._ensure(4); this.dv.setInt32(this.pos, v | 0, true); this.pos += 4; }
        f32(v) { this._ensure(4); this.dv.setFloat32(this.pos, v, true); this.pos += 4; }
        cstr(str) {
            const s = String(str || "");
            this._ensure(s.length + 1);
            for (let i = 0; i < s.length; i++) {
                this.u8[this.pos++] = s.charCodeAt(i) & 0x7f;
            }
            this.u8[this.pos++] = 0;
        }

        writeServerDetails(opts) {
            const o = this.beginMsg(0x00);
            this.i32(3); // Version 3
            this.f32(opts.timePerTick || 0.20);
            this.cstr(opts.ipPort || "127.0.0.1:16567");
            this.cstr(opts.serverName || "[PR 1.8.0.0] Debug Lab Proving Ground");
            this.i8v(opts.maxPlayers || 100);
            this.i16(opts.roundLength || 3600);
            this.i16(opts.briefingTime || 0);
            this.cstr(opts.mapName || "test_airfield");
            this.cstr(opts.gameMode || "gpm_cq");
            this.u8v(opts.layer || 64);
            this.cstr(opts.opfor || "ru");
            this.cstr(opts.blufor || "us");
            this.i32(opts.startTime || 1735689600);
            this.i16(opts.tickets1 != null ? opts.tickets1 : 800);
            this.i16(opts.tickets2 != null ? opts.tickets2 : 800);
            this.f32(opts.mapSize != null ? opts.mapSize : 4.0);
            this.endMsg(o);
        }

        writeDodEmpty() {
            const o = this.beginMsg(0x01);
            this.endMsg(o);
        }

        writeFlagList(flags) {
            const o = this.beginMsg(0x41);
            for (const f of flags) {
                this.u16(f.id);
                this.u8v(f.team);
                this.i16(f.x);
                this.i16(f.y);
                this.i16(f.z);
                this.u16(f.radius || 30);
            }
            this.endMsg(o);
        }

        writeFlagUpdate(id, team) {
            const o = this.beginMsg(0x40);
            this.u16(id);
            this.u8v(team);
            this.endMsg(o);
        }

        writePlayerAdd(players) {
            const o = this.beginMsg(0x11);
            for (const p of players) {
                this.u8v(p.id);
                this.cstr(p.name);
                this.cstr(p.hash || ("dbghash_" + String(p.id).padStart(4, "0") + "abcdef0123456789"));
                this.cstr(p.ip || "127.0.0.1");
            }
            this.endMsg(o);
        }

        writeSquadName(team, squad, name) {
            const o = this.beginMsg(0xA2);
            const ts = ((team === 2 ? 128 : 0) | (squad & 0x0f)) & 0xff;
            this.u8v(ts);
            this.cstr(name);
            this.endMsg(o);
        }

        writePlayerUpdates(updates) {
            if (!updates || updates.length === 0) return;
            const o = this.beginMsg(0x10);
            for (const u of updates) {
                let flags = 0;
                if (u.team !== undefined) flags |= 1;
                if (u.squad !== undefined) flags |= 2;
                if (u.vehicleid !== undefined) flags |= 4;
                if (u.health !== undefined) flags |= 8;
                if (u.score !== undefined) flags |= 16;
                if (u.scoreTW !== undefined) flags |= 32;
                if (u.kills !== undefined) flags |= 64;
                if (u.deaths !== undefined) flags |= 256;
                if (u.ping !== undefined) flags |= 512;
                if (u.isAlive !== undefined) flags |= 2048;
                if (u.x !== undefined) flags |= 8192;
                if (u.rotation !== undefined) flags |= 16384;
                if (u.kit !== undefined) flags |= 32768;

                this.u16(flags);
                this.u8v(u.id);
                if (flags & 1) this.i8v(u.team);
                if (flags & 2) {
                    const sq = ((u.isSL ? 128 : 0) + (u.squad & 0x7f)) & 0xff;
                    this.u8v(sq);
                }
                if (flags & 4) {
                    this.i16(u.vehicleid);
                    if (u.vehicleid >= 0) {
                        this.cstr(u.seatName || "");
                        this.i8v(u.slot != null ? u.slot : 0);
                    }
                }
                if (flags & 8) this.i8v(u.health);
                if (flags & 16) this.i16(u.score);
                if (flags & 32) this.i16(u.scoreTW);
                if (flags & 64) this.i16(u.kills);
                if (flags & 256) this.i16(u.deaths);
                if (flags & 512) this.i16(u.ping);
                if (flags & 2048) this.i8v(u.isAlive ? 1 : 0);
                if (flags & 8192) {
                    this.i16(u.x);
                    this.i16(u.y);
                    this.i16(u.z);
                }
                if (flags & 16384) this.i16(u.rotation);
                if (flags & 32768) this.cstr(u.kit);
            }
            this.endMsg(o);
        }

        writeVehicleAdd(id, name, maxHealth) {
            const o = this.beginMsg(0x21);
            this.i16(id);
            this.cstr(name);
            this.u16(maxHealth || 1000);
            this.endMsg(o);
        }

        writeVehicleUpdates(updates) {
            if (!updates || updates.length === 0) return;
            const o = this.beginMsg(0x20);
            for (const u of updates) {
                let flags = 0;
                if (u.team !== undefined) flags |= 0x01;
                if (u.x !== undefined) flags |= 0x02;
                if (u.rotation !== undefined) flags |= 0x04;
                if (u.health !== undefined) flags |= 0x08;
                this.u8v(flags);
                this.i16(u.id);
                if (flags & 0x01) this.i8v(u.team);
                if (flags & 0x02) {
                    this.i16(u.x);
                    this.i16(u.y);
                    this.i16(u.z);
                }
                if (flags & 0x04) this.i16(u.rotation);
                if (flags & 0x08) this.i16(u.health);
            }
            this.endMsg(o);
        }

        writeVehicleDestroyed(vehId, killerKnown = false, killerId = 0) {
            const o = this.beginMsg(0x22);
            this.i16(vehId);
            this.u8v(killerKnown ? 1 : 0);
            this.u8v(killerId || 0);
            this.endMsg(o);
        }

        writeFobAdd(id, team, x, y, z) {
            const o = this.beginMsg(0x30);
            this.i32(id);
            this.u8v(team);
            this.i16(x);
            this.i16(y);
            this.i16(z);
            this.endMsg(o);
        }

        writeFobRemove(id) {
            const o = this.beginMsg(0x31);
            this.i32(id);
            this.endMsg(o);
        }

        writeRallyAdd(team, squad, x, y, z) {
            const o = this.beginMsg(0x60);
            this.u8v(((team - 1) * 128 + squad) & 0xff);
            this.i16(x);
            this.i16(y);
            this.i16(z);
            this.endMsg(o);
        }

        writeRallyRemove(team, squad) {
            const o = this.beginMsg(0x61);
            this.u8v(((team - 1) * 128 + squad) & 0xff);
            this.endMsg(o);
        }

        writeCacheAdd(id, x, y, z) {
            const o = this.beginMsg(0x70);
            this.u8v(id);
            this.i16(x);
            this.i16(y);
            this.i16(z);
            this.endMsg(o);
        }

        writeCacheReveal(id) {
            const o = this.beginMsg(0x72);
            this.u8v(id);
            this.endMsg(o);
        }

        writeCacheRemove(id) {
            const o = this.beginMsg(0x71);
            this.u8v(id);
            this.endMsg(o);
        }

        writeSLOrder(team, squad, orderType, x, y, z) {
            const o = this.beginMsg(0xA3);
            this.u8v(((team - 1) * 128 + squad) & 0xff);
            this.i8v(orderType);
            this.i16(x);
            this.i16(y);
            this.i16(z);
            this.endMsg(o);
        }

        writeProjAdd(id, playerId, projType, templateName, yaw, x, y, z) {
            const o = this.beginMsg(0x91);
            this.u16(id);
            this.u8v(playerId);
            this.u8v(projType);
            this.cstr(templateName || "");
            this.i16(yaw);
            this.i16(x);
            this.i16(y);
            this.i16(z);
            this.endMsg(o);
        }

        writeProjUpdates(updates) {
            if (!updates || updates.length === 0) return;
            const o = this.beginMsg(0x90);
            for (const u of updates) {
                this.u16(u.id);
                this.i16(u.yaw);
                this.i16(u.x);
                this.i16(u.y);
                this.i16(u.z);
            }
            this.endMsg(o);
        }

        writeProjRemove(ids) {
            if (!ids || ids.length === 0) return;
            const o = this.beginMsg(0x92);
            const list = Array.isArray(ids) ? ids : [ids];
            for (const id of list) this.u16(id);
            this.endMsg(o);
        }

        writeKill(attackerId, victimId, weapon) {
            const o = this.beginMsg(0x50);
            this.u8v(attackerId);
            this.u8v(victimId);
            this.cstr(weapon || "ak74m");
            this.endMsg(o);
        }

        writeRevive(medicId, revivedId) {
            const o = this.beginMsg(0xA0);
            this.u8v(medicId);
            this.u8v(revivedId);
            this.endMsg(o);
        }

        writeChat(channel, playerId, text) {
            const o = this.beginMsg(0x51);
            this.u8v(channel);
            this.u8v(playerId);
            this.cstr(text);
            this.endMsg(o);
        }

        writeTick(step40ms = 5) {
            const o = this.beginMsg(0xF1);
            this.u8v(Math.max(1, Math.min(250, step40ms)));
            this.endMsg(o);
        }

        writeRoundEnd() {
            const o = this.beginMsg(0xF0);
            this.endMsg(o);
        }

        toArrayBuffer() {
            return this.buf.slice(0, this.pos);
        }
    }

    // =========================================================================
    // 2. Camera Presets & Station Definitions for Lab 1 (Mechanics Proving Ground)
    // =========================================================================
    const BASE_Y = 42; // Flat central apron elevation on test_airfield (~42.3m)
    const STANCES = ["stand", "crouch", "prone"];
    const STANCE_Y = { stand: BASE_Y + 1, crouch: BASE_Y + 1, prone: BASE_Y };

    const MECHANICS_STATIONS = [
        {
            id: "s1_heal",
            num: 1,
            title: "1. Medicos & Vendaje (3 Poses)",
            desc: "3 pares Medico+Herido (stand/crouch/prone) subiendo/bajando HP + 3 soldados vendandose solos.",
            worldX: -200, worldY: BASE_Y + 1.2, worldZ: 0,
            camPos: [-201, BASE_Y + 2.1, 5.8],
            lookAt: [-201, BASE_Y + 0.85, 0]
        },
        {
            id: "s2_revive",
            num: 2,
            title: "2. Revive / Epipen (3 Poses)",
            desc: "3 pares Medico+Caido en bucle continuo muerte -> Epipen (4s) -> Revive en stand, crouch y prone.",
            worldX: -145, worldY: BASE_Y + 1.1, worldZ: 0,
            camPos: [-145, BASE_Y + 2.0, 5.6],
            lookAt: [-145, BASE_Y + 0.75, 0]
        },
        {
            id: "s3_launchers",
            num: 3,
            title: "3. LAT / HAT / AA (Matriz 3x3)",
            desc: "9 tiradores (LAT RPG-7, HAT SRAW/Eryx y AA Igla) en las 3 posturas disparando en bucle con humo y estela.",
            worldX: -90, worldY: BASE_Y + 1.3, worldZ: -6,
            camPos: [-84, BASE_Y + 2.8, 9.2],
            lookAt: [-90, BASE_Y + 0.95, -5]
        },
        {
            id: "s4_shovel",
            num: 4,
            title: "4. FOB, Pala, Municion y Cuerda",
            desc: "Construccion y demolicion continua de FOB y Bunker con pala en 3 posturas + Ammokit + Grappling Hook.",
            worldX: -28, worldY: BASE_Y + 1.4, worldZ: 2,
            camPos: [-28, BASE_Y + 3.6, 13.5],
            lookAt: [-28, BASE_Y + 1.1, 2]
        },
        {
            id: "s5_ordnance",
            num: 5,
            title: "5. Granadas, Humo, Minas y C4",
            desc: "Lanzamiento continuo de Frag, Smoke (cortina 3D), Minas AT/AP, Claymore, C4 e IED en las 3 posturas.",
            worldX: 25, worldY: BASE_Y + 1.2, worldZ: 0,
            camPos: [25, BASE_Y + 3.0, 11.5],
            lookAt: [25, BASE_Y + 0.9, 0]
        },
        {
            id: "s6_sl_orders",
            num: 6,
            title: "6. Squad Lead, Ordenes y Caches",
            desc: "SL ciclando todas las ordenes (Attack/Defend/Move/Build/Observe), Rally, Captura de Bandera y Caches.",
            worldX: 75, worldY: BASE_Y + 1.5, worldZ: 8,
            camPos: [75, BASE_Y + 10.0, 22.0],
            lookAt: [75, BASE_Y + 1.0, 14]
        },
        {
            id: "s7_turrets",
            num: 7,
            title: "7. Torretas Giratorias y Artilleros",
            desc: "T-90, M1A2, BMP-3, LAV-25, Shilka, Humvee .50cal, UAZ MG y TOW girando 360 grados y disparando.",
            worldX: 140, worldY: BASE_Y + 2.2, worldZ: 0,
            camPos: [140, BASE_Y + 6.5, 24.0],
            lookAt: [140, BASE_Y + 1.8, 0]
        },
        {
            id: "s8_ground_phys",
            num: 8,
            title: "8. Suspension y Choque de Carros",
            desc: "Camion vs Tanque acelerando/curvando/frenando + 2 Jeeps chocando de frente en seco en bucle.",
            worldX: 0, worldY: BASE_Y + 2.0, worldZ: -110,
            camPos: [0, BASE_Y + 14.0, 152.0],
            lookAt: [0, BASE_Y + 1.5, -110]
        },
        {
            id: "s9_helis",
            num: 9,
            title: "9. Circuito de 4 Helicopteros",
            desc: "1) Hover + vertical, 2) Strafe lateral puro, 3) Sprint + frenada J-hook, 4) Orbita peraltada continua.",
            worldX: 0, worldY: 78, worldZ: 155,
            camPos: [0, 88, -82],
            lookAt: [0, 76, 155]
        },
        {
            id: "s10_jets_mortar",
            num: 10,
            title: "10. Cazas (Jets) y Morteros",
            desc: "A-10 recto nivelado (roll 0), F-16 y MiG-29 en circuito en 8 peraltado + Bateria de Morteros balisticos.",
            worldX: 0, worldY: 205, worldZ: 0,
            camPos: [0, 225, 390],
            lookAt: [0, 195, 0]
        }
    ];

    // =========================================================================
    // 3. Synthetic Continuous .PRdemo Generator (Lab 1)
    // =========================================================================
    function buildMechanicsProvingGroundDemo() {
        const w = new PRDemoBinaryWriter(3 * 1024 * 1024);
        const dt = 0.20; // 5 Hz (5 * 0.04s per tick) -> dense, smooth, parses 240s in <50ms
        const totalDuration = 240.0; // 4 full minutes + seamless auto-loop
        const totalTicks = Math.round(totalDuration / dt);
        const forcedStances = {};

        w.writeServerDetails({
            timePerTick: dt,
            serverName: "[PR 1.8.0.0] Debug Lab - Mechanics Proving Ground",
            mapName: "test_airfield",
            gameMode: "gpm_cq",
            layer: 64,
            opfor: "ru",
            blufor: "us",
            tickets1: 999,
            tickets2: 999,
            mapSize: 4.0
        });
        w.writeDodEmpty();
        w.writeFlagList([
            { id: 101, team: 2, x: 75, y: BASE_Y, z: 26, radius: 22 },
            { id: 102, team: 1, x: -200, y: BASE_Y, z: 45, radius: 20 }
        ]);

        // Allocate all test players
        const players = [];
        let nextPid = 0;
        const allocPlayer = (name, team, squad, kit, x, z, rot, stance, isSL = false) => {
            const id = nextPid++;
            if (stance) forcedStances[id] = stance;
            players.push({
                id, name, team, squad, kit,
                x, y: stance ? STANCE_Y[stance] : (BASE_Y + 1), z,
                rot: rot || 0, stance: stance || "stand", isSL: !!isSL
            });
            return players[players.length - 1];
        };

        // --- Station 1: Medics Healing + Self-Dressing (X = -200, Z = 0) ---
        const s1Pairs = STANCES.map((st, idx) => {
            const bx = -208 + idx * 5;
            const medic = allocPlayer(`S1_Medic_${st}`, 2, 2, "us_medic", bx - 1, 0, 90, st);
            const patient = allocPlayer(`S1_Patient_${st}`, 2, 2, "us_rifleman", bx + 1, 0, 270, st);
            return { st, idx, medic, patient };
        });
        const s1SelfDress = STANCES.map((st, idx) => {
            const bx = -190 + idx * 4;
            return allocPlayer(`S1_SelfDress_${st}`, 1, 2, "ru_rifleman", bx, 0, 180, st);
        });

        // --- Station 2: Continuous Kill -> Epipen -> Revive (X = -145, Z = 0) ---
        const s2Sniper = allocPlayer("S2_Executioner", 2, 9, "us_sniper", -145, 55, 180, "prone");
        const s2Pairs = STANCES.map((st, idx) => {
            const bx = -151 + idx * 6;
            const medic = allocPlayer(`S2_RevMedic_${st}`, 1, 3, "ru_medic", bx, -1, 0, st);
            const victim = allocPlayer(`S2_Victim_${st}`, 1, 3, "ru_rifleman", bx, 1, 180, "stand");
            return { st, idx, medic, victim };
        });

        // --- Station 3: 3x3 Matrix LAT / HAT / AA Launchers (X = -90, Z = 0..-14) ---
        const s3Configs = [
            { role: "LAT", kit: "ru_riflemanat", team: 1, projType: 32, tmpl: "rpg7_warhead_pg7vs", z: 0 },
            { role: "HAT", kit: "hamas_at",      team: 1, projType: 33, tmpl: "rpg29_pg29v",        z: -7 },
            { role: "AA",  kit: "ru_aa",         team: 1, projType: 35, tmpl: "igla_9k38",          z: -14 }
        ];
        const s3Shooters = [];
        for (let r = 0; r < s3Configs.length; r++) {
            const cfg = s3Configs[r];
            for (let c = 0; c < STANCES.length; c++) {
                const st = STANCES[c];
                const px = -96 + c * 6;
                const p = allocPlayer(`S3_${cfg.role}_${st}`, cfg.team, 4, cfg.kit, px, cfg.z, 0, st);
                s3Shooters.push({ p, cfg, st, offsetSec: r * 2.6 + c * 0.9 });
            }
        }

        // --- Station 4: FOB + Deployable Shovel + Ammokit + Grappling Hook (X = -38..-16) ---
        const s4FobSL = allocPlayer("S4_FobSL", 2, 5, "us_officer", -40, 2, 0, "stand", true);
        const s4FobAllies = STANCES.map((st, idx) => allocPlayer(`S4_FobAlly_${st}`, 2, 5, "us_rifleman", -41 + idx * 3, 6, 180, st));
        const s4FobEnemies = STANCES.map((st, idx) => allocPlayer(`S4_FobEnemy_${st}`, 1, 5, "ru_engineer", -41 + idx * 3, 28, 180, st));

        const s4DepAllies = STANCES.map((st, idx) => allocPlayer(`S4_DepBuild_${st}`, 2, 5, "us_engineer", -29 + idx * 3, 1, 0, st));
        const s4AmmoMen = STANCES.map((st, idx) => allocPlayer(`S4_Ammo_${st}`, 2, 5, "us_rifleman", -19 + idx * 3, -3, 180, st));
        const s4Breacher = allocPlayer("S4_Grapple", 2, 5, "us_rifleman", -11, 2, 0, "stand");

        // --- Station 5: Grenades, Smoke, Mines, Claymore, C4 & IED (X = +25, Z = 0) ---
        const s5Items = [
            { label: "Frag",     kit: "us_rifleman",   team: 2, projType: 38, tmpl: "ushgr_m67",       fly: true },
            { label: "Smoke",    kit: "us_officer",    team: 2, projType: 39, tmpl: "ushgr_m83",       fly: true },
            { label: "ATMine",   kit: "ru_engineer",   team: 1, projType: 1,  tmpl: "at_mine",         fly: false },
            { label: "APMine",   kit: "us_engineer",   team: 2, projType: 2,  tmpl: "usmin_m2a3",      fly: false },
            { label: "Claymore", kit: "us_sniper",     team: 2, projType: 4,  tmpl: "usmin_claymore",  fly: false },
            { label: "C4",       kit: "us_engineer",   team: 2, projType: 5,  tmpl: "c4_explosives",   fly: false },
            { label: "IED",      kit: "hamas_engineer",team: 1, projType: 6,  tmpl: "insrg_mine_ied",  fly: false }
        ];
        const s5Actors = s5Items.map((cfg, idx) => {
            const st = STANCES[idx % 3];
            const px = 13 + idx * 4;
            const p = allocPlayer(`S5_${cfg.label}_${st}`, cfg.team, 6, cfg.kit, px, 0, 0, st);
            return { p, cfg, st, offsetSec: idx * 1.3 };
        });

        // --- Station 6: Squad Leader Giving Orders, Rally, Flag & Caches (X = +75) ---
        const s6SL = allocPlayer("S6_Alpha_SL", 2, 1, "us_officer", 75, 2, 0, "stand", true);
        const s6Member1 = allocPlayer("S6_Alpha_Medic", 2, 1, "us_medic", 72, 0, 0, "crouch");
        const s6Member2 = allocPlayer("S6_Alpha_MG", 2, 1, "us_mg", 78, 0, 0, "prone");

        // --- Vehicles Allocation ---
        let nextVid = 1;
        const vehicles = [];
        const allocVeh = (name, team, maxHp, x, y, z, rot) => {
            const id = nextVid++;
            const v = { id, name, team, maxHp, x, y, z, rot: rot || 0, hp: maxHp };
            vehicles.push(v);
            return v;
        };

        // Station 4 Deployables
        const vS4Bunker = allocVeh("deployable_bunker", 2, 1000, -26, BASE_Y, 4, 0);
        const vS4Grapple = allocVeh("grapplinghookropecontainer", 2, 100, -11, BASE_Y + 4, 4, 0);

        // Station 7: Rotating Turret Armor, Technicals & TOW (X = +112..+168, Z = 0)
        const s7Specs = [
            { vName: "ru_tnk_t90",       team: 1, drvSeat: "ru_tnk_t90",       gunSeat: "ru_tnk_t90_gunner",       fireType: 40, fireTmpl: "tnk_125mm_he", rateDeg: 32 },
            { vName: "us_tnk_m1a2",      team: 2, drvSeat: "us_tnk_m1a2",      gunSeat: "us_tnk_m1a2_gunner",      fireType: 40, fireTmpl: "tnk_120mm_m829", rateDeg: -28 },
            { vName: "ru_ifv_bmp3",      team: 1, drvSeat: "ru_ifv_bmp3",      gunSeat: "ru_ifv_bmp3_gunner",      fireType: 40, fireTmpl: "30mm_2a72_he", rateDeg: 40 },
            { vName: "us_apc_lav25",     team: 2, drvSeat: "us_apc_lav25",     gunSeat: "us_apc_lav25_gunner",     fireType: 40, fireTmpl: "25mm_m242_he", rateDeg: -36 },
            { vName: "mec_aav_shilka",   team: 1, drvSeat: "mec_aav_shilka",   gunSeat: "mec_aav_shilka_gunner",   fireType: 0,  fireTmpl: "",             rateDeg: 55 },
            { vName: "us_jep_hmmwv",     team: 2, drvSeat: "us_jep_hmmwv",     gunSeat: "us_jep_hmmwv_gunner",     fireType: 0,  fireTmpl: "",             rateDeg: 45 },
            { vName: "mec_jep_uaz_mg",   team: 1, drvSeat: "mec_jep_uaz_mg",   gunSeat: "mec_jep_uaz_mg_reargunner", fireType: 0, fireTmpl: "",            rateDeg: -45 },
            { vName: "ats_tow",          team: 2, drvSeat: null,               gunSeat: "ats_tow",                 fireType: 34, fireTmpl: "tow_missile",  rateDeg: 22 }
        ];
        const s7Units = s7Specs.map((sp, idx) => {
            const vx = 108 + idx * 10;
            const veh = allocVeh(sp.vName, sp.team, 1500, vx, BASE_Y, 0, 0);
            const kit = sp.team === 1 ? "ru_rifleman" : "us_rifleman";
            const driver = sp.drvSeat ? allocPlayer(`S7_Drv_${idx}`, sp.team, 7, kit, vx, 0, 0, null) : null;
            const gunner = allocPlayer(`S7_Gun_${idx}`, sp.team, 7, kit, vx, 0, 0, null);
            return { sp, idx, veh, driver, gunner };
        });

        // Station 8: Ground Physics (Accel/S-Turn/Brake + Head-On Collision Crash)
        const vS8Truck = allocVeh("cf_trk_logistics", 2, 1000, -90, BASE_Y, -90, 90);
        const pS8TruckDrv = allocPlayer("S8_TruckDrv", 2, 8, "us_rifleman", -90, -90, 90, null);
        const vS8Tank = allocVeh("idf_tnk_merkava", 2, 2000, -90, BASE_Y, -104, 90);
        const pS8TankDrv = allocPlayer("S8_TankDrv", 2, 8, "us_rifleman", -90, -104, 90, null);

        const vS8CrashA = allocVeh("us_jep_hmmwv", 2, 1000, -60, BASE_Y, -125, 90);
        const pS8CrashADrv = allocPlayer("S8_CrashBlue", 2, 8, "us_rifleman", -60, -125, 90, null);
        const vS8CrashB = allocVeh("mec_jep_uaz", 1, 1000, 60, BASE_Y, -125, 270);
        const pS8CrashBDrv = allocPlayer("S8_CrashRed", 1, 8, "ru_rifleman", 60, -125, 270, null);

        // Station 9: 4 Helicopters (Hover/Vertical, Pure Strafe, Sprint+J-Hook, Circular Orbit)
        const vHeliHover  = allocVeh("us_the_uh60",      2, 1200, -140, 72, 150, 180);
        const pHeliHover  = allocPlayer("S9_Heli_Hover",  2, 9, "us_pilot", -140, 150, 180, null);
        const vHeliStrafe = allocVeh("mec_ahe_mi24",     1, 1500, -45,  72, 150, 180);
        const pHeliStrafe = allocPlayer("S9_Heli_Strafe", 1, 9, "ru_pilot", -45,  150, 180, null);
        const vHeliJHook  = allocVeh("ru_ahe_mi8amtsh",  1, 1200,  55,  76, 110, 0);
        const pHeliJHook  = allocPlayer("S9_Heli_JHook",  1, 9, "ru_pilot",  55,  110, 0, null);
        const vHeliOrbit  = allocVeh("us_the_uh60_soar", 2, 1200, 165,  82, 165, 0);
        const pHeliOrbit  = allocPlayer("S9_Heli_Orbit",  2, 9, "us_pilot", 165,  165, 0, null);

        // Station 10: Jets (Level Cruise + Figure-8 Aerobatic Track) + Mortar Battery
        const vJetLevel = allocVeh("us_jet_a10a", 2, 1500, -750, 175, 40, 90);
        const pJetLevel = allocPlayer("S10_Jet_Level_A10", 2, 9, "us_pilot", -750, 40, 90, null);
        const vJetFig8A = allocVeh("us_jet_f16",  2, 1500, 0, 230, 0, 45);
        const pJetFig8A = allocPlayer("S10_Jet_Fig8_F16", 2, 9, "us_pilot", 0, 0, 45, null);
        const vJetFig8B = allocVeh("ru_jet_mig29", 1, 1500, 0, 250, 0, 225);
        const pJetFig8B = allocPlayer("S10_Jet_Fig8_MiG29", 1, 9, "ru_pilot", 0, 0, 225, null);

        const vMortar = allocVeh("deployable_mortar_m252", 2, 500, 195, BASE_Y, 0, 0);
        const pMortarGunner = allocPlayer("S10_MortarOperator", 2, 7, "us_rifleman", 195, -1, 0, "crouch");

        // --- Emit Initial Setup Packets (Tick 0) ---
        w.writePlayerAdd(players);
        w.writeSquadName(2, 1, "ALPHA ORDERS");
        w.writeSquadName(2, 2, "MEDICS HEAL");
        w.writeSquadName(1, 3, "EPIPEN REVIVE");
        w.writeSquadName(1, 4, "LAT HAT AA");
        w.writeSquadName(2, 5, "FOB SHOVEL");
        w.writeSquadName(2, 6, "ORDNANCE LAB");
        w.writeSquadName(2, 7, "TURRET ARMOR");
        w.writeSquadName(2, 8, "GROUND PHYS");
        w.writeSquadName(2, 9, "AIR WING");

        for (const v of vehicles) {
            w.writeVehicleAdd(v.id, v.name, v.maxHp);
        }
        w.writeVehicleUpdates(vehicles.map(v => ({
            id: v.id, team: v.team, x: v.x, y: v.y, z: v.z, rotation: v.rot, health: v.hp
        })));

        // Seat vehicle crews
        const crewMap = new Map();
        for (const u of s7Units) {
            if (u.driver) crewMap.set(u.driver.id, { vid: u.veh.id, seat: u.sp.drvSeat, slot: 0 });
            crewMap.set(u.gunner.id, { vid: u.veh.id, seat: u.sp.gunSeat, slot: u.driver ? 1 : 0 });
        }
        crewMap.set(pS8TruckDrv.id,  { vid: vS8Truck.id,  seat: "cf_trk_logistics", slot: 0 });
        crewMap.set(pS8TankDrv.id,   { vid: vS8Tank.id,   seat: "idf_tnk_merkava",  slot: 0 });
        crewMap.set(pS8CrashADrv.id, { vid: vS8CrashA.id, seat: "us_jep_hmmwv",     slot: 0 });
        crewMap.set(pS8CrashBDrv.id, { vid: vS8CrashB.id, seat: "mec_jep_uaz",      slot: 0 });
        crewMap.set(pHeliHover.id,   { vid: vHeliHover.id,  seat: "us_the_uh60",      slot: 0 });
        crewMap.set(pHeliStrafe.id,  { vid: vHeliStrafe.id, seat: "mec_ahe_mi24",     slot: 0 });
        crewMap.set(pHeliJHook.id,   { vid: vHeliJHook.id,  seat: "ru_ahe_mi8amtsh",  slot: 0 });
        crewMap.set(pHeliOrbit.id,   { vid: vHeliOrbit.id,  seat: "us_the_uh60_soar", slot: 0 });
        crewMap.set(pJetLevel.id,    { vid: vJetLevel.id,   seat: "us_jet_a10a",      slot: 0 });
        crewMap.set(pJetFig8A.id,    { vid: vJetFig8A.id,   seat: "us_jet_f16",       slot: 0 });
        crewMap.set(pJetFig8B.id,    { vid: vJetFig8B.id,   seat: "ru_jet_mig29",     slot: 0 });

        w.writePlayerUpdates(players.map(p => {
            const c = crewMap.get(p.id);
            return {
                id: p.id,
                team: p.team,
                squad: p.squad,
                isSL: p.isSL,
                vehicleid: c ? c.vid : -1,
                seatName: c ? c.seat : "",
                slot: c ? c.slot : 0,
                health: 100,
                score: 10,
                scoreTW: 5,
                kills: 0,
                deaths: 0,
                ping: 24,
                isAlive: true,
                x: p.x,
                y: p.y,
                z: p.z,
                rotation: p.rot,
                kit: p.kit
            };
        }));

        w.writeChat(0x30, 0, "[DEBUG LAB] Continuous Mechanics Proving Ground Active - All 10 stations looping.");
        w.writeTick(5);

        // --- Dynamic Simulation State ---
        let nextProjId = 1;
        let nextDynVehId = 200;
        const activeProjs = []; // { id, x0, y0, z0, vx, vy, vz, g, yaw, tSpawn, tEnd }
        const activeTempVehs = []; // { id, tRemove }
        let fobActiveId = null;
        let cacheActive = false;
        let flagOwner = 2;

        const normDeg = (d) => (((Math.round(d) % 360) + 360) % 360);

        const spawnBallisticProj = (shooterId, projType, tmpl, x0, y0, z0, vx, vy, vz, grav, durSec, tNow) => {
            const id = (nextProjId++ % 60000) + 1;
            const yaw = normDeg(Math.atan2(vx, vz) * 180 / Math.PI);
            w.writeProjAdd(id, shooterId, projType, tmpl, yaw, x0, y0, z0);
            if (durSec <= dt * 1.1) {
                activeProjs.push({ id, staticOnly: true, x0, y0, z0, yaw, tSpawn: tNow, tEnd: tNow + Math.max(0.4, durSec) });
            } else {
                activeProjs.push({ id, staticOnly: false, x0, y0, z0, vx, vy, vz, g: grav, yaw, tSpawn: tNow, tEnd: tNow + durSec });
            }
        };

        // --- Main Tick Loop (1..totalTicks) ---
        for (let tk = 1; tk <= totalTicks; tk++) {
            const t = tk * dt;
            const pUpd = [];
            const vUpd = [];

            // -----------------------------------------------------------------
            // Station 1: Continuous Medic Heal + Lone Soldier Dressing (50-tick / 45-tick cycles)
            // -----------------------------------------------------------------
            for (const pair of s1Pairs) {
                const cycTk = (tk + pair.idx * 12) % 50;
                if (cycTk === 2) {
                    pUpd.push({ id: pair.patient.id, health: 30, x: pair.patient.x, y: pair.patient.y, z: pair.patient.z });
                    pUpd.push({ id: pair.medic.id, x: pair.medic.x, y: pair.medic.y, z: pair.medic.z });
                } else {
                    const stepTicks = [9, 15, 21, 27, 33, 39, 45];
                    const sIdx = stepTicks.indexOf(cycTk);
                    if (sIdx !== -1) {
                        pUpd.push({ id: pair.patient.id, health: Math.min(100, 40 + sIdx * 10) });
                    }
                }
            }
            for (let i = 0; i < s1SelfDress.length; i++) {
                const p = s1SelfDress[i];
                const cycTk = (tk + i * 15) % 45;
                if (cycTk === 3) {
                    pUpd.push({ id: p.id, health: 40, x: p.x, y: p.y, z: p.z });
                } else if (cycTk === 25) {
                    pUpd.push({ id: p.id, health: 72, x: p.x, y: p.y, z: p.z });
                } else if (cycTk === 38) {
                    pUpd.push({ id: p.id, health: 100 });
                }
            }

            // -----------------------------------------------------------------
            // Station 2: Continuous Kill -> Epipen (4s lead) -> Revive (55-tick / 11s cycle)
            // -----------------------------------------------------------------
            for (const pair of s2Pairs) {
                const cycTk = (tk + pair.idx * 16) % 55;
                if (cycTk === 5 && tk >= 5) {
                    w.writeKill(s2Sniper.id, pair.victim.id, "us_sniper_m24");
                    pUpd.push({ id: pair.victim.id, isAlive: false, health: 0 });
                } else if (cycTk === 31 && tk >= 25) {
                    w.writeRevive(pair.medic.id, pair.victim.id);
                    pUpd.push({ id: pair.victim.id, isAlive: true, health: 65, x: pair.victim.x, y: pair.victim.y, z: pair.victim.z });
                }
            }

            // -----------------------------------------------------------------
            // Station 3: 3x3 LAT / HAT / AA Simultaneous Volley Firing (50-tick / 10s cycle)
            // -----------------------------------------------------------------
            if (tk % 50 === 25) {
                for (const sh of s3Shooters) {
                    if (sh.cfg.role === "AA") {
                        spawnBallisticProj(sh.p.id, 35, sh.cfg.tmpl, sh.p.x, BASE_Y + 2, sh.p.z + 1, 4, 58, 72, -2.0, 2.8, t);
                    } else if (sh.cfg.role === "HAT") {
                        const pType = (sh.st === "crouch") ? 34 : 33;
                        spawnBallisticProj(sh.p.id, pType, sh.cfg.tmpl, sh.p.x, BASE_Y + 1, sh.p.z + 1, 0, 12, 85, -3.5, 2.4, t);
                    } else {
                        spawnBallisticProj(sh.p.id, 32, sh.cfg.tmpl, sh.p.x, BASE_Y + 1, sh.p.z + 1, 0, 14, 92, -6.5, 2.2, t);
                    }
                }
            }

            // -----------------------------------------------------------------
            // Station 4: FOB Shovel + Deployable Shovel + Ammo + Grapple
            // -----------------------------------------------------------------
            const fobTk = tk % 220;
            if (tk === 2 || fobTk === 3) {
                if (fobActiveId !== null) {
                    w.writeFobRemove(fobActiveId);
                    fobActiveId = null;
                }
                fobActiveId = 5000 + tk;
                // Move enemies away while allies dig FOB up
                for (const ep of s4FobEnemies) pUpd.push({ id: ep.id, x: ep.x, y: ep.y, z: 28 });
                for (const ap of s4FobAllies) pUpd.push({ id: ap.id, x: ap.x, y: ap.y, z: 6 });
                w.writeFobAdd(fobActiveId, 2, -38, BASE_Y, 5);
            } else if (fobTk === 120) {
                // Move allies back and move enemy engineers adjacent to FOB to shovel it down!
                for (const ap of s4FobAllies) pUpd.push({ id: ap.id, x: ap.x, y: ap.y, z: -18 });
                for (const ep of s4FobEnemies) pUpd.push({ id: ep.id, x: ep.x, y: ep.y, z: 6 });
            } else if (fobTk === 210 && fobActiveId !== null) {
                w.writeFobRemove(fobActiveId);
                fobActiveId = null;
            }
            // Keep stationary position history fresh every 1.6s so _predMovedDistance === 0
            if (tk % 8 === 0) {
                for (const ap of s4FobAllies) {
                    pUpd.push({ id: ap.id, x: ap.x, y: ap.y, z: (fobTk < 120 ? 6 : -18) });
                }
                for (const ep of s4FobEnemies) {
                    pUpd.push({ id: ep.id, x: ep.x, y: ep.y, z: (fobTk >= 120 && fobTk < 210 ? 6 : 28) });
                }
                for (const dp of s4DepAllies) {
                    pUpd.push({ id: dp.id, x: dp.x, y: dp.y, z: dp.z });
                }
            }

            // Deployable Bunker continuous shovel health steps every 1.4s
            if (tk % 7 === 0) {
                const wave = Math.sin(t * 0.55);
                vS4Bunker.hp = Math.round(600 + 350 * wave);
                vUpd.push({ id: vS4Bunker.id, health: vS4Bunker.hp });
            }

            // Ammokit drops every 9s (45 ticks) across the 3 stances
            for (let i = 0; i < s4AmmoMen.length; i++) {
                const am = s4AmmoMen[i];
                if ((tk + i * 15) % 45 === 20) {
                    const aid = nextDynVehId++;
                    w.writeVehicleAdd(aid, "ammo_drop", 100);
                    w.writeVehicleUpdates([{ id: aid, team: 2, x: am.x, y: BASE_Y, z: am.z - 1, rotation: 0, health: 100 }]);
                    activeTempVehs.push({ id: aid, tRemove: t + 4.5 });
                }
            }

            // Breacher grappling hook throw + rope climb cycle (14s = 70 ticks)
            const grapTk = tk % 70;
            if (grapTk === 15) {
                const gid = nextDynVehId++;
                w.writeVehicleAdd(gid, "grapplinghookropecontainer", 100);
                w.writeVehicleUpdates([{ id: gid, team: 2, x: s4Breacher.x, y: BASE_Y, z: s4Breacher.z + 1, rotation: 0, health: 100 }]);
                activeTempVehs.push({ id: gid, tRemove: t + 3.0 });
            } else if (grapTk >= 32 && grapTk <= 57) {
                const climbFrac = Math.sin(((grapTk - 32) / 25.0) * Math.PI);
                const climbY = BASE_Y + Math.round(climbFrac * 7);
                vUpd.push({ id: vS4Grapple.id, x: -11, y: climbY, z: 4, rotation: 0 });
                pUpd.push({ id: s4Breacher.id, vehicleid: vS4Grapple.id, seatName: "grapplinghookropecontainer", slot: 0, x: -11, y: climbY, z: 4 });
            } else if (grapTk === 58) {
                pUpd.push({ id: s4Breacher.id, vehicleid: -1, x: s4Breacher.x, y: s4Breacher.y, z: s4Breacher.z });
            }

            // Cleanup expired temporary ammo_drop / grapple containers
            for (let k = activeTempVehs.length - 1; k >= 0; k--) {
                if (t >= activeTempVehs[k].tRemove) {
                    w.writeVehicleDestroyed(activeTempVehs[k].id, false, 0);
                    activeTempVehs.splice(k, 1);
                }
            }

            // -----------------------------------------------------------------
            // Station 5: Ordnance (Frag, Smoke, Mines, Claymore, C4, IED)
            // -----------------------------------------------------------------
            for (let i = 0; i < s5Actors.length; i++) {
                const act = s5Actors[i];
                if ((tk + i * 7) % 48 === 21 && tk >= 18) {
                    if (act.cfg.fly) {
                        spawnBallisticProj(act.p.id, act.cfg.projType, act.cfg.tmpl, act.p.x, BASE_Y + 1, act.p.z + 1, 0, 11, 18, -9.8, 2.2, t);
                    } else {
                        spawnBallisticProj(act.p.id, act.cfg.projType, act.cfg.tmpl, act.p.x, BASE_Y, act.p.z + 2, 0, 0, 0, 0, 4.0, t);
                    }
                }
            }

            // -----------------------------------------------------------------
            // Station 6: Squad Leader Cycling Orders, Rally, Flag & Caches
            // -----------------------------------------------------------------
            if (tk % 25 === 2) {
                const orderIdx = Math.floor(tk / 25) % 5;
                const orderTypes = [1, 2, 3, 4, 5];
                const ang = (orderIdx / 5) * Math.PI * 2;
                const ox = Math.round(75 + Math.cos(ang) * 24);
                const oz = Math.round(20 + Math.sin(ang) * 24);
                w.writeSLOrder(2, 1, orderTypes[orderIdx], ox, BASE_Y, oz);
            }
            if (tk % 75 === 5) {
                w.writeRallyRemove(2, 1);
                w.writeRallyAdd(2, 1, 70, BASE_Y, 6);
            }
            if (tk % 60 === 10) {
                flagOwner = (flagOwner === 2) ? 1 : 2;
                w.writeFlagUpdate(101, flagOwner);
            }
            const cacheCyc = tk % 80;
            if (cacheCyc === 4 && !cacheActive) {
                w.writeCacheAdd(1, 84, BASE_Y, 12);
                cacheActive = true;
            } else if (cacheCyc === 28 && cacheActive) {
                w.writeCacheReveal(1);
            } else if (cacheCyc === 64 && cacheActive) {
                w.writeCacheRemove(1);
                cacheActive = false;
            }

            // -----------------------------------------------------------------
            // Station 7: Rotating Turrets & Tank/IFV/TOW Firing
            // -----------------------------------------------------------------
            for (const u of s7Units) {
                const gunYaw = normDeg(t * u.sp.rateDeg + u.idx * 35);
                pUpd.push({ id: u.gunner.id, rotation: gunYaw });
                if (u.sp.fireType > 0) {
                    if ((tk + u.idx * 11) % 50 === 25) {
                        const rad = gunYaw * Math.PI / 180;
                        const spd = (u.sp.fireType === 34) ? 75 : 135;
                        const muzzleX = Math.round(u.veh.x + Math.sin(rad) * 4);
                        const muzzleZ = Math.round(u.veh.z + Math.cos(rad) * 4);
                        spawnBallisticProj(
                            u.gunner.id, u.sp.fireType, u.sp.fireTmpl,
                            muzzleX, BASE_Y + 2, muzzleZ,
                            Math.sin(rad) * spd, (u.sp.fireType === 34 ? 2 : 5), Math.cos(rad) * spd,
                            (u.sp.fireType === 34 ? 0 : -3.0), 2.2, t
                        );
                    }
                }
            }

            // -----------------------------------------------------------------
            // Station 8: Ground Vehicle Suspension (Accel/S-Turn/Brake) & Crash
            // -----------------------------------------------------------------
            // 8A: Truck & Tank shuttle with brisk acceleration, S-curve weave, and hard brake (20s cycle)
            const s8Phase = (t % 20.0) / 20.0; // 0..1
            let s8Progress, s8Dir;
            if (s8Phase < 0.45) {
                const u = s8Phase / 0.45;
                // Smooth ease-in-out with strong initial accel & strong end braking
                s8Progress = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
                s8Dir = 90;
            } else if (s8Phase < 0.50) {
                s8Progress = 1.0;
                s8Dir = 90;
            } else if (s8Phase < 0.95) {
                const u = (s8Phase - 0.50) / 0.45;
                s8Progress = 1.0 - (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
                s8Dir = 270;
            } else {
                s8Progress = 0.0;
                s8Dir = 270;
            }
            const s8X = -95 + s8Progress * 190;
            const s8Weave = Math.sin(s8Progress * Math.PI * 2) * 12;
            const s8Slope = Math.cos(s8Progress * Math.PI * 2) * (Math.PI * 2 * 12 / 190);
            const weaveYaw = normDeg(s8Dir - Math.atan(s8Slope) * 180 / Math.PI * (s8Dir === 90 ? 1 : -1));

            vUpd.push({ id: vS8Truck.id, x: s8X, y: BASE_Y, z: -86 + s8Weave, rotation: weaveYaw });
            pUpd.push({ id: pS8TruckDrv.id, x: s8X, y: BASE_Y + 1, z: -86 + s8Weave, rotation: weaveYaw });
            vUpd.push({ id: vS8Tank.id, x: s8X, y: BASE_Y, z: -104 + s8Weave, rotation: weaveYaw });
            pUpd.push({ id: pS8TankDrv.id, x: s8X, y: BASE_Y + 1, z: -104 + s8Weave, rotation: weaveYaw });

            // 8B: Two Jeeps accelerating head-on and slamming to a dead stop at X = +/-3 (12s cycle)
            const crashCyc = t % 12.0;
            let cDist;
            if (crashCyc < 4.0) {
                // Accelerate quadratically from 68m out right into impact at 3.5m!
                const u = crashCyc / 4.0;
                cDist = 68.0 - (68.0 - 3.5) * (u * u);
            } else if (crashCyc < 6.5) {
                // Dead-stop collision hold (sharp velocity discontinuity dv > 30 m/s!)
                cDist = 3.5;
            } else if (crashCyc < 10.5) {
                // Reverse back to start
                const u = (crashCyc - 6.5) / 4.0;
                cDist = 3.5 + (68.0 - 3.5) * (u * u * (3 - 2 * u));
            } else {
                cDist = 68.0;
            }
            vUpd.push({ id: vS8CrashA.id, x: -cDist, y: BASE_Y, z: -125, rotation: 90 });
            pUpd.push({ id: pS8CrashADrv.id, x: -cDist, y: BASE_Y + 1, z: -125, rotation: 90 });
            vUpd.push({ id: vS8CrashB.id, x: cDist, y: BASE_Y, z: -125, rotation: 270 });
            pUpd.push({ id: pS8CrashBDrv.id, x: cDist, y: BASE_Y + 1, z: -125, rotation: 270 });

            // -----------------------------------------------------------------
            // Station 9: 4 Helicopters Continuous Flight Patterns
            // -----------------------------------------------------------------
            // Heli 1: Pure hover + smooth vertical climb/descent
            const h1Y = 74 + Math.sin(t * 0.65) * 14;
            vUpd.push({ id: vHeliHover.id, x: -140, y: h1Y, z: 150, rotation: 180 });
            pUpd.push({ id: pHeliHover.id, x: -140, y: h1Y, z: 150, rotation: 180 });

            // Heli 2: Pure lateral strafe left <-> right while nose stays locked South (180 deg)
            const h2X = -45 + Math.sin(t * 0.75) * 38;
            vUpd.push({ id: vHeliStrafe.id, x: h2X, y: 74, z: 150, rotation: 180 });
            pUpd.push({ id: pHeliStrafe.id, x: h2X, y: 74, z: 150, rotation: 180 });

            // Heli 3: Fast forward sprint + J-hook braking flare (16s cycle)
            const jhPhase = (t % 16.0) / 16.0;
            let jhU, jhRot;
            if (jhPhase < 0.38) {
                const u = jhPhase / 0.38;
                jhU = u < 0.65 ? (u / 0.65) * 0.78 : 0.78 + 0.22 * (1 - Math.pow(1 - (u - 0.65) / 0.35, 3));
                jhRot = 0;
            } else if (jhPhase < 0.50) {
                jhU = 1.0;
                jhRot = Math.round(((jhPhase - 0.38) / 0.12) * 180);
            } else if (jhPhase < 0.88) {
                const u = (jhPhase - 0.50) / 0.38;
                const fwd = u < 0.65 ? (u / 0.65) * 0.78 : 0.78 + 0.22 * (1 - Math.pow(1 - (u - 0.65) / 0.35, 3));
                jhU = 1.0 - fwd;
                jhRot = 180;
            } else {
                jhU = 0.0;
                jhRot = Math.round(180 + ((jhPhase - 0.88) / 0.12) * 180) % 360;
            }
            const h3Z = 95 + jhU * 155;
            vUpd.push({ id: vHeliJHook.id, x: 55, y: 76, z: h3Z, rotation: jhRot });
            pUpd.push({ id: pHeliJHook.id, x: 55, y: 76, z: h3Z, rotation: jhRot });

            // Heli 4: Continuous coordinated circular bank orbit (R = 62m, omega = 0.52 rad/s -> ~32 m/s)
            const h4Ang = t * 0.52;
            const h4X = 165 + Math.cos(h4Ang) * 62;
            const h4Z = 165 + Math.sin(h4Ang) * 62;
            const h4Yaw = normDeg(Math.atan2(-Math.sin(h4Ang), Math.cos(h4Ang)) * 180 / Math.PI);
            vUpd.push({ id: vHeliOrbit.id, x: h4X, y: 82, z: h4Z, rotation: h4Yaw });
            pUpd.push({ id: pHeliOrbit.id, x: h4X, y: 82, z: h4Z, rotation: h4Yaw });

            // -----------------------------------------------------------------
            // Station 10: Jets (Straight Level Pass + Figure-8) + High-Arc Mortars
            // -----------------------------------------------------------------
            // Jet 1 (A-10): Straight rock-steady level pass at 140 m/s across [-840..+840] (24s cycle)
            const j1Cyc = t % 24.0;
            let j1X, j1Z, j1Yaw;
            if (j1Cyc < 12.0) {
                j1X = -840 + (j1Cyc / 12.0) * 1680;
                j1Z = 40;
                j1Yaw = 90;
            } else {
                // Note: > 450m jump cleanly splits pre-sim track into a new straight return pass!
                j1X = 840 - ((j1Cyc - 12.0) / 12.0) * 1680;
                j1Z = -40;
                j1Yaw = 270;
            }
            vUpd.push({ id: vJetLevel.id, x: j1X, y: 175, z: j1Z, rotation: j1Yaw });
            pUpd.push({ id: pJetLevel.id, x: j1X, y: 175, z: j1Z, rotation: j1Yaw });

            // Jet 2 (F-16) & Jet 3 (MiG-29): Continuous smooth Figure-8 with climbs & dives
            const evalJetFig8 = (phaseRad, baseAlt) => {
                const x = 620 * Math.sin(phaseRad);
                const z = 310 * Math.sin(2 * phaseRad);
                const y = baseAlt + 48 * Math.cos(phaseRad);
                const vx = 620 * Math.cos(phaseRad);
                const vz = 620 * Math.cos(2 * phaseRad);
                const yaw = normDeg(Math.atan2(vx, vz) * 180 / Math.PI);
                return { x, y, z, yaw };
            };
            const f16 = evalJetFig8(t * 0.24, 235);
            vUpd.push({ id: vJetFig8A.id, x: f16.x, y: f16.y, z: f16.z, rotation: f16.yaw });
            pUpd.push({ id: pJetFig8A.id, x: f16.x, y: f16.y, z: f16.z, rotation: f16.yaw });

            const mig = evalJetFig8(t * 0.24 + Math.PI, 255);
            vUpd.push({ id: vJetFig8B.id, x: mig.x, y: mig.y, z: mig.z, rotation: mig.yaw });
            pUpd.push({ id: pJetFig8B.id, x: mig.x, y: mig.y, z: mig.z, rotation: mig.yaw });

            // Mortar Battery: Fires steep parabolic mortar shell every 6.0s (30 ticks)
            if (tk % 30 === 5) {
                // Parabolic arc: 5.0s flight, apex ~145m, lands 250m North
                spawnBallisticProj(pMortarGunner.id, 37, "mortar_shell_81mm", 195, BASE_Y + 2, 2, 0, 49.0, 50.0, -19.6, 5.0, t);
            }

            // -----------------------------------------------------------------
            // Advance & Remove Active Projectiles
            // -----------------------------------------------------------------
            const projUpds = [];
            const projRems = [];
            for (let i = activeProjs.length - 1; i >= 0; i--) {
                const pr = activeProjs[i];
                if (t >= pr.tEnd) {
                    projRems.push(pr.id);
                    activeProjs.splice(i, 1);
                    continue;
                }
                if (!pr.staticOnly) {
                    const age = t - pr.tSpawn;
                    const px = pr.x0 + pr.vx * age;
                    const py = Math.max(BASE_Y, pr.y0 + pr.vy * age + 0.5 * pr.g * age * age);
                    const pz = pr.z0 + pr.vz * age;
                    projUpds.push({ id: pr.id, yaw: pr.yaw, x: px, y: py, z: pz });
                }
            }
            if (projUpds.length > 0) w.writeProjUpdates(projUpds);
            if (projRems.length > 0) w.writeProjRemove(projRems);

            if (vUpd.length > 0) w.writeVehicleUpdates(vUpd);
            if (pUpd.length > 0) w.writePlayerUpdates(pUpd);

            w.writeTick(5);
        }

        w.writeRoundEnd();
        return {
            buffer: w.toArrayBuffer(),
            forcedStances,
            loopStartTick: Math.round(6.0 / dt) // Loop seamlessly back to t = 6.0s
        };
    }

    // Minimal empty 2-tick .PRdemo header for Lab 2 (Asset Museum) & Lab 3 (Structures Museum)
    function buildEmptyMuseumDemo(mapName, mapSizeKm, serverTitle) {
        const w = new PRDemoBinaryWriter(4096);
        w.writeServerDetails({
            timePerTick: 0.20,
            serverName: serverTitle || `[PR 1.8.0.0] Debug Museum (${mapName})`,
            mapName: mapName,
            gameMode: "gpm_cq",
            layer: 64,
            opfor: "ru",
            blufor: "us",
            tickets1: 500,
            tickets2: 500,
            mapSize: mapSizeKm
        });
        w.writeDodEmpty();
        w.writeTick(5);
        w.writeTick(5);
        w.writeRoundEnd();
        return w.toArrayBuffer();
    }

    // =========================================================================
    // 4. Lab 2 (Asset Museum on test_airfield) & Lab 3 (Structures Museum on deagle5)
    // =========================================================================
    const ASSET_WINGS = [
        { id: "ground",      label: "Sala 1: Terrestres/Navales" },
        { id: "air",         label: "Sala 2: Aeronaves" },
        { id: "deployables", label: "Sala 3: Desplegables/Projs" },
        { id: "soldiers",    label: "Sala 4: Soldados & Posturas" },
        { id: "weapons",     label: "Sala 5: Armeria (361 Armas)" },
        { id: "all",         label: "Todas las Salas" }
    ];

    const STRUCT_CATS = [
        { id: "0",   label: "Edificios (970)" },
        { id: "1",   label: "Muros / Vallas (618)" },
        { id: "2",   label: "Industrial / Props (1795)" },
        { id: "3",   label: "Arboles / Vegetacion (346)" },
        { id: "all", label: "Todas" }
    ];

    const museumState = {
        items: [],          // Laid-out items for Lab 2
        wingCenters: {},    // wingId -> { x, y, z, camPos, lookAt }
        activeWing: "ground",
        searchQuery: "",
        texFilter: "all", // "all" | "missing" | "textured"
        weaponHoldMode: false, // false = floating weapon pedestals, true = held by soldier
        weaponHoldPose: "stand",
        built: false,
        auditStatus: ""
    };

    const structMuseumState = {
        catFilter: "0",
        mapFilter: "",      // "" = all maps, or specific mapKey (enables 100% textured instancing!)
        searchQuery: "",
        page: 0,
        pageSize: 96,
        totalFiltered: 0,
        currentItems: [],   // Active page items laid out at Y=85m
        meshDbCache: {},    // mapKey -> parsed <map>_mesh3d.json
        loadingPage: false
    };

    function buildAssetMuseumCatalog() {
        if (museumState.built) return;
        const catDb = window.DEBUG_CATALOG_DB || { models: [] };
        const sdb = (typeof SOLDIER_LOADOUT_DB !== "undefined" && SOLDIER_LOADOUT_DB) ? SOLDIER_LOADOUT_DB : null;
        const items = [];
        const SKY_Y = 96.0;

        // Helper to lay out a list of items into neat floating rows in a dedicated sector
        const layoutGridSector = (wingId, baseOriginX, baseOriginZ, rawList, colsCount, minPadX, minPadZ) => {
            let col = 0;
            let curX = baseOriginX;
            let curZ = baseOriginZ;
            let rowMaxDepth = 0;
            let rowWidthMax = 0;

            for (let i = 0; i < rawList.length; i++) {
                const it = rawList[i];
                const spanX = Math.max(minPadX, (it.w || 3.0) + 4.0);
                const spanZ = Math.max(minPadZ, (it.l || 3.0) + 5.0);
                if (col > 0 && col >= colsCount) {
                    col = 0;
                    curX = baseOriginX;
                    curZ -= (rowMaxDepth + 6.0);
                    rowMaxDepth = 0;
                }
                it.wing = wingId;
                it.x = curX + spanX * 0.5;
                it.y = SKY_Y;
                it.z = curZ;
                curX += spanX;
                if (curX - baseOriginX > rowWidthMax) rowWidthMax = curX - baseOriginX;
                if (spanZ > rowMaxDepth) rowMaxDepth = spanZ;
                col++;
                items.push(it);
            }

            const centerX = baseOriginX + rowWidthMax * 0.35;
            museumState.wingCenters[wingId] = {
                x: centerX,
                y: SKY_Y,
                z: baseOriginZ,
                camPos: [baseOriginX + 18, SKY_Y + 11, -(baseOriginZ + 22)],
                lookAt: [baseOriginX + 24, SKY_Y + 1.5, baseOriginZ - 12]
            };
        };

        // 1. Wing 1 (Ground/Naval Vehicles), Wing 2 (Aircraft), Wing 3 (Deployables/FOBs/Projs)
        // Separate giant naval vessels & oversized static hulls (>= 24m) into an isolated distant zone so they never cover normal vehicles!
        const groundList = [];
        const giantList = [];
        const airList = [];
        const depList = [];
        for (const m of catDb.models) {
            const [key, cat, w, h, l, isMulti, hasTex] = m;
            const rec = { kind: "entity_mesh", key, label: key.replace(/^vehicle_/, ""), w, h, l, isMulti: !!isMulti, hasTex: !!hasTex };
            if (cat === 1) {
                airList.push(rec);
            } else if (cat === 2) {
                depList.push(rec);
            } else if (Math.max(w, l) >= 24.0 || key.includes("cargoship") || key.includes("carrier") || key.includes("_ship_")) {
                giantList.push(rec);
            } else {
                groundList.push(rec);
            }
        }

        layoutGridSector("ground", -520, 0, groundList, 18, 9.0, 12.0);
        if (giantList.length > 0) {
            const savedCenter = museumState.wingCenters["ground"];
            layoutGridSector("ground", -1350, -450, giantList, 3, 95.0, 95.0);
            museumState.wingCenters["ground"] = savedCenter;
        }
        layoutGridSector("air", 120, 0, airList, 10, 22.0, 24.0);
        layoutGridSector("deployables", -520, 260, depList, 16, 6.5, 8.0);

        // 2. Wing 4: Modular Soldiers (8x4 Grip/Pose Reference Matrix + All 209 Faction Bodies)
        const soldierList = [];
        if (sdb) {
            const gripRepWeapon = {
                rifle: "usrif_m4",
                lmg: "uslmg_m249saw",
                pistol: "uspis_92fs",
                launcher: "rulat_rpg7_pg7vs",
                grenade: "ushgr_m67",
                shovel: "klappspaten_ww2us",
                item_hold: "medikit",
                bino: "binocular"
            };
            const grips = Object.keys(sdb.weaponMats || {});
            const poses = ["stand", "crouch", "prone", "sit"];
            for (const g of grips) {
                for (const pose of poses) {
                    const wGeom = (gripRepWeapon[g] && sdb.weapons && sdb.weapons[gripRepWeapon[g]]) ? gripRepWeapon[g] : null;
                    soldierList.push({
                        kind: "modular_pose_ref",
                        key: `pose_${g}_${pose}`,
                        label: `${g} [${pose}]`,
                        bodyName: "pr_us_soldier2",
                        kitPair: "us_kits:1",
                        grip: g,
                        pose: pose,
                        weapGeom: wGeom,
                        w: 1.8, h: 1.9, l: 2.0
                    });
                }
            }

            // Map each faction + soldier slot (1..7) to its authentic PR kit role, defaulting to rifleman:
            // 1: Squad Leader, 2: Grenadier, 3: Rifleman, 4: Automatic Rifleman, 5: Breacher, 6: Medic/Corpsman, 7: Anti-Tank
            const slotRoles = {
                "1": ["officer", "sl"],
                "2": ["assault", "grenadier"],
                "3": ["rifleman"],
                "4": ["support", "ar", "mg"],
                "5": ["specialist", "breacher", "engineer"],
                "6": ["medic", "corpsman"],
                "7": ["riflemanat", "at", "hat"]
            };
            const findFactionKit = (fac, roleCandidates) => {
                if (!sdb.kitMap) return null;
                const keys = Object.keys(sdb.kitMap);
                const pickByRole = (role) => {
                    const exact = `${fac}_${role}`;
                    if (sdb.kitMap[exact] && sdb.kitMap[exact][0]) return sdb.kitMap[exact];
                    const alt = `${fac}_${role}_alt`;
                    if (sdb.kitMap[alt] && sdb.kitMap[alt][0]) return sdb.kitMap[alt];
                    const pref = `${fac}_${role}`;
                    for (let i = 0; i < keys.length; i++) {
                        const k = keys[i];
                        if ((k === pref || k.startsWith(pref + "_")) && sdb.kitMap[k] && sdb.kitMap[k][0]) {
                            return sdb.kitMap[k];
                        }
                    }
                    return null;
                };
                for (let r = 0; r < roleCandidates.length; r++) {
                    const hit = pickByRole(roleCandidates[r]);
                    if (hit) return hit;
                }
                const rif = pickByRole("rifleman");
                if (rif) return rif;
                for (let i = 0; i < keys.length; i++) {
                    if (keys[i].startsWith(fac + "_") && sdb.kitMap[keys[i]] && sdb.kitMap[keys[i]][0]) {
                        return sdb.kitMap[keys[i]];
                    }
                }
                return null;
            };
            const toKitRec = (kArr) => kArr
                ? { kitPair: kArr[0], weap: kArr[1], grip: (sdb.grips && sdb.grips[kArr[2]]) || "rifle" }
                : { kitPair: null, weap: "usrif_m4", grip: "rifle" };

            for (const bName of Object.keys(sdb.bodies || {}).sort()) {
                const m = /^pr_([a-z0-9]+)_soldier(\d*)/i.exec(bName);
                const fac = m ? m[1] : "us";
                const slotNum = (m && m[2]) ? m[2] : "3";
                const roles = slotRoles[slotNum] || ["rifleman"];
                const kArr = findFactionKit(fac, roles) || findFactionKit("us", roles);
                const fk = toKitRec(kArr);
                soldierList.push({
                    kind: "modular_pose_ref",
                    key: bName,
                    label: bName.replace(/^pr_/, ""),
                    bodyName: bName,
                    kitPair: fk.kitPair,
                    grip: fk.grip || "rifle",
                    pose: "stand",
                    weapGeom: fk.weap,
                    w: 1.8, h: 1.9, l: 2.0
                });
            }
        }
        layoutGridSector("soldiers", 120, 260, soldierList, 16, 3.2, 4.0);

        // 3. Wing 5: Complete 361 Weapons Armory (w_*)
        const weaponList = [];
        if (sdb && sdb.weapons) {
            for (const wName of Object.keys(sdb.weapons).sort()) {
                const wl = wName.toLowerCase();
                let bestGrip = "rifle";
                if (wl.includes("pis_") || wl.includes("pistol")) bestGrip = "pistol";
                else if (wl.includes("lmg_") || wl.includes("saw") || wl.includes("pkm") || wl.includes("mg")) bestGrip = "lmg";
                else if (wl.includes("lat_") || wl.includes("hat_") || wl.includes("rpg") || wl.includes("sraw") || wl.includes("aa_") || wl.includes("igla") || wl.includes("stinger")) bestGrip = "launcher";
                else if (wl.includes("hgr_") || wl.includes("grenade") || wl.includes("m67") || wl.includes("m83")) bestGrip = "grenade";
                else if (wl.includes("spaten") || wl.includes("shovel") || wl.includes("entrench")) bestGrip = "shovel";
                else if (wl.includes("medikit") || wl.includes("epipen") || wl.includes("mine") || wl.includes("c4") || wl.includes("ied") || wl.includes("ammokit") || wl.includes("claymore")) bestGrip = "item_hold";
                weaponList.push({
                    kind: "modular_weapon",
                    key: `w_${wName}`,
                    weapGeom: wName,
                    grip: bestGrip,
                    label: wName,
                    w: 1.6, h: 1.2, l: 1.8
                });
            }
        }
        layoutGridSector("weapons", -160, 260, weaponList, 20, 2.8, 3.4);

        museumState.wingCenters["all"] = museumState.wingCenters["ground"];
        museumState.items = items;
        museumState.built = true;
    }

    // =========================================================================
    // 5. Camera Aiming & Teleportation Utility
    // =========================================================================
    function aim3DCameraAt(camX, camY, camZ_webgl, lookWorldX, lookWorldY, lookWorldZ) {
        if (typeof setViewportMode === "function" && typeof VIEWPORT_3D_FREE !== "undefined") {
            if (typeof viewportMode === "undefined" || viewportMode !== VIEWPORT_3D_FREE) {
                setViewportMode(VIEWPORT_3D_FREE, false);
            }
        }
        if (typeof options_FirstPersonView !== "undefined" && options_FirstPersonView && typeof toggleFirstPersonView === "function") {
            toggleFirstPersonView(false);
        }
        if (typeof options_CameraTracking !== "undefined" && options_CameraTracking && typeof changeSetting === "function") {
            changeSetting("options_CameraTracking", false);
        }
        if (typeof renderer3d === "undefined" || !renderer3d) return;

        renderer3d.isTopDown = false;
        renderer3d.cameraPos[0] = camX;
        renderer3d.cameraPos[1] = camY;
        renderer3d.cameraPos[2] = camZ_webgl;

        // Convert lookAt game coordinate (X, Y, Z) -> WebGL coordinate (X, Y, -Z)
        const tx = lookWorldX - camX;
        const ty = lookWorldY - camY;
        const tz = (-lookWorldZ) - camZ_webgl;
        const len = Math.hypot(tx, ty, tz) || 1.0;
        const ux = tx / len, uy = ty / len, uz = tz / len;

        // Solve exact renderer3d.cameraYaw & cameraPitch to maximize dot(getCameraForward, u)
        let bestDot = -2.0, bestYaw = 0, bestPitch = 0;
        for (let yaw = 0; yaw < 360; yaw += 6) {
            for (let pitch = -65; pitch <= 45; pitch += 6) {
                renderer3d.cameraYaw = yaw;
                renderer3d.cameraPitch = pitch;
                const f = renderer3d.getCameraForward(renderer3d.getCameraQuat());
                const dot = f[0] * ux + f[1] * uy + f[2] * uz;
                if (dot > bestDot) { bestDot = dot; bestYaw = yaw; bestPitch = pitch; }
            }
        }
        for (let yaw = bestYaw - 6; yaw <= bestYaw + 6; yaw += 0.5) {
            for (let pitch = bestPitch - 6; pitch <= bestPitch + 6; pitch += 0.5) {
                renderer3d.cameraYaw = yaw;
                renderer3d.cameraPitch = pitch;
                const f = renderer3d.getCameraForward(renderer3d.getCameraQuat());
                const dot = f[0] * ux + f[1] * uy + f[2] * uz;
                if (dot > bestDot) { bestDot = dot; bestYaw = yaw; bestPitch = pitch; }
            }
        }
        renderer3d.cameraYaw = (bestYaw + 360) % 360;
        renderer3d.cameraPitch = Math.max(-85, Math.min(85, bestPitch));

        // Also center 2D map on same target
        if (typeof setCanvasCenterWithZoom === "function") {
            try { setCanvasCenterWithZoom(lookWorldX, lookWorldZ, 3.5); } catch (e) {}
        }
        if (typeof requestUpdate === "function") requestUpdate();
    }

    function teleportToMuseumItem(item) {
        if (!item) return;
        const span = Math.max(2.2, Math.max(item.w || 2, item.h || 2, item.l || 2));
        const dist = Math.max(2.6, span * 1.35);
        const targetY = item.y + Math.min(8.0, Math.max(0.85, (item.h || 1.8) * 0.45));
        const camX = item.x + dist * 0.55;
        const camY = targetY + Math.max(0.55, span * 0.28);
        const camWebglZ = (-item.z) + dist * 0.85;
        aim3DCameraAt(camX, camY, camWebglZ, item.x, targetY, item.z);
    }

    // =========================================================================
    // 6. Lab 3: Isolated Static Structures Museum Builder (deagle5, Y = 85m)
    // =========================================================================
    async function rebuildStructuresMuseumPage(teleportCam = false) {
        const st = window.debugLabState;
        if (!st || st.mode !== "structures") return;
        if (st.loadingStructPage) {
            st._pendingStructRebuild = true;
            st._pendingStructTeleport = st._pendingStructTeleport || teleportCam;
            return;
        }
        const catDb = window.DEBUG_CATALOG_DB;
        if (!catDb || !catDb.statics) return;

        const q = (structMuseumState.searchQuery || "").trim().toLowerCase();
        const catF = structMuseumState.catFilter;
        const mapF = structMuseumState.mapFilter;

        let filtered = [];
        for (let i = 0; i < catDb.statics.length; i++) {
            const s = catDb.statics[i]; // [tpl, mapIdx, scat, w, h, l, minY, hasTex]
            const mapName = catDb.staticMaps[s[1]] || "";
            if (catF !== "all" && String(s[2]) !== catF) continue;
            if (mapF && mapName !== mapF) continue;
            if (q && !s[0].toLowerCase().includes(q) && !mapName.toLowerCase().includes(q)) continue;
            filtered.push({
                tpl: s[0],
                mapKey: mapName,
                scat: s[2],
                w: s[3],
                h: s[4],
                l: s[5],
                minY: s[6],
                hasTex: !!s[7]
            });
        }

        // When browsing "Todos los Mapas", interleave round-robin across maps so page 1 shows
        // diverse structures from all 85 maps instead of only Adak (alphabetically first)!
        if (!mapF && filtered.length > 1) {
            const byMap = new Map();
            for (let i = 0; i < filtered.length; i++) {
                const it = filtered[i];
                let arr = byMap.get(it.mapKey);
                if (!arr) { arr = []; byMap.set(it.mapKey, arr); }
                arr.push(it);
            }
            const buckets = Array.from(byMap.values());
            const interleaved = [];
            let idx = 0;
            let added = true;
            while (added) {
                added = false;
                for (let b = 0; b < buckets.length; b++) {
                    if (idx < buckets[b].length) {
                        interleaved.push(buckets[b][idx]);
                        added = true;
                    }
                }
                idx++;
            }
            filtered = interleaved;
        }

        structMuseumState.totalFiltered = filtered.length;
        const maxPage = Math.max(0, Math.ceil(filtered.length / structMuseumState.pageSize) - 1);
        if (structMuseumState.page > maxPage) structMuseumState.page = maxPage;
        if (structMuseumState.page < 0) structMuseumState.page = 0;

        const start = structMuseumState.page * structMuseumState.pageSize;
        const slice = filtered.slice(start, start + structMuseumState.pageSize);

        st.loadingStructPage = true;
        updateDebugPanelStatus();

        // Fetch required <mapKey>_mesh3d.json files (cached)
        const neededMaps = [...new Set(slice.map(x => x.mapKey))];
        await Promise.all(neededMaps.map(async (mk) => {
            if (structMuseumState.meshDbCache[mk]) return;
            try {
                const res = await fetch(`MapsStaticobjects/${mk}/${mk}_mesh3d.json?v=2.6_vstart_fix`);
                if (res.ok) {
                    structMuseumState.meshDbCache[mk] = await res.json();
                } else {
                    structMuseumState.meshDbCache[mk] = {};
                }
            } catch (e) {
                structMuseumState.meshDbCache[mk] = {};
            }
        }));

        // Lay out structures floating at SKY_Y = 85m above deagle5
        const SKY_Y = 85.0;
        const cols = 8;
        let col = 0;
        let curX = -180;
        let curZ = 140;
        let rowMaxDepth = 0;
        const obbs = [];
        const laidOut = [];
        const mergedMeshDb = {};

        for (let i = 0; i < slice.length; i++) {
            const it = slice[i];
            const mdb = structMuseumState.meshDbCache[it.mapKey] || {};
            const mesh3d = mdb[it.tpl] || null;
            if (mesh3d) mergedMeshDb[it.tpl] = mesh3d;

            const spanX = Math.min(68, Math.max(8.0, it.w + 7.0));
            const spanZ = Math.min(68, Math.max(10.0, it.l + 9.0));
            if (col > 0 && col >= cols) {
                col = 0;
                curX = -180;
                curZ -= (rowMaxDepth + 10.0);
                rowMaxDepth = 0;
            }
            const x = curX + spanX * 0.5;
            const z = curZ;
            const baseY = SKY_Y - (it.minY < 0 ? it.minY : 0);

            curX += spanX;
            if (spanZ > rowMaxDepth) rowMaxDepth = spanZ;
            col++;

            const itemObj = {
                kind: "static_struct",
                key: it.tpl,
                label: `${it.tpl} (${it.mapKey})`,
                mapKey: it.mapKey,
                x, y: SKY_Y, z,
                w: it.w, h: it.h, l: it.l
            };
            laidOut.push(itemObj);

            obbs.push({
                name: it.tpl,
                template: it.tpl,
                x: x,
                y: baseY,
                z: z,
                yaw: 0,
                pitch: 0,
                roll: 0,
                scaleX: 1.0,
                scaleZ: 1.0,
                width: it.w,
                length: it.l,
                height: it.h,
                realWidth: it.w,
                realLength: it.l,
                minY: SKY_Y,
                maxY: SKY_Y + it.h,
                bounds3d: mesh3d ? mesh3d.b : [-it.w * 0.5, 0, -it.l * 0.5, it.w * 0.5, it.h, it.l * 0.5],
                mesh3d: mesh3d,
                isCustom: false,
                hidden: false,
                ignoreLOS: false
            });
        }

        structMuseumState.currentItems = laidOut;

        if (typeof buildingHeightmap !== "undefined" && buildingHeightmap) {
            // If filtering by a single map, set _mapKey to that map so Building3dRenderer streams 100% real textures!
            const activeMapForTex = (mapF && neededMaps.length === 1) ? mapF : (neededMaps.length === 1 ? neededMaps[0] : "museum_mixed");
            buildingHeightmap._mapKey = activeMapForTex;
            buildingHeightmap.mesh3dDb = mergedMeshDb;
            buildingHeightmap.obbs = obbs;
            buildingHeightmap.initialized = true;

            if (typeof building3dRenderer !== "undefined" && building3dRenderer) {
                building3dRenderer.currentMap = null; // Force clean buffer rebuild
                if (building3dRenderer.initialized) {
                    building3dRenderer.rebuildBuffers();
                    if (activeMapForTex !== "museum_mixed" && (options_StructureTextures || options_TreeTextures || options_BushTextures)) {
                        building3dRenderer._ensureStructureTexturesLoaded(activeMapForTex);
                    }
                }
            }
        }

        st.loadingStructPage = false;
        if (st._pendingStructRebuild) {
            const doTp = !!st._pendingStructTeleport;
            st._pendingStructRebuild = false;
            st._pendingStructTeleport = false;
            rebuildStructuresMuseumPage(doTp);
            return;
        }
        renderDebugItemResults();
        updateDebugPanelStatus();

        if (teleportCam) {
            if (laidOut.length > 0) {
                teleportToMuseumItem(laidOut[0]);
            } else {
                aim3DCameraAt(-160, 105, -175, -120, 88, 110);
            }
        } else if (typeof requestUpdate === "function") {
            requestUpdate();
        }
    }

    // =========================================================================
    // 7. 3D Rendering & 3D HUD Hooks (Called by entities3d.js & hud3d.js)
    // =========================================================================
    function getFilteredAssetMuseumItems() {
        buildAssetMuseumCatalog();
        const wing = museumState.activeWing;
        const q = (museumState.searchQuery || "").trim().toLowerCase();
        const tf = museumState.texFilter || "all";
        const out = [];
        for (let i = 0; i < museumState.items.length; i++) {
            const it = museumState.items[i];
            if (wing !== "all" && it.wing !== wing) continue;
            if (tf === "missing" && (it.kind !== "entity_mesh" || it.hasTex)) continue;
            if (tf === "textured" && it.kind === "entity_mesh" && !it.hasTex) continue;
            if (q && !it.key.toLowerCase().includes(q) && !it.label.toLowerCase().includes(q)) continue;
            out.push(it);
        }
        return out;
    }

    function getAuditReport(wingId) {
        buildAssetMuseumCatalog();
        const wing = wingId || museumState.activeWing || "all";
        const items = museumState.items.filter(it => it.kind === "entity_mesh" && (wing === "all" || it.wing === wing));
        const missingTex = [];
        const tallOrOversized = [];
        const tinyOrEmpty = [];
        for (const it of items) {
            if (!it.hasTex && !it.key.startsWith("proj_")) missingTex.push(it.key);
            if (it.h > 6.5 && it.wing === "deployables") tallOrOversized.push({ key: it.key, size: `${it.w}x${it.h}x${it.l}` });
            if (it.w < 0.05 && it.h < 0.05 && it.l < 0.05) tinyOrEmpty.push(it.key);
        }
        return {
            wing,
            total: items.length,
            withTex: items.filter(it => it.hasTex).length,
            missingTexCount: missingTex.length,
            missingTex,
            tallOrOversized,
            tinyOrEmpty
        };
    }

    function draw3DEntities(entRenderer, viewMatrix, projectionMatrix) {
        const st = window.debugLabState;
        if (!st || !st.active || st.mode !== "museum") return;

        buildAssetMuseumCatalog();
        const cam = (typeof renderer3d !== "undefined" && renderer3d) ? renderer3d.cameraPos : [0, 100, 0];
        const camGameX = cam[0];
        const camGameY = cam[1];
        const camGameZ = -cam[2];

        const wing = museumState.activeWing;
        const q = (museumState.searchQuery || "").trim().toLowerCase();
        const streamRadiusSq = 260 * 260; // Stream GPU assets within 260m of camera so 913+361 models never choke HTTP!
        const renderRadiusSq = 520 * 520;
        const sdb = (typeof SOLDIER_LOADOUT_DB !== "undefined") ? SOLDIER_LOADOUT_DB : null;
        const wantTex = (typeof options_FactionTextures !== "undefined") ? !!options_FactionTextures : true;

        for (let i = 0; i < museumState.items.length; i++) {
            const it = museumState.items[i];
            if (wing !== "all" && it.wing !== wing) continue;
            if (q && !it.key.toLowerCase().includes(q) && !it.label.toLowerCase().includes(q)) continue;

            const dx = it.x - camGameX;
            const dy = it.y - camGameY;
            const dz = it.z - camGameZ;
            const dSq = dx * dx + dy * dy + dz * dz;
            if (dSq > renderRadiusSq) continue;
            const allowStream = (dSq <= streamRadiusSq);

            if (it.kind === "entity_mesh") {
                const gpuMesh = entRenderer.gpuMeshCache[it.key];
                if (!gpuMesh) {
                    if (allowStream && entRenderer.pendingFetches.size < 8) {
                        entRenderer.fetchModelAsync(it.key);
                    }
                    continue;
                }
                if (gpuMesh.isNullMesh) continue;
                const lift = (typeof gpuMesh.groundOffset === "number") ? gpuMesh.groundOffset : 0.0;
                const mMat = mat4.create();
                mat4.translate(mMat, mMat, [it.x, it.y + lift, -it.z]);
                entRenderer.renderSingleMesh(gpuMesh, mMat, viewMatrix, projectionMatrix, entRenderer.colorTeam2, false, 0.0, true, false, false);
            } else if (it.kind === "modular_pose_ref" && sdb) {
                const bodyEntry = sdb.bodies && sdb.bodies[it.bodyName];
                if (!bodyEntry) continue;
                const bodyKey = `b_${bodyEntry.g}_${it.grip}_${it.pose}`;
                const bodyMesh = entRenderer.modularMeshCache[bodyKey];
                if (!bodyMesh) {
                    if (allowStream) entRenderer.fetchModularMeshAsync(bodyKey, false);
                    continue;
                }
                const mMat = mat4.create();
                mat4.translate(mMat, mMat, [it.x, it.y, -it.z]);

                const bTex = wantTex ? entRenderer._getOrLoadModularTex(bodyEntry.t, bodyEntry.w || 0) : null;
                entRenderer.renderSingleMesh(bodyMesh, mMat, viewMatrix, projectionMatrix, entRenderer.colorTeam2, false, 0.0, true, false, false, bTex);

                if (it.kitPair && sdb.kits && sdb.kits[it.kitPair]) {
                    const ke = sdb.kits[it.kitPair];
                    const kitKey = `k_${ke.g}_${it.pose}`;
                    const kitMesh = entRenderer.modularMeshCache[kitKey];
                    if (kitMesh) {
                        const kTex = wantTex ? entRenderer._getOrLoadModularTex(ke.t, ke.w || 0) : null;
                        entRenderer.renderSingleMesh(kitMesh, mMat, viewMatrix, projectionMatrix, entRenderer.colorTeam2, false, 0.0, true, false, false, kTex);
                    } else if (allowStream) {
                        entRenderer.fetchModularMeshAsync(kitKey, false);
                    }
                }

                if (it.weapGeom && sdb.weapons && sdb.weapons[it.weapGeom] && sdb.weaponMats && sdb.weaponMats[it.grip] && sdb.weaponMats[it.grip][it.pose]) {
                    const we = sdb.weapons[it.weapGeom];
                    const wKey = `w_${it.weapGeom}`;
                    const wMesh = entRenderer.modularMeshCache[wKey];
                    if (wMesh) {
                        const wMat = mat4.create();
                        mat4.multiply(wMat, mMat, sdb.weaponMats[it.grip][it.pose]);
                        const wTex = wantTex ? entRenderer._getOrLoadModularTex(we.t, we.w || 0) : null;
                        entRenderer.renderSingleMesh(wMesh, wMat, viewMatrix, projectionMatrix, entRenderer.colorTeam2, false, 0.0, true, false, false, wTex);
                    } else if (allowStream) {
                        entRenderer.fetchModularMeshAsync(wKey, false);
                    }
                }
            } else if (it.kind === "modular_weapon" && sdb && sdb.weapons && sdb.weapons[it.weapGeom]) {
                const we = sdb.weapons[it.weapGeom];
                const wKey = `w_${it.weapGeom}`;
                const wMesh = entRenderer.modularMeshCache[wKey];
                if (!wMesh) {
                    if (allowStream) entRenderer.fetchModularMeshAsync(wKey, false);
                    continue;
                }
                if (museumState.weaponHoldMode) {
                    const pose = museumState.weaponHoldPose || "stand";
                    const bodyEntry = sdb.bodies["pr_us_soldier2"];
                    const grip = (sdb.weaponMats[it.grip] && sdb.weaponMats[it.grip][pose]) ? it.grip : "rifle";
                    const bKey = `b_${bodyEntry.g}_${grip}_${pose}`;
                    const bMesh = entRenderer.modularMeshCache[bKey];
                    const mMat = mat4.create();
                    mat4.translate(mMat, mMat, [it.x, it.y, -it.z]);
                    if (bMesh) {
                        const bTex = wantTex ? entRenderer._getOrLoadModularTex(bodyEntry.t, bodyEntry.w || 0) : null;
                        entRenderer.renderSingleMesh(bMesh, mMat, viewMatrix, projectionMatrix, entRenderer.colorTeam2, false, 0.0, true, false, false, bTex);
                        if (sdb.weaponMats[grip] && sdb.weaponMats[grip][pose]) {
                            const wMat = mat4.create();
                            mat4.multiply(wMat, mMat, sdb.weaponMats[grip][pose]);
                            const wTex = wantTex ? entRenderer._getOrLoadModularTex(we.t, we.w || 0) : null;
                            entRenderer.renderSingleMesh(wMesh, wMat, viewMatrix, projectionMatrix, entRenderer.colorTeam2, false, 0.0, true, false, false, wTex);
                        }
                    } else if (allowStream) {
                        entRenderer.fetchModularMeshAsync(bKey, false);
                    }
                } else {
                    const mMat = mat4.create();
                    mat4.translate(mMat, mMat, [it.x, it.y + 1.25, -it.z]);
                    mat4.scale(mMat, mMat, [1.8, 1.8, 1.8]);
                    const wTex = wantTex ? entRenderer._getOrLoadModularTex(we.t, we.w || 0) : null;
                    entRenderer.renderSingleMesh(wMesh, mMat, viewMatrix, projectionMatrix, entRenderer.colorTeam2, false, 0.0, true, false, false, wTex);
                }
            }
        }
    }

    function draw3DHud(hudInstance, ctx) {
        const st = window.debugLabState;
        if (!st || !st.active || !ctx || !hudInstance) return;

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (st.mode === "mechanics") {
            // Draw clean floating station banners above all 10 Mechanics Proving Ground stations
            ctx.font = "bold 11px monospace";
            for (const s of MECHANICS_STATIONS) {
                const proj = hudInstance.worldToScreen(s.worldX, s.worldY + 5.2, s.worldZ);
                if (!proj || proj.dist > 340) continue;
                const text = `[ESTACION ${s.num}] ${s.title.substring(s.title.indexOf(" ") + 1)}`;
                const tw = Math.ceil(ctx.measureText(text).width) + 14;
                const bx = Math.round(proj.x - tw * 0.5);
                const by = Math.round(proj.y - 10);
                ctx.fillStyle = "rgba(14, 24, 24, 0.86)";
                ctx.fillRect(bx, by, tw, 20);
                ctx.strokeStyle = "rgba(97, 175, 239, 0.78)";
                ctx.lineWidth = 1;
                ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 19);
                ctx.fillStyle = "#e6f4f1";
                ctx.fillText(text, Math.round(proj.x), by + 10.5);
            }
        } else if (st.mode === "museum" || st.mode === "structures") {
            const list = (st.mode === "museum") ? getFilteredAssetMuseumItems() : structMuseumState.currentItems;
            const maxLabelDist = (st.mode === "structures") ? 140 : 62;
            ctx.font = "bold 10px monospace";
            let drawn = 0;
            for (let i = 0; i < list.length; i++) {
                const it = list[i];
                const labelY = it.y + Math.min(18.0, (it.h || 2.0) + 1.1);
                const proj = hudInstance.worldToScreen(it.x, labelY, it.z);
                if (!proj || proj.dist > maxLabelDist) continue;
                const text = it.label;
                const tw = Math.ceil(ctx.measureText(text).width) + 10;
                const bx = Math.round(proj.x - tw * 0.5);
                const by = Math.round(proj.y - 8);
                ctx.fillStyle = "rgba(12, 18, 20, 0.82)";
                ctx.fillRect(bx, by, tw, 16);
                ctx.strokeStyle = "rgba(130, 170, 168, 0.55)";
                ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 15);
                ctx.fillStyle = "#dceceb";
                ctx.fillText(text, Math.round(proj.x), by + 8.5);
                drawn++;
                if (drawn > 85) break;
            }
        }
        ctx.restore();
    }

    // =========================================================================
    // 8. Mode Launchers & Export
    // =========================================================================
    window.debugLabState = {
        active: false,
        mode: null, // "mechanics" | "museum" | "structures"
        autoLoop: true,
        loopStartTick: 30,
        panelVisible: false,
        loadingStructPage: false
    };

    function clearDebugEnvironment() {
        window._debugHideMapStatics = false;
        window._debugForcedStances = null;
        window.debugLabState.active = false;
        window.debugLabState.mode = null;
        const reopenBtn = document.getElementById("debugLabReopenBtn");
        if (reopenBtn) reopenBtn.style.display = "none";
    }

    function launchMechanicsLab(initialStationNum = 1) {
        ensureDebugPanel();
        window.debugLabState.panelVisible = true;
        document.getElementById("debugLabPanel").style.display = "flex";
        const rb1 = document.getElementById("debugLabReopenBtn");
        if (rb1) rb1.style.display = "none";

        const built = buildMechanicsProvingGroundDemo();
        window._lastMechanicsDemoBuffer = built.buffer;
        window._debugHideMapStatics = true;
        window._debugForcedStances = built.forcedStances;
        window.debugLabState.active = true;
        window.debugLabState.mode = "mechanics";
        window.debugLabState.autoLoop = true;
        window.debugLabState.loopStartTick = built.loopStartTick;

        window._onDebugDemoLoaded = () => {
            if (typeof changeSetting === "function") {
                changeSetting("options_FactionTextures", true);
                changeSetting("options_PredictiveEquipment", true);
                changeSetting("options_Interpolation", true);
            }
            if (typeof setViewportMode === "function" && typeof VIEWPORT_3D_FREE !== "undefined") {
                setViewportMode(VIEWPORT_3D_FREE, false);
            }
            goTo(built.loopStartTick);
            if (typeof Start === "function") Start();
            jumpToMechanicsStation(initialStationNum || 1);
            renderDebugPanelBody();
        };

        if (typeof window.loadDemoFromArrayBuffer === "function") {
            window.loadDemoFromArrayBuffer(built.buffer, "debug_mechanics_proving_ground.PRdemo");
        }
    }

    function launchAssetMuseumLab(initialWing = "ground") {
        ensureDebugPanel();
        window.debugLabState.panelVisible = true;
        document.getElementById("debugLabPanel").style.display = "flex";
        const rb2 = document.getElementById("debugLabReopenBtn");
        if (rb2) rb2.style.display = "none";

        buildAssetMuseumCatalog();
        museumState.activeWing = initialWing || "ground";
        const buf = buildEmptyMuseumDemo("test_airfield", 4.0, "[PR 1.8.0.0] Debug Lab - 3D Asset Museum");

        window._debugHideMapStatics = true;
        window._debugForcedStances = null;
        window.debugLabState.active = true;
        window.debugLabState.mode = "museum";
        window.debugLabState.autoLoop = false;

        window._onDebugDemoLoaded = () => {
            if (typeof Stop === "function") Stop();
            if (typeof changeSetting === "function") {
                changeSetting("options_FactionTextures", true);
                changeSetting("options_3dFog", false);
            }
            if (typeof setViewportMode === "function" && typeof VIEWPORT_3D_FREE !== "undefined") {
                setViewportMode(VIEWPORT_3D_FREE, false);
            }
            selectAssetMuseumWing(museumState.activeWing, true);
            renderDebugPanelBody();
        };

        if (typeof window.loadDemoFromArrayBuffer === "function") {
            window.loadDemoFromArrayBuffer(buf, "debug_asset_museum.PRdemo");
        }
    }

    function launchStructuresMuseumLab(initialCat = "0", initialMap = "beirut") {
        ensureDebugPanel();
        window.debugLabState.panelVisible = true;
        document.getElementById("debugLabPanel").style.display = "flex";
        const rb3 = document.getElementById("debugLabReopenBtn");
        if (rb3) rb3.style.display = "none";

        structMuseumState.catFilter = initialCat || "0";
        structMuseumState.mapFilter = (initialMap !== undefined) ? initialMap : "beirut";
        structMuseumState.page = 0;

        const buf = buildEmptyMuseumDemo("deagle5", 0.5, "[PR 1.8.0.0] Debug Lab - 3D Structures Museum");

        window._debugHideMapStatics = true;
        window._debugForcedStances = null;
        window.debugLabState.active = true;
        window.debugLabState.mode = "structures";
        window.debugLabState.autoLoop = false;

        window._onDebugDemoLoaded = () => {
            if (typeof Stop === "function") Stop();
            if (typeof changeSetting === "function") {
                changeSetting("options_StructureColors", true);
                changeSetting("options_StructureTextures", true);
                changeSetting("options_TreeTextures", true);
                changeSetting("options_BushTextures", true);
                changeSetting("options_3dFog", false);
            }
            if (typeof setViewportMode === "function" && typeof VIEWPORT_3D_FREE !== "undefined") {
                setViewportMode(VIEWPORT_3D_FREE, false);
            }
            renderDebugPanelBody();
            rebuildStructuresMuseumPage(true);
        };

        if (typeof window.loadDemoFromArrayBuffer === "function") {
            window.loadDemoFromArrayBuffer(buf, "debug_structures_museum.PRdemo");
        }
    }

    function downloadMechanicsDemoFile() {
        const buf = window._lastMechanicsDemoBuffer || buildMechanicsProvingGroundDemo().buffer;
        const blob = new Blob([buf], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "debug_mechanics_proving_ground.PRdemo";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function jumpToMechanicsStation(stationNum) {
        const s = MECHANICS_STATIONS.find(x => x.num === Number(stationNum)) || MECHANICS_STATIONS[0];
        if (!s) return;
        aim3DCameraAt(s.camPos[0], s.camPos[1], s.camPos[2], s.lookAt[0], s.lookAt[1], s.lookAt[2]);
        const descEl = document.getElementById("dbgStationDesc");
        if (descEl) descEl.textContent = s.desc;
    }

    function selectAssetMuseumWing(wingId, moveCamera = true) {
        buildAssetMuseumCatalog();
        museumState.activeWing = wingId;
        const sel = document.getElementById("dbgWingSelect");
        if (sel && sel.value !== wingId) sel.value = wingId;
        const holdRow = document.getElementById("dbgWeapHoldRow");
        if (holdRow) holdRow.style.display = (wingId === "weapons") ? "flex" : "none";
        const c = museumState.wingCenters[wingId] || museumState.wingCenters["ground"];
        if (moveCamera && c) {
            aim3DCameraAt(c.camPos[0], c.camPos[1], c.camPos[2], c.lookAt[0], c.lookAt[1], c.lookAt[2]);
        }
        renderDebugItemResults();
        updateDebugPanelStatus();
        if (typeof requestUpdate === "function") requestUpdate();
    }

    async function auditCurrentWingMeshes() {
        if (typeof entities3dRenderer === "undefined" || !entities3dRenderer) return;
        const list = getFilteredAssetMuseumItems();
        museumState.auditStatus = `Auditando ${list.length} items...`;
        updateDebugPanelStatus();

        let ok = 0, failed = 0;
        const failedNames = [];
        const batchSize = 12;
        for (let i = 0; i < list.length; i += batchSize) {
            const batch = list.slice(i, i + batchSize);
            await Promise.all(batch.map(async (it) => {
                if (it.kind === "entity_mesh") {
                    await entities3dRenderer.fetchModelAsync(it.key);
                    if (entities3dRenderer.failedModels.has(it.key)) { failed++; failedNames.push(it.key); }
                    else ok++;
                } else if (it.kind === "modular_weapon") {
                    const url = `models_3d/modular/${it.key}.json`;
                    try {
                        const r = await fetch(url);
                        if (r.ok) ok++; else { failed++; failedNames.push(it.key); }
                    } catch { failed++; failedNames.push(it.key); }
                } else if (it.kind === "modular_pose_ref") {
                    const b = SOLDIER_LOADOUT_DB.bodies[it.bodyName];
                    const bKey = `b_${b.g}_${it.grip}_${it.pose}`;
                    try {
                        const r = await fetch(`models_3d/modular/${bKey}.json`);
                        if (r.ok) ok++; else { failed++; failedNames.push(bKey); }
                    } catch { failed++; failedNames.push(bKey); }
                }
            }));
            museumState.auditStatus = `Auditando ${Math.min(list.length, i + batchSize)}/${list.length} (OK: ${ok}, Fallos: ${failed})`;
            updateDebugPanelStatus();
        }
        museumState.auditStatus = `Auditoria completa: ${ok} OK, ${failed} fallos` + (failedNames.length ? ` [${failedNames.slice(0, 5).join(", ")}]` : "");
        updateDebugPanelStatus();
    }

    // =========================================================================
    // 9. Floating Developer Debug Panel UI (Ctrl + Alt + D)
    // =========================================================================
    function ensureDebugPanel() {
        let el = document.getElementById("debugLabPanel");
        if (el) return el;

        el = document.createElement("div");
        el.id = "debugLabPanel";
        el.style.display = "none";
        el.innerHTML = `
            <div class="dbglab-header">
                <span class="dbglab-title">DEBUG LAB [Ctrl+Alt+D]</span>
                <button type="button" class="dbglab-close" id="dbgBtnClose" title="Ocultar panel (Ctrl+Alt+D)">X</button>
            </div>
            <div class="dbglab-modes">
                <button type="button" id="dbgModeMechanics" class="dbglab-mode-btn">Lab 1: Mecanicas</button>
                <button type="button" id="dbgModeMuseum" class="dbglab-mode-btn">Lab 2: Museo Assets</button>
                <button type="button" id="dbgModeStructs" class="dbglab-mode-btn">Lab 3: Estructuras</button>
            </div>
            <div id="dbgLabBody" class="dbglab-body"></div>
            <div id="dbgLabStatus" class="dbglab-status">Seleccione un entorno de pruebas arriba.</div>
        `;
        document.body.appendChild(el);

        // Only block camera shortcuts while typing inside a text input/textarea; buttons/selects let WASD work!
        el.addEventListener("keydown", (ev) => {
            if (ev.ctrlKey && ev.altKey && (ev.key === "d" || ev.key === "D" || ev.code === "KeyD")) return;
            const tag = ev.target && ev.target.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA") {
                const tp = (ev.target.type || "").toLowerCase();
                if (tp !== "checkbox" && tp !== "button") {
                    ev.stopPropagation();
                }
            }
        });

        // Release focus after clicking any button or changing any select/checkbox so WASD never gets trapped
        el.addEventListener("click", (ev) => {
            const t = ev.target;
            if (t && (t.tagName === "BUTTON" || (t.tagName === "INPUT" && t.type === "checkbox"))) {
                t.blur();
            }
        });
        el.addEventListener("change", (ev) => {
            if (ev.target && (ev.target.tagName === "SELECT" || (ev.target.tagName === "INPUT" && ev.target.type === "checkbox"))) {
                ev.target.blur();
            }
        });

        // Small floating reopen button when Debug Lab is active and panel is closed
        let reopenBtn = document.getElementById("debugLabReopenBtn");
        if (!reopenBtn) {
            reopenBtn = document.createElement("button");
            reopenBtn.id = "debugLabReopenBtn";
            reopenBtn.type = "button";
            reopenBtn.textContent = "DEBUG LAB";
            reopenBtn.title = "Abrir panel Debug Lab (Ctrl+Alt+D)";
            reopenBtn.style.display = "none";
            reopenBtn.onclick = () => { reopenBtn.blur(); toggleDebugPanel(true); };
            document.body.appendChild(reopenBtn);
        }

        document.getElementById("dbgBtnClose").onclick = () => toggleDebugPanel(false);
        document.getElementById("dbgModeMechanics").onclick = () => launchMechanicsLab(1);
        document.getElementById("dbgModeMuseum").onclick = () => launchAssetMuseumLab("ground");
        document.getElementById("dbgModeStructs").onclick = () => launchStructuresMuseumLab("0", "beirut");

        renderDebugPanelBody();
        return el;
    }

    function updateDebugPanelStatus() {
        const statusEl = document.getElementById("dbgLabStatus");
        if (!statusEl) return;
        const st = window.debugLabState;
        if (!st.active) {
            statusEl.textContent = "Listo. Lab 1 y 2 usan test_airfield; Lab 3 usa deagle5 aislado.";
            return;
        }
        if (st.mode === "mechanics") {
            const tlCount = window.PlayerActionTimeline ? Object.values(window.PlayerActionTimeline).reduce((a, b) => a + b.length, 0) : 0;
            const vTracks = window.VehicleMotionTracks ? Object.keys(window.VehicleMotionTracks).length : 0;
            statusEl.textContent = `test_airfield | Loop continuo: ${st.autoLoop ? "ON" : "OFF"} | Segs Predictivos: ${tlCount} | Veh Tracks: ${vTracks}`;
        } else if (st.mode === "museum") {
            const vis = getFilteredAssetMuseumItems().length;
            statusEl.textContent = museumState.auditStatus || `test_airfield (Y=96m, 0 estructuras) | Mostrando ${vis} de ${museumState.items.length} assets`;
        } else if (st.mode === "structures") {
            if (st.loadingStructPage) {
                statusEl.textContent = "Cargando mallas estaticas del mapa...";
            } else {
                const pages = Math.max(1, Math.ceil(structMuseumState.totalFiltered / structMuseumState.pageSize));
                statusEl.textContent = `deagle5 (Y=85m, solo estructuras) | Pagina ${structMuseumState.page + 1}/${pages} (${structMuseumState.totalFiltered} plantillas)`;
            }
        }
    }

    function renderDebugItemResults() {
        const listEl = document.getElementById("dbgItemList");
        if (!listEl) return;
        const st = window.debugLabState;
        const items = (st.mode === "museum") ? getFilteredAssetMuseumItems() : structMuseumState.currentItems;
        const slice = items.slice(0, 120);
        listEl.innerHTML = "";
        for (const it of slice) {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "dbglab-item-row";
            row.textContent = it.label;
            row.onclick = () => teleportToMuseumItem(it);
            listEl.appendChild(row);
        }
    }

    function renderDebugPanelBody() {
        const body = document.getElementById("dbgLabBody");
        if (!body) return;
        const st = window.debugLabState;

        document.getElementById("dbgModeMechanics").classList.toggle("active", st.mode === "mechanics");
        document.getElementById("dbgModeMuseum").classList.toggle("active", st.mode === "museum");
        document.getElementById("dbgModeStructs").classList.toggle("active", st.mode === "structures");

        if (!st.active) {
            body.innerHTML = `
                <div class="dbglab-help">
                    <b>Lab 1 (Mecanicas):</b> Genera un .PRdemo binario real en bucle perpetuo sobre <code>test_airfield</code> con 10 estaciones sin obstaculos.<br><br>
                    <b>Lab 2 (Museo Assets):</b> Todos los vehiculos, aeronaves, desplegables, soldados/posturas y 361 armas flotando en <code>test_airfield</code>.<br><br>
                    <b>Lab 3 (Museo Estructuras):</b> Las 3,729 estructuras y arboles estaticos aislados en <code>deagle5</code>.
                </div>
            `;
            updateDebugPanelStatus();
            return;
        }

        if (st.mode === "mechanics") {
            body.innerHTML = `
                <div class="dbglab-section-label">Teletransporte a Estaciones (test_airfield):</div>
                <div class="dbglab-station-grid" id="dbgStationGrid"></div>
                <div id="dbgStationDesc" class="dbglab-desc">${MECHANICS_STATIONS[0].desc}</div>
                <div class="dbglab-row">
                    <label class="dbglab-chk"><input type="checkbox" id="dbgChkLoop" ${st.autoLoop ? "checked" : ""}> Bucle infinito automatico</label>
                    <button type="button" class="dbglab-action-btn" id="dbgBtnDownloadDemo">Guardar .PRdemo</button>
                </div>
            `;
            const grid = document.getElementById("dbgStationGrid");
            for (const s of MECHANICS_STATIONS) {
                const b = document.createElement("button");
                b.type = "button";
                b.className = "dbglab-stn-btn";
                b.textContent = s.title;
                b.onclick = () => jumpToMechanicsStation(s.num);
                grid.appendChild(b);
            }
            document.getElementById("dbgChkLoop").onchange = (ev) => {
                st.autoLoop = !!ev.target.checked;
                updateDebugPanelStatus();
            };
            document.getElementById("dbgBtnDownloadDemo").onclick = downloadMechanicsDemoFile;
        } else if (st.mode === "museum") {
            body.innerHTML = `
                <div class="dbglab-row">
                    <select id="dbgWingSelect" class="dbglab-select"></select>
                    <select id="dbgTexFilterSelect" class="dbglab-select" style="max-width:115px" title="Filtrar por estado de textura">
                        <option value="all">Textura: Todas</option>
                        <option value="missing">Sin Textura</option>
                        <option value="textured">Con Textura</option>
                    </select>
                    <button type="button" class="dbglab-action-btn" id="dbgBtnAudit">Auditar Sala</button>
                </div>
                <div class="dbglab-row" id="dbgWeapHoldRow" style="display:${museumState.activeWing === "weapons" ? "flex" : "none"}">
                    <label class="dbglab-chk"><input type="checkbox" id="dbgChkWeapHold" ${museumState.weaponHoldMode ? "checked" : ""}> En manos de soldado</label>
                    <select id="dbgWeapPoseSelect" class="dbglab-select" style="max-width:95px">
                        <option value="stand">stand</option>
                        <option value="crouch">crouch</option>
                        <option value="prone">prone</option>
                        <option value="sit">sit</option>
                    </select>
                </div>
                <input type="text" id="dbgSearchInput" class="dbglab-input" placeholder="Buscar modelo (ej: t90, merkava, rpg7, epipen)..." value="${museumState.searchQuery}">
                <div id="dbgItemList" class="dbglab-item-list"></div>
            `;
            const sel = document.getElementById("dbgWingSelect");
            for (const w of ASSET_WINGS) {
                const opt = document.createElement("option");
                opt.value = w.id;
                opt.textContent = w.label;
                if (w.id === museumState.activeWing) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.onchange = (ev) => {
                museumState.auditStatus = "";
                selectAssetMuseumWing(ev.target.value, true);
                renderDebugPanelBody();
            };
            const tfSel = document.getElementById("dbgTexFilterSelect");
            if (tfSel) {
                tfSel.value = museumState.texFilter || "all";
                tfSel.onchange = (ev) => {
                    museumState.texFilter = ev.target.value;
                    renderDebugItemResults();
                    updateDebugPanelStatus();
                    if (typeof requestUpdate === "function") requestUpdate();
                };
            }
            document.getElementById("dbgBtnAudit").onclick = auditCurrentWingMeshes;
            const poseSel = document.getElementById("dbgWeapPoseSelect");
            if (poseSel) {
                poseSel.value = museumState.weaponHoldPose;
                poseSel.onchange = (ev) => { museumState.weaponHoldPose = ev.target.value; if (typeof requestUpdate === "function") requestUpdate(); };
            }
            const holdChk = document.getElementById("dbgChkWeapHold");
            if (holdChk) {
                holdChk.onchange = (ev) => { museumState.weaponHoldMode = !!ev.target.checked; if (typeof requestUpdate === "function") requestUpdate(); };
            }
            const inp = document.getElementById("dbgSearchInput");
            inp.oninput = (ev) => {
                museumState.searchQuery = ev.target.value;
                renderDebugItemResults();
                updateDebugPanelStatus();
                if (typeof requestUpdate === "function") requestUpdate();
            };
            inp.onkeydown = (ev) => {
                if (ev.key === "Enter") {
                    const res = getFilteredAssetMuseumItems();
                    if (res.length > 0) teleportToMuseumItem(res[0]);
                    inp.blur();
                }
            };
            renderDebugItemResults();
        } else if (st.mode === "structures") {
            const catDb = window.DEBUG_CATALOG_DB || { staticMaps: [] };
            body.innerHTML = `
                <div class="dbglab-row">
                    <select id="dbgStructCatSelect" class="dbglab-select"></select>
                    <select id="dbgStructMapSelect" class="dbglab-select"></select>
                </div>
                <div class="dbglab-row">
                    <button type="button" class="dbglab-action-btn" id="dbgStructPrev">&lt; Pag Ant</button>
                    <button type="button" class="dbglab-action-btn" id="dbgStructNext">Pag Sig &gt;</button>
                </div>
                <input type="text" id="dbgStructSearch" class="dbglab-input" placeholder="Buscar estructura (ej: hangar, mosque, hesco, bridge)..." value="${structMuseumState.searchQuery}">
                <div id="dbgItemList" class="dbglab-item-list"></div>
            `;
            const cSel = document.getElementById("dbgStructCatSelect");
            for (const c of STRUCT_CATS) {
                const opt = document.createElement("option");
                opt.value = c.id;
                opt.textContent = c.label;
                if (c.id === structMuseumState.catFilter) opt.selected = true;
                cSel.appendChild(opt);
            }
            const mSel = document.getElementById("dbgStructMapSelect");
            const allOpt = document.createElement("option");
            allOpt.value = "";
            allOpt.textContent = "Todos los Mapas (86)";
            mSel.appendChild(allOpt);
            for (const mName of catDb.staticMaps) {
                const opt = document.createElement("option");
                opt.value = mName;
                opt.textContent = mName;
                if (mName === structMuseumState.mapFilter) opt.selected = true;
                mSel.appendChild(opt);
            }
            cSel.onchange = (ev) => { structMuseumState.catFilter = ev.target.value; structMuseumState.page = 0; rebuildStructuresMuseumPage(true); };
            mSel.onchange = (ev) => { structMuseumState.mapFilter = ev.target.value; structMuseumState.page = 0; rebuildStructuresMuseumPage(true); };
            document.getElementById("dbgStructPrev").onclick = () => { if (structMuseumState.page > 0) { structMuseumState.page--; rebuildStructuresMuseumPage(true); } };
            document.getElementById("dbgStructNext").onclick = () => { structMuseumState.page++; rebuildStructuresMuseumPage(true); };

            const sInp = document.getElementById("dbgStructSearch");
            sInp.oninput = (ev) => {
                structMuseumState.searchQuery = ev.target.value;
                structMuseumState.page = 0;
                rebuildStructuresMuseumPage(false);
            };
            sInp.onkeydown = (ev) => {
                if (ev.key === "Enter" && structMuseumState.currentItems.length > 0) {
                    teleportToMuseumItem(structMuseumState.currentItems[0]);
                    sInp.blur();
                }
            };
            renderDebugItemResults();
        }
        updateDebugPanelStatus();
    }

    function toggleDebugPanel(forceState) {
        const el = ensureDebugPanel();
        const next = (forceState !== undefined) ? !!forceState : (el.style.display === "none");
        window.debugLabState.panelVisible = next;
        el.style.display = next ? "flex" : "none";
        const reopenBtn = document.getElementById("debugLabReopenBtn");
        if (reopenBtn) {
            reopenBtn.style.display = (!next && window.debugLabState.active) ? "block" : "none";
        }
        if (next) renderDebugPanelBody();
        return next;
    }

    // Global Ctrl + Alt + D listener (works on landing page AND inside any loaded demo!)
    window.addEventListener("keydown", (ev) => {
        if (ev.ctrlKey && ev.altKey && (ev.key === "d" || ev.key === "D" || ev.code === "KeyD")) {
            ev.preventDefault();
            ev.stopPropagation();
            toggleDebugPanel();
        }
    }, true);

    window.DebugLab = {
        togglePanel: toggleDebugPanel,
        launchMechanics: launchMechanicsLab,
        launchAssetMuseum: launchAssetMuseumLab,
        launchStructuresMuseum: launchStructuresMuseumLab,
        jumpToStation: jumpToMechanicsStation,
        selectWing: selectAssetMuseumWing,
        teleportToItem: teleportToMuseumItem,
        auditWing: auditCurrentWingMeshes,
        getAuditReport,
        clearEnvironment: clearDebugEnvironment,
        draw3DEntities,
        draw3DHud,
        STATIONS: MECHANICS_STATIONS,
        museumState,
        structMuseumState
    };
})();
