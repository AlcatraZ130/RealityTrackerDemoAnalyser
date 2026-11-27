#!/usr/bin/env node
// Reusable 3D Asset Museum Visual Inspector & Contact-Sheet Generator
// Uses live RealityTracker Demo Analyser (?debug=museum) + headless Edge CDP.
// Usage:
//   node tools/museum_inspect.js --wing deployables --filter roadblock --out contact_roadblocks.png
//   node tools/museum_inspect.js --wing deployables --missing-tex --limit 16 --out contact_notex.png
//   node tools/museum_inspect.js --keys deployable_roadblock_l01,vehicle_deployable_roadblock_l01 --out sheet.png

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const EDGE_CANDIDATES = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
];

function parseArgs(argv) {
    const out = {
        url: "http://localhost:8000/",
        wing: "deployables",
        filter: "",
        keys: "",
        missingTex: false,
        auditJson: false,
        limit: 16,
        cols: 4,
        tileW: 360,
        tileH: 240,
        outPath: path.join(os.tmpdir(), "museum_contact_sheet.png"),
        port: 9240 + Math.floor(Math.random() * 40),
        hideLabels: true
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--wing") out.wing = argv[++i];
        else if (a === "--filter") out.filter = argv[++i];
        else if (a === "--keys") out.keys = argv[++i];
        else if (a === "--missing-tex") out.missingTex = true;
        else if (a === "--audit-json") out.auditJson = true;
        else if (a === "--limit") out.limit = parseInt(argv[++i], 10) || 16;
        else if (a === "--cols") out.cols = parseInt(argv[++i], 10) || 4;
        else if (a === "--out") out.outPath = argv[++i];
        else if (a === "--url") out.url = argv[++i];
        else if (a === "--port") out.port = parseInt(argv[++i], 10) || out.port;
    }
    return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const opts = parseArgs(process.argv);
    const edgeBin = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
    if (!edgeBin) throw new Error("Microsoft Edge not found in standard paths.");

    const profileDir = path.join(os.tmpdir(), `rt_museum_inspect_${opts.port}`);
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.mkdirSync(profileDir, { recursive: true });

    const startUrl = `${opts.url}?debug=museum&wing=${encodeURIComponent(opts.wing)}`;
    const proc = spawn(edgeBin, [
        "--headless=new",
        `--remote-debugging-port=${opts.port}`,
        `--user-data-dir=${profileDir}`,
        `--window-size=${opts.tileW * 2},${opts.tileH * 2}`,
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--no-first-run",
        "--no-default-browser-check",
        startUrl
    ], { stdio: "ignore" });

    let ws = null;
    try {
        let wsUrl = null;
        for (let i = 0; i < 40; i++) {
            try {
                const list = await (await fetch(`http://127.0.0.1:${opts.port}/json`)).json();
                const page = list.find((t) => t.type === "page" && (t.url.includes("localhost") || t.url.includes("127.0.0.1")));
                if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
            } catch {}
            await sleep(250);
        }
        if (!wsUrl) throw new Error("Failed to connect to Edge CDP on port " + opts.port);

        ws = new WebSocket(wsUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

        let nid = 1;
        const pend = new Map();
        ws.onmessage = (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id && pend.has(m.id)) {
                const { resolve, reject } = pend.get(m.id);
                pend.delete(m.id);
                if (m.error) reject(new Error(m.error.message));
                else resolve(m.result);
            }
        };
        const send = (method, params = {}) => {
            const id = nid++;
            ws.send(JSON.stringify({ id, method, params }));
            return new Promise((resolve, reject) => pend.set(id, { resolve, reject }));
        };
        const evalJS = async (expr) => {
            const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
            return r.result ? r.result.value : undefined;
        };

        await send("Runtime.enable");
        await send("Page.enable");

        for (let i = 0; i < 120; i++) {
            if (await evalJS("typeof loadingComplete !== 'undefined' && loadingComplete === true && window.DebugLab && window.debugLabState && window.debugLabState.mode === 'museum'")) break;
            await sleep(200);
        }

        if (opts.auditJson) {
            const report = await evalJS(`DebugLab.getAuditReport(${JSON.stringify(opts.wing)})`);
            console.log(JSON.stringify(report, null, 2));
            return;
        }

        // Hide debug panel & HUD overlays for clean contact-sheet framing
        await evalJS(`(() => {
            if (window.DebugLab) DebugLab.togglePanel(false);
            const rb = document.getElementById('debugLabReopenBtn'); if (rb) rb.style.display = 'none';
            const tb = document.getElementById('topBar'); if (tb) tb.style.display = 'none';
            const cb = document.getElementById('controlBarContainer'); if (cb) cb.style.display = 'none';
            const mn = document.getElementById('menuList'); if (mn) mn.style.display = 'none';
        })()`);

        // Select matching items from DebugLab.museumState.items
        const explicitKeys = opts.keys ? opts.keys.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
        const selected = await evalJS(`(() => {
            const items = DebugLab.museumState.items || [];
            const explicit = ${JSON.stringify(explicitKeys)};
            const wing = ${JSON.stringify(opts.wing)};
            const filt = ${JSON.stringify(opts.filter.toLowerCase())};
            const onlyNoTex = ${JSON.stringify(opts.missingTex)};
            const limit = ${opts.limit};
            let list;
            if (explicit.length > 0) {
                list = [];
                for (const k of explicit) {
                    const hit = items.find(it => it.key.toLowerCase() === k || it.label.toLowerCase() === k);
                    if (hit) list.push(hit);
                }
            } else {
                list = items.filter(it => {
                    if (wing && wing !== "all" && it.wing !== wing) return false;
                    if (onlyNoTex && it.hasTex) return false;
                    if (filt && !it.key.toLowerCase().includes(filt) && !it.label.toLowerCase().includes(filt)) return false;
                    return true;
                });
            }
            return list.slice(0, limit).map(it => ({
                key: it.key, label: it.label, wing: it.wing,
                w: it.w, h: it.h, l: it.l, hasTex: !!it.hasTex
            }));
        })()`);

        if (!selected || selected.length === 0) {
            console.log("No matching items found.");
            return;
        }
        console.log(`Snapshotting ${selected.length} items into contact sheet...`);

        const tiles = [];
        for (const meta of selected) {
            const info = await evalJS(`(async () => {
                const it = DebugLab.museumState.items.find(x => x.key === ${JSON.stringify(meta.key)});
                if (!it) return null;
                DebugLab.selectWing(it.wing, false);
                DebugLab.museumState.searchQuery = it.key;
                DebugLab.teleportToItem(it);
                if (it.kind === "entity_mesh" && typeof entities3dRenderer.fetchModelAsync === "function") {
                    await entities3dRenderer.fetchModelAsync(it.key);
                }
                renderer3d.draw();
                for (let i = 0; i < 40; i++) {
                    if (entities3dRenderer.pendingFetches.size === 0 && entities3dRenderer._modularActiveFetches === 0 && entities3dRenderer._modularFetchQueue.length === 0) break;
                    await new Promise(r => setTimeout(r, 80));
                }
                if (it.kind === "entity_mesh" && typeof entities3dRenderer.fetchModelTexAsync === "function") {
                    await entities3dRenderer.fetchModelTexAsync(it.key);
                }
                renderer3d.draw();
                for (let i = 0; i < 30; i++) {
                    if (entities3dRenderer.pendingTexFetches.size === 0 && Object.keys(entities3dRenderer.pendingTexPaths).length === 0) break;
                    await new Promise(r => setTimeout(r, 80));
                }
                renderer3d.draw();
                const gpu = entities3dRenderer.gpuMeshCache[it.key];
                return {
                    key: it.key,
                    texReady: !!(gpu && gpu.texReady),
                    verts: gpu ? (gpu.isMultiPart ? (gpu.hull.vertexCount + gpu.turret.vertexCount) : gpu.vertexCount) : 0,
                    failed: entities3dRenderer.failedModels.has(it.key),
                    failedTex: entities3dRenderer.failedTexModels.has(it.key)
                };
            })()`);
            const cap = await send("Page.captureScreenshot", { format: "png" });
            tiles.push({ meta, info, b64: cap.data });
            console.log(`  [${tiles.length}/${selected.length}] ${meta.key} | ${meta.w}x${meta.h}x${meta.l} | texReady=${info && info.texReady} | verts=${info && info.verts}`);
        }

        // Composite all tiles into ONE labeled PNG contact sheet using an offscreen Canvas inside Edge!
        const cols = Math.min(opts.cols, tiles.length);
        const rows = Math.ceil(tiles.length / cols);
        const sheetB64 = await evalJS(`(async () => {
            const tiles = ${JSON.stringify(tiles.map(t => ({
                b64: t.b64,
                title: t.meta.key,
                sub: `${t.meta.w}x${t.meta.h}x${t.meta.l}m | ${t.info && t.info.texReady ? "TEX" : "NO-TEX"} | v=${t.info ? t.info.verts : 0}`,
                texOk: !!(t.info && t.info.texReady)
            })))};
            const cols = ${cols}, rows = ${rows}, tw = ${opts.tileW}, th = ${opts.tileH};
            const c = document.createElement("canvas");
            c.width = cols * tw;
            c.height = rows * th;
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#111618";
            ctx.fillRect(0, 0, c.width, c.height);

            for (let i = 0; i < tiles.length; i++) {
                const t = tiles[i];
                const col = i % cols, row = Math.floor(i / cols);
                const x = col * tw, y = row * th;
                const img = await new Promise((resolve) => {
                    const im = new Image();
                    im.onload = () => resolve(im);
                    im.onerror = () => resolve(null);
                    im.src = "data:image/png;base64," + t.b64;
                });
                if (img) ctx.drawImage(img, x, y, tw, th);
                // Label banner at bottom of each tile
                ctx.fillStyle = "rgba(10, 14, 16, 0.86)";
                ctx.fillRect(x, y + th - 36, tw, 36);
                ctx.strokeStyle = t.texOk ? "#4fb87a" : "#e06c75";
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 1, y + 1, tw - 2, th - 2);
                ctx.font = "bold 11px monospace";
                ctx.fillStyle = "#ffffff";
                ctx.fillText(t.title, x + 8, y + th - 20);
                ctx.font = "10px monospace";
                ctx.fillStyle = t.texOk ? "#8ae3a8" : "#ff9999";
                ctx.fillText(t.sub, x + 8, y + th - 6);
            }
            return c.toDataURL("image/png").split(",")[1];
        })()`);

        fs.mkdirSync(path.dirname(path.resolve(opts.outPath)), { recursive: true });
        fs.writeFileSync(opts.outPath, Buffer.from(sheetB64, "base64"));
        console.log("Wrote contact sheet:", opts.outPath);
    } finally {
        if (ws) try { ws.close(); } catch {}
        try { proc.kill(); } catch {}
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
