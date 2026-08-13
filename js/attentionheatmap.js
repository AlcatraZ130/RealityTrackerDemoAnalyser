// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// Attention / Vision Heatmap Engine

var options_DrawAttentionHeatmap = false;
var heatmapCache = new Map();

class AttentionHeatmap {
	constructor() {
		this.isComputing = false;
		this.progress = 0;
		this.cellSize = 50; // meters per grid cell
		this.rayLength = 4000; // meters: enough to cross the largest PR maps
		this.rayStep = 50;
	}

	getCacheKey(playerId) {
		return ServerName + "_" + StartTime + "_" + playerId +
			"_attention-v3_" + this.cellSize + "_" + this.rayLength;
	}

	compute(playerId, mode) {
		if (this.isComputing || !ServerName || SelectedPlayer === SELECTED_NOTHING) return;
		mode = "vision";
		
		const cacheKey = this.getCacheKey(playerId);
		const gridKey = "visionGrid";
		const maxWeightKey = "maxVisionWeight";
		const modeLabel = "vision heatmap";
		const cached = heatmapCache.get(cacheKey);
		if (cached && cached[gridKey]) {
			$("#heatmapStatus").text(modeLabel + " ready.");
			setTimeout(() => $("#heatmapStatus").text(""), 2500);
			requestUpdate();
			return;
		}

		this.isComputing = true;
		this.progress = 0;
		$("#heatmapStatus").text("Computing " + modeLabel + ": 0%...");

		const grid = new Map();
		let maxWeight = 0;
		let playerState = { X: 0, Y: 0, Z: 0, rotation: 0, hasPosition: false, hasRotation: false, isAlive: false };
		
		let msgIdx = 0;
		const totalMsgs = messageArrayObject.messages.length;
		const CHUNK_SIZE = 500;

		const processChunk = () => {
			let endIdx = Math.min(msgIdx + CHUNK_SIZE, totalMsgs);
			
			for (; msgIdx < endIdx; msgIdx++) {
				const FullMessage = messageArrayObject.getMessageAt(msgIdx);
				if (!FullMessage) continue;
				
				const MessageType = FullMessage.getUint8(0);
				
				if (MessageType === MESSAGETYPE.PLAYER_UPDATE) {
					let pos = 1;
					const length = FullMessage.byteLength;
					while (pos < length) {
						const flags = FullMessage.getUint16(pos, true);
						pos += 2;
						const id = FullMessage.getUint8(pos);
						pos++;

						if (id === playerId) {
							if (flags & PLAYERUPDATEFLAGS.TEAM) pos += 1;
							if (flags & PLAYERUPDATEFLAGS.SQUAD) pos += 1;
							if (flags & PLAYERUPDATEFLAGS.VEHICLE) {
								const vid = FullMessage.getInt16(pos, true);
								pos += 2;
								if (vid >= 0) {
									const seatName = getString(FullMessage, pos);
									pos += seatName.length + 1;
									pos += 1;
								}
							}
							if (flags & PLAYERUPDATEFLAGS.HEALTH) pos += 1;
							if (flags & PLAYERUPDATEFLAGS.SCORE) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.TEAMWORKSCORE) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.KILLS) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.DEATHS) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.PING) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.ISALIVE) {
								playerState.isAlive = FullMessage.getInt8(pos) === 1;
								pos += 1;
							}
							if (flags & PLAYERUPDATEFLAGS.ISJOINING) pos += 1;
							if (flags & PLAYERUPDATEFLAGS.POSITION) {
								playerState.X = FullMessage.getInt16(pos, true);
								playerState.Y = FullMessage.getInt16(pos + 2, true);
								playerState.Z = FullMessage.getInt16(pos + 4, true);
								playerState.hasPosition = true;
								pos += 6;
							}
							if (flags & PLAYERUPDATEFLAGS.ROTATION) {
								playerState.rotation = FullMessage.getInt16(pos, true);
								playerState.hasRotation = true;
								pos += 2;
							}
							if (flags & PLAYERUPDATEFLAGS.KIT) {
								const kit = getString(FullMessage, pos);
								pos += kit.length + 1;
							}
						} else {
							if (flags & PLAYERUPDATEFLAGS.TEAM) pos += 1;
							if (flags & PLAYERUPDATEFLAGS.SQUAD) pos += 1;
							if (flags & PLAYERUPDATEFLAGS.VEHICLE) {
								const vid = FullMessage.getInt16(pos, true);
								pos += 2;
								if (vid >= 0) {
									const seatName = getString(FullMessage, pos);
									pos += seatName.length + 1;
									pos += 1;
								}
							}
							if (flags & PLAYERUPDATEFLAGS.HEALTH) pos += 1;
							if (flags & PLAYERUPDATEFLAGS.SCORE) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.TEAMWORKSCORE) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.KILLS) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.DEATHS) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.PING) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.ISALIVE) pos += 1;
							if (flags & PLAYERUPDATEFLAGS.ISJOINING) pos += 1;
							if (flags & PLAYERUPDATEFLAGS.POSITION) pos += 6;
							if (flags & PLAYERUPDATEFLAGS.ROTATION) pos += 2;
							if (flags & PLAYERUPDATEFLAGS.KIT) {
								const kit = getString(FullMessage, pos);
								pos += kit.length + 1;
							}
						}
					}
				} else if (MessageType === MESSAGETYPE.TICK && playerState.hasPosition && playerState.isAlive && playerState.hasRotation) {
					const [fx, fz] = this.getForwardVector(playerState.rotation);
					for (let d = this.rayStep; d <= this.rayLength; d += this.rayStep) {
						const wx = playerState.X + fx * d;
						const wz = playerState.Z + fz * d;
						maxWeight = Math.max(maxWeight, this.addWeight(grid, wx, wz));
					}
				}
			}

			if (msgIdx < totalMsgs) {
				const pct = Math.floor((msgIdx / totalMsgs) * 100);
				$("#heatmapStatus").text(`Computing ${modeLabel}: ${pct}%...`);
				setTimeout(processChunk, 0);
			} else {
				const data = heatmapCache.get(cacheKey) || {};
				data[gridKey] = grid;
				data[maxWeightKey] = maxWeight;
				heatmapCache.set(cacheKey, data);
				this.isComputing = false;
				$("#heatmapStatus").text(modeLabel + " ready!");
				setTimeout(() => $("#heatmapStatus").text(""), 3000);
				requestUpdate();
			}
		};

		setTimeout(processChunk, 0);
	}

	getForwardVector(rotDeg) {
		const r = rotDeg / 180 * Math.PI;
		return [Math.sin(r), Math.cos(r)];
	}

	addWeight(grid, wx, wz) {
		const gridX = Math.floor(wx / this.cellSize);
		const gridZ = Math.floor(wz / this.cellSize);
		const key = gridX + "," + gridZ;
		const newWeight = (grid.get(key) || 0) + 1;
		grid.set(key, newWeight);
		return newWeight;
	}

	draw(ctx) {
		if (!options_DrawAttentionHeatmap || SelectedPlayer === SELECTED_NOTHING) return;
		
		const cacheKey = this.getCacheKey(SelectedPlayer);
		const data = heatmapCache.get(cacheKey);
		if (!data) return;

		if (options_DrawAttentionHeatmap)
			this.drawGrid(ctx, data.visionGrid, data.maxVisionWeight, intensity => {
				const hue = (1 - intensity) * 240;
				return "hsla(" + hue + ", 100%, 50%, " + (0.12 + intensity * 0.38) + ")";
			});
	}

	drawGrid(ctx, grid, maxWeight, colorForIntensity) {
		if (!grid || maxWeight === 0) return;
		const cSize = lengthtoCanvas(this.cellSize);
		ctx.save();
		for (const [key, weight] of grid.entries()) {
			const [gx, gz] = key.split(",").map(Number);
			const cx = XtoCanvas(gx * this.cellSize);
			const cy = YtoCanvas(gz * this.cellSize);
			ctx.fillStyle = colorForIntensity(weight / maxWeight);
			ctx.fillRect(cx, cy, cSize, cSize);
		}
		ctx.restore();
	}
}

var attentionHeatmap = new AttentionHeatmap();
