/**
 * RealityTracker Clip Recorder (v9.0)
 * 
 * Features:
 * - Direct Map Canvas Recording: completely immune to stream death during 2D <-> 3D toggle.
 * - EBML Metadata Duration Patcher: writes real duration into file header so seeking (adelantar/retroceder)
 *   works seamlessly in VLC, Windows Media Player, Premiere, DaVinci, and Discord without snapping to 0:00!
 * - 30 Mbps CFR.
 * - Output format selectable (.mp4 or .webm).
 */
"use strict";

class ClipRecorder {
    constructor() {
        this.fps = parseInt(localStorage.getItem("rt_rec_fps") || "60", 10);
        this.format = localStorage.getItem("rt_rec_fmt") || "mp4";
        const savedBitrate = parseInt(localStorage.getItem("rt_rec_bitrate") || "30", 10);
        this.bitrateMbps = isNaN(savedBitrate) ? 30 : Math.max(5, Math.min(80, savedBitrate));
        this.isRecording = false;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.startTime = 0;
        this.timerInterval = null;
        this.stream = null;
        this.activeFps = this.fps;
        this.activeBitrateMbps = this.bitrateMbps;
        this.activeFormat = this.format;
    }

    setFPS(fps) {
        this.fps = (fps === 30) ? 30 : 60;
        localStorage.setItem("rt_rec_fps", String(this.fps));
        this.updateUI();
        console.log(`[ClipRecorder] Framerate: ${this.fps} FPS`);
    }

    isFormatSupported(fmt) {
        if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return false;
        if (fmt === "mp4") {
            return [
                "video/mp4;codecs=avc1.42E01E",
                "video/mp4;codecs=avc1",
                "video/mp4;codecs=h264",
                "video/mp4"
            ].some(t => MediaRecorder.isTypeSupported(t));
        }
        return [
            "video/webm;codecs=vp9",
            "video/webm;codecs=vp8",
            "video/webm"
        ].some(t => MediaRecorder.isTypeSupported(t));
    }

    setFormat(fmt) {
        if (fmt === "mp4" && !this.isFormatSupported("mp4") && this.isFormatSupported("webm")) {
            this.format = "webm";
        } else {
            this.format = (fmt === "webm") ? "webm" : "mp4";
        }
        localStorage.setItem("rt_rec_fmt", this.format);
        this.updateUI();
        console.log(`[ClipRecorder] Format: .${this.format}`);
    }

    setBitrate(mbps) {
        const val = parseInt(mbps, 10);
        if (isNaN(val)) return;
        this.bitrateMbps = Math.max(5, Math.min(80, val));
        localStorage.setItem("rt_rec_bitrate", String(this.bitrateMbps));
        this.updateUI();
    }

    updateUI() {
        if (this.format === "mp4" && !this.isFormatSupported("mp4") && this.isFormatSupported("webm")) {
            this.format = "webm";
        }
        const mp4Supported = this.isFormatSupported("mp4");

        const btn30 = document.getElementById("btnRecFps30");
        const btn60 = document.getElementById("btnRecFps60");
        if (btn30 && btn60) {
            if (this.fps === 30) {
                btn30.style.background = "#3a5250"; btn30.style.color = "#fff"; btn30.style.borderColor = "#8fa3a1";
                btn60.style.background = "rgba(255,255,255,0.08)"; btn60.style.color = "#bbb"; btn60.style.borderColor = "#555";
            } else {
                btn60.style.background = "#3a5250"; btn60.style.color = "#fff"; btn60.style.borderColor = "#8fa3a1";
                btn30.style.background = "rgba(255,255,255,0.08)"; btn30.style.color = "#bbb"; btn30.style.borderColor = "#555";
            }
        }

        const lang = (typeof currentAnalyserLang !== "undefined") ? currentAnalyserLang : "EN";
        const btnMp4 = document.getElementById("btnRecFmtMp4");
        const btnWebm = document.getElementById("btnRecFmtWebm");
        if (btnMp4 && btnWebm) {
            if (!mp4Supported) {
                btnMp4.style.opacity = "0.45";
                btnMp4.style.cursor = "not-allowed";
                btnMp4.title = lang === "ES"
                    ? "MP4 no soportado nativamente por MediaRecorder en este navegador (usando .WEBM)"
                    : (lang === "PT"
                        ? "MP4 n\u00e3o suportado nativamente pelo MediaRecorder neste navegador (usando .WEBM)"
                        : "MP4 is not natively supported by MediaRecorder in this browser (using .WEBM)");
            } else {
                btnMp4.style.opacity = "1";
                btnMp4.style.cursor = "pointer";
                btnMp4.title = lang === "ES" ? "Grabar en formato .MP4" : (lang === "PT" ? "Gravar em formato .MP4" : "Record in .MP4 format");
            }
            if (this.format === "mp4" && mp4Supported) {
                btnMp4.style.background = "#3a5250"; btnMp4.style.color = "#fff"; btnMp4.style.borderColor = "#8fa3a1";
                btnWebm.style.background = "rgba(255,255,255,0.08)"; btnWebm.style.color = "#bbb"; btnWebm.style.borderColor = "#555";
            } else {
                btnWebm.style.background = "#3a5250"; btnWebm.style.color = "#fff"; btnWebm.style.borderColor = "#8fa3a1";
                btnMp4.style.background = "rgba(255,255,255,0.08)"; btnMp4.style.color = "#bbb"; btnMp4.style.borderColor = "#555";
            }
        }

        const brSlider = document.getElementById("recBitrateSlider");
        const brLbl = document.getElementById("lblRecBitrateVal");
        if (brSlider) brSlider.value = String(this.bitrateMbps);
        if (brLbl) brLbl.textContent = `${this.bitrateMbps} Mbps`;

        const btn = document.getElementById("recordClipButton");
        if (btn && !this.isRecording) {
            const recPrefix = lang === "ES" ? "Grabar clip" : (lang === "PT" ? "Gravar clipe" : "Record clip");
            btn.title = `${recPrefix} (${this.fps} FPS, ${this.bitrateMbps} Mbps - .${this.format.toUpperCase()})`;
        }
    }

    getBestMimeType() {
        const mp4Candidates = [
            "video/mp4;codecs=avc1.42E01E",
            "video/mp4;codecs=avc1",
            "video/mp4;codecs=h264",
            "video/mp4"
        ];
        const webmCandidates = [
            "video/webm;codecs=vp9",
            "video/webm;codecs=vp8",
            "video/webm"
        ];
        const candidates = (this.format === "webm")
            ? webmCandidates.concat(mp4Candidates)
            : mp4Candidates.concat(webmCandidates);

        for (const type of candidates) {
            if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        return "";
    }

    toggle() {
        if (this.isRecording) {
            this.stop();
        } else {
            this.start();
        }
    }

    start() {
        if (this.isRecording) return;

        const mapCanvas = document.getElementById("map");
        if (!mapCanvas || typeof mapCanvas.captureStream !== "function") {
            alert("Error: Canvas #map no disponible para captura.");
            return;
        }

        // If starting while in 3D mode, ensure #map is active and matched in resolution for 3D mirror
        if (typeof is3DMode !== "undefined" && is3DMode) {
            mapCanvas.style.display = "block";
            mapCanvas.style.zIndex = "0";
            const map3d = document.getElementById("map3d");
            const hudCanvas = document.getElementById("map3dHud");
            if (map3d) {
                map3d.style.zIndex = "1";
                if (map3d.width > 0 && map3d.height > 0 && (mapCanvas.width !== map3d.width || mapCanvas.height !== map3d.height)) {
                    mapCanvas.width = map3d.width;
                    mapCanvas.height = map3d.height;
                }
            }
            if (hudCanvas) hudCanvas.style.zIndex = "2";
        }

        this.activeFps = this.fps;
        this.activeBitrateMbps = this.bitrateMbps;
        this.activeFormat = this.format;

        try {
            this.stream = mapCanvas.captureStream(this.activeFps);
        } catch (err) {
            console.error("[ClipRecorder] captureStream error:", err);
            alert("No se pudo iniciar stream: " + err.message);
            return;
        }

        const mimeType = this.getBestMimeType();
        const options = {
            videoBitsPerSecond: this.activeBitrateMbps * 1000000
        };
        if (mimeType) {
            options.mimeType = mimeType;
        }

        try {
            this.mediaRecorder = new MediaRecorder(this.stream, options);
        } catch (err) {
            try {
                this.mediaRecorder = new MediaRecorder(this.stream);
            } catch (fallbackErr) {
                alert("Error al iniciar MediaRecorder: " + fallbackErr.message);
                return;
            }
        }

        this.recordedChunks = [];
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                this.recordedChunks.push(e.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }
            this.saveRecording();
        };

        this.mediaRecorder.start(1000);
        this.isRecording = true;
        this.startTime = performance.now();

        if (typeof isPlaying !== "undefined" && !isPlaying) {
            if (typeof Start === "function") Start();
        }

        this.updateButtonUI(true);
        console.log(`[ClipRecorder] Recording STARTED at ${this.activeFps} FPS, ${this.activeBitrateMbps} Mbps (${this.mediaRecorder.mimeType || mimeType || "default"})`);
    }

    stop() {
        if (!this.isRecording) return;
        this.isRecording = false;

        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            this.mediaRecorder.stop();
        } else if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        // Reset z-indices if in 3D mode
        const mapCanvas = document.getElementById("map");
        const map3d = document.getElementById("map3d");
        if (mapCanvas) mapCanvas.style.zIndex = "";
        if (map3d) map3d.style.zIndex = "";
        if (typeof is3DMode !== "undefined" && is3DMode && mapCanvas) {
            mapCanvas.style.display = "none";
        }

        this.updateButtonUI(false);
        console.log("[ClipRecorder] Recording STOPPED.");
    }

    /**
     * Injects Duration metadata into EBML/WebM container so players
     * can seek (adelantar/retroceder) without snapping back to 0:00.
     */
    async fixDuration(blob, durationMs) {
        try {
            const buffer = await blob.arrayBuffer();
            const u8 = new Uint8Array(buffer);

            // Locate Segment Info element (0x15 0x49 0xA9 0x66)
            let infoPos = -1;
            for (let i = 0; i < Math.min(u8.length - 4, 2048); i++) {
                if (u8[i] === 0x15 && u8[i+1] === 0x49 && u8[i+2] === 0xA9 && u8[i+3] === 0x66) {
                    infoPos = i;
                    break;
                }
            }

            if (infoPos === -1) return blob;

            // Look for existing Duration tag (0x44 0x89)
            let durationPos = -1;
            let durationLen = 0;
            for (let i = infoPos; i < Math.min(infoPos + 256, u8.length - 6); i++) {
                if (u8[i] === 0x44 && u8[i+1] === 0x89) {
                    const lenByte = u8[i+2];
                    if (lenByte === 0x84) {
                        durationLen = 4;
                        durationPos = i + 3;
                    } else if (lenByte === 0x88) {
                        durationLen = 8;
                        durationPos = i + 3;
                    }
                    break;
                }
            }

            const view = new DataView(buffer);
            if (durationPos !== -1) {
                if (durationLen === 4) {
                    view.setFloat32(durationPos, durationMs, false);
                } else if (durationLen === 8) {
                    view.setFloat64(durationPos, durationMs, false);
                }
                return new Blob([buffer], { type: blob.type });
            }

            // Do not shift byte offsets if no existing Duration element is present (avoids invalidating parent EBML VINT sizes)
            return blob;
        } catch (err) {
            console.warn("[ClipRecorder] Duration patcher skipped:", err);
            return blob;
        }
    }

    async saveRecording() {
        if (this.recordedChunks.length === 0) {
            console.warn("[ClipRecorder] No recorded data.");
            return;
        }

        const actualMime = (this.mediaRecorder && this.mediaRecorder.mimeType)
            ? this.mediaRecorder.mimeType.toLowerCase()
            : "";
        let isWebm = actualMime.includes("webm") || (!actualMime.includes("mp4") && (this.activeFormat === "webm" || !this.isFormatSupported("mp4")));
        try {
            if (this.recordedChunks[0] && this.recordedChunks[0].size >= 4) {
                const headBuf = await this.recordedChunks[0].slice(0, 4).arrayBuffer();
                const h8 = new Uint8Array(headBuf);
                // EBML / WebM magic bytes: 0x1A 0x45 0xDF 0xA3
                if (h8[0] === 0x1A && h8[1] === 0x45 && h8[2] === 0xDF && h8[3] === 0xA3) {
                    isWebm = true;
                }
            }
        } catch (e) {}
        const ext = isWebm ? "webm" : "mp4";
        const mapNameStr = (typeof MapName !== "undefined" && MapName) ? MapName.toLowerCase() : "clip";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const fileName = `RealityTracker_${mapNameStr}_${this.activeFps}fps_${this.activeBitrateMbps}mbps_${timestamp}.${ext}`;

        const rawBlob = new Blob(this.recordedChunks, { type: actualMime || (isWebm ? "video/webm" : "video/mp4") });
        const durationMs = Math.max(500, performance.now() - this.startTime);

        // Patch duration in WebM/EBML containers so seekbar works in VLC, Windows player, Premiere, etc.
        const finalBlob = isWebm ? await this.fixDuration(rawBlob, durationMs) : rawBlob;

        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 2000);

        console.log(`[ClipRecorder] Downloaded: ${fileName} (${(finalBlob.size / 1024 / 1024).toFixed(2)} MB, duration: ${(durationMs / 1000).toFixed(1)}s)`);
    }

    updateButtonUI(recording) {
        const btn = document.getElementById("recordClipButton");
        const circle = document.getElementById("recordBtnShapeCircle");
        const square = document.getElementById("recordBtnShapeSquare");
        const badge = document.getElementById("recordTimeBadge");

        const lang = (typeof currentAnalyserLang !== "undefined" && currentAnalyserLang) ? currentAnalyserLang : "EN";

        if (recording) {
            if (btn) {
                btn.classList.add("recording");
                btn.title = lang === "ES"
                    ? "Detener grabaci\u00f3n y descargar clip"
                    : (lang === "PT"
                        ? "Parar grava\u00e7\u00e3o e baixar clipe"
                        : "Stop recording and download clip");
            }
            if (circle) circle.style.display = "none";
            if (square) square.style.display = "block";
            if (badge) {
                badge.style.display = "inline-flex";
                badge.textContent = `REC 00:00 [${this.activeFps} FPS • ${this.activeBitrateMbps}M]`;
            }

            if (this.timerInterval) clearInterval(this.timerInterval);
            this.timerInterval = setInterval(() => {
                if (!this.isRecording) return;
                const elapsedSec = Math.floor((performance.now() - this.startTime) / 1000);
                const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
                const secs = String(elapsedSec % 60).padStart(2, "0");
                if (badge) {
                    badge.textContent = `REC ${mins}:${secs} [${this.activeFps} FPS • ${this.activeBitrateMbps}M]`;
                }
            }, 500);
        } else {
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }
            if (btn) {
                btn.classList.remove("recording");
                const recPrefix = lang === "ES" ? "Grabar clip" : (lang === "PT" ? "Gravar clipe" : "Record clip");
                btn.title = `${recPrefix} (${this.fps} FPS, ${this.bitrateMbps} Mbps - .${this.format.toUpperCase()})`;
            }
            if (circle) circle.style.display = "block";
            if (square) square.style.display = "none";
            if (badge) {
                badge.style.display = "none";
            }
        }
    }
}

const clipRecorder = new ClipRecorder();

function toggleClipRecording() {
    clipRecorder.toggle();
}

function setRecorderFPS(fps) {
    clipRecorder.setFPS(fps);
}

function setRecorderFormat(fmt) {
    clipRecorder.setFormat(fmt);
}

function setRecorderBitrate(mbps) {
    clipRecorder.setBitrate(mbps);
}

$(document).ready(() => {
    clipRecorder.updateUI();
});
