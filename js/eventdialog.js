"use strict;"

//Options required:
//name
//height/width/minHeight/minWidth
//title
//rowWriteFunction ((obj,newRow) -> void), fill a row
//tableStyles

//All event dialogs by name
const eventDialogs = {}

function eventDialog(options)
{
	const name = options.name
	eventDialogs[name] = this
	const globalString = 'eventDialogs.'+name
	this.filterText = ""
	this.hideFuture = false
	
	//Called to set scroll to proper spot if lockScroll is checked
	this.updateScroll = function ()
	{
		if (this.lockScrollElement && this.lockScrollElement.checked)
		{
			this.ignoreScroll = true
			if (this.lastEvent == 0)
				this.element.scrollTop = 0
			else
			{
				let targetRow = this.DOMCollection[this.lastEvent - 1];
				for (let k = this.lastEvent - 1; k >= 0; k--) {
					if (this.DOMCollection[k] && this.DOMCollection[k].style.display !== "none") {
						targetRow = this.DOMCollection[k];
						break;
					}
				}
				if (targetRow) {
					this.element.scrollTop = targetRow.offsetTop +
					targetRow.offsetHeight -
					this.element.clientHeight
				}
			}
		}
	}
	
	//Called onScroll
	this.onScroll = function ()
	{
		if (this.ignoreScroll)
			this.ignoreScroll = false
		else if (this.lockScrollElement)
			this.lockScrollElement.checked = false
	}

	this.applyRowFilter = function (row, index)
	{
		if (!row) return;
		const isFuture = index >= this.lastEvent;
		if (isFuture) row.classList.add("futureRow");
		else row.classList.remove("futureRow");

		let visible = true;
		if (this.hideFuture && isFuture) {
			visible = false;
		}
		if (visible && this.filterText) {
			const txt = (row.textContent || "").toLowerCase();
			if (!txt.includes(this.filterText)) visible = false;
		}
		row.style.display = visible ? "" : "none";
	}

	this.applyFilterAll = function ()
	{
		const inp = document.getElementById(name + "FilterInput");
		const chk = document.getElementById(name + "HideFuture");
		this.filterText = inp ? inp.value.trim().toLowerCase() : "";
		this.hideFuture = chk ? !!chk.checked : false;
		for (let i = 0; i < this.DOMCollection.length; i++) {
			this.applyRowFilter(this.DOMCollection[i], i);
		}
		this.updateScroll();
	}
	
	//Enable the next row.
	this.enableOne = function ()
	{
		const row = this.DOMCollection[this.lastEvent];
		this.lastEvent++
		this.applyRowFilter(row, this.lastEvent - 1)
		this.updateScroll()
	}
	
	//Enable to a specific Row.
	this.reenable = function (newIterator)
	{
		const oldLast = this.lastEvent;
		this.lastEvent = newIterator;
		const minIdx = Math.max(0, Math.min(oldLast, newIterator) - 1);
		const maxIdx = Math.min(this.DOMCollection.length, Math.max(oldLast, newIterator) + 1);
		for (var i = minIdx; i < maxIdx; i++) {
			this.applyRowFilter(this.DOMCollection[i], i);
		}
		this.updateScroll()
	}
	
	
	//The given row writing function
	this.rowWriteFunction = options.rowWriteFunction
	
	//Called when a new event is parsed (Only in initial parsing or network mode)
	this.newEvent = function(obj)
	{
		const newRow = $("#"+name+"Table")[0].insertRow(-1) //Create a new row
		this.rowWriteFunction(obj,newRow) //Use the custom function to style the row
		newRow.classList.add('futureRow') 
		this.DOMCollection.push(newRow) //Add it to our cached array
		this.applyRowFilter(newRow, this.DOMCollection.length - 1)
	}
	
	//Append new HTML
	$("#floaters")[0].innerHTML+=(
		'<div id="'+name+'Container">' +
			'<div class="eventDialogFilterBar" style="display:flex; align-items:center; gap:6px; padding:2px 4px; background:#23262b; border-bottom:1px solid #34313a; font-size:11px;">' +
				'<input type="text" id="'+name+'FilterInput" placeholder="Filter..." oninput="'+globalString+'.applyFilterAll()" style="flex:1; min-width:70px; background:#172322; color:#eee; border:1px solid #433f4a; border-radius:2px; padding:1px 5px; font-size:11px;">' +
				'<label style="display:inline-flex; align-items:center; gap:3px; color:#b7c0bf; cursor:pointer; white-space:nowrap;" title="Show only events up to current time">' +
					'<input type="checkbox" id="'+name+'HideFuture" onchange="'+globalString+'.applyFilterAll()" style="margin:0;"> Up to now' +
				'</label>' +
			'</div>' +
			'<div id="'+name+'"><table id="'+name+'Table"></table></div>' +
		'</div>'
	)
	
	//Set Styles
	$("#"+name)[0].setAttribute("style", "overflow-x: hidden;overflow-y: auto;width: 100%;height: calc(100% - 24px);")

	
	
	//Set the new HTML as dialog
	$("#"+name+"Container").dialog(
	{
		classes:
		{
			"ui-dialog-titlebar": name+"Title" //Set special class for title so its easily selectable (Bit of a hac
		},
		height: options.height,
		width: options.width,
		minHeight: options.minHeight,
		minWidth: options.minWidth,
		resize: () => this.updateScroll(), //These must be a lambda function because "this" means the object that called the function.
		open: () => this.updateScroll(),
		autoOpen: false,
		title: options.title,
		containment: "#mainContainer",
	})
	
	
	$("."+options.name+"Title").children("span").append(
		'<input type="checkbox" checked="" onclick="'+globalString+'.updateScroll()" id="'+name+'LockScroll" class="autoScroll">' +
		'Auto Scroll'
	);
	
	
	
	//Store "Pointers" to elements to save jquery lookups.
	this.lockScrollElement = $("#"+name+"LockScroll")[0]
	this.element = $("#"+name)[0]
	this.element.addEventListener("scroll", () => this.onScroll())
	this.tableElement = $("#"+name+"Table")[0]
	this.DOMCollection = []
	this.lastEvent = 0
	
	
	for (var style in options.tableStyles)
		this.tableElement.style[style] = options.tableStyles[style]
	
	
}


$(() => 
{
	new eventDialog({
		name: 'kills',
		height: 230,
		width: 610,
		minHeight: 60,
		minWidth: 200,
		title: "Kill Feed (X)",
		rowWriteFunction: kf_makeRow,
		tableStyles: {
			"fontSize": "12px"
		}
	})
	

	new eventDialog({
		name: 'chat',
		height: 400,
		width: 550,
		minHeight: 60,
		minWidth: 200,
		title: "Chat",
		rowWriteFunction: chat_makeRow,
		tableStyles: {
			"fontSize": "12px"
		}
	})
	

	new eventDialog({
		name: 'revives',
		height: 200,
		width: 350,
		minHeight: 80,
		minWidth: 300,
		title: "Revives (R)",
		rowWriteFunction: revive_makeRow,
		tableStyles: {
			"fontSize": "12px"
		}
	})
	
	new eventDialog({
		name: 'kitAllocations',
		height: 200,
		width: 350,
		minHeight: 80,
		minWidth: 300,
		title: "Kit Allocations (K)",
		rowWriteFunction: kit_makeRow,
		tableStyles: {
			"fontSize": "14px"
		}
	})
	
	new eventDialog({
		name: 'vehicleDestroyers',
		height: 300,
		width: 470,
		minHeight: 80,
		minWidth: 300,
		title: "Vehicles Destroyed",
		rowWriteFunction: vdestroy_makeRow,
		tableStyles: {
			"fontSize": "14px"
		}
	})
})



function setCellTeamColor(rowObject, cellIndex, team)
{
	if (team == 1)
		rowObject.cells[cellIndex].className = "color_Team1"
	else
		rowObject.cells[cellIndex].className = "color_Team2"
}

//Special row making functions

function insertTimeCellAtIndex(row,index,obj,dialog)
{
	row.insertCell(index).innerHTML = getTimeStringOfTick(Tick_Current)
	
	//add click event
	row.cells[index].onclick = () =>
	{
		//Disable scroll lock
		if (dialog && dialog.lockScrollElement) dialog.lockScrollElement.checked = false;
		goTo(Math.max(1, obj.tick - 1))
		if (Number.isFinite(obj.X) && Number.isFinite(obj.Y))
			highlight(obj.X, obj.Y)
	}
	
	row.cells[index].style.cursor = "pointer"
}

function insertNameCellAtIndex(row,index,obj,name,playerID,team)
{
	row.insertCell(index).textContent = name
	setCellTeamColor(row, index, team)
	
	//add click event
	addPlayerSelectFunctionToCell(row.cells[index],name,playerID,obj)
}

function addPlayerSelectFunctionToCell(cell, name, playerID, obj)
{
	cell.onclick = () =>
	{
		if (playerID in AllPlayers && name == AllPlayers[playerID].name) {
			selection_SelectPlayer(playerID, true)
		} else if (obj && Number.isFinite(obj.tick)) {
			goTo(Math.max(1, obj.tick - 1));
			if (playerID in AllPlayers) {
				selection_SelectPlayer(playerID, true);
			}
		}
	}
	cell.style.cursor = "pointer"
}


function vdestroy_makeRow(obj,row)
{
	insertTimeCellAtIndex(row,0,obj,eventDialogs.vehicleDestroyers)
	insertNameCellAtIndex(row,1,obj,obj.destroyerName,obj.destroyerID,obj.destroyerTeam)
	let vehName = obj.vehicleTemplate
	if (vehName in vehicleData)
		if (vehicleData[vehName].HudName != "")
			vehName = vehicleData[vehName].HudName
	
	
	row.insertCell(2).textContent = vehName
	setCellTeamColor(row, 2, obj.vehicleTeam)	
}

function kit_makeRow(obj,row)
{
	insertTimeCellAtIndex(row,0,obj,eventDialogs.kitAllocations)
	insertNameCellAtIndex(row,1,obj,obj.playerName,obj.playerID,obj.team)
	row.insertCell(2).textContent = obj.kitName
}

function revive_makeRow(obj, row)
{
	insertTimeCellAtIndex(row,0,obj,eventDialogs.revives)
	insertNameCellAtIndex(row,1,obj,obj.MedicName,obj.MedicID,obj.team)
	insertNameCellAtIndex(row,2,obj,obj.RevivedName,obj.RevivedID,obj.team)
}

function chat_makeRow(obj, row)
{
	insertTimeCellAtIndex(row,0,obj,eventDialogs.chat)
	
	
	var channelName = ""
	var colorClass = "color_Team"+obj.team
	var isSquadChat = false
	var team
	var squad
	//Above 0x30, special channels
	if (obj.channel >= 0x30)
		channelName = CHATCHANNELS[obj.channel]
	// if AllChat
	else if (obj.channel == 0x00)
		channelName = "All Chat"
	else 
	{
		team = ((obj.channel & 0xF0) >> 4)
		squad = ((obj.channel & 0x0F))
		channelName = "T"+ team
		if (squad != 0)
		{
			channelName += " Squad " + squad
			colorClass = "color_Squad"
			isSquadChat = true
		}
		else
		{
			channelName += " Team "
		}
	}
	
	row.className = colorClass
	
	row.insertCell(1).textContent = channelName
	
	row.insertCell(2).textContent = obj.speaker +":"
	addPlayerSelectFunctionToCell(row.cells[2],obj.speaker,obj.playerID)
	
	row.insertCell(3).textContent = obj.text 
	
	if (isSquadChat)
	{
		row.cells[1].onclick = () =>
		{
			selection_SelectSquad(team, squad)
		}
		row.cells[1].style.cursor = "pointer"
	}
	
	row.cells[2].onclick = () =>
	{
		if (obj.playerID in AllPlayers && obj.speaker == AllPlayers[obj.playerID].name)
			selection_SelectPlayer(obj.playerID,true)
		else
			selection_SelectPlayer(SELECTED_NOTHING)
		
	}
}

function kf_triggerKillReplay(kill)
{
	if (!kill) return;
	if (eventDialogs.kills && eventDialogs.kills.lockScrollElement) {
		eventDialogs.kills.lockScrollElement.checked = false;
	}

	const hz = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0) ? DetectedDemoHz : 3.0;
	const preRollTicks = Math.max(3, Math.round(3.5 * hz));
	const startTick = Math.max(1, (kill.tick || 1) - preRollTicks);

	window._suppressKillReplayCancel = true;
	try {
		goTo(startTick);
	} finally {
		window._suppressKillReplayCancel = false;
	}

	let focusX = Number(kill.AttackerX);
	let focusZ = Number(kill.AttackerY);
	let focusY = Number.isFinite(Number(kill.AttackerZ)) ? Number(kill.AttackerZ) : null;

	if (kill.AttackerID != null && (kill.AttackerID in AllPlayers)) {
		selection_SelectPlayer(kill.AttackerID, true);
		const atk = AllPlayers[kill.AttackerID];
		if (atk && Number.isFinite(atk.X) && Number.isFinite(atk.Z)) {
			focusX = atk.X;
			focusZ = atk.Z;
			focusY = Number.isFinite(atk.Y) ? atk.Y : focusY;
		}
	}

	if (Number.isFinite(focusX) && Number.isFinite(focusZ)) {
		if (typeof focusCameraOnWorldPos === "function") {
			focusCameraOnWorldPos(focusX, focusZ, focusY);
		}
		if (typeof highlight === "function") {
			highlight(focusX, focusZ, false);
		}
	}

	if (typeof toggleCameraTracking === "function") {
		toggleCameraTracking(true);
		if (typeof selection_UpdateInformationBox === "function") {
			selection_UpdateInformationBox();
		}
	}

	window._killReplayStopTick = (kill.tick || 1) + 1;
	if (typeof Start === "function") {
		Start();
	}
}

function kf_makeRow(kill, row)
{
	row.className = "killsRow"
	insertTimeCellAtIndex(row,0,kill,eventDialogs.kills)
	row.insertCell(1).innerHTML = kill.Distance + "m "
	insertNameCellAtIndex(row,2,kill,kill.AttackerName,kill.AttackerID,kill.AttackerTeam)
	
	const cell = row.insertCell(3)
	const weaponName = kill.Weapon
	cell.textContent = "[" + weaponName + "]"
	cell.title = kill.Weapon
	cell.style.cursor = "pointer"
	
	insertNameCellAtIndex(row,4,kill,kill.VictimName,kill.VictimID,kill.VictimTeam)

	// Clicking Time, Distance, Attacker, or Weapon replays the kill from ~3.5s before, tracks the killer, and auto-pauses when executed
	row.cells[0].onclick = () => kf_triggerKillReplay(kill);
	row.cells[1].style.cursor = "pointer";
	row.cells[1].onclick = () => kf_triggerKillReplay(kill);
	row.cells[2].onclick = () => kf_triggerKillReplay(kill);
	row.cells[3].onclick = () => kf_triggerKillReplay(kill);

	// Clicking Victim jumps to the kill moment and selects the victim
	row.cells[4].onclick = () => {
		if (eventDialogs.kills && eventDialogs.kills.lockScrollElement) {
			eventDialogs.kills.lockScrollElement.checked = false;
		}
		window._killReplayStopTick = null;
		const hz = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0) ? DetectedDemoHz : 3.0;
		goTo(Math.max(1, (kill.tick || 1) - Math.max(2, Math.round(1.5 * hz))));
		if (kill.VictimID != null && (kill.VictimID in AllPlayers)) {
			selection_SelectPlayer(kill.VictimID, true);
		}
		if (Number.isFinite(Number(kill.VictimX)) && Number.isFinite(Number(kill.VictimY))) {
			if (typeof focusCameraOnWorldPos === "function") {
				focusCameraOnWorldPos(Number(kill.VictimX), Number(kill.VictimY), Number.isFinite(Number(kill.VictimZ)) ? Number(kill.VictimZ) : null);
			}
			highlight(Number(kill.VictimX), Number(kill.VictimY), false);
		}
	};
	
	row.onmouseenter = () => kf_select(kill.index)
	row.onmouseleave = () => kf_select(SELECTED_NOTHING)
}


function kf_select(killid)
{
	SelectedKill = killid

	requestUpdate();
}