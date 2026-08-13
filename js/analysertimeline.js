// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Demo Analyser Event Timeline Engine

var options_DrawTimeline = false;

class AnalyserTimeline {
	constructor() {
		this.kills = [];
		this.killKeys = new Set();
	}

	recordKill(kill) {
		const tick = kill.tick != null ? kill.tick : kill.Tick;
		const key = kill.index != null ? "i:" + kill.index : tick + ":" + kill.AttackerID + ":" + kill.VictimID;
		if (this.killKeys.has(key)) return;
		this.killKeys.add(key);
		this.kills.push({ tick, attackerId: kill.AttackerID, victimId: kill.VictimID, isNoLOSKill: !!kill.isNoLOSKill });
	}

	resetAnalysis() {
		this.kills.length = 0;
		this.killKeys.clear();
	}

	draw() {
		const container = document.getElementById("demoTimelineMarkers");
		if (!container) return;
		if (!options_DrawTimeline || SelectedPlayer === SELECTED_NOTHING || Tick_Count <= 0) {
			container.style.display = "none";
			container.replaceChildren();
			this.renderKey = null;
			return;
		}
		const player = AllPlayers[SelectedPlayer];
		if (!player) return;
		container.style.display = "block";
		const noLOSList = typeof noLOSKills !== "undefined" ? noLOSKills : [];
		const key = player.id + ":" + Tick_Count + ":" + this.kills.length + ":" + noLOSList.length;
		if (key === this.renderKey) return;
		this.renderKey = key;
		container.replaceChildren();
		const add = (tick, type) => {
			const marker = document.createElement("span");
			marker.className = "demoTimelineMarker " + type;
			marker.style.left = Math.max(0, Math.min(100, tick * 100 / Tick_Count)) + "%";
			container.appendChild(marker);
		};
		for (const kill of this.kills) {
			if (kill.attackerId === player.id) add(kill.tick, kill.isNoLOSKill ? "suspicious" : "kill");
			if (kill.victimId === player.id) add(kill.tick, "death");
		}
		for (const kill of noLOSList) if (kill.attackerId === player.id) add(kill.tick, "suspicious");
	}
}

var analyserTimeline = new AnalyserTimeline();
