// Derived from RealityTracker (https://github.com/yossizap/realitytracker)
// Licensed under the GNU General Public License v3.0 (GPL-3.0)
// Modified by [KKCK] AlcatraZ.jpg, 2026 - see LICENSE for full terms

$(() => $("#selection").dialog(
{
	close: selection_DeselectCurrent,
	containment: "#mainContainer",
	autoOpen: false,
	width: "auto",
	minWidth: 260,
	maxWidth: 480,
	height: "auto",
	resizable: false,
	title: "Selection",
	position: { my: "left top+60", at: "left top+60" },
}))

$(() => {
	$("#selection")[0].onclick = () =>
	{
		selection_onClick()
	}
	$("#selection")[0].style.cursor = "pointer"
})


const SELECTED_NOTHING = -99999
// Currently selected player, to draw as white. takes priority over squad.
var SelectedPlayer = SELECTED_NOTHING
var SelectedVehicle = SELECTED_NOTHING
// Currently selected squad, to draw as green 
var SelectedSquadTeam = SELECTED_NOTHING
var SelectedSquadNumber = SELECTED_NOTHING

function selection_SelectObject(obj) {
	if (obj == null) {
		if (typeof buildingHeightmap !== "undefined") buildingHeightmap.setSelectedObb(null);
		selection_SelectPlayer(SELECTED_NOTHING);
	}
	else if (obj instanceof PlayerObject) {
		if (typeof buildingHeightmap !== "undefined") buildingHeightmap.setSelectedObb(null);
		selection_SelectPlayer(obj.id);
	}
	else if (obj instanceof ProjObject && obj.player != null) {
		if (typeof buildingHeightmap !== "undefined") buildingHeightmap.setSelectedObb(null);
		selection_SelectPlayer(obj.player.id, true);
	}
	else if (obj && obj._isBuildingObb) {
		selection_SelectPlayer(SELECTED_NOTHING);
		if (typeof buildingHeightmap !== "undefined") {
			buildingHeightmap.setSelectedObb(obj);
		}
		selection_UpdateInformationBox();
		$("#selection").dialog("open");
		requestUpdate();
	}
}

function selection_selectObjectSquad(object) {
	if (object != null)
	{
		if (object instanceof PlayerObject)
			selection_SelectPlayersSquad(object.id);
		else if (object instanceof ProjObject)
			selection_SelectPlayersSquad(object.player.id);
	}
	if (typeof buildingHeightmap !== "undefined") buildingHeightmap.setSelectedObb(null);
	selection_SelectPlayer(SELECTED_NOTHING);
}

function selection_SelectPlayer(i, allowHighlight)
{
	var selectingSamePlayer = (i == SelectedPlayer)
	// Undo previous selection 
	// a vehicle is currently selected. mark all players as deselected and deselect the vehicle
	if (SelectedVehicle != SELECTED_NOTHING)
	{
		playerRow_PlayerDeselectAll()
		if (SelectedVehicle in vehicleTables)
			vehicleTables[SelectedVehicle].classList.remove("vehicleTable-selected")
	}

	// A player was selected before 
	else if (SelectedPlayer != SELECTED_NOTHING)
		if (SelectedPlayer in playerRows)
			playerRows[SelectedPlayer].classList.remove("player-row-selected")

	SelectedVehicle = SELECTED_NOTHING
	SelectedPlayer = SELECTED_NOTHING

	// New selection 
	if (i != SELECTED_NOTHING && i in AllPlayers)
	{
		var p = AllPlayers[i]
		// newly selected player is in a vehicle 
		if (p.vehicleid >= 0 && !isVehicleContainer(p.vehicleid))
		{
			SelectedVehicle = p.vehicleid

			// select all players in that vehicle 
			for (var player in AllPlayers)
				selection_CheckIfPlayerInSelectedVehicle(player)

			// select vehicle on vehicle table
			if (SelectedVehicle in vehicleTables)
				vehicleTables[SelectedVehicle].classList.add("vehicleTable-selected")
		}
		
		//highlight player
		if (!selectingSamePlayer && allowHighlight && p.X && p.Z)
			highlight(p.X, p.Z)
		
		playerRows[i].classList.add("player-row-selected") //set row to selected
		SelectedPlayer = i

		$("#selection").dialog("open")
	}
	else
		$("#selection").dialog("close")

	selection_UpdateInformationBox()

	requestUpdate();
}


function selection_onClick()
{
	if (SelectedVehicle != SELECTED_NOTHING)
	{
		const veh = AllVehicles[SelectedVehicle]
		highlight(veh.X, veh.Z)
	}
	else if (SelectedPlayer != SELECTED_NOTHING)
	{
		const p = AllPlayers[SelectedPlayer]
		highlight(p.X, p.Z)
	}
}

// When clicking on a vehicle, for this release just select a passenger
function selection_SelectVehicle(i)
{
	const v = AllVehicles[i]
	
	if (v.Passengers.size == 0)
		console.log("Vehicle " + i + " is empty, but was selected")
	else
		selection_SelectPlayer(v.Passengers.values().next().value, true)
}


// Called on a every player that changed vehicle status to see if he's now in a selected vehicle
function selection_CheckIfPlayerInSelectedVehicle(i)
{
	const p = AllPlayers[i]

	if (p.vehicleid == SelectedVehicle)
		playerRows[i].classList.add("player-row-selected")
	else
		playerRows[i].classList.remove("player-row-selected")
}

function selection_SelectPlayersSquad(i)
{
	if (i != SELECTED_NOTHING && i in AllPlayers)
	{
		var p = AllPlayers[i]
		if (p.team != 0 && p.squad != 0)
			selection_SelectSquad(p.team, p.squad)
	}
}

function selection_SelectSquad(Team, Squad)
{
	// Deselect old squad
	if (SelectedSquadTeam != SELECTED_NOTHING)
	{
		var TableOld = $("#Squad" + SelectedSquadTeam + SelectedSquadNumber)[0]
		TableOld.classList.remove("scoreboard-squad-table-selected")
	}

	// Deselect current squad if selected again
	if (Team == SelectedSquadTeam && SelectedSquadNumber == Squad)
	{
		SelectedSquadTeam = SELECTED_NOTHING
		SelectedSquadNumber = SELECTED_NOTHING

	}
	// Select new squad
	else
	{
		$("#Squad" + Team + Squad)[0].classList.add("scoreboard-squad-table-selected")

		SelectedSquadTeam = Team
		SelectedSquadNumber = Squad
	}
	// Redraw map to color the squad
	requestUpdate();
}

function selection_DeselectCurrent()
{
	if (typeof buildingHeightmap !== "undefined") buildingHeightmap.setSelectedObb(null);
	selection_SelectPlayer(SELECTED_NOTHING);
}

function copyPlayerHash(e, hashStr)
{
	if (e) e.stopPropagation();
	if (!hashStr) return;

	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(hashStr).catch(() => {});
	} else {
		try {
			const ta = document.createElement("textarea");
			ta.value = hashStr;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand("copy");
			document.body.removeChild(ta);
		} catch (err) {}
	}

	const target = e ? (e.currentTarget || e.target) : null;
	if (target) {
		const range = document.createRange();
		range.selectNodeContents(target);
		const sel = window.getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
	}
}

// Centralized function to obtain the player's external statistics URL.
// To enable direct player stats profiles (e.g. LATAMSQUAD), uncomment the block below:
function getPlayerStatsUrl(p)
{
	if (!p) return null;

	// LATAM SQUAD Stats (Direct Profile by Player CD-Key Hash)
	// if (p.hash) {
	// 	return `https://stats.latamsquad.org/pr/player?id=${encodeURIComponent(p.hash)}&s=1`;
	// }

	return null;
}

// Rewrites the information box
function selection_UpdateInformationBox()
{
	const div = $("#selection")[0]
	div.innerHTML = ""
	div.classList.remove("color_Team1")
	div.classList.remove("color_Team2")
	
	// Vehicle is selected
	if (SelectedVehicle != SELECTED_NOTHING)
	{
		const v = AllVehicles[SelectedVehicle]
		div.innerHTML = "<b>" + escapeHtml(v.name) + "</b>"
		
		if (v.health > 0)
			div.innerHTML += "<br>Health: " + v.health

		const spdDiv = document.createElement("div");
		spdDiv.id = "selection_SpeedAcousticContainer";
		spdDiv.style.cssText = "margin-top: 0px;";
		div.appendChild(spdDiv);

		updateSelectionSpeedAcousticLabel();

		if (v.team == 1)
			div.classList.add("color_Team1")
		else	
			div.classList.add("color_Team2")
	}
	// Player is selected
	else if (SelectedPlayer != SELECTED_NOTHING)
	{
		var p = AllPlayers[SelectedPlayer]

		if (p.squad == 0)
		{
			if (p.isSquadLeader)
				div.innerHTML += "<b>Commander</b>"
			else
				div.innerHTML += "<b>Unassigned</b>"
		}
		else
		{
			const sqName = (typeof getSquadName === "function") ? getSquadName(p.team, p.squad) : "";
			const sqColor = (typeof getSquadColor === "function") ? getSquadColor(p.team, p.squad) : "";
			const sqDisplayName = sqName ? `${p.squad}. ${escapeHtml(sqName)}` : `Squad ${p.squad}`;
			const slText = p.isSquadLeader ? " (SL)" : "";
			if (sqColor) {
				div.innerHTML += `<span style="color: ${sqColor}; font-weight: bold;">${sqDisplayName}${slText}</span>`;
			} else {
				div.innerHTML += `<b>${sqDisplayName}${slText}</b>`;
			}
		} 

		const statsUrl = getPlayerStatsUrl(p);
		if (statsUrl) {
			div.innerHTML += `<br><a href="${statsUrl}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: none; font-weight: bold;" title="Ver estadísticas del jugador" onclick="event.stopPropagation();">${escapeHtml(p.name)}</a>`;
		} else {
			div.innerHTML += "<br><b>" + escapeHtml(p.name) + "</b>";
		}
		const imgNode = p.ns_kitImage.cloneNode(false);
		imgNode.width = 16;imgNode.height = 16;
		imgNode.style.verticalAlign = "text-bottom";
		imgNode.style.marginLeft = "3px";
		div.appendChild(imgNode)
		div.innerHTML += "<br>Height: " + p.Y	
		if (p.health > 0) 
			div.innerHTML += "<br>Health: " + p.health
		if (p.hash)
			div.innerHTML += `<br>Hash: <span id="playerSelectionHashVal" onclick="copyPlayerHash(event, '${escapeHtml(p.hash)}')" style="cursor: copy; user-select: all;" title="Click to copy hash">${escapeHtml(p.hash)}</span>`

		const spdDiv = document.createElement("div");
		spdDiv.id = "selection_SpeedAcousticContainer";
		spdDiv.style.cssText = "margin-top: 0px;";
		div.appendChild(spdDiv);

		updateSelectionSpeedAcousticLabel();

		if (p.team == 1)
			div.classList.add("color_Team1")
		else	
			div.classList.add("color_Team2")
	}
	// Building Footprint is selected
	else if (typeof buildingHeightmap !== "undefined" && buildingHeightmap.selectedObb)
	{
		const b = buildingHeightmap.selectedObb;
		const typeStr = b.isVegetation ? "Vegetation Collision (Trunk)" : (b.isCustom ? "Custom Object" : (b.ignoreLOS ? "Non-LOS Barrier" : "PR Static Structure"));
		
		div.innerHTML = `
			<div style="font-size: 11px; line-height: 1.4; color: #fff; padding: 2px 0;">
				<div style="font-weight: bold; color: #fbbf24; font-size: 12px; margin-bottom: 3px; word-break: break-all;">
					🏛️ ${escapeHtml(b.name || 'Building')}
				</div>
				<div style="color: #94a3b8; font-size: 10px; margin-bottom: 5px;">
					Type: <span style="color: #38bdf8;">${typeStr}</span>
				</div>
				<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px 6px; font-size: 10.5px; background: rgba(255,255,255,0.06); padding: 5px 6px; border-radius: 3px;">
					<div><b>Width:</b> ${(b.width || 0).toFixed(1)}m</div>
					<div><b>Length:</b> ${(b.length || 0).toFixed(1)}m</div>
					<div><b>Height:</b> ${(b.height || 0).toFixed(1)}m</div>
					<div><b>Yaw/Rot:</b> ${(b.yaw || 0).toFixed(1)}°</div>
					<div><b>Pos X:</b> ${(b.x || 0).toFixed(1)}</div>
					<div><b>Pos Z:</b> ${(b.z || 0).toFixed(1)}</div>
					<div><b>Base Y:</b> ${(b.y || 0).toFixed(1)}</div>
					<div><b>Min Y:</b> ${(b.minY || 0).toFixed(1)}</div>
					<div><b>Max Y:</b> ${(b.maxY || 0).toFixed(1)}</div>
				</div>
			</div>
		`;
	}
}

function updateSelectionSpeedAcousticLabel() {
	const container = document.getElementById("selection_SpeedAcousticContainer");
	if (!container) return;

	if (typeof options_ShowSelectionSpeed === "undefined" || !options_ShowSelectionSpeed) {
		container.style.display = "none";
		return;
	}

	container.style.display = "block";

	if (typeof SelectedVehicle !== "undefined" && SelectedVehicle != SELECTED_NOTHING) {
		const veh = AllVehicles[SelectedVehicle];
		if (!veh || typeof getEntitySpeedKmh !== "function") return;
		const speedKmh = getEntitySpeedKmh(veh);
		let hasDriver = false;
		if (veh.Passengers && typeof veh.Passengers.forEach === "function") {
			veh.Passengers.forEach((pid) => {
				const passenger = AllPlayers[pid];
				if (passenger && (passenger.vehicleSlot === 0 || passenger.vehicleSlot == null || passenger.vehicleSlot === "0")) {
					hasDriver = true;
				}
			});
		}
		const vName = (veh.name || "").toLowerCase();
		const isHeavy = vName.includes("tnk") || vName.includes("tank") || vName.includes("apc") || vName.includes("bmp") || vName.includes("btr");
		const isHeli = vName.includes("heli") || vName.includes("uh60") || vName.includes("mi8") || vName.includes("ah1z");
		let acousticState = "Engine OFF";
		if (hasDriver) {
			let engineRadiusM = speedKmh >= 2.0 ? (isHeli ? 800 : isHeavy ? 450 : 250) : (isHeli ? 300 : isHeavy ? 100 : 60);
			acousticState = speedKmh >= 2.0 ? `Driving (${engineRadiusM}m sound)` : `Engine Idle (${engineRadiusM}m sound)`;
		}
		container.innerHTML = `Speed: ${speedKmh.toFixed(1)} km/h<br>Acoustic: ${acousticState}`;
	} else if (typeof SelectedPlayer !== "undefined" && SelectedPlayer != SELECTED_NOTHING) {
		const p = AllPlayers[SelectedPlayer];
		if (!p || typeof getEntitySpeedKmh !== "function") return;
		const speedKmh = getEntitySpeedKmh(p);
		const st = (typeof getPlayerStance === "function") ? getPlayerStance(p, speedKmh) : { text: "Stationary (0m)" };
		container.innerHTML = `Speed: ${speedKmh.toFixed(1)} km/h<br>Acoustic: ${st.text}`;
	}
}