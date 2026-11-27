// Derived from RealityTracker (https://github.com/yossizap/realitytracker)
// Licensed under the GNU General Public License v3.0 (GPL-3.0)
// Modified by [KKCK] AlcatraZ.jpg, 2026 - see LICENSE for full terms

"use strict";

const Style_RedTeam = "#FF0000"
const Style_BlueTeam = "#0040FF"

const Style_SquadLeaderStroke = "white"
const Style_GruntStroke = "black"

const Style_Selection = "#BEA425"
const Style_SquadSelection = "#44FF00"

const Style_HealthBarGreen = "green"
const Style_HealthBarWreck = "#eeee00"
const Style_HealthBarRed = "red"




function interpolate(Start, End)
{
	if (typeof options_Interpolation !== "undefined" && !options_Interpolation) {
		return isNaN(End) ? Start : End;
	}
	if (isNaN(Start)) return End;
	if (isNaN(End)) return Start;

	return Start * (1 - interpolation_CurrentAmount) + End * interpolation_CurrentAmount;
}

function extrapolate(Start, End, extra)
{
	if (typeof options_Interpolation !== "undefined" && !options_Interpolation) {
		return isNaN(End) ? Start : End;
	}
	if (isNaN(Start)) return End;
	if (isNaN(End)) return Start;
	return Start * (1 - interpolation_CurrentAmount - extra) + End * (interpolation_CurrentAmount + extra);
}

function interpolateAngle(Start, End)
{
	if (typeof options_Interpolation !== "undefined" && !options_Interpolation) {
		return isNaN(End) ? Start : End;
	}
	if (isNaN(Start)) return End;
	if (isNaN(End)) return Start;
	const diff = (((End - Start) % 360) + 540) % 360 - 180;
	return Start + diff * interpolation_CurrentAmount;
}

// Ease-out exponential interpolation for player camera rotation.
// Human mouse movement is fast then stops — this covers ~80% of the turn
// in the first ~30% of the tick window (150ms of 500ms), then settles smoothly.
// Vehicles still use the linear interpolateAngle for realistic turret inertia.
function interpolateAngleFast(Start, End)
{
	if (typeof options_Interpolation !== "undefined" && !options_Interpolation) {
		return isNaN(End) ? Start : End;
	}
	if (isNaN(Start)) return End;
	if (isNaN(End)) return Start;
	const diff = (((End - Start) % 360) + 540) % 360 - 180;

	// ease-out exponential: f(t) = 1 - 2^(-10t)
	// At t=0.1 → 50%, t=0.2 → 75%, t=0.3 → 87%, t=0.5 → 97%
	const t = interpolation_CurrentAmount;
	const tEased = t >= 1.0 ? 1.0 : 1.0 - Math.pow(2, -10 * t);

	return Start + diff * tEased;
}

//for UI purposes only
var playSpeed = 1
	//black magic do not touch
function setSpeed(multiplier)
{
	playSpeed = multiplier
	updateHeader()
}

var interpolation_CurrentAmount = 0


// Current Camera position (Canvas X,Y of TopLeft corner on map) 
var CameraX = 100
var CameraY = 0
	// Current zoom 
var CameraZoom = 1
var MapImageDrawSize = 1024 //this helper value is ALWAYS CameraZoom * 1024
// Map size in km
var MapSize = 0

// Scale from game X/Y to canvas coordinates
function XtoCanvas(x)
{
	// To (-512,512) 
	x /= MapSize
		// To (0,1024) 
	x += 512
		// To zoom
	x *= CameraZoom
		// Camera Offset 
	x += CameraX

	return x
}

function YtoCanvas(y)
{
	// Y is inverted 
	y /= -MapSize
	y += 512
	y *= CameraZoom
	y += CameraY
	return y
}
//scale game length to canvas pixels. used for radius
function lengthtoCanvas(r)
{
	r /= MapSize
	r *= CameraZoom
	return r
}


function XtoWorld(x) {
	x -= CameraX;
	x /= CameraZoom;
	x -= 512;
	x *= MapSize;

	return x;
}
function YtoWorld(y) {
	y -= CameraY;
	y /= CameraZoom;
	y -= 512;
	y *= -MapSize;

	return y;
}

// canvas element
var Canvas
// the canvas' context
var Context
// the div the canvas is in
var mapDiv



var PlayerCircleSize = 8
// A list of vehicles that has a player of the selected squad in. reset and filled every draw (TODO just set it every Update/Select instead?)
var SquadVehicles


var options_canvasScale = 1;
function UIScaleChange() {

	const [x, y] = getCanvasCenter();
	const oldscale = options_canvasScale;
	const scale = $("#options_canvasScale")[0].value;
	changeSetting("options_canvasScale", scale)


	setCanvasCenterWithZoom(x, y, CameraZoom * oldscale / scale)
}


var gametimepassed = 0;
var gametimelasttime = NaN;

var renderer2d;
class Renderer2d {

	cameraPos = vec2.create();

	mouseClick(pos) {
		var initialdis = MinDistanceSquared * CameraZoom
		var minDis = initialdis
		var objectToSelect = null
		for (var I in AllPlayers) {
			var p = AllPlayers[I]
			const x = p.getX();
			const z = p.getZ();
			if (p.isJoining)
				continue

			var dis = Math.pow(XtoCanvas(x) - pos.X, 2) + Math.pow(YtoCanvas(z) - pos.Y, 2)
			if (dis < minDis) {
				objectToSelect = p
				minDis = dis
			}
		}
		for (var I in AllProj) {
			const p = AllProj[I]
			const x = p.getX();
			const z = p.getZ();
			var dis = (Math.pow(XtoCanvas(x) - pos.X, 2) + Math.pow(YtoCanvas(z) - pos.Y, 2)) * 2 // less click priority than players
			if (dis < minDis) {
				objectToSelect = p
				minDis = dis
			}
		}

		if (objectToSelect == null && typeof options_DrawBuildingWireframes !== "undefined" && options_DrawBuildingWireframes && typeof buildingHeightmap !== "undefined") {
			const obb = buildingHeightmap.getObbAtCanvasPos(pos.X, pos.Y);
			if (obb) return obb;
		}

		return objectToSelect;
	}

	getMousePos(event) {
		var rect = Canvas.getBoundingClientRect()

		return {
			X: (event.clientX - rect.left) / options_canvasScale,
			Y: (event.clientY - rect.top) / options_canvasScale
	};
}

	update(frameTime) {

	}

	draw() {
		var gametime = (Tick_Current + interpolation_CurrentAmount) * DemoTimePerTick;
		gametimepassed = Math.max(0, (gametime - (isNaN(gametimelasttime) ? gametime : gametimelasttime)));
		gametimelasttime = gametime;

		//Reset canvas width and height (Efficient, only does actual changes if value differs)
		Canvas.width = mapDiv.clientWidth
		Canvas.height = mapDiv.clientHeight
		Context.scale(options_canvasScale, options_canvasScale);

		//Clear canvas, reapply new background
		Context.clearRect(0, 0, Canvas.width, Canvas.height);

		mapRenderer.draw(Context);


		//Draw Flags
		Context.lineWidth = 1
		for (var i in AllFlags)
			drawFlag(i)


		//Draw Rallies
		Context.font = "bold 26px Arial";
		Context.strokeStyle = "green"
		Context.lineWidth = 2;
		for (var i in AllRallies)
			drawRally(i)

		//Draw killlines
		if (options_DrawKillLines)
			for (var i = 0, len = killLines.length; i < len; i++)
				killLine_Draw(killLines[i]);

		//Draw fobs
		Context.lineWidth = 1;
		Context.strokeStyle = "black"
		for (var i in AllFobs)
			drawFob(i)

		SquadVehicles = {}
		Context.font = "bold 12px Arial";
		for (var i in AllPlayers)
			if (i != SelectedPlayer)
				drawPlayer(i)


		for (var i in AllVehicles)
			drawVehicle(i)

		for (var i in AllCaches)
			drawCache(i)
		if (typeof drawSmokeScreens2D === "function")
			drawSmokeScreens2D()
		for (var i in AllProj)
			drawProj(i)
		if (typeof drawExplosions2D === "function")
			drawExplosions2D()

		//Draw selected player above everyone else
		if (SelectedPlayer != SELECTED_NOTHING)
			drawPlayer(SelectedPlayer)

		drawDemoAnalyserOverlay()
		flankChronometer.draw(Context)
		analyserTimeline.draw(Context)

		//Draw selected kill line
		if (SelectedKill != SELECTED_NOTHING)
			killLine_DrawSelected()


		if (options_drawAllOrderIcons)
			for (var index in AllSLOrders)
				drawOrderIcon(AllSLOrders[index])

		if (typeof buildingHeightmap !== 'undefined') {
			if (options_DrawHeightmapOverlay) buildingHeightmap.drawHeightmapOverlay(Context);
			if (options_DrawBuildingWireframes) buildingHeightmap.drawBuildingWireframes(Context);
			if (typeof options_DrawLOSCollisionPoints !== 'undefined' && options_DrawLOSCollisionPoints) buildingHeightmap.drawLOSCollisionPoints(Context);
		}

		animations.draw(Context);
    }
}
$(() => { renderer2d = new Renderer2d(); });


// enum -> [icon, color]
const orderEnums = [null,
	null,
	null,
	null,
	[0, "#cbc337"], // move
	[32, "#ff9900"], // target
	[64, "#ca32f2"], // defend
	[96, "#ca32f2"], // build
	[128, "#ff9900"], // destroy
	[160, "#ff9900"]  // observe
]


function drawOrderIconByTeamSquad(team, squad)
{
	const order = getOrderFromTeamSquad(team,squad)
	drawOrderIcon(order)
}

// TODO this needs to draw squad number
function drawOrderIcon(order)
{
	if (order == null || order.type == -1)
		return
	
	const e = orderEnums[order.type]
	if (e == null)
		return
	
	const iconX = e[0]
	const x = XtoCanvas(order.X)
	const y = YtoCanvas(order.Z)
	
	Context.drawImage(icons.squadorders, iconX + 6, 12, 20, 20, x - 10, y - 10, 20, 20) 

	
	Context.fillStyle = (order.team == 1) ? Style_RedTeam : Style_BlueTeam
	Context.fillText(order.squad, x + 5, y - 5)
}


function drawOrderVector(p, interpx, interpy)
{
	const team = p.team
	const squad = p.squad
	const order = getOrderFromTeamSquad(team,squad)
	if (order == null || order.type == -1)
		return
	
	const e = orderEnums[order.type]
	if (e == null)
		return
	
	const color = e[1]
	const X = XtoCanvas(order.X)
	const Y = YtoCanvas(order.Z)
	
	Context.save()
	
	Context.lineWidth = 3;
	Context.strokeStyle = color
	Context.beginPath()
	Context.moveTo(interpx, interpy)
	Context.lineTo(X, Y)
	Context.stroke()
	
	Context.restore()
}


var gunnerFOVSize = 45
var gunnerFOVArc = 0.02

var driverFOVSize = 5
var driverFOVArc = 0.15

var gunnerFOVSize_selected = 300
var gunnerFOVArc_selected  = 0.01

var driverFOVSize_selected  = 5
var driverFOVArc_selected  = 0.15


function drawPlayer(index)
{
	const p = AllPlayers[index]
	if (p.isJoining || p.ns_lastX == null) //Skip if joining or unknown pos
		return
	
	var x = p.getCanvasX()
	var y = p.getCanvasY()
	const rot = p.getRotation()
	const isSquadSelected = (p.team == SelectedSquadTeam && p.squad == SelectedSquadNumber)
	const isPlayerSelected = (SelectedPlayer == index)
	
	if (options_ClampVehiclesToMap)
	{
		x = clamp(CameraX, x, CameraX + MapImageDrawSize)
		y = clamp(CameraY, y, CameraY + MapImageDrawSize)
	}
	
	
	//Decide circle size
	if (options_DrawKitIcons || p.isSquadLeader)
		PlayerCircleSize = 8
	else
		PlayerCircleSize = 6
	
	
	Context.beginPath()

	//In vehicle (that is not a climbing vehicle), has to be alive
	if (p.vehicleid >= 0 && !isVehicleContainer(p.vehicleid))
	{
		if (isSquadSelected)
			SquadVehicles[p.vehicleid] = true
		
		switch (p.vehicleSlot)
		{
			case 0:
				setTeamSquadColor(p.team, 0)
				if (p.vehicleid == SelectedVehicle)
					drawFieldOfView(x, y, 1 * CameraZoom, driverFOVSize_selected * CameraZoom, rot, driverFOVArc_selected)
				else
					drawFieldOfView(x, y, 1 * CameraZoom, driverFOVSize * CameraZoom, rot, driverFOVArc)
				break
			case 1:
				if (!gunnerRotationSupported) // TODO for demos before 1.4.21. remove for version 4
					break
					
				setTeamSquadColor(p.team, 0)
				if (p.vehicleid == SelectedVehicle)
					drawFieldOfView(x, y, 1 * CameraZoom, gunnerFOVSize_selected * CameraZoom, rot, gunnerFOVArc_selected)
				else
					drawFieldOfView(x, y, 1 * CameraZoom, gunnerFOVSize * CameraZoom, rot, gunnerFOVArc)
				break
			case 2:
				break
		}
	}
	else //Not in vehicle (dead or alive)
	{
		if (p.isAlive) // Alive, not in vehicle
			drawPlayer_DrawAlive(p, x, y, rot)
		else
			drawPlayer_DrawDead(p, x, y)
		
		if (options_DrawKitIcons) //Draw mode Kit icons
			drawPlayer_DrawKit(p, x, y)
		else if (p.isSquadLeader) //Draw mode SL numbers
			drawPlayer_DrawSLNumber(p, x, y)
		
	}
	
	// Draw Orders
	if (isPlayerSelected || (isSquadSelected && p.isSquadLeader))
	{
		drawOrderVector(p, x, y)
		// If we're not drawing all icons, we need to draw this one
		if (!options_drawAllOrderIcons)
			drawOrderIconByTeamSquad(p.team, p.squad)
	}
}




function drawPlayer_DrawSLNumber(p, x, y)
{
	Context.fillStyle = "black"
	Context.font = "bold " + 15 + "px arial";
	Context.fillText(p.squad, x-4.5 , y+5)
}

function drawPlayer_DrawKit(p, x, y)
{
	Context.drawImage(p.ns_kitImage, x - 7, y - 7, 14, 14)
}

function drawPlayer_DrawDead(p, x, y)
{
	const outerstyle = p.isSquadLeader ? Style_SquadLeaderStroke : Style_GruntStroke
	var teamstyle
	
	if (p.id == SelectedPlayer) //is selected
		teamstyle = Style_Selection
	else if (p.team == SelectedSquadTeam && p.squad == SelectedSquadNumber) //is squad selected
		teamstyle = Style_SquadSelection
	else
		teamstyle = (p.team == 2) ? Style_BlueTeam : Style_RedTeam
		
	drawPlayer_DrawHollowWithInnerStroke(p, x, y, outerstyle, teamstyle)
	
}

function drawPlayer_DrawAlive(p, x, y, rot)
{
	const outerstyle = p.isSquadLeader ? Style_SquadLeaderStroke : Style_GruntStroke
	const teamstyle = (p.team == 2) ? Style_BlueTeam : Style_RedTeam
	if (p.team == SelectedSquadTeam && p.squad == SelectedSquadNumber) //is squad selected
	{
		if (p.id == SelectedPlayer) //is selected
			drawPlayer_DrawSelected(p, x, y, Style_SquadSelection)
		else
			drawPlayer_DrawNormal(p, x, y, Style_SquadSelection, outerstyle)

	}
	else if (p.id == SelectedPlayer) //is selected
		drawPlayer_DrawSelected(p, x, y, teamstyle)
	else
		drawPlayer_DrawNormal(p, x, y, teamstyle, outerstyle)
		
	
	if (options_health_players || HealthButtonDown)
		p.ns_healthRenderer.draw(x, y);

	// Heading arrow
	setTeamSquadColor(p.team, p.squad)
	drawHeadingArrow(x, y, rot, p.team)
	
	if (options_DrawKitIcons)
		drawPlayer_DrawKit(p, x, y)
}


function drawPlayer_DrawSelected(p, x, y, fill)
{
	Context.fillStyle = fill
	Context.strokeStyle = Style_Selection
	Context.beginPath()
	Context.arc(x, y, PlayerCircleSize, 0, Math.PI * 2)
	Context.fill()
	Context.lineWidth = 3
	Context.stroke()
}


function drawPlayer_DrawNormal(p, x, y, FillStyle, OuterStrokeStyle)
{
	Context.fillStyle = FillStyle
	Context.strokeStyle = OuterStrokeStyle
	Context.beginPath()
	Context.arc(x, y, PlayerCircleSize, 0, Math.PI * 2)
	Context.fill()
	Context.stroke()
}



function drawPlayer_DrawWithInnerStroke(p, x, y, FillStyle, OuterStrokeStyle, InnerStrokeStyle)
{
	Context.fillStyle = FillStyle
	Context.strokeStyle = InnerStrokeStyle
	Context.beginPath()
	Context.arc(x, y, PlayerCircleSize - 1, 0, Math.PI * 2)
	Context.fill()
	Context.stroke()

	Context.beginPath()
	Context.arc(x, y, PlayerCircleSize, 0, Math.PI * 2)
	Context.strokeStyle = OuterStrokeStyle
	Context.stroke()
}

function drawPlayer_DrawHollowWithInnerStroke(p, x, y, OuterStrokeStyle, InnerStrokeStyle)
{
	Context.strokeStyle = InnerStrokeStyle
	Context.beginPath()
	Context.arc(x, y, PlayerCircleSize - 1, 0, Math.PI * 2)
	Context.stroke()

	Context.strokeStyle = OuterStrokeStyle
	Context.beginPath()
	Context.arc(x, y, PlayerCircleSize, 0, Math.PI * 2)
	Context.stroke()
}


const HEALTH_WRECK = -1
const HEALTH_ERROR = -128
const DAMAGEINCOMING_PERCENT_PERSEC_CONST = 0.01

const DAMAGEINCOMING_PERCENT_PERSEC_MUL = 3.3;

class HealthRenderer {
	constructor(object) {
		this.reset(object);
	}

	reset(object) {
		this.object = object;
		this.incomingDamage = 0;
		this.activeDamageTexts = [];
	}

	draw(x, y) {
		const p = this.object;			

		if (p.health == HEALTH_ERROR)
			return

		const width = 24
		const height = 5
		const offsetX = -12
		const offsetY = -15
		const maxhealth = (p instanceof PlayerObject) ? 100 : p.maxHealth

		if (p.health == HEALTH_WRECK) {
			Context.fillStyle = Style_HealthBarWreck
			Context.fillRect(x + offsetX, y + offsetY, width, height);
		}
		else {
			if (this.incomingDamage > 0)
				this.incomingDamage = Math.max(0, this.incomingDamage
					- (gametimepassed * (DAMAGEINCOMING_PERCENT_PERSEC_CONST + this.incomingDamage * DAMAGEINCOMING_PERCENT_PERSEC_MUL)));


			const greenWidth = width * p.health / maxhealth 		
			const incomingDamageWidth = (width * this.incomingDamage)
			const redWidth = width - greenWidth - incomingDamageWidth

			var hx = x + offsetX
			var hy = y + offsetY
			Context.fillStyle = Style_HealthBarGreen
			Context.fillRect(hx, hy, greenWidth, height);
			hx += greenWidth;

			Context.fillStyle = "white";
			Context.fillRect(hx, hy, incomingDamageWidth, height);
			hx += incomingDamageWidth;

			Context.fillStyle = "#232323";
			Context.fillRect(hx, hy, redWidth, height);
		}
	}


	onDamage(obj, previous, now) {
		if (now >= previous) return;
		if (!this.activeDamageTexts) this.activeDamageTexts = [];
		const diff = previous - now;
		const text = `-${diff}`;
		if (typeof DamageText !== "undefined") {
			this.activeDamageTexts.push(new DamageText(text, performance.now()));
		}
		const maxhealth = (obj instanceof PlayerObject || !obj || !obj.maxHealth) ? 100 : obj.maxHealth;
		if (previous >= now && maxhealth > 0) {
			this.incomingDamage += (previous - now) / maxhealth;
		}
		else {
			this.incomingDamage = 0;
        }
    }
}


function setTeamSquadColor(team, squad)
{
	const style = getStyle(team, squad)
	Context.fillStyle = style
	Context.strokeStyle = style
}


/* Set the fill style and stroke style before calling this function. */
function drawFieldOfView(x, y, arclow, archigh, rot, size)
{
	Context.save()
	Context.translate(x, y)
	Context.rotate(rot / 180 * Math.PI)
	Context.beginPath()
	Context.arc(0, 0, arclow, (Math.PI * (18 / 12 + size / 2)), (Math.PI * (18 / 12 - size / 2)), true)
	Context.arc(0, 0, archigh, (Math.PI * (18 / 12 - size / 2)), (Math.PI * (18 / 12 + size / 2)))
	Context.closePath()
	/* Only make the filling transparent */
	Context.globalAlpha = 0.2
	Context.fill()
	Context.stroke()
	Context.restore()
}



// Set the fill style before calling this function
function drawHeadingArrow(x, y, rot)
{
	Context.save()
	Context.translate(x, y)
	Context.rotate(rot / 180 * Math.PI)
	Context.beginPath()
	Context.arc(0, 0, 11, 15 / 12 * Math.PI, 21 / 12 * Math.PI)
	Context.lineTo(0, -16)
	Context.closePath()
	Context.fill()
	Context.restore()
}

var bluforflag
var opforflag
var neutralflag
function drawFlag(i)
{
	const f = AllFlags[i]
	const x = XtoCanvas(f.X)
	const y = YtoCanvas(f.Z)
	
	
	if (f.team == 2)
	{
		Context.drawImage(bluforflag, x - 16, y - 16)
		Context.fillStyle = "rgba(0, 32, 255, 0.1)";
		Context.strokeStyle = "blue"
	}
	else if (f.team == 1)
	{
		Context.drawImage(opforflag, x - 16, y - 16)
		Context.fillStyle = "rgba(255, 0, 0, 0.1)";
		Context.strokeStyle = "red"
	}
	else
	{
		Context.drawImage(neutralflag, x - 16, y - 16)
		Context.fillStyle = "rgba(160, 160, 160, 0.15)";
		Context.strokeStyle = "gray"
	}


	//draw radius
	if (options_DrawFlagRadius)
	{
		var r = lengthtoCanvas(f.Radius)
		Context.beginPath()
		Context.arc(x, y, r, 0, 2 * Math.PI)
		Context.fill()
		Context.stroke()
	}
}

function drawFob(i)
{
	const fob = AllFobs[i]
	const x = XtoCanvas(fob.X)
	const y = YtoCanvas(fob.Z)

	if (fob.team == 2)
		Context.fillStyle = "blue"
	else
		Context.fillStyle = "red"
	
	
	//triangle
	Context.beginPath()
	Context.lineTo(x - 7, y + 7)
	Context.lineTo(x + 7, y + 7)
	Context.lineTo(x, y - 7)
	Context.fill()
	Context.stroke()

	//circle
	Context.fillStyle = "black"
	Context.beginPath()
	Context.arc(x, y + 2, 2.5, 0, 2 * Math.PI)
	Context.fill()
}

function drawVehicle(i)
{
	const v = AllVehicles[i]
		// if vehicle is empty and we don't draw empty vehicles, 
	if (!options_DrawEmptyVehicles && v.Passengers.size == 0)
		return
	//or if is a climbing/container vehicle, skip
	if (isVehicleContainer(i))
		return


	var x = v.getCanvasX();
	var y = v.getCanvasY();
	let rot = v.getRotation();
	if (v.ns_isStationaryWeapon && v.Passengers && v.Passengers.size > 0) {
		let opPlayer = null;
		v.Passengers.forEach((pid) => {
			const p = AllPlayers[pid];
			if (!p || !p.isAlive) return;
			if (!opPlayer || p.vehicleSlot === 0) opPlayer = p;
		});
		if (opPlayer && typeof opPlayer.getRotation === "function") {
			rot = opPlayer.getRotation();
		}
	}

	var color
	// if vehicle is selected 
	if (i == SelectedVehicle)
		color = 3
	else if (i in SquadVehicles)
		color = 2
	else if (v.team != 0)
		color = v.team - 1
	else
		color = 0 // TODO neutral vehicles color

	if (options_ClampVehiclesToMap)
	{
		x = clamp(CameraX, x, CameraX + MapImageDrawSize)
		y = clamp(CameraY, y, CameraY + MapImageDrawSize)
	}

	if (!v.ns_mapImage && v.ns_mapIconKey && coloredIcons[v.ns_mapIconKey]) {
		v.ns_mapImage = coloredIcons[v.ns_mapIconKey];
	}
	const mapImg = (v.ns_mapImage && v.ns_mapImage[color]) ? v.ns_mapImage[color] : null;
	if (!mapImg)
		return;

	Context.save()
	Context.translate(x, y)
	if (!v.isUAVVehicle)
		Context.rotate(rot / 180 * Math.PI)
	Context.drawImage(mapImg, -16, -16, 32, 32)
	Context.restore()

	if (v.isFlyingVehicle && options_DrawVehicleHeight)
	{
		Context.fillStyle = (v.team == 1) ? "red" : "blue"
		Context.fillText((v.Y / 1000).toFixed(2) + "k", x - 8, y + 18)
	}

	if (options_health_vehicles || HealthButtonDown)
		v.ns_healthRenderer.draw(x, y);
}

function drawRally(i)
{
	const R = AllRallies[i]
	const x = XtoCanvas(R.X)
	const y = YtoCanvas(R.Z)


	if (R.team == 2)
		Context.fillStyle = "blue"
	else
		Context.fillStyle = "red"
	

	Context.beginPath()
	var radius = 6
	Context.arc(x, y, radius, 0, 2 * Math.PI)
	Context.fill()
	Context.stroke()

	Context.fillStyle = "green"
	Context.font = "bold " + 9 + "px arial";

	if (R.squad != 0)
		var text = R.squad
	else
		var text = "C"

	/* measureText only returns width so we have to guess the approximate height */
	var width = Context.measureText(text).width;
	var height = Context.measureText("C").width;

	Context.fillText(text, x - (width / 2), y + (height / 2))
}


function drawCache(i)
{
	const cache = AllCaches[i]
	const x = XtoCanvas(cache.X)
	const y = YtoCanvas(cache.Z)
	if (cache.revealed)
		Context.drawImage(icons.CacheRevealed, x-13, y-13, 26, 26)
	else
		Context.drawImage(icons.CacheUnrevealed, x-13, y-13, 26, 26)
}


function drawProj(i)
{
	const proj = AllProj[i]
	if (!proj) return
	
	// Projectiles take a while to delete after hitting. Ignore fast projectiles when they stop moving
	if (proj.ns_isFast && Math.abs(proj.ns_lastX - proj.X) < 10 
					&& Math.abs(proj.ns_lastY - proj.Y) < 10 
					&& Math.abs(proj.ns_lastZ - proj.Z) < 10)
		return
	
	const x = proj.getCanvasX()
	const y = proj.getCanvasY()
	
	// Safe color index [0: Red/OpFor, 1: Blue/BluFor, 2: Squad Green, 3: Selected White]
	var color = 0
	if (proj.player != null)
	{
		const p = proj.player
		if (typeof SelectedPlayer !== "undefined" && SelectedPlayer == p.id)
		{
			color = 3
		}
		else if (typeof SelectedSquadTeam !== "undefined" && typeof SelectedSquadNumber !== "undefined" &&
				 p.team == SelectedSquadTeam && p.squad == SelectedSquadNumber)
		{
			color = 2
		}
		else
		{
			color = (p.team === 2) ? 1 : 0
		}
	}
	else
	{
		color = (proj.team === 2) ? 1 : 0
	}
	color = Math.max(0, Math.min(3, color))
	
	if (proj.ns_icon != null && proj.ns_icon[color] != null) 
	{
		Context.save()
		Context.translate(x, y)
		if (proj.type === 38) {
			// High-visibility fuse ring for live hand frag grenades (4.4s fuse)
			const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.015);
			Context.beginPath();
			Context.arc(0, 0, 10, 0, Math.PI * 2);
			Context.strokeStyle = `rgba(255, 168, 48, ${(0.55 + 0.35 * pulse).toFixed(2)})`;
			Context.lineWidth = 1.6;
			Context.stroke();
		}
		if (proj.ns_shouldRotate)
			Context.rotate(proj.rotation / 180 * Math.PI)
		Context.drawImage(proj.ns_icon[color], -8, -8) 
		Context.restore()
	}
	else 
	{
		const style = [Style_RedTeam, Style_BlueTeam, Style_SquadSelection, "white"][color] || "white"
		Context.save()
		Context.lineWidth = 2;
		Context.strokeStyle = style
		Context.beginPath()
		Context.moveTo(x-4, y-4)
		Context.lineTo(x+4, y+4)
		Context.moveTo(x+4, y-4)
		Context.lineTo(x-4, y+4)
		Context.stroke()
		Context.restore()
	}
}

function drawSmokeScreens2D()
{
	if (typeof syncBurningSmokeScreensFromAllProj === "function") {
		syncBurningSmokeScreensFromAllProj();
	}
	if (typeof ns_activeSmokeScreens3D === "undefined" || ns_activeSmokeScreens3D.length === 0) return;
	if (typeof computeSmokeCloudState !== "function") return;

	const currentT = (typeof Tick_Current !== "undefined" && typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null)
		? tickToTime[Tick_Current]
		: (performance.now() / 1000.0);

	Context.save();
	try {
		for (let i = ns_activeSmokeScreens3D.length - 1; i >= 0; i--) {
			const smk = ns_activeSmokeScreens3D[i];
			if (!smk) continue;

			// Track bouncing burning smoke canister live while still in AllProj
			if (smk.projId != null && typeof AllProj !== "undefined" && AllProj[smk.projId]) {
				const liveP = AllProj[smk.projId];
				const lx = (typeof liveP.getX === "function") ? liveP.getX() : liveP.X;
				const lz = (typeof liveP.getZ === "function") ? liveP.getZ() : liveP.Z;
				if (lx != null && !isNaN(lx) && lz != null && !isNaN(lz)) {
					smk.x = lx;
					smk.z = lz;
				}
			}

			let elapsed = 0;
			if (typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null && smk.startTimeSeconds > 0) {
				elapsed = currentT - smk.startTimeSeconds;
			} else {
				elapsed = (performance.now() - smk.spawnTime) / 1000.0;
			}

			if (elapsed < 0 || elapsed >= smk.totalDuration) {
				if (elapsed >= smk.totalDuration) {
					ns_activeSmokeScreens3D.splice(i, 1);
				}
				continue;
			}

			const st = computeSmokeCloudState(smk, elapsed);
			if (!st.visible || st.alpha <= 0.02) continue;

			const cx = XtoCanvas(smk.x);
			const cy = YtoCanvas(smk.z);
			if (isNaN(cx) || isNaN(cy)) continue;

			const col = Array.isArray(smk.color) ? smk.color : [0.95, 0.96, 0.98];
			const isNeutralWhite = (Math.abs(col[0] - col[1]) < 0.06 && Math.abs(col[1] - col[2]) < 0.06);
			const r255 = isNeutralWhite ? 245 : Math.round(Math.min(1.0, col[0]) * 255);
			const g255 = isNeutralWhite ? 248 : Math.round(Math.min(1.0, col[1]) * 255);
			const b255 = isNeutralWhite ? 252 : Math.round(Math.min(1.0, col[2]) * 255);

			// Clean 2D white wave: expands during propagation/burst, holds at peak, and contracts smoothly while dissipating
			const peakEnd = (smk.mode === "burning") ? (smk.burnEnd || 60.0) : (smk.peakDuration || 40.0);
			let waveScale = st.radiusScale;
			if (elapsed > peakEnd) {
				const fadeP = Math.max(0.0, Math.min(1.0, (elapsed - peakEnd) / Math.max(0.1, smk.totalDuration - peakEnd)));
				waveScale = Math.max(0.06, 1.0 - fadeP * 0.92);
			}

			const radPx = Math.max(3.0, lengthtoCanvas(smk.maxRadius * waveScale));
			const alpha = Math.max(0.0, Math.min(1.0, st.alpha));

			// Soft white inner fill
			const grad = Context.createRadialGradient(cx, cy, 0, cx, cy, radPx);
			grad.addColorStop(0.0, `rgba(${r255}, ${g255}, ${b255}, ${(alpha * 0.42).toFixed(3)})`);
			grad.addColorStop(0.55, `rgba(${r255}, ${g255}, ${b255}, ${(alpha * 0.24).toFixed(3)})`);
			grad.addColorStop(1.0, `rgba(${r255}, ${g255}, ${b255}, 0)`);
			Context.fillStyle = grad;
			Context.beginPath();
			Context.arc(cx, cy, radPx, 0, Math.PI * 2);
			Context.fill();

			// Crisp white outer wave ring (matches 2D frag wave style)
			Context.beginPath();
			Context.arc(cx, cy, radPx, 0, Math.PI * 2);
			Context.strokeStyle = `rgba(${r255}, ${g255}, ${b255}, ${(alpha * 0.82).toFixed(3)})`;
			Context.lineWidth = 1.6;
			Context.stroke();
		}
	} finally {
		Context.restore();
	}
}

function drawExplosions2D()
{
	if (typeof ns_activeExplosions3D === "undefined" || ns_activeExplosions3D.length === 0) return;

	const now = performance.now();
	Context.save();
	try {
		for (let i = ns_activeExplosions3D.length - 1; i >= 0; i--) {
			const exp = ns_activeExplosions3D[i];
			if (!exp) continue;
			const elapsed = (now - exp.spawnTime) / 1000.0;
			if (elapsed < 0 || elapsed >= exp.duration) {
				if (elapsed >= exp.duration) ns_activeExplosions3D.splice(i, 1);
				continue;
			}
			const p = elapsed / exp.duration;
			const ease = 1.0 - Math.pow(1.0 - p, 2.2);
			const radPx = Math.max(3.0, lengthtoCanvas(exp.maxRadius * ease));
			const cx = XtoCanvas(exp.x);
			const cy = YtoCanvas(exp.z);
			if (isNaN(cx) || isNaN(cy)) continue;

			const alpha = Math.pow(1.0 - p, 1.4);
			const grad = Context.createRadialGradient(cx, cy, 0, cx, cy, radPx);
			grad.addColorStop(0.0, `rgba(255, 224, 130, ${(alpha * 0.75).toFixed(3)})`);
			grad.addColorStop(0.45, `rgba(255, 128, 36, ${(alpha * 0.45).toFixed(3)})`);
			grad.addColorStop(1.0, `rgba(255, 80, 20, 0)`);
			Context.fillStyle = grad;
			Context.beginPath();
			Context.arc(cx, cy, radPx, 0, Math.PI * 2);
			Context.fill();

			Context.beginPath();
			Context.arc(cx, cy, radPx, 0, Math.PI * 2);
			Context.strokeStyle = `rgba(255, 196, 82, ${(alpha * 0.85).toFixed(3)})`;
			Context.lineWidth = exp.isHuge ? 2.2 : 1.5;
			Context.stroke();
		}
	} finally {
		Context.restore();
	}
}


function getStyle(Team, Squad)
{
	return (Team == 2) ? opSquadColors[Squad] : bluSquadColors[Squad]
}


function getCanvasCenter() {
	const x = XtoWorld((Canvas.width / 2) / options_canvasScale);
	const y = YtoWorld((Canvas.height / 2) / options_canvasScale);
	return [x, y];
}


function setCanvasCenterWithZoom(x, y, zoom) {
	CameraZoom = zoom;
	MapImageDrawSize = 1024 * CameraZoom
	Canvas.width = mapDiv.clientWidth
	Canvas.height = mapDiv.clientHeight

	CameraX = 0;
	CameraY = 0;


	CameraX = (-XtoCanvas(x) + (Canvas.width / 2) / options_canvasScale)
	CameraY = (-YtoCanvas(y) + (Canvas.height / 2) / options_canvasScale)

	requestUpdate();
}