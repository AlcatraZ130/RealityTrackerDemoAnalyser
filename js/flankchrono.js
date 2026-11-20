// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Flank Chrono: Flanking Chronometer

var options_DrawFlankChronometer = false;
function getAdaptiveFlankRadius() {
	let size = 2;
	if (typeof MapSize !== 'undefined' && MapSize > 0) {
		size = MapSize;
	} else if (typeof MapName !== 'undefined' && MapName && typeof MAP_VIEW_DISTANCES !== 'undefined') {
		const viewDist = MAP_VIEW_DISTANCES[MapName.toLowerCase()] || 750;
		if (viewDist <= 600) size = 1;
		else if (viewDist <= 1000) size = 2;
		else size = 4;
	}

	if (size <= 1) return 50;  // 1km map -> 50m radius
	if (size <= 2) return 100; // 2km map -> 100m radius
	return 150;                // 4km/8km map -> 150m radius
}

class FlankChronometer {
	constructor() {
		// Maps enemyId -> { enterRangeTick, enterConeTick, laserTick, deathTick }
		this.state = new Map(); 
		this.lastTick = -1;
		this.lastSelectedPlayer = SELECTED_NOTHING;
	}

	update(p) {
		if (this.lastSelectedPlayer !== SelectedPlayer || (this.lastTick !== -1 && Tick_Current < this.lastTick)) {
			this.state.clear();
			this.lastSelectedPlayer = SelectedPlayer;
		}

		if (this.lastTick === Tick_Current) return;
		this.lastTick = Tick_Current;

		if (!p || !p.isAlive) return;

		const coneHits = getPlayersInVisionCone(p);
		const currentRadius = getAdaptiveFlankRadius();

		for (var i in AllPlayers) {
			const other = AllPlayers[i];
			if (other === p || other.isJoining || !other.isAlive || other.ns_lastX == null) continue;
			if (!isEnemyOf(p, other)) continue;

			const worldDist = Math.hypot(other.getX() - p.getX(), other.getZ() - p.getZ());
			
			if (worldDist <= currentRadius) {
				let s = this.state.get(other.id);
				if (!s) {
					s = { enterRangeTick: Tick_Current, enterConeTick: null, laserTick: null, deathTick: null };
					this.state.set(other.id, s);
				}

				const hitEntry = coneHits.find(h => h[0].id === other.id);
				if (hitEntry && !s.enterConeTick) s.enterConeTick = Tick_Current;
				if (hitEntry && hitEntry[2] <= 5.0 && !s.laserTick) s.laserTick = Tick_Current; 

			} else {
				// The display is only meaningful while the enemy remains inside the
				// detection zone; clear it immediately when they leave the radius.
				this.state.delete(other.id);
			}
		}
	}

	draw(ctx) {
		if (!options_DrawFlankChronometer) return;
		if (SelectedPlayer === SELECTED_NOTHING) return;
		
		const p = AllPlayers[SelectedPlayer];
		if (!p || p.isJoining || p.ns_lastX == null || !p.isAlive) return;

		// Draw tactical dashed detection circle (matches 3D)
		ctx.save();
		ctx.setLineDash([6, 5]);
		ctx.strokeStyle = "rgba(173, 115, 209, 0.58)";
		ctx.lineWidth = 1.25;
		ctx.beginPath();
		ctx.arc(p.getCanvasX(), p.getCanvasY(), lengthtoCanvas(getAdaptiveFlankRadius()), 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();

		this.update(p);

		for (const [enemyId, s] of this.state.entries()) {
			const other = AllPlayers[enemyId];
			if (!other) continue;

			// If died, set death tick
			if (!other.isAlive && !s.deathTick) {
				s.deathTick = Tick_Current;
			}

			let endTick = s.deathTick || s.laserTick || s.enterConeTick || Tick_Current;
			let elapsedTicks = endTick - s.enterRangeTick;
			if (elapsedTicks < 0) elapsedTicks = 0;
			let elapsedSeconds = elapsedTicks * DemoTimePerTick;

			// Show timer immediately from 0.0s as soon as enemy enters the zone
			if (elapsedSeconds < 0.0) continue;

			const x = Math.round(other.getCanvasX());
			const y = Math.round(other.getCanvasY());
			const isDead = !other.isAlive || !!s.deathTick;

			let textColor = "#ddd2ec";
			let bgColor = "rgba(23, 35, 34, 0.88)";
			let borderColor = "#8c6bb1";
			if (isDead) {
				textColor = "#9aa6a5";
				bgColor = "rgba(26, 28, 30, 0.82)";
				borderColor = "#5c6665";
			} else if (s.laserTick) {
				textColor = "#f2b8b8";
				borderColor = "#c94a4a";
			} else if (s.enterConeTick) {
				textColor = "#f3d9a4";
				borderColor = "#d49b3e";
			}

			ctx.save();
			ctx.font = "bold 10px Arial, sans-serif";
			const text = elapsedSeconds.toFixed(1) + "s";
			const textWidth = ctx.measureText(text).width;
			const padX = 5;
			const badgeW = Math.round(textWidth + padX * 2);
			const badgeH = 14;
			const badgeX = Math.round(x - badgeW * 0.5);
			const badgeY = Math.round(y + 13);

			ctx.fillStyle = bgColor;
			ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
			ctx.strokeStyle = borderColor;
			ctx.lineWidth = 1;
			ctx.strokeRect(badgeX + 0.5, badgeY + 0.5, badgeW - 1, badgeH - 1);

			ctx.fillStyle = textColor;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(text, x, badgeY + Math.round(badgeH * 0.5) + 0.5);
			ctx.restore();
		}
	}
}

var flankChronometer = new FlankChronometer();
