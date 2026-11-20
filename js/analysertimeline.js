// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Vertical Multi-Lane Tactical Timeline Engine
// All event tracks start disabled by default until toggled on by the user.

var options_DrawTimeline = true;

class AnalyserTimeline {
	constructor() {
		this.kills = [];
		this.killKeys = new Set();

		this.ticketsHistory = [];
		this.flagEvents = [];
		this.fobEvents = [];
		this.cacheEvents = [];
		this.vehicleDestroyEvents = [];
		this.reviveEvents = [];
		this.kitEvents = [];
		this.playerSessions = [];

		// All event tracks OFF by default until the user activates them
		this.layers = {
			tickets: false,
			flags: false,
			fobs: false,
			caches: false,
			vehs: false,
			bookmarks: false,
			selected: false
		};

		this.zoomMode = "full"; // "full", "10m", "2m"
		this.viewStartTick = 0;
		this.viewEndTick = 1;

		this.loopStartTick = null;
		this.loopEndTick = null;
		this.loopEnabled = false;

		this.renderedEvents = [];
		this._eventsBound = false;
		this._lastRenderKey = null;
		this._isDraggingZoom = false;
		this._suppressNextMarkerClick = false;
		this._userPannedZoom = false;

		try {
			if (typeof localStorage !== "undefined") {
				const savedLayers = localStorage.getItem("rt_timeline_layers_v2");
				if (savedLayers) {
					const parsed = JSON.parse(savedLayers);
					if (parsed && typeof parsed === "object") {
						for (const k in this.layers) {
							if (k in parsed) this.layers[k] = !!parsed[k];
						}
					}
				}
			}
		} catch (e) {}
	}

	recordKill(kill) {
		if (!kill) return;
		const tick = kill.tick != null ? kill.tick : kill.Tick;
		const key = kill.index != null ? "i:" + kill.index : tick + ":" + kill.AttackerID + ":" + kill.VictimID;
		if (this.killKeys.has(key)) return;
		this.killKeys.add(key);
		this.kills.push({
			tick: tick,
			attackerId: kill.AttackerID,
			attackerName: kill.AttackerName || "",
			attackerTeam: kill.AttackerTeam || 0,
			attackerSquad: kill.AttackerSquad || 0,
			attackerX: kill.AttackerX,
			attackerZ: kill.AttackerY,
			victimId: kill.VictimID,
			victimName: kill.VictimName || "",
			victimTeam: kill.VictimTeam || 0,
			victimX: kill.VictimX,
			victimZ: kill.VictimY,
			weapon: kill.Weapon || "",
			distance: kill.Distance || 0,
			isTeamkill: !!kill.isTeamkill,
			rawKill: kill
		});
	}

	resetAnalysis() {
		this.kills.length = 0;
		this.killKeys.clear();
		this.ticketsHistory = [];
		this.flagEvents = [];
		this.fobEvents = [];
		this.cacheEvents = [];
		this.vehicleDestroyEvents = [];
		this.reviveEvents = [];
		this.kitEvents = [];
		this.playerSessions = [];
		this.loopStartTick = null;
		this.loopEndTick = null;
		this.loopEnabled = false;
		this.zoomMode = "full";
	}

	setPreloadedData(data) {
		if (!data) return;
		this.ticketsHistory = Array.isArray(data.ticketsHistory) ? data.ticketsHistory : [];
		this.flagEvents = Array.isArray(data.flagEvents) ? data.flagEvents : [];
		this.fobEvents = Array.isArray(data.fobEvents) ? data.fobEvents : [];
		this.cacheEvents = Array.isArray(data.cacheEvents) ? data.cacheEvents : [];
		this.vehicleDestroyEvents = Array.isArray(data.vehicleDestroyers) ? data.vehicleDestroyers : [];
		this.reviveEvents = Array.isArray(data.revives) ? data.revives : [];
		this.kitEvents = Array.isArray(data.kitAllocations) ? data.kitAllocations : [];
		this.playerSessions = Array.isArray(data.playerSessions) ? data.playerSessions : [];

		if (Array.isArray(data.kills)) {
			this.kills.length = 0;
			this.killKeys.clear();
			for (const k of data.kills) {
				this.recordKill(k);
			}
		}

		this._bindEventsOnce();
		this._syncLayerButtonsUI();
		this._lastRenderKey = null;
		this.draw(true);
	}

	_bindEventsOnce() {
		if (this._eventsBound || typeof window === "undefined") return;
		this._eventsBound = true;
		window.addEventListener("resize", () => {
			this.drawScrubBackground();
			this.drawSparkline();
			this.updatePlayheadPosition();
		});

		// Reparent #playBarBubble to document.body so backdrop-filter on #controlBarContainer
		// never traps position:fixed coordinates off-screen.
		const bubble = document.getElementById("playBarBubble");
		if (bubble && bubble.parentElement !== document.body) {
			document.body.appendChild(bubble);
		}

		const playLabel = document.getElementById("playBarLabel");
		if (playLabel) {
			playLabel.addEventListener("mouseleave", () => this.hideHoverBubble());
		}

		const lanesContainer = document.getElementById("timelineLanesContainer");
		if (lanesContainer) {
			lanesContainer.addEventListener("mousemove", (e) => {
				if (!this._isDraggingZoom) this.updateHoverBubble(e);
			});
			lanesContainer.addEventListener("mouseleave", () => {
				if (!this._isDraggingZoom) this.hideHoverBubble();
			});

			// Click-and-drag horizontal panning when zoomed in (10m / 2m)
			let dragStartX = 0;
			let dragInitStartTick = 0;
			let dragInitEndTick = 0;
			let dragMoved = false;

			lanesContainer.addEventListener("mousedown", (e) => {
				if (e.button !== 0 || this.zoomMode === "full") return;
				const playBar = document.getElementById("playBar");
				const barW = playBar ? Math.max(40, playBar.getBoundingClientRect().width - 14) : 400;
				dragStartX = e.clientX;
				dragInitStartTick = this.viewStartTick;
				dragInitEndTick = this.viewEndTick;
				dragMoved = false;
				this._isDraggingZoom = true;

				const onMouseMove = (me) => {
					const dx = me.clientX - dragStartX;
					if (!dragMoved && Math.abs(dx) < 5) return;
					dragMoved = true;
					lanesContainer.classList.add("tl-dragging");
					this.hideHoverBubble();

					const total = (typeof Tick_Count !== "undefined" && Tick_Count > 0) ? Tick_Count : 1;
					const span = Math.max(10, dragInitEndTick - dragInitStartTick);
					// Dragging right moves timeline earlier (like dragging paper/video timeline)
					const tickDelta = Math.round((-dx / barW) * span);
					let newStart = dragInitStartTick + tickDelta;
					let newEnd = newStart + span;
					if (newStart < 0) {
						newStart = 0;
						newEnd = Math.min(total, span);
					} else if (newEnd > total) {
						newEnd = total;
						newStart = Math.max(0, total - span);
					}
					if (newStart !== this.viewStartTick || newEnd !== this.viewEndTick) {
						this._userPannedZoom = true;
						this.viewStartTick = newStart;
						this.viewEndTick = Math.max(newStart + 1, newEnd);
						this._syncPlayBarRangeToWindow();
						this._syncLayerButtonsUI();
						this.draw(true);
					}
				};

				const onMouseUp = () => {
					window.removeEventListener("mousemove", onMouseMove);
					window.removeEventListener("mouseup", onMouseUp);
					lanesContainer.classList.remove("tl-dragging");
					this._isDraggingZoom = false;
					if (dragMoved) {
						this._suppressNextMarkerClick = true;
						setTimeout(() => { this._suppressNextMarkerClick = false; }, 50);
					}
				};

				window.addEventListener("mousemove", onMouseMove);
				window.addEventListener("mouseup", onMouseUp);
			});
		}

		// Mouse wheel over the timeline dock pans the zoomed window smoothly (and blocks map zoom bleed-through)
		const dock = document.getElementById("controlBarContainer");
		if (dock) {
			dock.addEventListener("wheel", (e) => {
				if (this.zoomMode === "full") return;
				e.preventDefault();
				e.stopPropagation();
				const dir = (e.deltaY > 0 || e.deltaX > 0) ? 1 : -1;
				this.panZoomWindow(dir * 0.2);
			}, { passive: false });
		}
	}

	toggleLayer(layerName) {
		if (!(layerName in this.layers)) return;
		this.layers[layerName] = !this.layers[layerName];
		try {
			if (typeof localStorage !== "undefined") {
				localStorage.setItem("rt_timeline_layers_v2", JSON.stringify(this.layers));
			}
		} catch (e) {}
		this._syncLayerButtonsUI();
		this.draw(true);
	}

	_syncLayerButtonsUI() {
		for (const k in this.layers) {
			const btn = document.getElementById("btnTlLayer_" + k);
			if (btn) {
				btn.classList.toggle("active", !!this.layers[k]);
			}
		}
		const zFull = document.getElementById("btnTlZoom_full");
		const z10m = document.getElementById("btnTlZoom_10m");
		const z2m = document.getElementById("btnTlZoom_2m");
		const pLeft = document.getElementById("btnTlPanLeft");
		const pRight = document.getElementById("btnTlPanRight");
		const isZoomed = this.zoomMode !== "full";
		if (zFull) zFull.classList.toggle("active", this.zoomMode === "full");
		if (z10m) z10m.classList.toggle("active", this.zoomMode === "10m");
		if (z2m) z2m.classList.toggle("active", this.zoomMode === "2m");
		if (pLeft) {
			pLeft.style.display = isZoomed ? "inline-block" : "none";
			pLeft.disabled = this.viewStartTick <= 0;
		}
		const lanesContainer = document.getElementById("timelineLanesContainer");
		if (lanesContainer) lanesContainer.classList.toggle("tl-zoomed", isZoomed);
		if (pRight) {
			pRight.style.display = isZoomed ? "inline-block" : "none";
			pRight.disabled = (typeof Tick_Count !== "undefined") && this.viewEndTick >= Tick_Count;
		}

		const btnIn = document.getElementById("btnTlLoopIn");
		const btnOut = document.getElementById("btnTlLoopOut");
		const btnClear = document.getElementById("btnTlLoopClear");
		if (btnIn) btnIn.classList.toggle("active", this.loopStartTick != null);
		if (btnOut) btnOut.classList.toggle("active", this.loopEndTick != null);
		if (btnClear) btnClear.style.display = (this.loopStartTick != null || this.loopEndTick != null) ? "inline-block" : "none";
	}

	setZoomMode(mode) {
		this.zoomMode = mode || "full";
		this._userPannedZoom = false;
		this._updateZoomWindow();
		this._syncLayerButtonsUI();
		this.draw(true);
	}

	panZoomWindow(fraction) {
		if (this.zoomMode === "full") return;
		this._userPannedZoom = true;
		const total = (typeof Tick_Count !== "undefined" && Tick_Count > 0) ? Tick_Count : 1;
		const span = Math.max(10, this.viewEndTick - this.viewStartTick);
		const delta = Math.round(span * fraction);
		let newStart = this.viewStartTick + delta;
		let newEnd = newStart + span;

		if (newStart < 0) {
			newStart = 0;
			newEnd = Math.min(total, span);
		} else if (newEnd > total) {
			newEnd = total;
			newStart = Math.max(0, total - span);
		}

		if (newStart === this.viewStartTick && newEnd === this.viewEndTick) return;
		this.viewStartTick = newStart;
		this.viewEndTick = Math.max(newStart + 1, newEnd);

		const playBar = document.getElementById("playBar");
		if (playBar && total > 1) {
			playBar.min = this.viewStartTick;
			playBar.max = this.viewEndTick;
			const cur = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;
			playBar.value = Math.max(this.viewStartTick, Math.min(this.viewEndTick, cur));
		}

		this._syncLayerButtonsUI();
		this.draw(true);
	}

	_syncPlayBarRangeToWindow() {
		const total = (typeof Tick_Count !== "undefined" && Tick_Count > 0) ? Tick_Count : 1;
		const cur = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;
		const playBar = document.getElementById("playBar");
		if (playBar && total > 1) {
			playBar.min = this.viewStartTick;
			playBar.max = this.viewEndTick;
			playBar.value = Math.max(this.viewStartTick, Math.min(this.viewEndTick, cur));
		}
	}

	_updateZoomWindow() {
		const total = (typeof Tick_Count !== "undefined" && Tick_Count > 0) ? Tick_Count : 1;
		const cur = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;
		const hz = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0) ? DetectedDemoHz : 3.0;

		if (this.zoomMode === "10m") {
			const span = Math.max(20, Math.round(600 * hz));
			let s = Math.max(0, cur - Math.round(span * 0.5));
			let e = Math.min(total, s + span);
			if (e - s < span) s = Math.max(0, e - span);
			this.viewStartTick = s;
			this.viewEndTick = Math.max(s + 1, e);
		} else if (this.zoomMode === "2m") {
			const span = Math.max(10, Math.round(120 * hz));
			let s = Math.max(0, cur - Math.round(span * 0.5));
			let e = Math.min(total, s + span);
			if (e - s < span) s = Math.max(0, e - span);
			this.viewStartTick = s;
			this.viewEndTick = Math.max(s + 1, e);
		} else {
			this.viewStartTick = 0;
			this.viewEndTick = total;
		}

		this._syncPlayBarRangeToWindow();
	}

	setLoopPoint(which) {
		const cur = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;
		if (which === "in") {
			this.loopStartTick = cur;
			if (this.loopEndTick != null && this.loopEndTick <= this.loopStartTick) {
				this.loopEndTick = null;
			}
		} else if (which === "out") {
			this.loopEndTick = cur;
			if (this.loopStartTick != null && this.loopEndTick <= this.loopStartTick) {
				this.loopStartTick = Math.max(1, cur - 10);
			}
		} else if (which === "clear") {
			this.loopStartTick = null;
			this.loopEndTick = null;
			this.loopEnabled = false;
		}
		this.loopEnabled = (this.loopStartTick != null && this.loopEndTick != null && this.loopEndTick > this.loopStartTick);
		this._syncLayerButtonsUI();
		this.draw(true);
	}

	checkPlaybackBounds() {
		const cur = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;
		if (this.zoomMode !== "full" && !this._userPannedZoom) {
			if (cur < this.viewStartTick || cur >= this.viewEndTick) {
				this._updateZoomWindow();
				this._syncLayerButtonsUI();
				this.draw(true);
			}
		}

		if (this.loopEndTick != null && cur >= this.loopEndTick) {
			if (typeof clipRecorder !== "undefined" && clipRecorder.isRecording) {
				clipRecorder.stop();
				if (typeof Stop === "function") Stop();
				return true;
			}
			if (this.loopEnabled && this.loopStartTick != null) {
				if (typeof goTo === "function") {
					goTo(this.loopStartTick);
				}
				return true;
			}
		}
		return false;
	}

	stepTime(secondsDelta) {
		if (typeof goTo !== "function") return;
		const hz = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0) ? DetectedDemoHz : 3.0;
		const tickDelta = Math.round(secondsDelta * hz);
		const target = Math.max(1, Math.min((Tick_Count || 1) - 1, (Tick_Current || 1) + tickDelta));
		goTo(target);
		if (this.zoomMode !== "full" && (target < this.viewStartTick || target > this.viewEndTick)) {
			this._updateZoomWindow();
			this._syncLayerButtonsUI();
			this.draw(true);
		}
	}

	stepTicks(tickDelta) {
		if (typeof goTo !== "function") return;
		const target = Math.max(1, Math.min((Tick_Count || 1) - 1, (Tick_Current || 1) + tickDelta));
		goTo(target);
		if (this.zoomMode !== "full" && (target < this.viewStartTick || target > this.viewEndTick)) {
			this._updateZoomWindow();
			this._syncLayerButtonsUI();
			this.draw(true);
		}
	}

	jumpAdjacentEvent(dir) {
		if (!this.renderedEvents || this.renderedEvents.length === 0 || typeof goTo !== "function") return;
		const cur = (typeof Tick_Current !== "undefined") ? Tick_Current : 0;
		const ticks = [];
		for (const ev of this.renderedEvents) {
			if (ev && Number.isFinite(ev.tick)) ticks.push(ev.tick);
		}
		if (ticks.length === 0) return;
		ticks.sort((a, b) => a - b);

		if (dir < 0) {
			for (let i = ticks.length - 1; i >= 0; i--) {
				if (ticks[i] < cur - 2) {
					goTo(Math.max(1, ticks[i] - 2));
					return;
				}
			}
			goTo(Math.max(1, ticks[0]));
		} else {
			for (let i = 0; i < ticks.length; i++) {
				if (ticks[i] > cur + 2) {
					goTo(Math.max(1, ticks[i] - 2));
					return;
				}
			}
			goTo(Math.max(1, ticks[ticks.length - 1]));
		}
	}

	updateClockDisplay() {
		const el = document.getElementById("timelineClockDisplay");
		if (el) {
			const curStr = (typeof getTimeStringOfTick === "function") ? getTimeStringOfTick(Tick_Current || 0) : "00:00";
			const maxTick = (typeof Tick_Count !== "undefined" && Tick_Count > 0) ? Math.max(0, Tick_Count - 1) : 0;
			const totStr = (typeof getTimeStringOfTick === "function") ? getTimeStringOfTick(maxTick) : "00:00";
			el.textContent = `${curStr} / ${totStr}`;
		}
		const tkBadge = document.getElementById("tlTicketsScoreBadge");
		if (tkBadge) {
			const tkNow = this.getTicketsAtTick(Tick_Current || 0);
			tkBadge.innerHTML = `<span style="color:#FF3300;">${tkNow.t1}</span>/<span style="color:#2299FF;">${tkNow.t2}</span>`;
		}
		this.updatePlayheadPosition();
	}

	_getI18n() {
		if (typeof ANALYSER_I18N !== "undefined" && typeof currentAnalyserLang !== "undefined" && ANALYSER_I18N[currentAnalyserLang] && ANALYSER_I18N[currentAnalyserLang].timeline) {
			return ANALYSER_I18N[currentAnalyserLang].timeline;
		}
		return {
			tickets: "Tickets",
			flags: "Flags",
			fobs: "FOBs",
			caches: "Caches",
			vehs: "Vehicles",
			bookmarks: "Bookmarks",
			selected: "Selected",
			selectHint: "Select a player or squad to view Kills, Deaths & Revives"
		};
	}

	updatePlayheadPosition() {
		const playhead = document.getElementById("timelineLanesPlayhead");
		const playBar = document.getElementById("playBar");
		const lanesContainer = document.getElementById("timelineLanesContainer");
		if (!playhead || !playBar || !lanesContainer || lanesContainer.style.display === "none") return;

		const barRect = playBar.getBoundingClientRect();
		const contRect = lanesContainer.getBoundingClientRect();
		if (barRect.width <= 16) return;

		const minV = Number(playBar.min) || 0;
		const maxV = Number(playBar.max) || 1;
		const curV = Number(playBar.value);
		const span = Math.max(1, maxV - minV);
		const ratio = Math.max(0, Math.min(1, (curV - minV) / span));

		const usableW = barRect.width - 10;
		const centerPx = (barRect.left - contRect.left) + 5 + ratio * usableW;
		playhead.style.left = (Math.round(centerPx) - 1) + "px";
	}

	getTicketsAtTick(targetTick) {
		if (!this.ticketsHistory || this.ticketsHistory.length === 0) {
			return {
				t1: typeof tickets1 !== "undefined" ? tickets1 : 0,
				t2: typeof tickets2 !== "undefined" ? tickets2 : 0
			};
		}
		let lo = 0, hi = this.ticketsHistory.length - 1;
		let best = this.ticketsHistory[0];
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const item = this.ticketsHistory[mid];
			if (item.tick <= targetTick) {
				best = item;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		return { t1: best.t1, t2: best.t2 };
	}

	_getSelectedPlayerSession() {
		if (typeof SelectedPlayer === "undefined" || SelectedPlayer === SELECTED_NOTHING || typeof AllPlayers === "undefined") {
			return null;
		}
		const p = AllPlayers[SelectedPlayer];
		if (!p || p.isJoining) return null;
		const pid = Number(SelectedPlayer);
		const pName = p.name || "";
		const curTick = typeof Tick_Current !== "undefined" ? Tick_Current : 0;

		if (this.playerSessions && this.playerSessions.length > 0) {
			for (const s of this.playerSessions) {
				if (s.slotId === pid && s.name === pName && curTick >= s.joinTick && (s.leaveTick == null || curTick <= s.leaveTick)) {
					return s;
				}
			}
			for (const s of this.playerSessions) {
				if (s.name === pName) return s;
			}
		}
		return {
			slotId: pid,
			name: pName,
			team: p.team || 0,
			squad: p.squad || 0,
			joinTick: 0,
			leaveTick: Tick_Count || 999999
		};
	}

	_tickToPercent(tick) {
		const start = this.viewStartTick || 0;
		const end = (this.viewEndTick != null && this.viewEndTick > start) ? this.viewEndTick : ((typeof Tick_Count !== "undefined" && Tick_Count > 0) ? Tick_Count : 1);
		const span = Math.max(1, end - start);
		return ((tick - start) * 100) / span;
	}

	drawScrubBackground() {
		const canvas = document.getElementById("timelineScrubBgCanvas");
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const w = rect && rect.width > 20 ? Math.floor(rect.width) : 600;
		const h = rect && rect.height > 6 ? Math.floor(rect.height) : 28;
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;

		const ctx = canvas.getContext("2d");
		ctx.clearRect(0, 0, w, h);

		if (typeof Tick_Count === "undefined" || Tick_Count <= 0) return;

		const startTick = this.viewStartTick || 0;
		const endTick = (this.viewEndTick != null && this.viewEndTick > startTick) ? this.viewEndTick : Tick_Count;
		const span = Math.max(1, endTick - startTick);

		// Briefing phase shading
		if (typeof tickToTime !== "undefined" && Array.isArray(tickToTime) && tickToTime.length > 1) {
			let briefingEndTick = 0;
			for (let t = 1; t < tickToTime.length; t++) {
				if (tickToTime[t] < 0) briefingEndTick = t;
				else break;
			}
			if (briefingEndTick > startTick) {
				const bx2 = Math.min(w, Math.max(0, ((briefingEndTick - startTick) / span) * w));
				if (bx2 > 0) {
					ctx.fillStyle = "rgba(160, 175, 255, 0.12)";
					ctx.fillRect(0, 0, bx2, h);
					ctx.strokeStyle = "rgba(160, 175, 255, 0.45)";
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(bx2, 0);
					ctx.lineTo(bx2, h);
					ctx.stroke();
				}
			}
		}

		// Loop / Clip [In A - Out B] shading
		if (this.loopStartTick != null || this.loopEndTick != null) {
			const aTick = this.loopStartTick != null ? this.loopStartTick : startTick;
			const bTick = this.loopEndTick != null ? this.loopEndTick : endTick;
			const lx1 = Math.max(0, Math.min(w, ((aTick - startTick) / span) * w));
			const lx2 = Math.max(0, Math.min(w, ((bTick - startTick) / span) * w));
			if (lx2 > lx1) {
				ctx.fillStyle = "rgba(79, 209, 197, 0.20)";
				ctx.fillRect(lx1, 0, lx2 - lx1, h);
			}
			ctx.strokeStyle = "#4fd1c5";
			ctx.lineWidth = 2;
			if (this.loopStartTick != null && this.loopStartTick >= startTick && this.loopStartTick <= endTick) {
				ctx.beginPath(); ctx.moveTo(lx1, 0); ctx.lineTo(lx1, h); ctx.stroke();
			}
			if (this.loopEndTick != null && this.loopEndTick >= startTick && this.loopEndTick <= endTick) {
				ctx.beginPath(); ctx.moveTo(lx2, 0); ctx.lineTo(lx2, h); ctx.stroke();
			}
		}
	}

	drawSparkline() {
		const canvas = document.getElementById("timelineSparklineCanvas");
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const w = rect && rect.width > 20 ? Math.floor(rect.width) : 600;
		const h = rect && rect.height > 10 ? Math.floor(rect.height) : 46;
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;

		const ctx = canvas.getContext("2d");
		ctx.clearRect(0, 0, w, h);

		if (!this.layers.tickets || !this.ticketsHistory || this.ticketsHistory.length < 2 || typeof Tick_Count === "undefined" || Tick_Count <= 0) {
			return;
		}

		const startTick = this.viewStartTick || 0;
		const endTick = (this.viewEndTick != null && this.viewEndTick > startTick) ? this.viewEndTick : Tick_Count;
		const span = Math.max(1, endTick - startTick);

		// Subtle horizontal guide lines
		ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
		ctx.lineWidth = 1;
		for (const frac of [0.25, 0.5, 0.75]) {
			const gy = Math.round(h * frac) + 0.5;
			ctx.beginPath();
			ctx.moveTo(0, gy);
			ctx.lineTo(w, gy);
			ctx.stroke();
		}

		let maxT = 100;
		for (let i = 0; i < this.ticketsHistory.length; i++) {
			const th = this.ticketsHistory[i];
			if (th.t1 > maxT) maxT = th.t1;
			if (th.t2 > maxT) maxT = th.t2;
		}

		const drawTeamCurve = (prop, strokeColor, fillColor) => {
			ctx.save();
			ctx.beginPath();
			let started = false;
			let firstX = 0;
			let lastX = 0;
			const step = Math.max(1, Math.floor(this.ticketsHistory.length / 400));
			for (let i = 0; i < this.ticketsHistory.length; i += step) {
				const pt = this.ticketsHistory[i];
				if (pt.tick < startTick || pt.tick > endTick) continue;
				const x = ((pt.tick - startTick) / span) * w;
				const val = Math.max(0, pt[prop] || 0);
				const y = h - 4 - (val / maxT) * (h - 9);
				if (!started) {
					ctx.moveTo(x, y);
					firstX = x;
					started = true;
				} else {
					ctx.lineTo(x, y);
				}
				lastX = x;
			}
			const lastPt = this.ticketsHistory[this.ticketsHistory.length - 1];
			if (lastPt && lastPt.tick >= startTick && lastPt.tick <= endTick) {
				const x = ((lastPt.tick - startTick) / span) * w;
				const val = Math.max(0, lastPt[prop] || 0);
				const y = h - 4 - (val / maxT) * (h - 9);
				if (started) {
					ctx.lineTo(x, y);
					lastX = x;
				}
			}

			if (started) {
				ctx.strokeStyle = strokeColor;
				ctx.lineWidth = 1.8;
				ctx.stroke();

				ctx.lineTo(lastX, h);
				ctx.lineTo(firstX, h);
				ctx.closePath();
				ctx.fillStyle = fillColor;
				ctx.fill();
			}
			ctx.restore();
		};

		drawTeamCurve("t1", "#FF3300", "rgba(255, 51, 0, 0.12)");
		drawTeamCurve("t2", "#2299FF", "rgba(34, 153, 255, 0.12)");
	}

	_createFlagSvg(team) {
		const color = team === 1 ? "#FF3300" : (team === 2 ? "#2299FF" : "#9ea8a7");
		return `<svg width="16" height="17" viewBox="0 0 14 15" style="display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.85));">
			<line x1="2.5" y1="1.2" x2="2.5" y2="14" stroke="#ffffff" stroke-width="1.6"/>
			<polygon points="3,1.5 13,4.3 3,7.8" fill="${color}" stroke="#111" stroke-width="0.8"/>
		</svg>`;
	}

	_createFobSvg(team, isRemove) {
		const color = team === 1 ? "#FF3300" : (team === 2 ? "#2299FF" : "#9ea8a7");
		const cross = isRemove ? `<line x1="1.5" y1="1.5" x2="12.5" y2="12.5" stroke="#ffffff" stroke-width="1.8"/><line x1="12.5" y1="1.5" x2="1.5" y2="12.5" stroke="#ffffff" stroke-width="1.8"/>` : "";
		return `<svg width="16" height="16" viewBox="0 0 14 14" style="display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.9)); opacity:${isRemove ? '0.82' : '1'};">
			<polygon points="7,1.2 13,12.2 1,12.2" fill="${color}" stroke="#000" stroke-width="1.2"/>
			<circle cx="7" cy="8.4" r="1.8" fill="#000"/>
			${cross}
		</svg>`;
	}

	_createCacheElement(action) {
		const wrap = document.createElement("div");
		wrap.style.cssText = "width:17px; height:17px; position:relative; display:flex; align-items:center; justify-content:center;";
		const sprite = (typeof icons !== "undefined" && icons) ? (action === "reveal" ? icons.CacheRevealed : icons.CacheUnrevealed) : null;
		if (sprite) {
			const img = sprite.cloneNode(false);
			img.style.cssText = "width:17px; height:17px; display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.9));";
			if (action === "remove") img.style.opacity = "0.65";
			wrap.appendChild(img);
		} else {
			const col = action === "remove" ? "#888888" : "#ff3300";
			wrap.innerHTML = `<svg width="15" height="15" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" fill="${col}" stroke="#000" stroke-width="1.3"/></svg>`;
		}
		return wrap;
	}

	_createVehicleElement(ev) {
		const wrap = document.createElement("div");
		wrap.style.cssText = "width:18px; height:18px; position:relative; display:flex; align-items:center; justify-content:center;";
		const tpl = ev.vehicleTemplate || "";
		const vTeam = ev.vehicleTeam || 1;
		let iconNode = null;
		if (typeof vehicleData !== "undefined" && (tpl in vehicleData)) {
			const vd = vehicleData[tpl];
			if (typeof coloredIcons !== "undefined" && vd.MiniMapIcon && coloredIcons[vd.MiniMapIcon] && coloredIcons[vd.MiniMapIcon][vTeam - 1]) {
				iconNode = coloredIcons[vd.MiniMapIcon][vTeam - 1].cloneNode(false);
			} else if (typeof icons !== "undefined" && vd.MenuIcon && icons[vd.MenuIcon]) {
				iconNode = icons[vd.MenuIcon].cloneNode(false);
			}
		}
		if (iconNode) {
			iconNode.style.cssText = "width:18px; height:18px; display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.9));";
			wrap.appendChild(iconNode);
		} else {
			const col = vTeam === 1 ? "#FF3300" : "#2299FF";
			wrap.innerHTML = `<svg width="15" height="15" viewBox="0 0 14 14"><polygon points="7,1 13,7 7,13 1,7" fill="${col}" stroke="#000" stroke-width="1.2"/></svg>`;
		}
		return wrap;
	}

	_createBookmarkSvg() {
		return `<svg width="16" height="16" viewBox="0 0 14 14" style="display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.9));">
			<polygon points="7,1 8.9,5 13.3,5.5 10,8.5 10.9,12.8 7,10.6 3.1,12.8 4,8.5 0.7,5.5 5.1,5" fill="#ffd166" stroke="#000" stroke-width="1"/>
		</svg>`;
	}

	_createLaneRow(laneId, labelText, countBadge, extraClass = "") {
		const row = document.createElement("div");
		row.className = "tlLaneRow" + (extraClass ? " " + extraClass : "");
		row.dataset.lane = laneId;

		const leftCol = document.createElement("div");
		leftCol.className = "tlLaneLabelCol";
		const titleSpan = document.createElement("span");
		titleSpan.className = "tlLaneTitle";
		titleSpan.textContent = labelText;
		titleSpan.title = labelText;
		leftCol.appendChild(titleSpan);

		if (countBadge !== null && countBadge !== undefined) {
			const countSpan = document.createElement("span");
			countSpan.className = "tlLaneCount";
			countSpan.innerHTML = countBadge;
			leftCol.appendChild(countSpan);
		}

		const trackCol = document.createElement("div");
		trackCol.className = "tlLaneTrackCol";

		row.appendChild(leftCol);
		row.appendChild(trackCol);
		return { row, trackCol };
	}

	_renderClusteredMarkers(trackCol, items) {
		if (!items || items.length === 0) return;
		items.sort((a, b) => a.tick - b.tick);

		const clusters = [];
		const clusterThresholdPct = 1.05;
		for (const item of items) {
			const pct = Math.max(0, Math.min(100, this._tickToPercent(item.tick)));
			const prev = clusters.length > 0 ? clusters[clusters.length - 1] : null;
			if (prev && prev.category === item.category && Math.abs(pct - prev.pct) <= clusterThresholdPct) {
				prev.items.push(item);
			} else {
				clusters.push({
					pct: pct,
					tick: item.tick,
					category: item.category,
					items: [item]
				});
			}
		}

		for (const cl of clusters) {
			const first = cl.items[0];
			const count = cl.items.length;
			const marker = document.createElement("div");
			marker.className = `tlMarker tlMarker-${first.category}`;
			marker.style.left = `${cl.pct.toFixed(3)}%`;

			if (first.category === "flag") {
				marker.innerHTML = this._createFlagSvg(first.team);
			} else if (first.category === "fob") {
				marker.innerHTML = this._createFobSvg(first.team, first.action === "remove");
			} else if (first.category === "cache") {
				marker.appendChild(this._createCacheElement(first.action));
			} else if (first.category === "veh") {
				marker.appendChild(this._createVehicleElement(first.data));
			} else if (first.category === "bookmark") {
				marker.innerHTML = this._createBookmarkSvg();
			} else if (first.category === "revive") {
				if (typeof icons !== "undefined" && icons && icons.kit_medic) {
					const mImg = icons.kit_medic.cloneNode(false);
					mImg.style.cssText = "width:15px; height:15px; display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.85));";
					marker.appendChild(mImg);
				} else {
					marker.classList.add("tlBar-revive");
				}
			} else if (first.category === "kill") {
				marker.classList.add("tlBar-kill");
			} else if (first.category === "death") {
				marker.classList.add("tlBar-death");
			}

			if (count > 1) {
				const badge = document.createElement("span");
				badge.className = "tlClusterBadge";
				badge.textContent = `x${count}`;
				marker.appendChild(badge);
			}

			marker.addEventListener("click", (ev) => {
				ev.stopPropagation();
				ev.preventDefault();
				this._onMarkerClick(first);
			});

			trackCol.appendChild(marker);
		}
	}

	draw(force = false) {
		const isForce = (force === true);
		const lanesContainer = document.getElementById("timelineLanesContainer");
		const lanesBody = document.getElementById("timelineLanesBody");
		const topStrip = document.getElementById("timelineTopStrip");
		if (!lanesContainer || !lanesBody) return;

		this._bindEventsOnce();
		this.updateClockDisplay();

		if (typeof Tick_Count === "undefined" || Tick_Count <= 0) {
			lanesContainer.style.display = "none";
			lanesBody.replaceChildren();
			this.renderedEvents = [];
			this._lastRenderKey = null;
			return;
		}

		if (topStrip) topStrip.style.display = "flex";

		// Keep user's panned zoom window intact unless Full mode or uninitialized
		if (this.zoomMode === "full") {
			this.viewStartTick = 0;
			this.viewEndTick = Tick_Count;
			this._syncPlayBarRangeToWindow();
		} else if (this.viewEndTick <= this.viewStartTick) {
			this._updateZoomWindow();
		}

		const selP = (typeof SelectedPlayer !== "undefined") ? SelectedPlayer : -99999;
		const selST = (typeof SelectedSquadTeam !== "undefined") ? SelectedSquadTeam : -99999;
		const selSN = (typeof SelectedSquadNumber !== "undefined") ? SelectedSquadNumber : -99999;
		const bmCount = (typeof bookmarks_List !== "undefined" && Array.isArray(bookmarks_List)) ? bookmarks_List.length : 0;
		const lang = (typeof currentAnalyserLang !== "undefined") ? currentAnalyserLang : "EN";

		const renderKey = [
			Tick_Count,
			this.zoomMode,
			this.viewStartTick,
			this.viewEndTick,
			this.loopStartTick,
			this.loopEndTick,
			this.layers.tickets ? 1 : 0,
			this.layers.flags ? 1 : 0,
			this.layers.fobs ? 1 : 0,
			this.layers.caches ? 1 : 0,
			this.layers.vehs ? 1 : 0,
			this.layers.bookmarks ? 1 : 0,
			this.layers.selected ? 1 : 0,
			selP, selST, selSN,
			bmCount,
			this.kills.length,
			this.flagEvents.length,
			this.fobEvents.length,
			this.cacheEvents.length,
			lang
		].join("|");

		if (!isForce && renderKey === this._lastRenderKey) {
			return;
		}
		this._lastRenderKey = renderKey;

		this._syncLayerButtonsUI();
		this.drawScrubBackground();

		const startTick = this.viewStartTick || 0;
		const endTick = (this.viewEndTick != null && this.viewEndTick > startTick) ? this.viewEndTick : Tick_Count;
		const i18n = this._getI18n();

		lanesBody.replaceChildren();
		this.renderedEvents = [];
		let activeLaneCount = 0;

		// Lane 1: Tickets Sparkline
		if (this.layers.tickets) {
			const tkNow = this.getTicketsAtTick(Tick_Current || 0);
			const scoreBadge = `<span id="tlTicketsScoreBadge"><span style="color:#FF3300;">${tkNow.t1}</span>/<span style="color:#2299FF;">${tkNow.t2}</span></span>`;
			const { row, trackCol } = this._createLaneRow("tickets", i18n.tickets || "Tickets", scoreBadge, "tlLaneRow-tickets");
			const canvas = document.createElement("canvas");
			canvas.id = "timelineSparklineCanvas";
			trackCol.appendChild(canvas);
			lanesBody.appendChild(row);
			activeLaneCount++;
		}

		// Lane 2: Flags
		if (this.layers.flags) {
			const items = [];
			for (const f of (this.flagEvents || [])) {
				if (f.tick < startTick || f.tick > endTick) continue;
				const tLabel = f.team === 1 ? "Team 1 (Red)" : (f.team === 2 ? "Team 2 (Blue)" : "Neutral");
				items.push({
					tick: f.tick,
					category: "flag",
					team: f.team,
					X: f.X,
					Z: f.Z,
					summary: `Flag update: ${tLabel}`,
					data: f
				});
			}
			const { row, trackCol } = this._createLaneRow("flags", i18n.flags || "Flags", String(items.length));
			this._renderClusteredMarkers(trackCol, items);
			lanesBody.appendChild(row);
			this.renderedEvents.push(...items);
			activeLaneCount++;
		}

		// Lane 3: FOBs
		if (this.layers.fobs) {
			const items = [];
			for (const fb of (this.fobEvents || [])) {
				if (fb.tick < startTick || fb.tick > endTick) continue;
				const tLabel = fb.team === 1 ? "Team 1" : (fb.team === 2 ? "Team 2" : "Team");
				const actStr = fb.action === "remove" ? "FOB Destroyed" : "FOB Built";
				items.push({
					tick: fb.tick,
					category: "fob",
					action: fb.action,
					team: fb.team,
					X: fb.X,
					Z: fb.Z,
					summary: `${actStr} (${tLabel})`,
					data: fb
				});
			}
			const { row, trackCol } = this._createLaneRow("fobs", i18n.fobs || "FOBs", String(items.length));
			this._renderClusteredMarkers(trackCol, items);
			lanesBody.appendChild(row);
			this.renderedEvents.push(...items);
			activeLaneCount++;
		}

		// Lane 4: Caches
		if (this.layers.caches) {
			const items = [];
			for (const c of (this.cacheEvents || [])) {
				if (c.tick < startTick || c.tick > endTick) continue;
				const actStr = c.action === "reveal" ? "Cache Revealed" : (c.action === "remove" ? "Cache Destroyed" : "New Cache");
				items.push({
					tick: c.tick,
					category: "cache",
					action: c.action,
					X: c.X,
					Z: c.Z,
					summary: actStr,
					data: c
				});
			}
			const { row, trackCol } = this._createLaneRow("caches", i18n.caches || "Caches", String(items.length));
			this._renderClusteredMarkers(trackCol, items);
			lanesBody.appendChild(row);
			this.renderedEvents.push(...items);
			activeLaneCount++;
		}

		// Lane 5: Vehicles Destroyed
		if (this.layers.vehs) {
			const items = [];
			const vList = (this.vehicleDestroyEvents && this.vehicleDestroyEvents.length > 0)
				? this.vehicleDestroyEvents
				: ((typeof eventArrays !== "undefined" && eventArrays.vehicleDestroyers) ? eventArrays.vehicleDestroyers.events : []);
			for (const v of vList) {
				if (v.tick < startTick || v.tick > endTick) continue;
				let vHud = v.vehicleTemplate || "Vehicle";
				if (typeof vehicleData !== "undefined" && (vHud in vehicleData) && vehicleData[vHud].HudName) {
					vHud = vehicleData[vHud].HudName;
				}
				const byStr = v.destroyerName ? ` by ${v.destroyerName}` : "";
				items.push({
					tick: v.tick,
					category: "veh",
					team: v.vehicleTeam || 1,
					X: Number.isFinite(v.X) ? v.X : null,
					Z: Number.isFinite(v.Y) ? v.Y : null,
					summary: `${vHud} destroyed${byStr}`,
					data: v
				});
			}
			const { row, trackCol } = this._createLaneRow("vehs", i18n.vehs || "Vehicles", String(items.length));
			this._renderClusteredMarkers(trackCol, items);
			lanesBody.appendChild(row);
			this.renderedEvents.push(...items);
			activeLaneCount++;
		}

		// Lane 6: Bookmarks
		if (this.layers.bookmarks) {
			const items = [];
			if (typeof bookmarks_List !== "undefined" && Array.isArray(bookmarks_List)) {
				for (const bm of bookmarks_List) {
					if (!bm || bm.tick < startTick || bm.tick > endTick) continue;
					items.push({
						tick: bm.tick,
						category: "bookmark",
						X: null,
						Z: null,
						summary: `Bookmark: ${bm.comment || "(no comment)"}`,
						data: bm
					});
				}
			}
			const { row, trackCol } = this._createLaneRow("bookmarks", i18n.bookmarks || "Bookmarks", String(items.length));
			this._renderClusteredMarkers(trackCol, items);
			lanesBody.appendChild(row);
			this.renderedEvents.push(...items);
			activeLaneCount++;
		}

		// Lane 7: Selected Player / Squad Track
		if (this.layers.selected) {
			const items = [];
			const selSession = this._getSelectedPlayerSession();
			const hasSquadSel = (typeof SelectedSquadTeam !== "undefined" && SelectedSquadTeam !== SELECTED_NOTHING &&
			                     typeof SelectedSquadNumber !== "undefined" && SelectedSquadNumber > 0);
			let laneLabel = i18n.selected || "Selected";

			if (selSession) {
				laneLabel = selSession.name || "Player";
				const pName = selSession.name;
				const jTick = selSession.joinTick || 0;
				const lTick = selSession.leaveTick != null ? selSession.leaveTick : (Tick_Count || 999999);

				for (const k of this.kills) {
					if (k.tick < startTick || k.tick > endTick) continue;
					if (k.tick < jTick || k.tick > lTick) continue;
					const isKiller = (k.attackerName && pName) ? (k.attackerName === pName) : (k.attackerId === selSession.slotId);
					const isVictim = (k.victimName && pName) ? (k.victimName === pName) : (k.victimId === selSession.slotId);

					if (isKiller) {
						items.push({
							tick: k.tick,
							category: "kill",
							X: k.attackerX,
							Z: k.attackerZ,
							summary: `Kill: ${k.attackerName || pName} [${k.weapon}] ${k.victimName} (${k.distance}m)`,
							data: k
						});
					} else if (isVictim) {
						items.push({
							tick: k.tick,
							category: "death",
							X: k.victimX,
							Z: k.victimZ,
							summary: `Death: ${k.victimName || pName} killed by ${k.attackerName} [${k.weapon}] (${k.distance}m)`,
							data: k
						});
					}
				}

				const revList = (this.reviveEvents && this.reviveEvents.length > 0)
					? this.reviveEvents
					: ((typeof eventArrays !== "undefined" && eventArrays.revives) ? eventArrays.revives.events : []);
				for (const r of revList) {
					if (r.tick < startTick || r.tick > endTick) continue;
					if (r.tick < jTick || r.tick > lTick) continue;
					const isMedic = (r.MedicName && pName) ? (r.MedicName === pName) : (r.MedicID === selSession.slotId);
					const isRevived = (r.RevivedName && pName) ? (r.RevivedName === pName) : (r.RevivedID === selSession.slotId);
					if (isMedic || isRevived) {
						items.push({
							tick: r.tick,
							category: "revive",
							X: null,
							Z: null,
							summary: isMedic ? `Revive: Revived ${r.RevivedName}` : `Revived by ${r.MedicName}`,
							data: r
						});
					}
				}
			} else if (hasSquadSel) {
				laneLabel = `Squad ${SelectedSquadNumber}`;
				for (const k of this.kills) {
					if (k.tick < startTick || k.tick > endTick) continue;
					if (k.attackerTeam === SelectedSquadTeam && k.attackerSquad === SelectedSquadNumber) {
						items.push({
							tick: k.tick,
							category: "kill",
							X: k.attackerX,
							Z: k.attackerZ,
							summary: `Squad ${SelectedSquadNumber} Kill: ${k.attackerName} [${k.weapon}] ${k.victimName} (${k.distance}m)`,
							data: k
						});
					}
				}
			}

			const { row, trackCol } = this._createLaneRow("selected", laneLabel, String(items.length));
			if (items.length === 0 && !selSession && !hasSquadSel) {
				const hint = document.createElement("span");
				hint.style.cssText = "position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:10.5px; color:#778886; font-style:italic;";
				hint.textContent = i18n.selectHint || "Select a player or squad to view Kills, Deaths & Revives";
				trackCol.appendChild(hint);
			} else {
				this._renderClusteredMarkers(trackCol, items);
			}
			lanesBody.appendChild(row);
			this.renderedEvents.push(...items);
			activeLaneCount++;
		}

		this.renderedEvents.sort((a, b) => a.tick - b.tick);
		lanesContainer.style.display = activeLaneCount > 0 ? "block" : "none";

		if (this.layers.tickets) {
			this.drawSparkline();
		}
		this.updatePlayheadPosition();
	}

	_onMarkerClick(item) {
		if (!item || this._suppressNextMarkerClick) return;
		this._userPannedZoom = false;
		if (item.category === "kill" && item.data && item.data.rawKill && typeof kf_triggerKillReplay === "function") {
			kf_triggerKillReplay(item.data.rawKill);
			return;
		}

		const hz = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0) ? DetectedDemoHz : 3.0;
		const preRoll = (item.category === "bookmark") ? 0 : Math.max(2, Math.round(2.0 * hz));
		const targetTick = Math.max(1, item.tick - preRoll);
		if (typeof goTo === "function") {
			goTo(targetTick);
		}
		if (Number.isFinite(Number(item.X)) && Number.isFinite(Number(item.Z))) {
			if (typeof focusCameraOnWorldPos === "function") {
				focusCameraOnWorldPos(Number(item.X), Number(item.Z));
			}
			if (typeof highlight === "function") {
				highlight(Number(item.X), Number(item.Z), false);
			}
		}
	}

	hideHoverBubble() {
		const bubble = document.getElementById("playBarBubble");
		if (bubble) bubble.style.display = "none";
	}

	updateHoverBubble(e) {
		const bubble = document.getElementById("playBarBubble");
		const playBar = document.getElementById("playBar");
		if (!bubble || !playBar || !e) return;

		const rect = playBar.getBoundingClientRect();
		if (rect.width <= 16) return;
		if (e.clientX < rect.left || e.clientX > rect.right) {
			bubble.style.display = "none";
			return;
		}

		const width = Math.max(1, rect.width - 10);
		const relX = Math.min(Math.max(e.clientX - rect.left - 5, 0), width);
		const ratio = relX / width;

		const startTick = this.viewStartTick || 0;
		const endTick = (this.viewEndTick != null && this.viewEndTick > startTick) ? this.viewEndTick : (Tick_Count || 1);
		const span = Math.max(1, endTick - startTick);
		const hoveredTick = Math.round(startTick + ratio * span);

		const timeStr = (typeof getTimeStringOfTick === "function") ? getTimeStringOfTick(hoveredTick) : "";
		const tk = this.getTicketsAtTick(hoveredTick);

		const hoverPct = ratio * 100;
		const nearby = [];
		if (options_DrawTimeline && this.renderedEvents && this.renderedEvents.length > 0) {
			for (const ev of this.renderedEvents) {
				const evPct = this._tickToPercent(ev.tick);
				if (Math.abs(evPct - hoverPct) <= 1.25) {
					nearby.push(ev);
				}
			}
		}

		let html = `<div style="font-weight:bold; color:#fff;">[${timeStr}] <span style="color:#FF3300;">${tk.t1}</span> vs <span style="color:#2299FF;">${tk.t2}</span></div>`;
		if (nearby.length > 0) {
			const maxShow = 5;
			for (let i = 0; i < Math.min(maxShow, nearby.length); i++) {
				const ev = nearby[i];
				const safeText = (typeof escapeHtml === "function") ? escapeHtml(ev.summary) : ev.summary;
				html += `<div style="font-size:10.5px; color:#d2dedc; white-space:nowrap;">- ${safeText}</div>`;
			}
			if (nearby.length > maxShow) {
				html += `<div style="font-size:10px; color:#9ea8a7;">+${nearby.length - maxShow} more events</div>`;
			}
		}

		bubble.innerHTML = html;
		bubble.style.display = "block";

		// Position fixed strictly ABOVE the mouse cursor (never overlapping the cursor or markers)
		const vw = window.innerWidth || 1280;
		const bw = bubble.offsetWidth || 160;
		const halfW = bw * 0.5 + 8;
		const clampedX = Math.max(halfW, Math.min(vw - halfW, e.clientX));
		const targetY = Math.max(bubble.offsetHeight + 10, e.clientY - 16);
		bubble.style.left = clampedX + "px";
		bubble.style.top = targetY + "px";
	}
}

var analyserTimeline = new AnalyserTimeline();
