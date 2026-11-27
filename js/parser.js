// Derived from RealityTracker (https://github.com/yossizap/realitytracker)
// Licensed under the GNU General Public License v3.0 (GPL-3.0)
// Modified by [KKCK] AlcatraZ.jpg, 2026 - see LICENSE for full terms

"use strict";
//WARNNING do not dive in this file without https://docs.google.com/spreadsheets/d/1ArciEg1rkG_MHzSYWphje1s071a6kD2ojuD58nVmwAE/edit#gid=0

// "DataView" of the entire demo file 
var DataBuffer = null

// Amount of recording ticks in the file 
var Tick_Count = 0
// Current Tick 
var Tick_Current = 0

// Important functions and variables to call from drawing logic / GUI: 
// goTo(Tick) Go to a specific tick. Calls some UI updates
// Call Reset() to completely reset everything 
// Call loadDemo(URL) to load a PRDemo file from URL. Will call Reset() and update the map image according to the demo's header 
// Call Update() to advance by 1 recording tick. also update the variables below:	 // calls some UI updates depending on changes in the tick	


// AllPlayers: dictionary of all players by their id. Their object has a KitImage Icon field 
// AllVehicles: dictionary of all vehicles by their id. Their object has a Menu icon and Map Icon field 
// AllFobs: dictionary of all FoBs by their BF2 Object id 
// AllRallies: dictionary of all rallies by their Team and Squad, where the key equals ((Team - 1) * 128 + Squad)  
// AllFlags: dictionary of flags by their unique map-specific id. 
// These are also up to date at all times: 
var IPPort = ""
var ServerName = ""
var MaxPlayers = 0
var StartTime = 0
var roundLength = 0
var MapName = ""
var GameMode = ""
var Layer = 64
var BluForTeam = ""
var OpForTeam = ""

var tickets1 = 0
var tickets2 = 0

var DetectedDemoHz = 3.0
var IsHighTickrateDemo = false

const MESSAGETYPE = {
	SERVERDETAILS: 0x00,
	DODLIST: 0x01,

	PLAYER_UPDATE: 0x10,
	PLAYER_ADD: 0x11,
	PLAYER_REMOVE: 0x12,

	VEHICLE_UPDATE: 0x20,
	VEHICLE_ADD: 0x21,
	VEHICLE_DESTROYED: 0x22,

	FOB_ADD: 0x30,
	FOB_REMOVE: 0x31,

	FLAG_UPDATE: 0x40,
	FLAG_LIST: 0x41,

	KILL: 0x50,
	CHAT: 0x51,

	TICKETS_TEAM1: 0x52,
	TICKETS_TEAM2: 0x53,

	RALLY_ADD: 0x60,
	RALLY_REMOVE: 0x61,
	
	CACHE_ADD: 0x70,
	CACHE_REMOVE: 0x71,
	CACHE_REVEAL: 0x72,
	INTEL_CHANGE: 0x73,
	
	MARKER_ADD: 0x80,
	MARKER_REMOVE: 0x81,
	
	PROJ_UPDATE: 0x90,
	PROJ_ADD: 0x91,
	PROJ_REMOVE: 0x92,
	
	REVIVE: 0xA0,
	KITALLOCATED: 0xA1,
	SQUADNAME: 0xA2,
	SLORDERS: 0xA3,

	ROUNDEND: 0xf0,
	TICK: 0xf1,

	PRIVATEMESSAGE: 0xfd,
	ERRORMESSAGE: 0xfe,
};

var TIMESTEP = 0.04
var tickToTime = [0]
var _timeCounter = 0
function message_Tick(FullMessage)
{
	if (InitialParse)
	{
		_timeCounter += FullMessage.getUint8(1) * TIMESTEP
		tickToTime.push(_timeCounter)
	}
}



class GameObject
{
	constructor(X,Y,Z) {
		this.X = X
		this.Y = Y
		this.Z = Z
		this.team = 0;
		this.ns_geom = null;
		this.ns_geomName = "";
	}
	getX() {
		return this.X;
	}
	getZ() {
		return this.Z;
	}
	// Negate Z to convert from game's left hand system to glmatrix lib right hand stuff
	getPos() {
		return vec3.set(vec3create(), this.X, this.Y, -this.Z);
	}
	getRotation() {
		return 0
	}
	getCanvasX() {
		return XtoCanvas(this.getX())
	}
	getCanvasY() {
		return YtoCanvas(this.getZ())
	}
	getTeamColor3d() {
		switch (this.team) {
			case 0: return renderer3d.white;
			case 1: return renderer3d.red;
			case 2: return renderer3d.blue;
        }
	}
	getGeometry() {
		if (this.ns_geom == null) {
			//this.ns_geom = renderer3d.getGeometry(this.ns_geomName); 
			this.ns_geom = renderer3d.getGeometry3d(this.ns_geomName); // TEMP
        }
			
		return this.ns_geom;
    }
	onLoadState() {}
}

class InterpolatedGameObject extends GameObject
{
	constructor(X,Y,Z) {
		super(X,Y,Z)
		this.ns_lastX = X
		this.ns_lastY = Y
		this.ns_lastZ = Z
		this.ns_lastRotation = 0
		this.rotation = 0
		this.ns_posHistory = []
		this.ns_smoothedSpeedKmh = 0
	}

	getPos() {
		return vec3.set(vec3.create(),
			interpolate(this.ns_lastX, this.X),
			interpolate(this.ns_lastY, this.Y),
			-interpolate(this.ns_lastZ, this.Z));
	}

	getX() {
		return interpolate(this.ns_lastX, this.X);
	}
	getY() {
		return interpolate(this.ns_lastY, this.Y);
	}
	getZ() {
		return interpolate(this.ns_lastZ, this.Z);
	}
	getRotation() {
		return interpolateAngle(this.ns_lastRotation, this.rotation);
	}
	updateInterpHistory(){
		this.ns_lastX = this.X
		this.ns_lastY = this.Y
		this.ns_lastZ = this.Z
		this.ns_lastRotation = this.rotation;
	}
	recordPosHistory() {
		if (this.X != null && !isNaN(this.X) && this.Z != null && !isNaN(this.Z)) {
			if (!this.ns_posHistory) this.ns_posHistory = [];
			const currentT = (typeof Tick_Current !== "undefined" && typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null)
				? tickToTime[Tick_Current]
				: (typeof Tick_Current !== "undefined" ? Tick_Current * (typeof DemoTimePerTick !== "undefined" ? DemoTimePerTick : 0.04) : 0);

			const isVeh = (typeof VehicleObject !== "undefined" && this instanceof VehicleObject) || (this.Passengers !== undefined);
			if (this.ns_posHistory.length > 0) {
				const lastEntry = this.ns_posHistory[this.ns_posHistory.length - 1];
				const d = Math.hypot(this.X - lastEntry.x, this.Z - lastEntry.z);
				// Reset on respawn/teleport ONLY: 12m for on-foot soldiers, 450m for vehicles/jets (never wipe fast jets!)
				const teleportLimit = isVeh ? 450.0 : ((!this.vehicleid || this.vehicleid < 0) ? 12.0 : 450.0);
				if (d > teleportLimit) {
					this.ns_posHistory = [];
					this.ns_smoothedSpeedKmh = 0;
				} else if (isVeh && this.isFlyingVehicle) {
					// Skip duplicate stale ticks where the server didn't emit a new aircraft transform yet
					const curY = this.Y || 0;
					const curRot = this.rotation || 0;
					if (this.X === lastEntry.x && curY === lastEntry.y && this.Z === lastEntry.z && curRot === lastEntry.rot && (currentT - lastEntry.time) < 0.45) {
						return;
					}
				}
			}

			this.ns_posHistory.push({
				x: this.X,
				y: this.Y || 0,
				z: this.Z,
				rot: this.rotation || 0,
				time: currentT
			});

			if (this.ns_posHistory.length > 36) {
				this.ns_posHistory.shift();
			}
		}
	}
	onLoadState() {
		this.ns_posHistory = [];
		this.ns_smoothedSpeedKmh = 0;
		this.ns_stance = "stationary";
		this.updateInterpHistory();
	}
}


// Dictionary of all players 
var AllPlayers = {}
var CurrentMapCamoSuffix = "";
window.CurrentMapCamoSuffix = "";

function resolveSpawnSoldierBody(team, kitName) {
	if (typeof SOLDIER_LOADOUT_DB === "undefined" || !SOLDIER_LOADOUT_DB) return "";
	const bodies = SOLDIER_LOADOUT_DB.bodies || {};
	const spawnSkins = SOLDIER_LOADOUT_DB.spawnSkins || {};
	const facDefs = SOLDIER_LOADOUT_DB.factionDefaults || {};
	const kitMap = SOLDIER_LOADOUT_DB.kitMap || {};

	const kitLow = (kitName || "").toLowerCase().trim();
	if (kitLow && spawnSkins[kitLow] && bodies[spawnSkins[kitLow]]) {
		return spawnSkins[kitLow];
	}

	let fac = "";
	if (kitLow.startsWith("gungame_blue_")) {
		fac = (typeof BluForTeam !== "undefined" && BluForTeam) ? BluForTeam.toLowerCase() : "us";
	} else if (kitLow.startsWith("gungame_red_")) {
		fac = (typeof OpForTeam !== "undefined" && OpForTeam) ? OpForTeam.toLowerCase() : "ru";
	} else if (kitLow.includes("_")) {
		const prefix = kitLow.split("_")[0];
		if (facDefs[prefix]) fac = prefix;
	}
	if (!fac) {
		const teamFac = (team == 1)
			? (typeof OpForTeam !== "undefined" ? OpForTeam : "")
			: (typeof BluForTeam !== "undefined" ? BluForTeam : "");
		fac = (teamFac || "").toLowerCase();
	}
	// Strip faction suffix variants like _ziptie, _iron, _alt
	if (fac && !facDefs[fac] && fac.includes("_")) {
		const baseFac = fac.split("_")[0];
		if (facDefs[baseFac]) fac = baseFac;
	}
	if (!facDefs[fac]) {
		const aliases = { usmc: "us", british: "gb", canadian: "cf", russian: "ru", chinese: "ch", german: "ger", french: "fr", dutch: "nl", polish: "pl", israeli: "idf", ins: "meinsurgent" };
		if (aliases[fac] && facDefs[aliases[fac]]) fac = aliases[fac];
	}

	const role = (kitLow && kitMap[kitLow] && kitMap[kitLow][3]) ? kitMap[kitLow][3] : "rifleman";
	if (facDefs[fac]) {
		const pick = facDefs[fac][role] || facDefs[fac]["rifleman"] || facDefs[fac]["default"];
		if (pick && bodies[pick]) return pick;
	}
	return bodies["pr_us_soldier1"] ? "pr_us_soldier1" : (Object.keys(bodies)[0] || "");
}

class PlayerObject extends InterpolatedGameObject
{
	constructor(_id) {
		super(NaN,NaN,NaN)
		this.id = _id
		this.name = 'error!!!'
		this.isJoining = true
		this.isAlive = false
		this.squad = 0
		this.isSquadLeader = false
		this.vehicleid = -1
		this.vehicleSeatName = ""
		this.vehicleSlot = 0
		this.score = 0
		this.scoreTW = 0
		this.kills = 0
		this.deaths = 0
		this.ping = 0
		this.team = 0
		this.idle = 0
		this.kit = ""
		this.spawnSoldierBody = ""
		this.awaitingSpawnSkin = true

		this.health = 0

		this.rotation = 0

		this.ns_kitImage = icons[KitNameToImageDictionary["rifleman"]]

		this.ns_healthRenderer = new HealthRenderer(this);
		//Private data
		this.hash = null
		this.ip = null

		AllPlayers[this.id] = this
	}

	onLoadState() {
		super.onLoadState();
		this.ns_healthRenderer = new HealthRenderer(this);
		this.setKitImage();
		
	}
	setKitImage() {
		if (this.kit != "") {
			const parts = this.kit.split("_");
			var KitSubName = parts[1];
			if (parts[0] === "gungame" && parts.length >= 3) {
				const ggMap = {
					ar: "support",
					mg: "mg",
					dmr: "marksman",
					sniper: "sniper",
					rif: "rifleman",
					smg: "assault",
					shotgun: "specialist",
					pistol: "pilot",
					grenade: "assault",
					m79: "assault",
					claymore: "sapper",
					knife: "ninja",
					scorpion: "assault"
				};
				KitSubName = ggMap[parts[2]] || parts[2];
			}
			if (KitSubName in KitNameToImageDictionary && KitNameToImageDictionary[KitSubName] in icons)
				this.ns_kitImage = icons[KitNameToImageDictionary[KitSubName]]
			else {
				this.ns_kitImage = icons[KitNameToImageDictionary["rifleman"]]
				console.log("Parser: unknown kit name " + this.kit)
				if (!this.ns_kitImage)
					console.error("Parser: `rifleman` image in kitname-to-image dictionary must exist as fallback. Check the build script.")
			}
		}
	}
	getTeamColor3d() {
		if (SelectedPlayer == this.id)
			color = renderer3d.white;
		else if (this.team == SelectedSquadTeam && this.squad == SelectedSquadNumber)
			return renderer3d.green;
		else
			return this.team == 1 ? renderer3d.red : renderer3d.blue;
	}
}

const PLAYERUPDATEFLAGS = {
	TEAM: 1,
	SQUAD: 2,
	VEHICLE: 4,
	HEALTH: 8,
	SCORE: 16,
	TEAMWORKSCORE: 32,
	KILLS: 64,
	TEAMKILLS: 128,
	DEATHS: 256,
	PING: 512,

	ISALIVE: 2048,
	ISJOINING: 4096,
	POSITION: 8192,
	ROTATION: 16384,
	KIT: 32768
}

// TODO put these in another module?
// On what changes should we rewrite the row
const playerUpdate_StatusChange = 
	PLAYERUPDATEFLAGS.VEHICLE +
	PLAYERUPDATEFLAGS.ISALIVE +
	PLAYERUPDATEFLAGS.KIT +
	PLAYERUPDATEFLAGS.KILLS +
	PLAYERUPDATEFLAGS.DEATHS +
	PLAYERUPDATEFLAGS.SQUAD

// When to move the playerrow
const playerUpdate_TeamOrSquadChange = 
	PLAYERUPDATEFLAGS.TEAM +
	PLAYERUPDATEFLAGS.SQUAD

// When to rewrite selection
const playerUpdate_SelectionInfoChange = 
	playerUpdate_StatusChange +
	PLAYERUPDATEFLAGS.HEALTH
	PLAYERUPDATEFLAGS.POSITION


function PlayerUpdate(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const flags = FullMessage.getUint16(pos, true);
		pos += 2

		const id = FullMessage.getUint8(pos)
		const Player = AllPlayers[id];
		pos++

		if (flags & PLAYERUPDATEFLAGS.TEAM)
		{
			const newTeam = FullMessage.getInt8(pos++)
			if (Player.team !== newTeam) {
				Player.team = newTeam;
				Player.spawnSoldierBody = "";
				Player.awaitingSpawnSkin = true;
			}
		}
		if (flags & PLAYERUPDATEFLAGS.SQUAD)
		{
			const sqd = FullMessage.getUint8(pos++)

			Player.isSquadLeader = sqd >= 128
			Player.squad = sqd % 128
		}
		if (flags & PLAYERUPDATEFLAGS.VEHICLE)
		{
			const prevVehId = Player.vehicleid;
			RemovePlayerFromVehicle(id)
			onVehicleDataChange(Player.vehicleid)
			Player.vehicleid = FullMessage.getInt16(pos, true)
			pos += 2
			if (Player.vehicleid >= 0)
			{
				Player.vehicleSeatName = getString(FullMessage, pos)
				pos += Player.vehicleSeatName.length + 1

				Player.vehicleSlot = FullMessage.getInt8(pos)
				pos+=1
			}

			if (InitialParse && prevVehId !== Player.vehicleid) {
				_predRecordInterrupt(id, _timeCounter);
			}

			AddPlayerToVehicle(id)
			onVehicleDataChange(Player.vehicleid)
			onPlayerVehicleChange(id)
		}

		if (flags & PLAYERUPDATEFLAGS.HEALTH)
		{
			const val = FullMessage.getInt8(pos++, true);
			const prevHealth = Player.health;
			if (!isFastForwarding)
				Player.ns_healthRenderer.onDamage(Player, Player.health, val);
			Player.health = val;
			if (InitialParse && val > prevHealth) {
				_predOnPlayerHealthGain(Player, prevHealth, val, _timeCounter);
			}
		}

		if (flags & PLAYERUPDATEFLAGS.SCORE)
		{
			Player.score = FullMessage.getInt16(pos, true);
			pos += 2
		}

		if (flags & PLAYERUPDATEFLAGS.TEAMWORKSCORE)
		{
			Player.scoreTW = FullMessage.getInt16(pos, true);
			pos += 2
		}

		if (flags & PLAYERUPDATEFLAGS.KILLS)
		{
			Player.kills = FullMessage.getInt16(pos, true);
			pos += 2
		}

		if (flags & PLAYERUPDATEFLAGS.DEATHS)
		{
			Player.deaths = FullMessage.getInt16(pos, true);
			pos += 2
		}

		if (flags & PLAYERUPDATEFLAGS.PING)
		{
			Player.ping = FullMessage.getInt16(pos, true);
			pos += 2
		}
		if (flags & PLAYERUPDATEFLAGS.ISALIVE)
		{
			const wasAlive = Player.isAlive;
			if (FullMessage.getInt8(pos++) == 1)
			{
				Player.isAlive = true
				Player.isJoining = false
				if (!wasAlive) {
					Player.awaitingSpawnSkin = true;
					if (InitialParse) {
						Player.ns_predAliveSince = _timeCounter;
						_predRecordInterrupt(id, _timeCounter);
					}
				}
			}
			else
			{
				Player.isAlive = false
				if (wasAlive && InitialParse) {
					_predRecordInterrupt(id, _timeCounter);
				}
			}
		}
		if (flags & PLAYERUPDATEFLAGS.ISJOINING)
		{
			pos++; //This will be removed next protocl version
			//Player.isJoining = (FullMessage.getInt8(pos++) == 1);
		}
		if (flags & PLAYERUPDATEFLAGS.POSITION)
		{
			Player.X = FullMessage.getInt16(pos, true);
			Player.Y = FullMessage.getInt16(pos + 2, true);
			Player.Z = FullMessage.getInt16(pos + 4, true);
			pos += 6
			if (InitialParse) {
				_predRecordPosition(id, Player.X, Player.Z, _timeCounter);
			}
		}
		if (flags & PLAYERUPDATEFLAGS.ROTATION)
		{
			Player.rotation = FullMessage.getInt16(pos, true);
			pos += 2
		}

		if (flags & PLAYERUPDATEFLAGS.KIT)
		{
			const prevKit = Player.kit;
			Player.kit = getString(FullMessage, pos)
			pos += Player.kit.length + 1
			Player.setKitImage();
			if (InitialParse && prevKit && prevKit !== Player.kit) {
				_predRecordInterrupt(id, _timeCounter);
			}
			// Lock soldier skin (face/body armor) on spawn; preserve it across mid-game kit swaps
			if ((!Player.spawnSoldierBody || Player.awaitingSpawnSkin) && Player.kit) {
				Player.spawnSoldierBody = resolveSpawnSoldierBody(Player.team, Player.kit);
				Player.awaitingSpawnSkin = false;
			}
		}

		// Handle respawn with the exact same kit (no KIT packet emitted)
		if (Player.isAlive && Player.awaitingSpawnSkin && Player.kit) {
			Player.spawnSoldierBody = resolveSpawnSoldierBody(Player.team, Player.kit);
			Player.awaitingSpawnSkin = false;
		}

		// Stop before the events calling if doing initial parse
		if (InitialParse)
			continue

		// Reset interpolation if alive changed
		if (flags & PLAYERUPDATEFLAGS.ISALIVE)
			Player.updateInterpHistory();
		

		// Call events for each player
		if (flags & playerUpdate_StatusChange)
			onPlayerStatusChanged(id)

		if (flags & playerUpdate_TeamOrSquadChange)
			onPlayerTeamOrSquadChange(id)

		// TODO get rid of this
		if (flags & playerUpdate_SelectionInfoChange)
			onPlayerSelectionInfoChange(id)

	}

}

function PlayerAdd(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const unpacked = FullMessage.unPack(pos, "Bsss")
		pos+= unpacked[0]
		const parsed = unpacked[1]
		
		const p = new PlayerObject(parsed[0])
		p.name = parsed[1]
		p.hash = parsed[2]
		p.ip = parsed[3]
		if (InitialParse) {
			_predRecordInterrupt(parsed[0], _timeCounter);
		}

		playerRow_Create(parsed[0])
	}
}

function PlayerRemove(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const unpacked = FullMessage.unPack(pos, "B")
		pos+= unpacked[0]
		const parsed = unpacked[1]
		const id = parsed[0]
		
		RemovePlayerFromVehicle(id)
		onVehicleDataChange(AllPlayers[id].vehicleid, id)

		onPlayerLeave(id)
		delete AllPlayers[id]
	}
}

function AddPlayerToVehicle(id)
{
	const Player = AllPlayers[id]
	if (Player.vehicleid in AllVehicles)
		AllVehicles[Player.vehicleid].Passengers.add(id)
}

function RemovePlayerFromVehicle(id)
{
	const Player = AllPlayers[id]
		// update old vehicle object
	if (Player.vehicleid in AllVehicles)
		AllVehicles[Player.vehicleid].Passengers.delete(id)
}

// -- Vehicles 
// Dictionary of vehicles 
var AllVehicles = {}

class VehicleObject extends InterpolatedGameObject
{
	constructor(id)
	{
		super(NaN,NaN,NaN)
		this.id = id
		this.name = ""
		this.team = 0
		this.rotation = 0

		this.isFlyingVehicle = false
		this.isClimbingVehicle = false

		this.ns_menuImage = null
		this.ns_mapImage = coloredIcons["mini_shp_light"]

		this.maxHealth = 0
		this.health = 0

		this.Passengers = new Set()

		// Get current players inside
		for (var i in AllPlayers)
		{
			const p = AllPlayers[i]
			if (p.vehicleid == this.id)
				this.Passengers.add(i)
		}
		
		
		//No Update received for this vehicle yet
		this.isNew = true

		this.ns_healthRenderer = new HealthRenderer(this);

		AllVehicles[this.id] = this
	}

	getTeamColor3d() {
		if (SelectedVehicle == this.id)
			return renderer3d.white;
		else if (this.id in SquadVehicles)
			return renderer3d.green;
		else
			return this.team == 1 ? renderer3d.red : renderer3d.blue;
	}

	initializeGraphics() {
		this.ns_mapImage = null;
		this.ns_geomName = "";
		this.ns_menuImage = null;
		this.ns_isStationaryWeapon = false;

		const vLow = (this.name || "").toLowerCase();
		const isDeployableStruct = (
			vLow.startsWith("deployable_") || vLow.startsWith("fixed_") || vLow.startsWith("stationary_") ||
			vLow.endsWith("_stationary") || vLow.startsWith("aa_") || vLow.startsWith("aaa_") ||
			vLow.startsWith("sam_") || vLow.startsWith("ushmg_") || vLow.startsWith("2cm_flak") ||
			vLow.startsWith("88mm_flak") || vLow === "zis3" || vLow === "pak36" || vLow === "pak40" ||
			vLow === "zpu4" || vLow === "ammo_drop" || vLow.includes("ats_") || vLow.includes("aas_") ||
			vLow.includes("zu23") || vLow.includes("djigit") || vLow.includes("bipod")
		);

		const inferFallbackIcon = () => {
			if (vLow.includes("_acv_")) {
				if (vLow.includes("tent")) return { key: "svg_dep_commandpost", weapon: false };
				if (vLow.includes("technical") && coloredIcons["mini_tec_logi"]) return { key: "mini_tec_logi", weapon: false };
				if (coloredIcons["mini_apc_light"]) return { key: "mini_apc_light", weapon: false };
			}
			if (typeof isUAVVehicle === "function" && isUAVVehicle(vLow) && coloredIcons["crosshair_uav"]) {
				return { key: "crosshair_uav", weapon: false };
			}
			if (vLow === "ammo_drop") {
				return { key: "svg_dep_crate", weapon: false };
			}
			if (isDeployableStruct) {
				if (vLow.includes("tow") || vLow.includes("milan") || vLow.includes("kornet") || vLow.includes("hj8") || vLow.includes("spike") || vLow.includes("spg9")) {
					return { key: "mini_stw_atgm", weapon: true };
				} else if (vLow.includes("zu23") || vLow.includes("zpu4") || vLow.includes("flak") || vLow.startsWith("aa_") || vLow.startsWith("aaa_")) {
					return { key: "mini_stw_aa_medium", weapon: true };
				} else if (vLow.includes("stinger") || vLow.includes("djigit") || vLow.includes("igla") || vLow.includes("mistral") || vLow.includes("_aa") || vLow.startsWith("sam_")) {
					return { key: "mini_stw_aa_light", weapon: true };
				} else if (vLow.includes("mortar") || vLow.includes("podnos")) {
					return { key: "mini_stw_mortar", weapon: true };
				} else if (vLow.includes("50cal") || vLow.includes("tripod") || vLow.includes("dshk") || vLow.includes("kord") || vLow.includes("m2hb") || vLow.includes("m1910") || vLow.includes("mg42") || vLow.includes("agl") || vLow.startsWith("ushmg_") || vLow.endsWith("_stationary")) {
					return { key: "mini_stw_mg", weapon: true };
				} else if (vLow.includes("commandpost") || vLow.includes("_fob")) {
					return { key: "svg_dep_commandpost", weapon: false };
				} else if (vLow.includes("bunker") || vLow.includes("firebase") || vLow.includes("hideout") || vLow.includes("pillbox") || vLow.includes("outpost")) {
					return { key: "svg_dep_bunker", weapon: false };
				} else if (vLow.includes("sandbag") || vLow.includes("foxhole")) {
					return { key: "svg_dep_sandbags", weapon: false };
				} else if (vLow.includes("razorwire")) {
					return { key: "svg_dep_razorwire", weapon: false };
				} else if (vLow.includes("roadblock")) {
					return { key: "svg_dep_roadblock", weapon: false };
				} else if (vLow.includes("_csb_")) {
					return { key: "svg_dep_bridge", weapon: false };
				} else if (vLow.includes("crate")) {
					return { key: "svg_dep_crate", weapon: false };
				}
			}
			return { key: "", weapon: false };
		};

		if (this.name in vehicleData) {
			const data = vehicleData[this.name];
			let iconKey = (data.MiniMapIcon && data.MiniMapIcon !== "empty") ? data.MiniMapIcon : "";
			if (!iconKey && data.MenuIcon && data.MenuIcon.startsWith("menuicon_")) {
				const derived = "mini_" + data.MenuIcon.substring("menuicon_".length);
				if (coloredIcons[derived]) iconKey = derived;
			}
			let isWeaponIcon = false;
			if (!iconKey) {
				const inferred = inferFallbackIcon();
				iconKey = inferred.key;
				isWeaponIcon = inferred.weapon;
			}
			if (iconKey && iconKey.startsWith("mini_stw_")) {
				isWeaponIcon = true;
			}

			if (iconKey && coloredIcons[iconKey]) {
				this.ns_mapImage = coloredIcons[iconKey];
			} else if (iconKey && iconKey.startsWith("svg_dep_")) {
				this.ns_mapIconKey = iconKey;
			} else if (!isDeployableStruct && data.MiniMapIcon !== "empty") {
				this.ns_mapImage = coloredIcons["mini_shp_light"];
			}

			if (isWeaponIcon) {
				this.ns_isStationaryWeapon = true;
			}
			if (data.MenuIcon != "")
				this.ns_menuImage = icons[data.MenuIcon] //Menuimage is optional
			this.ns_geomName = data.Geometry;
		}
		else {
			const inferred = inferFallbackIcon();
			if (inferred.key && coloredIcons[inferred.key]) {
				this.ns_mapImage = coloredIcons[inferred.key];
			} else if (inferred.key && inferred.key.startsWith("svg_dep_")) {
				this.ns_mapIconKey = inferred.key;
			} else if (!isDeployableStruct) {
				this.ns_mapImage = coloredIcons["mini_shp_light"];
			}
			if (inferred.weapon || (inferred.key && inferred.key.startsWith("mini_stw_"))) {
				this.ns_isStationaryWeapon = true;
			}
			console.log("Parser: Vehicle Name not in dictionary: " + this.name)
		}
    }

	onLoadState() {
		super.onLoadState();
		this.ns_healthRenderer = new HealthRenderer(this);
		this.initializeGraphics();
	}
}

var VEHICLEUPDATEFLAGS = {
	TEAM: 0x01,
	POSITION: 0x02,
	ROTATION: 0x04,
	HEALTH: 0x08,
}

function VehicleAdd(FullMessage)
{
	var pos = 1
	const id = FullMessage.getInt16(pos, true)
	pos += 2

	var CurrentVehicle
	if (id in AllVehicles)
		CurrentVehicle = AllVehicles[id]
	else
		CurrentVehicle = new VehicleObject(id)

	CurrentVehicle.name = getString(FullMessage, pos)
	pos += CurrentVehicle.name.length + 1

	CurrentVehicle.maxHealth = FullMessage.getUint16(pos, true)
	pos += 2

	CurrentVehicle.isUAVVehicle = isUAVVehicle(CurrentVehicle.name)
	CurrentVehicle.isClimbingVehicle = isClimbingVehicle(CurrentVehicle.name)
	if (!CurrentVehicle.isClimbingVehicle)
	{
		CurrentVehicle.initializeGraphics();
	}

	CurrentVehicle.isFlyingVehicle = isFlyingVehicle(CurrentVehicle.name)
	CurrentVehicle.isJetVehicle = isJetVehicle(CurrentVehicle.name)
	if (CurrentVehicle.isClimbingVehicle || CurrentVehicle.ns_isStationaryWeapon || _predIsBuildableDeployable(CurrentVehicle.name)) {
		CurrentVehicle.trackMode = "";
	} else if (CurrentVehicle.isJetVehicle) {
		CurrentVehicle.trackMode = "jet";
	} else if (CurrentVehicle.isFlyingVehicle) {
		CurrentVehicle.trackMode = "heli";
	} else {
		CurrentVehicle.trackMode = "ground";
	}
	
}

function VehicleUpdate(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const flags = FullMessage.getUint8(pos)
		pos++

		const id = FullMessage.getInt16(pos, true)
		pos += 2

		const CurrentVehicle = AllVehicles[id]

		//Debugging, This should never happen
		if (CurrentVehicle == null)
		{
			console.log("Unknown vehicle " + id)
			return;
		}

		if (flags & VEHICLEUPDATEFLAGS.TEAM)
		{
			CurrentVehicle.team = FullMessage.getInt8(pos++)
		}
		if (flags & VEHICLEUPDATEFLAGS.POSITION)
		{
			CurrentVehicle.X = FullMessage.getInt16(pos, true)
			CurrentVehicle.Y = FullMessage.getInt16(pos + 2, true)
			CurrentVehicle.Z = FullMessage.getInt16(pos + 4, true)
			pos += 6
		}
		if (flags & VEHICLEUPDATEFLAGS.ROTATION)
		{
			CurrentVehicle.rotation = FullMessage.getInt16(pos, true)
			pos += 2
		}

		if (InitialParse && CurrentVehicle.trackMode && (flags & (VEHICLEUPDATEFLAGS.POSITION | VEHICLEUPDATEFLAGS.ROTATION))) {
			_vehTrackRecordSample(id, CurrentVehicle.trackMode, CurrentVehicle.name, _timeCounter, CurrentVehicle.X, CurrentVehicle.Y, CurrentVehicle.Z, CurrentVehicle.rotation);
		}

		if (flags & VEHICLEUPDATEFLAGS.HEALTH)
		{
			const val = FullMessage.getInt16(pos, true);
			const prevVehHealth = CurrentVehicle.health;
			if (!isFastForwarding)
				CurrentVehicle.ns_healthRenderer.onDamage(CurrentVehicle, CurrentVehicle.health, val);
			CurrentVehicle.health = val;
			pos += 2
			if (InitialParse && !CurrentVehicle.isNew && prevVehHealth != null && val !== prevVehHealth) {
				_predOnVehicleHealthChange(CurrentVehicle, prevVehHealth, val, _timeCounter);
			}

			onVehicleDataChange(id)
		}
		
		
		if (isNaN(CurrentVehicle.ns_lastX))
			CurrentVehicle.updateInterpHistory();
		
		
		// First update received for vehicle, do UI stuff
		if (CurrentVehicle.isNew)
		{
			CurrentVehicle.isNew = false
			if (InitialParse) {
				_predOnVehicleFirstPos(CurrentVehicle, _timeCounter);
			} else {
				onNewVehicle(id)
			}
		}
	}
}

// Reload passenger list of all vehicles. 
function RecheckAllVehicles()
{
	for (var vid in AllVehicles)
		AllVehicles[vid].Passengers = new Set()

	for (var id in AllPlayers)
	{
		const p = AllPlayers[id]

		if (p.vehicleid >= 0 && (p.vehicleid in AllVehicles))
			AllVehicles[p.vehicleid].Passengers.add(parseInt(id))
	}
}

// -- Flags 
var AllFlags = {}

class FlagObject extends GameObject
{
	constructor(id, Team, X, Y, Z, radius)
	{
		super(X,Y,Z)
		this.team = Team
		this.id = id
		this.Radius = radius

		AllFlags[id] = this
	}
}

function FlagList(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const res = FullMessage.unPack(pos, "HBhhhH")
		const parsed = res[1]
		new FlagObject(
				parsed[0], // Unique ID
				parsed[1], // Team (Starting)
				parsed[2], // X
				parsed[3], // Y
				parsed[4], // Z
				parsed[5]) // Radius
	
		pos += res[0]
	}
}

function FlagUpdate(FullMessage)
{
	const unpacked = FullMessage.unPack(1, "HB")
	const parsed = unpacked[1]
	if (parsed[0] in AllFlags)
		AllFlags[parsed[0]].team = parsed[1]
}

// Tickets 
function Tickets_Team1(FullMessage)
{
	tickets1 = FullMessage.getInt16(1, true)
}

function Tickets_Team2(FullMessage)
{
	tickets2 = FullMessage.getInt16(1, true)
}

var AllSLOrders = {}
function SLOrder(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const unpacked = FullMessage.unPack(pos, "Bbhhh")
		pos+= unpacked[0]
		const parsed = unpacked[1]
		
		new SLOrderObject(parsed[0], //(Team and Squad) 
			parsed[1], //type
			parsed[2], //X 
			parsed[3], //Y 
			parsed[4]) //Z 
	}
}

class SLOrderObject extends GameObject
{
	constructor(TeamSquad, type, X, Y, Z)
	{
		super(X,Y,Z)
		this.team = Math.floor(TeamSquad / 128) + 1
		this.squad = (TeamSquad % 128)
		this.type = type
		
		AllSLOrders[TeamSquad] = this
		if (typeof ordersHistory !== 'undefined') {
			ordersHistory.recordOrder(this);
		}
	}
}

function getOrderFromTeamSquad(team,squad)
{
	return AllSLOrders[(team-1) * 128 + squad]
}

// Rallies 
var AllRallies = {}

class RallyObject extends GameObject
{
	constructor(TeamSquad, X, Y, Z)
	{
		super(X,Y,Z)
		this.team = Math.floor(TeamSquad / 128) + 1
		this.squad = (TeamSquad % 128)
		
		AllRallies[TeamSquad] = this
	}
}

function RallyAdd(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const unpacked = FullMessage.unPack(pos, "Bhhh")
		pos+= unpacked[0]
		const parsed = unpacked[1]
		
		new RallyObject(parsed[0], //(Team and Squad) 
			parsed[1], //X 
			parsed[2], //Y 
			parsed[3]) //Z 
	}
}

function RallyRemove(FullMessage)
{
	const TeamSquad = FullMessage.getUint8(1)
	if (TeamSquad in AllRallies)
		delete AllRallies[TeamSquad]
}


// -- Fobs 
var AllFobs = {}

class FoBObject extends GameObject
{
	constructor(id, Team, X, Y, Z) 
	{
		super(X,Y,Z)
		this.id = id
		this.team = Team

		AllFobs[id] = this
	}
}

function FoBAdd(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const unpacked = FullMessage.unPack(pos, "iBhhh")
		pos+= unpacked[0]
		const parsed = unpacked[1]
		
		const fobObj = new FoBObject(parsed[0], //Object ID 
					parsed[1],       //Team 
					parsed[2], //X 
					parsed[3], //Y 
					parsed[4]) //Z 
		if (InitialParse) {
			_predOnFobAdd(fobObj, _timeCounter);
		}
	}
}

function FoBRemove(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const unpacked = FullMessage.unPack(pos, "i")
		pos+= unpacked[0]
		const parsed = unpacked[1]
		
		if (parsed[0] in AllFobs) {
			if (InitialParse) {
				_predOnFobRemove(parsed[0], _timeCounter);
			}
			delete AllFobs[parsed[0]]
		}
	}
}

// Caches
var AllCaches = {}

class CacheObject extends GameObject
{
	constructor(id, X, Y, Z)
	{
		super(X,Y,Z)
		this.id = id
		this.revealed = false

		AllCaches[id] = this
	}
}

function CacheAdd(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	
	while (pos != length)
	{
		const id = FullMessage.getUint8(pos,true)
		new CacheObject(id, //Cache ID (The module numbers them)
					FullMessage.getInt16(pos+1,true), //X 
					FullMessage.getInt16(pos+3,true), //Y 
					FullMessage.getInt16(pos+5,true)) //Z 
		pos+= 7
	}
}
function CacheReveal(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const id = FullMessage.getUint8(pos,true)
		AllCaches[id].revealed = true
		pos+=1
	}
}
function CacheDestroyed(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const id = FullMessage.getUint8(pos,true)
		delete AllCaches[id]
		pos+=1
	}
}

var AllProj = {}
class ProjObject extends InterpolatedGameObject
{
	constructor(id, playerid, type, templateName, rotation, X, Y, Z) {
		super(X,Y,Z)
		this.id = id
		
		this.rotation = rotation
		this.templateName = templateName
		this.type = type
		this.player = AllPlayers[playerid]
		this.team = this.player ? this.player.team : 1 // so if player disconnects while projectile in air we still have team.
		this.spawnTimeSec = (typeof Tick_Current !== "undefined" && typeof tickToTime !== "undefined" && tickToTime[Tick_Current] != null)
			? tickToTime[Tick_Current]
			: 0;
		
		
		AllProj[id] = this
		this.initializeNoState();
	}

	initializeNoState() {
		const tLow = (this.templateName || "").toLowerCase();
		const isSmk = (this.type === 39 || this.type === 41 || tLow.includes("smoke") || tLow.includes("smk") || tLow.includes("ugd"));
		this.ns_iconName = isSmk ? "proj_smoke" : ProjectileTypeToImageName[this.type];
		this.ns_icon = this.ns_iconName ? coloredIcons[this.ns_iconName] : null;
		this.ns_shouldRotate = isSmk ? false : ProjectileTypeShouldRotate[this.type];
		this.ns_isFast = false
	}
	getTeamColor3d() {
		const p = this.player;
		if (p == null)
			return super.getTeamColor3d();
		return p.getTeamColor3d();
	}
	onLoadState() {
		super.onLoadState();
		this.initializeNoState();
	}


}

function ProjUpdate(FullMessage) 
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length) 
	{
		const unpacked = FullMessage.unPack(pos, "Hhhhh")
		pos+= unpacked[0]
		const size = unpacked[0]
		const parsed = unpacked[1]
		const id = parsed[0]
		const proj = AllProj[id]
		
		proj.yaw = parsed[1]
		proj.X = parsed[2]
		proj.Y = parsed[3]
		proj.Z = parsed[4]

		if (InitialParse && proj) {
			_projTrackRecordSample(id, proj.type, _timeCounter, proj.X, proj.Y, proj.Z, proj.yaw);
		}
		
		proj.ns_isFast = proj.ns_isFast | (Math.pow(proj.X - proj.ns_lastX, 2) + Math.pow(proj.Z - proj.ns_lastZ, 2) > 1600 * DemoTimePerTick) // 40m/s
	}
}

function ProjAdd(FullMessage)
{
	const unpacked = FullMessage.unPack(1, "HBBshhhh")
	const parsed = unpacked[1]
	
	new ProjObject(parsed[0], // index
					parsed[1], // playerid
					parsed[2], // type
					parsed[3], // templateName
					parsed[4], // yaw
					parsed[5], parsed[6], parsed[7]) // xyz

	if (InitialParse) {
		_predOnProjAdd(parsed[1], parsed[2], parsed[3], _timeCounter);
		_projTrackRecordSample(parsed[0], parsed[2], _timeCounter, parsed[5], parsed[6], parsed[7], parsed[4]);
	}
	
}
function ProjRemoved(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	const id = FullMessage.getUint16(pos,true)
	delete AllProj[id]
}

//Insurgency Intel
var intel = 0
function intelChanged(FullMessage)
{
	intel = FullMessage.getInt8(1,true)
}


var SquadNames = {}
function SquadName(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const teamsquad = FullMessage.getUint8(pos,true)
		const team = (teamsquad > 127) ? 2 : 1
		const squad = (teamsquad & 0x0F)
		pos+=1
		
		const name = getString(FullMessage, pos)
		pos += name.length + 1
		
		if (!(team in SquadNames))
			SquadNames[team] = {}
			
		if (!(squad in SquadNames[team]))
			SquadNames[team][squad] = {}
		SquadNames[team][squad] = name
		
		if (!InitialParse)
			onSquadNameChanged(team, squad, name)
	}
}

function getSquadName(team,squad)
{
	if (!(team in SquadNames))
		return ''
	if (!(squad in SquadNames[team]))
		return ''
	return SquadNames[team][squad]
}




var TICKSPERSAVE = 100
var LatestState = -1
var isFastForwarding = false //Set to true to not do any UI updates when fast forwarding

function getNearestSavedTickBefore(targetTick)
{
	const rounded = targetTick - (targetTick % TICKSPERSAVE)
	if (rounded === 0 || (rounded in savedStates))
		return rounded

	let best = 0
	for (var k in savedStates)
	{
		const tk = Number(k)
		if (tk <= targetTick && tk > best)
			best = tk
	}
	return best
}

function clearTransientTacticalState()
{
	if (typeof spottedPlayerEntryMap !== "undefined" && spottedPlayerEntryMap) spottedPlayerEntryMap.clear();
	if (typeof spottedVehicleEntryMap !== "undefined" && spottedVehicleEntryMap) spottedVehicleEntryMap.clear();
	if (typeof ns_activeShockwaves !== "undefined" && Array.isArray(ns_activeShockwaves)) ns_activeShockwaves.length = 0;
	if (typeof flankChronometer !== "undefined" && flankChronometer && flankChronometer.state) {
		flankChronometer.state.clear();
		flankChronometer.lastTick = -1;
	}
	if (typeof ns_activeExplosions3D !== "undefined" && Array.isArray(ns_activeExplosions3D)) ns_activeExplosions3D.length = 0;
	if (typeof ns_activeLaunchSmoke3D !== "undefined" && Array.isArray(ns_activeLaunchSmoke3D)) ns_activeLaunchSmoke3D.length = 0;
	if (typeof ns_activeSmokeScreens3D !== "undefined" && Array.isArray(ns_activeSmokeScreens3D)) ns_activeSmokeScreens3D.length = 0;
}

function goTo(Tick_Target)
{
	Tick_Target = Number(Tick_Target)
	if (isNaN(Tick_Target))
		return

	if (!window._suppressKillReplayCancel)
		window._killReplayStopTick = null

	// If its the same tick, do nothing 
	if (Tick_Target == Tick_Current)
		return
		// if the bar was dragged below first tick, load the first tick.
	if (Tick_Target < 1)
		Tick_Target = 1 
		// if its after the last tick, load the last state 
	if (Tick_Target >= Tick_Count)
		Tick_Target = Tick_Count - 1 

	const jumpMin = Math.round(TICKSPERSAVE * 1.5)

	// If its a forward tick, Check if we can shortcut by using a stored future state 
	if (Tick_Target > Tick_Current)
	{
		// If its close do not load any states 
		if (Tick_Target < Tick_Current + jumpMin)
		{}

		//if latest state is before current, then loading will not help. Do nothing.
		else if (LatestState < Tick_Current)
		{}

		// Latest state is before target, load the latest to shortcut as much as possible 
		else if (LatestState < Tick_Target && (LatestState in savedStates))
			loadState(LatestState);
		// Latest state is after target, load the one before the target 
		else
		{
			const SavedTick = getNearestSavedTickBefore(Tick_Target)
			if (SavedTick > Tick_Current)
				loadState(SavedTick)
		}
	}
	// If its behind, load a state because we have it for sure (The only way to reach future ticks is to parse all the way to there at least once, which stores states) 
	else
	{
		const SavedTick = getNearestSavedTickBefore(Tick_Target)
		loadState(SavedTick)
	}

	isFastForwarding = true
	// Catch up to almost target tick
	while (Tick_Current < Tick_Target - 1)
		Update()

	isFastForwarding = false
	if (Tick_Current < Tick_Target) // If no updates are needed, the UI should be already updated from loading the state
		Update() // Do the last update with isFastForwarding false to cause UI update 

	if (typeof analyserTimeline !== "undefined")
		analyserTimeline.draw()

	requestUpdate();
}




function loadState(SavedTick)
{
	playerHistory.invalidate()
	if (typeof ordersHistory !== 'undefined') ordersHistory.invalidate()
	clearTransientTacticalState()
	if (SavedTick <= 0 || !(SavedTick in savedStates))
	{
		const fallbackTick = (SavedTick > 0) ? getNearestSavedTickBefore(SavedTick) : 0
		if (fallbackTick <= 0 || !(fallbackTick in savedStates))
		{
			Reset()
			return
		}
		SavedTick = fallbackTick
	}

	const State = savedStates[SavedTick]
	loadList(State.AllPlayers, AllPlayers)
	loadList(State.AllVehicles, AllVehicles)
	loadList(State.AllFobs, AllFobs)
	loadList(State.AllRallies, AllRallies)
	loadList(State.AllFlags, AllFlags)
	loadList(State.AllCaches, AllCaches)
	loadList(State.AllSLOrders, AllSLOrders)
	loadList(State.AllProj, AllProj)
	
	SquadNames = JSON.parse(State.SquadNames)
	
	
	tickets1 = State.tickets1
	tickets2 = State.tickets2
	intel = State.intel
	
	messagePos = State.messagePos

	killLines = JSON.parse(State.killLines)

	Tick_Current = SavedTick
	RecheckAllVehicles()
	
	for (var handler in eventArrays)
		eventArrays[handler].loadState(State)
	
	// Do UI things
	onLoadState()
}

var savedStates = {}

function saveState()
{
	const state = {
		SquadNames: JSON.stringify(SquadNames),
		
		AllPlayers: saveList(AllPlayers),
		AllVehicles: saveList(AllVehicles),
		AllFobs: saveList(AllFobs),
		AllFlags: saveList(AllFlags),
		AllCaches: saveList(AllCaches),
		AllRallies: saveList(AllRallies),
		AllSLOrders: saveList(AllSLOrders),
		AllProj: saveList(AllProj),
		
		tickets1: tickets1,
		tickets2: tickets2,
		intel: intel,
		
		messagePos: messagePos,
		
		iterators: {},
		
		killLines: JSON.stringify(killLines),
	}
	

	
	for (var handler in eventArrays)
		eventArrays[handler].saveState(state)
	
	savedStates[Tick_Current] = state
	LatestState = Tick_Current
}

function Reset()
{
	playerHistory.invalidate()
	if (typeof ordersHistory !== 'undefined') ordersHistory.invalidate()
	clearTransientTacticalState()
	AllPlayers = {}
	AllVehicles = {}
	AllFobs = {}
	AllRallies = {}
	AllCaches = {}
	AllSLOrders = {}
	AllProj = {}
	SquadNames = {}
	
	
	tickets1 = 0
	tickets2 = 0

	messagePos = 0
	Tick_Current = 0
	
	for (var handler in eventArrays)
		eventArrays[handler].reset()
	
	
	playerRows = {}
	vehicleTables = {}

	// Parse up to the first tick (demo headers) 
	Update()

	onReset()
}


var InitialParse = true
// Call this to advance time by one tick 
function Update()
{
	// If not in counting phase and current tick is at the end then stop
	if (Tick_Count == Tick_Current && !InitialParse)
	{
		Stop()
		Tick_Current = Tick_Count
		return false
	}

	// Interpolation
	if (!isFastForwarding) // Do not interpolate when fast forwarding
	{
		[AllPlayers, AllVehicles, AllProj]
			.forEach((dict) => { 
				for (var key in dict)
					dict[key].updateInterpHistory()
				})
	}

	// Main message parsing loop, parse until tick message
	while (true)
	{
		// Get the next message from the messages array
		const FullMessage = messageArrayObject.getMessageAt(messagePos)
		if (FullMessage == null)
		{
			Stop()
			Tick_Current = Tick_Count
			return false
		}

		messagePos++
		const MessageType = FullMessage.getUint8(0);

		// Call the message handler
		messageHandlers[MessageType](FullMessage)

		// Only break when message type is end tick or end round
		if (MessageType == MESSAGETYPE.TICK || MessageType == MESSAGETYPE.ROUNDEND)
			break
	}

	// If this is the initial parse phase, count the ticks and sample periodic FOB digging builders
	if (InitialParse) {
		Tick_Count++
		_predTickFobShovels(_timeCounter);
	}


	// If we're doing initial parse or if this is live demo, save states.
	if (InitialParse)
	// Save once per X ticks, don't save if already exists, don't save for tick = 0
		if (Tick_Current % TICKSPERSAVE == 0 && !(Tick_Current in savedStates) && Tick_Current != 0)
			saveState()

	if (!InitialParse) {
		for (var key in AllPlayers) {
			playerHistory.recordTick(key, AllPlayers[key]);
			AllPlayers[key].recordPosHistory();
		}
		for (var vKey in AllVehicles) {
			AllVehicles[vKey].recordPosHistory();
		}
	}

	Tick_Current++

	// Call UI stuff
	onUpdate()

	return true
}

var currentDODList = []
function DODList(FullMessage)
{
	currentDODList = []
	var pos = 1
	const length = FullMessage.byteLength
	while (pos != length)
	{
		const unpacked = FullMessage.unPack(pos, "BBBB")
		pos+= unpacked[0]
		const parsed = unpacked[1]
		
		const polygon = {
			"team": parsed[0],
			"inverted": parsed[1],
			"type": parsed[2],
			"points": []
			}
		const numOfPoints = parsed[3]
		for (var i=0;i<numOfPoints;i++)
		{
			const point = [FullMessage.getFloat32(pos ,true), FullMessage.getFloat32(pos+4 ,true)]
			pos+=8
			polygon.points.push(point)
		}
		currentDODList.push(polygon)
	}
}




const CURRENTVERSION = 3
var Version = -1
var DemoTimePerTick = 0.5
var briefingtime = 0
var gameVersionMod
var gameVersionMajor
var gameVersionMinor
var gameVersionRevision
var gameVersionHotfix

var gunnerRotationSupported = false

function ServerDetails(FullMessage)
{
	var pos = 1
	
	Version = FullMessage.getInt32(pos, true)
	pos += 4
	
	if (Version != CURRENTVERSION)
		console.log("Wrong version detected. Expected: "+CURRENTVERSION+", file is " + Version)
	
	DemoTimePerTick = FullMessage.getFloat32(pos, true)
	pos += 4

	if (DemoTimePerTick > 0) {
		DetectedDemoHz = 1.0 / DemoTimePerTick;
		IsHighTickrateDemo = (DetectedDemoHz >= 10.0);
		TICKSPERSAVE = Math.max(50, Math.round(30.0 * (DetectedDemoHz || 3.0)));
	}

	IPPort = getString(FullMessage, pos)
	pos += IPPort.length + 1

	ServerName = getString(FullMessage, pos)
	pos += ServerName.length + 1
	
	try
	{
		var index = ServerName.indexOf("]")
		var split = ServerName.substring(1, index).split(".")
		gameVersionMod = split[0].split(" ")[0]
		gameVersionMajor = split[0].split(" ")[1]
		gameVersionMinor = split[1]
		gameVersionRevision = split[2]
		gameVersionHotfix = split[3]

		//TODO Remove this hack for protocol version 4
		const vMaj = Number(gameVersionMajor) || 0;
		const vMin = Number(gameVersionMinor) || 0;
		gunnerRotationSupported = (vMaj > 1) || (vMaj === 1 && vMin >= 4);
		/////////////////
		
	}
	catch(err){}

	MaxPlayers = FullMessage.getInt8(pos)
	pos++

	roundLength = FullMessage.getInt16(pos, true)
	pos += 2

	briefingtime = FullMessage.getInt16(pos, true)
	pos += 2

	MapName = getString(FullMessage, pos)
	pos += MapName.length + 1
	const mapKeyLow = (MapName || "").toLowerCase();
	CurrentMapCamoSuffix = (typeof MAP_CAMO_DB !== "undefined" && MAP_CAMO_DB[mapKeyLow]) ? MAP_CAMO_DB[mapKeyLow] : "";
	window.CurrentMapCamoSuffix = CurrentMapCamoSuffix;

	GameMode = getString(FullMessage, pos)
	pos += GameMode.length + 1

	Layer = FullMessage.getUint8(pos)
	pos++

	OpForTeam = getString(FullMessage, pos)
	pos += OpForTeam.length + 1

	BluForTeam = getString(FullMessage, pos)
	pos += BluForTeam.length + 1
	
	StartTime = FullMessage.getInt32(pos, true)
	pos += 4
	
	tickets1 = FullMessage.getInt16(pos, true)
	pos += 2

	tickets2 = FullMessage.getInt16(pos, true)
	pos += 2
	
	
	//Version Oct 2018 - added mapsize in file
	if (pos == FullMessage.byteLength)
		return
		
	MapSize = FullMessage.getFloat32(pos, true)
	if (MapSize == 0) MapSize = 2
	MapSize = clamp(0.25, MapSize, 128)
	pos += 4
	
	
}

// DO NOT CALL AFTER INIT
// Read up to the serverdetails message
function ReadServerDetails()
{
	messagePos = 0
	while (true)
	{
		const Message = messageArrayObject.getMessageAt(messagePos++)
		if (Message == null)
			return false

		if (Message.getUint8(0) == MESSAGETYPE.SERVERDETAILS)
		{
			ServerDetails(Message)
			messagePos = 0
			return true
		}
	}
}

function roundEnd(FullMessage)
{
	Stop()
}

function unknownMessage(FullMessage)
{
	console.log("Received unknown message type " + FullMessage.getUint8(0))
}

// MARKER_ADD / MARKER_REMOVE are present in the replay protocol but their
// payload format has not yet been documented.  Preserve every packet so we
// can derive the format from real demos instead of guessing it.
var markerDiagnostics = []
function MarkerDiagnostic(FullMessage)
{
	const type = FullMessage.getUint8(0)
	const bytes = new Uint8Array(FullMessage.buffer, FullMessage.byteOffset, FullMessage.byteLength)
	const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(" ")
	const entry = {
		tick: Tick_Current,
		type: type == MESSAGETYPE.MARKER_ADD ? "MARKER_ADD" : "MARKER_REMOVE",
		length: FullMessage.byteLength,
		hex: hex
	}
	markerDiagnostics.push(entry)
	console.info("[Demo Analyser] " + entry.type + " at tick " + entry.tick +
		" (" + entry.length + " bytes): " + entry.hex)
}

function markerDiagnosticsSummary()
{
	const adds = markerDiagnostics.filter(marker => marker.type == "MARKER_ADD").length
	const removes = markerDiagnostics.length - adds
	console.info("[Demo Analyser] Marker capture complete: " + adds +
		" add(s), " + removes + " remove(s). Inspect window.markerDiagnostics for all packets.")
}


// An object type that handles specific events. Each event will have his own instance.
// -On initial parse, the events are added into an array (sorted by when they happened)
// -Each array has an iterator pointing to the first event that didn't happen yet.
// -When playing the demo and receiving an event, advanced the iterator by one and call UI updating methods
// -Store the iterator value as part of the state so it can be loaded in loadState.
// -In network mode, there is no initial parse. Add the new event to the array only if the iterator has reached the end of the array 
// (we're parsing something that was never parsed before)
// Current events using this:
function eventArray(typeCode)
{
	this.typeCode = typeCode
	this.events = []
	this.iterator = 0 //Points to the first event that wasn't played yet
	
	// These are implemented per object
	this.onMessage = (FullMessage) => console.log("onMessage missing") //return an object representing the processed message
	this.onLoadState = (newIterator) => console.log("onLoadState missing") //(UI) Check what should be remarked
	this.onIteratorIncreasedByOne = (obj) => console.log("onIteratorIncreasedByOne missing") //(UI) Mark the new one as not future
	this.onNewEvent = (obj) => console.log("onNewEvent missing") //(UI) Write one event (For network mode, or done on initial parse)
	
	// These are same for all objects
	this.message = (FullMessage) => 
	{
		if (this.iterator == this.events.length) 
		{
			const event = this.onMessage(FullMessage)
			event.index = this.iterator
			event.tick = Tick_Current
			this.events[this.iterator] = event
			this.onNewEvent(event)
		}
		else
		{
			this.onIteratorIncreasedByOne(this.events[this.iterator])
		}
		this.iterator++
	}
	this.reset = () => 
	{
		this.iterator = 0
		this.onLoadState(0)
	}
	this.loadState = (state) =>
	{
		this.iterator = state.iterators[this.typeCode]
		this.onLoadState(this.iterator)
	}
	this.saveState = (state) =>
	{
		state.iterators[this.typeCode] = this.iterator
	}
	this.clear = () =>
	{
		this.events = []
		this.iterator = 0
	}
}

const eventArrays = {}
function ProjAdd(FullMessage)
{
	const unpacked = FullMessage.unPack(1, "HBBshhhh")
	const parsed = unpacked[1]
	
	new ProjObject(parsed[0], // index
					parsed[1], // playerid
					parsed[2], // type
					parsed[3], // templateName
					parsed[4], // yaw
					parsed[5], parsed[6], parsed[7]) // xyz

	if (InitialParse) {
		_predOnProjAdd(parsed[1], parsed[2], parsed[3], _timeCounter);
		_projTrackRecordSample(parsed[0], parsed[2], _timeCounter, parsed[5], parsed[6], parsed[7], parsed[4]);
	}

	if (!isFastForwarding && typeof triggerShootingShockwave === 'function' && parsed && parsed[5] != null && parsed[7] != null) {
		const shooterId = parsed[1];
		const tName = (parsed[3] || "").toLowerCase();
		const shooter = typeof AllPlayers !== "undefined" ? AllPlayers[shooterId] : null;
		const vehId = shooter ? shooter.vehicleid : -1;

		let radiusM = 0;
		let color = "rgba(0, 229, 255, OPACITY)";
		let duration = 1.4;

		if (tName.includes("tnk") || tName.includes("tank") || tName.includes("120mm") || tName.includes("125mm") || tName.includes("105mm") || tName.includes("artillery") || tName.includes("mortar")) {
			radiusM = 1500;
			color = "rgba(255, 140, 0, OPACITY)";
			duration = 2.2;
		} else if (tName.includes("25mm") || tName.includes("30mm") || tName.includes("autocannon")) {
			radiusM = 750;
			color = "rgba(255, 200, 0, OPACITY)";
			duration = 1.8;
		} else if (tName.includes("rpg") || tName.includes("lat") || tName.includes("hat") || tName.includes("at4") || tName.includes("nlaw") || tName.includes("sraw") || tName.includes("eryx") || tName.includes("tow") || tName.includes("kornet") || tName.includes("spg")) {
			radiusM = 450;
			color = "rgba(255, 100, 0, OPACITY)";
			duration = 1.5;
		}

		if (radiusM > 0) {
			triggerShootingShockwave(parsed[5], parsed[7], radiusM, color, duration, shooterId, vehId);
		}

		if (typeof isBurningSmokeProjectile === "function" && typeof triggerBurningSmokeScreen === "function" && isBurningSmokeProjectile(parsed[2], parsed[3])) {
			triggerBurningSmokeScreen(parsed[0], parsed[5], parsed[6], parsed[7], parsed[2], parsed[3]);
		} else if (parsed[2] !== 38 && typeof trigger3DLaunchSmoke === 'function' && parsed[5] != null && parsed[7] != null) {
			trigger3DLaunchSmoke(parsed[5], parsed[6], parsed[7], parsed[2], parsed[3]);
		}
	}
}
function ProjRemoved(FullMessage)
{
	var pos = 1
	const length = FullMessage.byteLength
	while (pos < length)
	{
		const index = FullMessage.getUint16(pos, true)
		pos += 2
		const proj = AllProj[index]
		if (InitialParse) {
			_projTrackClose(index);
		}
		if (proj && typeof trigger3DExplosion === "function") {
			let px = (typeof proj.getX === "function") ? proj.getX() : proj.X;
			let py = (typeof proj.getY === "function") ? proj.getY() : (proj.Y || 0);
			let pz = (typeof proj.getZ === "function") ? proj.getZ() : proj.Z;
			trigger3DExplosion(px, py, pz, proj.type, proj.templateName, index);
		}
		delete AllProj[index]
	}
}

//Insurgency Intel
var intel = 0
function intelChanged(FullMessage)
{
	intel = FullMessage.getInt8(1,true)
}

//Event Message Handlers 
$(() => 
{
	eventArrays.kills = new eventArray(MESSAGETYPE.KILL)
	eventArrays.kills.onMessage = (FullMessage) => 
	{
		const parsed = FullMessage.unPack(1, "BBs")[1]
		const Attacker = parsed[0]
		const Victim = parsed[1]
		const Weapon = parsed[2]

		const obj = {
			isTeamkill: false,
			Weapon: Weapon,
			AttackerName: "???",
			VictimName: "???",
			AttackerID: Attacker,
			VictimID: Victim,
			Distance: "???",
			AttackerX: NaN,
			VictimX: NaN,
			AttackerY: NaN,
			VictimY: NaN,
			X: NaN,
			Y: NaN,
		}
		
		const AttackerObj = AllPlayers[Attacker]
		const VictimObj = AllPlayers[Victim]
		
		if (AttackerObj != null)
		{
			obj.AttackerName = AttackerObj.name
			obj.AttackerTeam = AttackerObj.team
			obj.AttackerSquad = AttackerObj.squad
		}
		else
			console.log("Received Attacker ID of invalid player")

		if (VictimObj != null)
		{
			obj.VictimName = VictimObj.name
			obj.VictimTeam = VictimObj.team
		}
		else
			console.log("Received Victim ID of invalid player")

		if (AttackerObj != null && VictimObj != null)
		{
			const x1 = AttackerObj.X
			const x2 = VictimObj.X
			const y1 = AttackerObj.Z
			const y2 = VictimObj.Z
			const z1 = AttackerObj.Y
			const z2 = VictimObj.Y

			obj.AttackerX = x1
			obj.VictimX = x2
			obj.X = x2
			obj.AttackerY = y1
			obj.VictimY = y2
			obj.Y = y2

			obj.Distance = Math.round(Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2) + Math.pow(z2 - z1, 2)))
			obj.isTeamkill = AttackerObj.team == VictimObj.team
		}
			
		return obj
	}
	eventArrays.kills.onNewEvent = (obj) => {
		eventDialogs.kills.newEvent(obj);
		if (!isFastForwarding && typeof triggerShootingShockwave === "function" && obj && obj.AttackerID != null) {
			const attacker = typeof AllPlayers !== "undefined" ? AllPlayers[obj.AttackerID] : null;
			const fireX = (attacker && attacker.X != null && !isNaN(attacker.X)) ? attacker.X : obj.AttackerX;
			const fireZ = (attacker && attacker.Z != null && !isNaN(attacker.Z)) ? attacker.Z : obj.AttackerY;

			if (fireX != null && !isNaN(fireX) && fireZ != null && !isNaN(fireZ)) {
				const wName = (obj.Weapon || "").toLowerCase();
				let radiusM = 0;
				let color = "rgba(0, 229, 255, OPACITY)";
				let duration = 1.4;

				if (wName.includes("tnk") || wName.includes("tank") || wName.includes("120mm") || wName.includes("125mm") || wName.includes("artillery") || wName.includes("mortar")) {
					radiusM = 1500;
					color = "rgba(255, 140, 0, OPACITY)";
					duration = 2.2;
				} else if (wName.includes("25mm") || wName.includes("30mm") || wName.includes("apc") || wName.includes("bmp") || wName.includes("btr")) {
					radiusM = 750;
					color = "rgba(255, 200, 0, OPACITY)";
					duration = 1.8;
				} else if (wName.includes("rpg") || wName.includes("lat") || wName.includes("hat") || wName.includes("at4") || wName.includes("nlaw") || wName.includes("sraw") || wName.includes("eryx") || wName.includes("tow") || wName.includes("kornet") || wName.includes("spg")) {
					radiusM = 450;
					color = "rgba(255, 100, 0, OPACITY)";
					duration = 1.5;
				}

				if (radiusM > 0) {
					const vehId = attacker ? attacker.vehicleid : -1;
					triggerShootingShockwave(fireX, fireZ, radiusM, color, duration, obj.AttackerID, vehId, obj.VictimID);
					if (typeof trigger3DExplosion === "function" && obj.VictimX != null && obj.VictimY != null) {
						trigger3DExplosion(obj.VictimX, null, obj.VictimY, 0, wName);
					}
				}
			}
		}
	}
	eventArrays.kills.onIteratorIncreasedByOne = (obj) =>  {killLine_Add(obj);eventDialogs.kills.enableOne()}
	eventArrays.kills.onLoadState = (i) => {eventDialogs.kills.reenable(i)}
}) 

//Revives
$(() => 
{
	eventArrays.revives = new eventArray(MESSAGETYPE.REVIVE)
	eventArrays.revives.onMessage = (FullMessage) => 
	{
		const medic = FullMessage.getUint8(1)
		const revived = FullMessage.getUint8(2)

		const medicObj = AllPlayers[medic]
		const revivedObj = AllPlayers[revived]

		const obj = {
			MedicName: "???",
			RevivedName: "???",
			MedicID: medic,
			RevivedID: revived,
			team: 0,
			X: NaN,
			Y: NaN,
		}

		if (medicObj != null)
		{
			obj.MedicName = medicObj.name
			obj.team = medicObj.team
			obj.X = medicObj.X
			obj.Y = medicObj.Z
			
		}
		else
			console.log("Received Medic ID of invalid player")

		if (revivedObj != null)
			obj.RevivedName = revivedObj.name
		else
			console.log("Received Revived ID of invalid player")

		if (InitialParse && medicObj != null) {
			_predOnRevive(medic, revived, _timeCounter);
		}
			
		return obj
	}
	eventArrays.revives.onNewEvent = (obj) => eventDialogs.revives.newEvent(obj)
	eventArrays.revives.onIteratorIncreasedByOne = () => eventDialogs.revives.enableOne()
	eventArrays.revives.onLoadState = (i) => {eventDialogs.revives.reenable(i)}
})

//Vehicles Destroyed
$(() => 
{
	eventArrays.vehicleDestroyers = new eventArray(MESSAGETYPE.VEHICLE_DESTROYED)
	eventArrays.vehicleDestroyers.onMessage = (FullMessage) => 
	{
		const vehicleID = FullMessage.getInt16(1, true)
		const vehicle = AllVehicles[vehicleID]
		if (InitialParse && vehicle && vehicle.trackMode) {
			_vehTrackBreakSegment(vehicleID);
		}
		delete AllVehicles[vehicleID]
		
		const playerKnown = (FullMessage.getUint8(3) != 0)
		const playerID = FullMessage.getUint8(4)
		const player = playerKnown ? AllPlayers[playerID] : null
		
		var obj = {
			vehicleID: vehicleID,
			vehicleX: NaN,
			vehicleY: NaN,
			X: NaN,
			Y: NaN,
			vehicleTemplate: "",
			vehicleTeam: 0,
			destroyerName: "",
			destroyerTeam: 0,
			destroyerX: NaN,
			destroyerY: NaN,
			destroyerID: playerID,
		}
		if (playerKnown && player)
		{
			obj.destroyerX = player.X
			obj.destroyerY = player.Z
			obj.destroyerName = player.name
			obj.destroyerTeam = player.team
		}
		if (vehicle)
		{
			obj.vehicleX = vehicle.X
			obj.vehicleY = vehicle.Z
			obj.X = vehicle.X
			obj.Y = vehicle.Z
			obj.vehicleTemplate = vehicle.name
			obj.vehicleTeam = vehicle.team
		}
		return obj
	}
	
	
	eventArrays.vehicleDestroyers.onNewEvent = (obj) => eventDialogs.vehicleDestroyers.newEvent(obj)
	eventArrays.vehicleDestroyers.onIteratorIncreasedByOne = (obj) => {delete AllVehicles[obj.vehicleID];onVehicleDestroyed(obj.vehicleID);eventDialogs.vehicleDestroyers.enableOne()}
	eventArrays.vehicleDestroyers.onLoadState = (i) => {eventDialogs.vehicleDestroyers.reenable(i)}
})


//Chat
const CHATCHANNELS = 
{
	0x00 : "AllChat",  // - AllChat
	0x10 : "Team1", // - Team 1 chat.
	0x20 : "Team2",  // - Team 2 chat.
	0x30 : "Server",
	0x31 : "Response",
	0x32 : "AdminAlert",
	0x33 : "Server Message",
	0x34 : "Server Team1 Message",
	0x35 : "Server Team2 Message",
}
$(() => 
{
	
	eventArrays.chat = new eventArray(MESSAGETYPE.CHAT)
	eventArrays.chat.onMessage = (FullMessage) => 
	{
		const channel = FullMessage.getUint8(1)
		const playerID = FullMessage.getUint8(2)
		
		var speakerName
		var team = 0
		//Anything below 0x30 is player channels
		if (channel < 0x30)
		{
			speakerName = AllPlayers[playerID] ? AllPlayers[playerID].name : "Unknown Player"
			team = AllPlayers[playerID] ? AllPlayers[playerID].team : 0
		}
		else
			speakerName = ""
		
		const text = getString(FullMessage, 3)
		const obj = 
		{
			text: text,
			playerID: playerID,
			speaker: speakerName,
			channel: channel,
			team: team,
		}
		
		return obj
	}
	eventArrays.chat.onNewEvent = (obj) => {eventDialogs.chat.newEvent(obj)}
	eventArrays.chat.onIteratorIncreasedByOne = (obj) => {eventDialogs.chat.enableOne()}
	eventArrays.chat.onLoadState = (i) => {eventDialogs.chat.reenable(i)}
})

//Kits
$(() => 
{
	eventArrays.kitAllocations = new eventArray(MESSAGETYPE.KITALLOCATED)
	eventArrays.kitAllocations.onMessage = (FullMessage) => 
	{
		const playerID = FullMessage.getUint8(1)
		const kitName = getString(FullMessage, 2)
		const playerName = AllPlayers[playerID] ? AllPlayers[playerID].name : "Unknown Player!"
		const team = AllPlayers[playerID] ? AllPlayers[playerID].team : 0
		
		const obj = 
		{
			playerID: playerID,
			playerName: playerName,
			team: team,
			kitName: kitName,
		}
		
		return obj
	}
	eventArrays.kitAllocations.onNewEvent = (obj) => {eventDialogs.kitAllocations.newEvent(obj)}
	eventArrays.kitAllocations.onIteratorIncreasedByOne = (obj) => {eventDialogs.kitAllocations.enableOne()}
	eventArrays.kitAllocations.onLoadState = (i) => {eventDialogs.kitAllocations.reenable(i)}
})

var messagePos = 0
var messageArrayObject
$(() => messageArrayObject = new messageArray()) 
function messageArray()
{
	this.messages = []
	this.pos = 0
	

	this.getMessageAt = function (i)
	{
		if (this.messages.length > i)
			return this.messages[i]
		else
			return null
	}

	this.getNextMessage = function ()
	{
		var databuffer = window.DataBuffer || DataBuffer
		if (!databuffer) return null
		var endOfBuffer = databuffer.byteLength
		
		// Enough bytes for length?
		if (this.pos + 2 > endOfBuffer)
			return null // End of file reached

		const LengthBytes = new DataView(databuffer, this.pos, 2);
		const Length = LengthBytes.getUint16(0, true);

		if (Length <= 0)
			return null

		// Enough bytes for message itself?
		if (this.pos + 2 + Length > endOfBuffer)
			return null // Error, unexpected end of file

		const message = new DataView(databuffer, this.pos + 2, Length)

		this.pos += 2 + Length
		return message
	}
	
	this._lasttickIndex = 0;
	
	// Update the messages var
	this.updateNewMessages = function ()
	{
		var message = this.getNextMessage()
		while (message != null)
		{
			this.addMessage(message)
			message = this.getNextMessage()
		}
		
		// If last message isn't ROUNDEND type, its probably a server crash, last message is likely corrupted. remove it.
		if (this.messages.length > 0) {
			message = this.messages[this.messages.length - 1]
			if (message && message.byteLength > 0) {
				const messageType = message.getUint8(0);
				if (messageType != MESSAGETYPE.ROUNDEND)
				{
					console.log("Unexpected file end. Removing last message as it may be incomplete")
					this.messages.pop()
				}
			}
		}
	}

	this.addMessage = function (message)
	{
		const messageType = message.getUint8(0);
		if (messageType == MESSAGETYPE.TICK)
			this._lasttickIndex = this.messages.length;
			
		// Reorder Projectile messages to be one tick early, so interpolation doesn't make it late
		// Add / remove / update will keep their order if we always insert before the TICK message
		if (messageType == MESSAGETYPE.PROJ_UPDATE || messageType == MESSAGETYPE.PROJ_ADD || messageType == MESSAGETYPE.PROJ_REMOVE)
		{
			this.messages.splice( this._lasttickIndex, 0, message );
			this._lasttickIndex++;
		} else {
			this.messages.push(message)
		}
		
		
		
	}
}


// Finds the next null character and returns a string from offset to it
function getString(message, offset)
{
	var text = ''
	while (offset < message.byteLength)
	{
		const val = message.getUint8(offset++);
		if (val == 0) break;
		text += String.fromCharCode(val);
	}
	return text
}

function getStringToEndOfMessage(message, offset)
{
	var text = ''
	while (offset < message.byteLength)
	{
		const val = message.getUint8(offset++);
		text += String.fromCharCode(val);
	}
	return text
}

// Utility functions
// Returns false when vehicle is a climbing vehicle, or parachute vehicle, or any other container, or when invalid
function isVehicleContainer(VehicleID)
{
	const v = AllVehicles[VehicleID]
	return (v == null || v.isClimbingVehicle)
}

function isJetVehicle(vehicleName)
{
	const name = (vehicleName || "").toLowerCase();
	if (!name || name.includes("_the_") || name.includes("_ahe_") || name.startsWith("the_") || name.startsWith("ahe_")) {
		return false;
	}
	return name.includes("_jet_") ||
		name.includes("_air_") ||
		name.startsWith("air_") ||
		name.startsWith("usair_") ||
		name.startsWith("ruair_") ||
		name.startsWith("chair_") ||
		name.includes("a10") || name.includes("su25") || name.includes("su30") || name.includes("su34") ||
		name.includes("mig") || name.includes("f16") || name.includes("f18") || name.includes("f15") ||
		name.includes("f4_") || name.includes("a4_") || name.includes("tornado") || name.includes("harrier") ||
		name.includes("q5") || name.includes("j10") || name.includes("mirage") || name.includes("ef2000") ||
		name.includes("gripen") || name.includes("c130") || name.includes("c47") || name.includes("ac130") ||
		name.includes("spitfire") || name.includes("bf109") || name.includes("fw190") || name.includes("p51") ||
		name.includes("yak") || name.includes("il2") || name.includes("ju87") || name.includes("a1h") ||
		name.includes("ov10") ||
		isUAVVehicle(name);
}

function isFlyingVehicle(vehicleName)
{
	const name = (vehicleName || "").toLowerCase();
	return name.includes("_the_") ||
		name.includes("_ahe_") ||
		name.startsWith("the_") ||
		name.startsWith("ahe_") ||
		name.startsWith("spectator") ||
		isJetVehicle(name);
}
function isUAVVehicle(vehicleName) {
	const name = (vehicleName || "").toLowerCase();
	return name.includes("uav_") ||
		name.includes("_uav") ||
		name.includes("init_air");
}


function isClimbingVehicle(vehicleName)
{
	return vehicleName == "grapplinghookropecontainer" ||
		vehicleName == "laddercontainer" ||
		vehicleName == "parachute"

}


function saveList(Source) {
	var res = {}
	for (var objid in Source) {
		res[objid] = shallowCopy(Source[objid])
	}
	return res;
}

function loadList(Source, Target)
{
	for (var objid in Target)
		if (!(objid in Source))
			delete Target[objid]
	
	
	for (var field in Source)
	{
		if (field in Target)
			shallowCopy(Source[field], Target[field])
		else 
			Target[field] = shallowCopy(Source[field]);
			

		Target[field].onLoadState()
	}
	
	return Target
}

function shallowCopy(Source, Target)
{
	if (!Target)
		Target = Object.create(Source.__proto__)
	
	for (var field in Source) {
		if (field.startsWith("ns_"))
			continue;
		Target[field] = Source[field]
    }
		
	
	return Target;
}

// =========================================================================
// Phase 4: Predictive Equipment Timeline (Lookahead Pre-Analysis Engine)
// =========================================================================
window.PlayerActionTimeline = {};
var _predRawEvents = {};
var _predInterrupts = {};
var _predPosHist = {};
var _predActiveFobs = {};
var _predLastFobScanT = -10;

function resetPredictiveTimelineCollector() {
	window.PlayerActionTimeline = {};
	_predRawEvents = {};
	_predInterrupts = {};
	_predPosHist = {};
	_predActiveFobs = {};
	_predLastFobScanT = -10;
}

function _predAddRawEvent(playerId, tEvent, leadSec, trailSec, itemType, grip, priority, templateName) {
	if (playerId == null || isNaN(playerId)) return;
	if (!_predRawEvents[playerId]) _predRawEvents[playerId] = [];
	_predRawEvents[playerId].push({
		tEvent: tEvent,
		s: Math.max(0, tEvent - leadSec),
		e: tEvent + trailSec,
		t: itemType,
		g: grip,
		p: priority,
		n: templateName || ""
	});
}

function _predRecordInterrupt(playerId, tSec) {
	if (playerId == null || isNaN(playerId)) return;
	let arr = _predInterrupts[playerId];
	if (!arr) {
		arr = [];
		_predInterrupts[playerId] = arr;
	}
	if (arr.length === 0 || tSec > arr[arr.length - 1] + 0.001) {
		arr.push(tSec);
	}
}

function _predRecordPosition(playerId, x, z, tSec) {
	if (playerId == null || isNaN(x) || isNaN(z)) return;
	let hist = _predPosHist[playerId];
	if (!hist) {
		hist = [];
		_predPosHist[playerId] = hist;
	}
	const last = hist.length > 0 ? hist[hist.length - 1] : null;
	if (!last || tSec - last.t >= 0.35) {
		hist.push({ t: tSec, x: x, z: z });
		if (hist.length > 12) hist.shift();
	}
}

function _predMovedDistance(playerId, tNow, lookbackSec) {
	const hist = _predPosHist[playerId];
	if (!hist || hist.length < 2) return 0;
	const newest = hist[hist.length - 1];
	let oldest = hist[0];
	for (let i = hist.length - 2; i >= 0; i--) {
		oldest = hist[i];
		if (tNow - hist[i].t >= lookbackSec) break;
	}
	return Math.hypot(newest.x - oldest.x, newest.z - oldest.z);
}

function _predIsMedicKit(kitName) {
	if (!kitName) return false;
	const k = kitName.toLowerCase();
	return k.includes("medic") || k.includes("corpsman") || k.includes("sanitater");
}

function _predIsOnFootAlive(p) {
	return !!(p && p.isAlive && !p.isJoining && (p.vehicleid == null || p.vehicleid < 0));
}

function _predIsBuildableDeployable(vName) {
	if (!vName) return false;
	const n = vName.toLowerCase();
	if (/_(jep|trk|apc|ifv|tnk|aav|atm|acv|ahe|the|jet|shp|bik)_|^boat_/.test(n)) return false;
	return (
		n.includes("deployable") || n.includes("firebase") || n.includes("hideout") ||
		n.includes("commandpost") || n.includes("sandbag") || n.includes("bunker") ||
		n.includes("razorwire") || n.includes("roadblock") || n.includes("foxhole") ||
		n.includes("stationary") || n.includes("mortar") || n.includes("ats_") ||
		n.includes("aas_") || n.includes("zu23") || n.includes("tow") ||
		n.includes("kornet") || n.includes("spg") || n.includes("_csb_") ||
		n.includes("pillbox") || n.includes("trench") || n.includes("emplacement") ||
		n.startsWith("aa_") || n.startsWith("at_") || n.startsWith("hmg_")
	);
}

function _predOnProjAdd(shooterId, projType, templateName, tSec) {
	const shooter = AllPlayers[shooterId];
	if (!shooter || !shooter.isAlive) return;
	// Require shooter to be on foot (ignore vehicle-fired rockets/smokes)
	if (shooter.vehicleid != null && shooter.vehicleid >= 0 && !isVehicleContainer(shooter.vehicleid)) return;

	const tLow = (templateName || "").toLowerCase();
	if (projType === 35) {
		// AA launcher (Stinger, Igla, Starstreak): ~4s aim/lock + release
		_predAddRawEvent(shooterId, tSec, 4.0, 1.5, "launcher", "launcher", 95, tLow);
	} else if (projType === 33 || projType === 34) {
		// HAT / Guided infantry AT (SRAW, Eryx, RPG-29, Milan, etc.)
		_predAddRawEvent(shooterId, tSec, 3.5, 1.8, "launcher", "launcher", 95, tLow);
	} else if (projType === 32) {
		// LAT / RPG launcher
		_predAddRawEvent(shooterId, tSec, 3.0, 1.3, "launcher", "launcher", 95, tLow);
	} else if (projType === 38) {
		// Frag grenade
		_predAddRawEvent(shooterId, tSec, 1.8, 0.8, "frag", "grenade", 90, tLow);
	} else if (projType === 39 || projType === 41) {
		// Handheld smoke grenade (exclude vehicle M82 / mortar / artillery smoke)
		if (tLow.includes("m82") || tLow.includes("smokelauncher") || tLow.includes("mortar") || tLow.includes("artillery") || tLow.includes("120mm") || tLow.includes("155mm") || tLow.includes("81mm")) {
			return;
		}
		_predAddRawEvent(shooterId, tSec, 1.8, 0.8, "smoke", "grenade", 90, tLow);
	} else if (projType === 1 || projType === 3) {
		_predAddRawEvent(shooterId, tSec, 3.0, 1.0, "mine_at", "item_hold", 90, tLow);
	} else if (projType === 2) {
		_predAddRawEvent(shooterId, tSec, 3.0, 1.0, "mine_ap", "item_hold", 90, tLow);
	} else if (projType === 4) {
		_predAddRawEvent(shooterId, tSec, 3.0, 1.0, "claymore", "item_hold", 90, tLow);
	} else if (projType === 5 || projType === 6) {
		const isIed = tLow.includes("ied") || tLow.includes("insrg") || tLow.includes("cellphone");
		_predAddRawEvent(shooterId, tSec, 3.0, 1.0, isIed ? "ied" : "c4", "item_hold", 90, tLow);
	}
}

function _predOnRevive(medicId, revivedId, tSec) {
	const medic = AllPlayers[medicId];
	if (!_predIsOnFootAlive(medic)) return;
	_predAddRawEvent(medicId, tSec, 4.0, 0.8, "epipen", "item_hold", 95, "epipen");
}

function _predOnPlayerHealthGain(player, oldH, newH, tSec) {
	if (!_predIsOnFootAlive(player)) return;
	// Ignore respawn/revive initial HP reset
	if (oldH <= 0) return;
	if (player.ns_predAliveSince != null && (tSec - player.ns_predAliveSince) < 1.2) return;

	const delta = newH - oldH;
	if (delta <= 0) return;

	// Check for closest friendly medic within 6.0m horizontal (handles prone/crouch & slopes cleanly)
	let closestMedic = null;
	let closestMedicDist = 6.1;
	let anyMedicWithin6m = false;
	for (const pid in AllPlayers) {
		const other = AllPlayers[pid];
		if (!other || other.id === player.id || other.team !== player.team) continue;
		if (!_predIsOnFootAlive(other) || !_predIsMedicKit(other.kit)) continue;
		const dy = Math.abs((other.Y || 0) - (player.Y || 0));
		if (dy > 3.5) continue;
		const d = Math.hypot(other.X - player.X, other.Z - player.Z);
		if (d <= 6.2) anyMedicWithin6m = true;
		if (d < closestMedicDist) {
			closestMedicDist = d;
			closestMedic = other;
		}
	}

	if (closestMedic) {
		_predAddRawEvent(closestMedic.id, tSec, 1.5, 1.0, "medikit", "item_hold", 75, "");
		return;
	}

	// Medic self-healing with medic bag (small continuous ticks)
	if (_predIsMedicKit(player.kit) && delta >= 1 && delta <= 10) {
		_predAddRawEvent(player.id, tSec, 1.5, 1.0, "medikit", "item_hold", 72, "");
		return;
	}

	// Lone soldier self-healing with Field Dressing (+10..+33 HP jump while stationary/slow-crawling)
	if (!anyMedicWithin6m && delta >= 8) {
		const moved = _predMovedDistance(player.id, tSec, 3.0);
		if (moved <= 4.0) {
			_predAddRawEvent(player.id, tSec, 3.5, 0.7, "dressing", "item_hold", 70, "");
		}
	}
}

function _predOnVehicleHealthChange(veh, oldH, newH, tSec) {
	if (!veh || !_predIsBuildableDeployable(veh.name)) return;
	if (isNaN(veh.X) || isNaN(veh.Z)) return;
	const delta = newH - oldH;
	// Exclude huge instant explosion/C4 damage spikes
	if (delta === 0 || Math.abs(delta) > 250) return;

	const isBuild = delta > 0;
	const maxDist = isBuild ? 8.5 : 7.5;
	const candidates = [];
	for (const pid in AllPlayers) {
		const p = AllPlayers[pid];
		if (!_predIsOnFootAlive(p)) continue;
		if (isBuild) {
			if (veh.team && p.team && p.team !== veh.team) continue;
		} else {
			if (veh.team && p.team && p.team === veh.team) continue;
			if (_predMovedDistance(p.id, tSec, 1.5) > 4.0) continue;
		}
		if (Math.abs((p.Y || 0) - (veh.Y || 0)) > 4.0) continue;
		const d = Math.hypot(p.X - veh.X, p.Z - veh.Z);
		if (d <= maxDist) {
			candidates.push({ id: p.id, d: d });
		}
	}
	if (candidates.length === 0) return;
	candidates.sort((a, b) => a.d - b.d);
	const limit = Math.min(5, candidates.length);
	for (let i = 0; i < limit; i++) {
		_predAddRawEvent(candidates[i].id, tSec, 1.8, 1.5, "shovel", "shovel", 65, "");
	}
}

function _predOnFobAdd(fob, tSec) {
	if (!fob || isNaN(fob.X) || isNaN(fob.Z)) return;
	// Register FOB so all friendly soldiers digging it up over the next ~38s hold shovels,
	// and enemies digging it down prior to FoBRemove also hold shovels!
	_predActiveFobs[fob.id] = {
		id: fob.id,
		team: fob.team,
		x: fob.X,
		y: fob.Y || 0,
		z: fob.Z,
		tAdd: tSec,
		enemyCands: []
	};
	for (const pid in AllPlayers) {
		const p = AllPlayers[pid];
		if (!_predIsOnFootAlive(p)) continue;
		if (fob.team && p.team && p.team !== fob.team) continue;
		if (Math.abs((p.Y || 0) - (fob.Y || 0)) > 4.0) continue;
		const d = Math.hypot(p.X - fob.X, p.Z - fob.Z);
		if (d <= 9.5 && _predMovedDistance(p.id, tSec, 2.0) <= 4.0) {
			_predAddRawEvent(p.id, tSec, 1.2, 1.6, "shovel", "shovel", 62, "");
		}
	}
}

function _predOnFobRemove(fobId, tSec) {
	const rec = _predActiveFobs[fobId];
	if (!rec) return;
	// Commit buffered enemy shovel candidates from the 35s leading up to FOB destruction
	const cands = rec.enemyCands;
	if (cands && cands.length > 0) {
		for (let i = 0; i < cands.length; i++) {
			const c = cands[i];
			if (tSec - c.t <= 35.0) {
				_predAddRawEvent(c.pid, c.t, 1.2, 1.5, "shovel", "shovel", 64, "");
			}
		}
	}
	delete _predActiveFobs[fobId];
}

function _predTickFobShovels(tSec) {
	if (tSec - _predLastFobScanT < 1.0) return;
	_predLastFobScanT = tSec;
	for (const fid in _predActiveFobs) {
		const f = _predActiveFobs[fid];
		if (!f) continue;
		const buildingWindow = (tSec - f.tAdd <= 38.0);
		for (const pid in AllPlayers) {
			const p = AllPlayers[pid];
			if (!_predIsOnFootAlive(p)) continue;
			if (Math.abs((p.Y || 0) - f.y) > 4.0) continue;
			const d = Math.hypot(p.X - f.x, p.Z - f.z);
			if (d > 9.5) continue;
			if (_predMovedDistance(p.id, tSec, 2.0) > 3.5) continue;

			if (buildingWindow && (!f.team || !p.team || p.team === f.team)) {
				_predAddRawEvent(p.id, tSec, 1.0, 1.4, "shovel", "shovel", 60, "");
			} else if (f.team && p.team && p.team !== f.team) {
				f.enemyCands.push({ pid: p.id, t: tSec });
			}
		}
		// Keep only recent 40s of enemy dig candidates to keep memory tiny
		while (f.enemyCands.length > 0 && (tSec - f.enemyCands[0].t) > 40.0) {
			f.enemyCands.shift();
		}
	}
}

function _predOnVehicleFirstPos(veh, tSec) {
	if (!veh || !veh.name || isNaN(veh.X) || isNaN(veh.Z)) return;
	const n = veh.name.toLowerCase();
	const isAmmo = (n === "ammo_drop" || n.includes("ammo_drop") || n.includes("ammobag"));
	const isGrapple = (n === "grapplinghookropecontainer" || n.includes("grapplinghook"));
	if (!isAmmo && !isGrapple) return;

	const maxDist = isAmmo ? 4.5 : 5.0;
	let bestId = null;
	let bestScore = Infinity;
	for (const pid in AllPlayers) {
		const p = AllPlayers[pid];
		if (!_predIsOnFootAlive(p)) continue;
		if (veh.team && p.team && p.team !== veh.team) continue;
		const d = Math.hypot(p.X - veh.X, (p.Y || 0) - (veh.Y || 0), p.Z - veh.Z);
		if (d <= maxDist) {
			let score = d;
			if (isAmmo && p.kit && p.kit.toLowerCase().includes("rifleman")) score -= 1.0;
			if (score < bestScore) {
				bestScore = score;
				bestId = p.id;
			}
		}
	}
	if (bestId != null) {
		if (isAmmo) {
			_predAddRawEvent(bestId, tSec, 1.5, 0.8, "ammokit", "item_hold", 65, "");
		} else {
			_predAddRawEvent(bestId, tSec, 2.0, 0.8, "grapplinghook", "item_hold", 70, "");
		}
	}
}

function _predClampWindow(ev, interrupts) {
	let s = ev.s;
	let e = ev.e;
	if (interrupts && interrupts.length > 0) {
		const tEv = ev.tEvent;
		// Binary search for latest interrupt < tEv - 0.001 and earliest interrupt > tEv + 0.001
		let lo = 0, hi = interrupts.length - 1, idx = interrupts.length;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (interrupts[mid] > tEv + 0.001) {
				idx = mid;
				hi = mid - 1;
			} else {
				lo = mid + 1;
			}
		}
		if (idx < interrupts.length && interrupts[idx] < e) {
			e = interrupts[idx];
		}
		// Scan backward for strictly earlier interrupt (< tEv - 0.001)
		let pIdx = idx - 1;
		while (pIdx >= 0 && interrupts[pIdx] >= tEv - 0.001) pIdx--;
		if (pIdx >= 0 && interrupts[pIdx] > s) {
			s = interrupts[pIdx];
		}
	}
	if (e - s < 0.12) return null;
	return { s: s, e: e, t: ev.t, g: ev.g, p: ev.p, n: ev.n, tEvent: ev.tEvent };
}

function finalizePredictiveTimeline() {
	const timeline = {};
	let totalSegments = 0;

	for (const pid in _predRawEvents) {
		const raw = _predRawEvents[pid];
		if (!raw || raw.length === 0) continue;
		const interrupts = _predInterrupts[pid] || null;

		const clamped = [];
		const pts = [];
		for (let i = 0; i < raw.length; i++) {
			const c = _predClampWindow(raw[i], interrupts);
			if (c) {
				clamped.push(c);
				pts.push(c.s, c.e);
			}
		}
		if (clamped.length === 0) continue;

		pts.sort((a, b) => a - b);
		const uniqPts = [pts[0]];
		for (let i = 1; i < pts.length; i++) {
			if (pts[i] - uniqPts[uniqPts.length - 1] > 0.005) {
				uniqPts.push(pts[i]);
			}
		}

		// Sweep elementary intervals and resolve priority conflicts
		const merged = [];
		for (let k = 0; k < uniqPts.length - 1; k++) {
			const a = uniqPts[k];
			const b = uniqPts[k + 1];
			const mid = 0.5 * (a + b);
			let best = null;
			for (let j = 0; j < clamped.length; j++) {
				const ev = clamped[j];
				if (ev.s <= mid && mid <= ev.e) {
					if (!best || ev.p > best.p || (ev.p === best.p && ev.tEvent > best.tEvent)) {
						best = ev;
					}
				}
			}
			if (!best) continue;
			const prev = merged.length > 0 ? merged[merged.length - 1] : null;
			if (prev && Math.abs(prev.e - a) <= 0.02 && prev.t === best.t && prev.g === best.g && prev.n === best.n) {
				prev.e = b;
			} else {
				merged.push({ s: a, e: b, t: best.t, g: best.g, n: best.n });
			}
		}

		if (merged.length > 0) {
			timeline[pid] = merged;
			totalSegments += merged.length;
		}
	}

	window.PlayerActionTimeline = timeline;
	_predRawEvents = {};
	_predInterrupts = {};
	_predPosHist = {};
	_predActiveFobs = {};
	return totalSegments;
}

window.getPlayerActionAtTime = function(playerId, timeSec) {
	const tl = window.PlayerActionTimeline;
	if (!tl) return null;
	const segs = tl[playerId];
	if (!segs || segs.length === 0) return null;
	let lo = 0;
	let hi = segs.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const seg = segs[mid];
		if (timeSec < seg.s) {
			hi = mid - 1;
		} else if (timeSec > seg.e) {
			lo = mid + 1;
		} else {
			return seg;
		}
	}
	return null;
};

// =========================================================================
// Pre-Simulated Motion Tracks (Jets, Helicopters, Ground Vehicles & Projectiles)
// Zero-Phase Bidirectional Offline Solver built during InitialParse
// =========================================================================
window.VehicleMotionTracks = {};
window.JetFlightTracks = window.VehicleMotionTracks; // Alias for backward compatibility
window.ProjMotionTracks = {};
var _vehRawSegs = {};
var _projRawSegs = {};

function resetPreSimulatedTracks() {
	window.VehicleMotionTracks = {};
	window.JetFlightTracks = window.VehicleMotionTracks;
	window.ProjMotionTracks = {};
	_vehRawSegs = {};
	_projRawSegs = {};
}
function resetJetFlightTracks() { resetPreSimulatedTracks(); }

function _vehTrackBreakSegment(vehId) {
	const rec = _vehRawSegs[vehId];
	if (rec && rec.segs.length > 0 && rec.segs[rec.segs.length - 1].length > 0) {
		rec.segs.push([]);
	}
}
function _jetTrackBreakSegment(vehId) { _vehTrackBreakSegment(vehId); }

function _vehTrackRecordSample(vehId, mode, vName, tSec, x, y, z, rot) {
	if (vehId == null || !mode || isNaN(x) || isNaN(z)) return;
	const py = (y != null && !isNaN(y)) ? y : 0;
	const pRot = (rot != null && !isNaN(rot)) ? rot : 0;

	let rec = _vehRawSegs[vehId];
	if (!rec) {
		rec = { mode: mode, name: (vName || "").toLowerCase(), segs: [[]] };
		_vehRawSegs[vehId] = rec;
	} else {
		rec.mode = mode;
		if (vName) rec.name = vName.toLowerCase();
	}
	let cur = rec.segs[rec.segs.length - 1];
	const maxJump = (mode === "jet") ? 450.0 : ((mode === "heli") ? 200.0 : 90.0);
	const maxGap = (mode === "ground") ? 4.0 : 3.0;

	if (cur.length > 0) {
		const last = cur[cur.length - 1];
		const dt = tSec - last.t;
		const dist = Math.hypot(x - last.x, z - last.z);
		if (dist > maxJump || dt > maxGap || dt < -0.001) {
			cur = [];
			rec.segs.push(cur);
		} else if (dt < 0.001) {
			last.x = x; last.y = py; last.z = z; last.rot = pRot;
			return;
		}
	}
	cur.push({ t: tSec, x: x, y: py, z: z, rot: pRot });
}
function _jetTrackRecordSample(vehId, tSec, x, y, z, rot) {
	_vehTrackRecordSample(vehId, "jet", "jet", tSec, x, y, z, rot);
}

function _projTrackRecordSample(projId, projType, tSec, x, y, z, yaw) {
	// Skip stationary ground mines/C4/IEDs (types 1..6)
	if (projId == null || (projType >= 1 && projType <= 6) || isNaN(x) || isNaN(z)) return;
	const py = (y != null && !isNaN(y)) ? y : 0;
	const pYaw = (yaw != null && !isNaN(yaw)) ? yaw : 0;

	let segs = _projRawSegs[projId];
	if (!segs) {
		segs = [{ type: projType, pts: [], closed: false }];
		_projRawSegs[projId] = segs;
	}
	let cur = segs[segs.length - 1];
	if (cur.closed) {
		cur = { type: projType, pts: [], closed: false };
		segs.push(cur);
	}
	const pts = cur.pts;
	if (pts.length > 0) {
		const last = pts[pts.length - 1];
		const dt = tSec - last.t;
		if (dt > 2.5 || dt < -0.001) {
			cur.closed = true;
			cur = { type: projType, pts: [], closed: false };
			segs.push(cur);
		} else if (dt < 0.001) {
			last.x = x; last.y = py; last.z = z; last.yaw = pYaw;
			return;
		}
	}
	cur.pts.push({ t: tSec, x: x, y: py, z: z, yaw: pYaw });
}

function _projTrackClose(projId) {
	const segs = _projRawSegs[projId];
	if (segs && segs.length > 0) {
		segs[segs.length - 1].closed = true;
	}
}

function _jetGaussianSmooth(times, vals, sigmaSec, lockEnds, sharpMask) {
	const n = vals.length;
	const out = new Float32Array(n);
	if (n <= 2 || sigmaSec <= 0) {
		for (let i = 0; i < n; i++) out[i] = vals[i];
		return out;
	}
	const inv2Sig2 = 0.5 / (sigmaSec * sigmaSec);
	const maxSpan = sigmaSec * 3.0;

	for (let i = 0; i < n; i++) {
		if ((lockEnds && (i === 0 || i === n - 1)) || (sharpMask && sharpMask[i])) {
			out[i] = vals[i];
			continue;
		}
		const ti = times[i];
		let effSpan = maxSpan;
		if (sharpMask) {
			// Cap smoothing symmetrically to the nearest impact/crash boundary so pre-crash & post-crash never bias or smear!
			for (let j = i - 1; j >= 0; j--) {
				const dt = ti - times[j];
				if (dt > effSpan) break;
				if (sharpMask[j]) { effSpan = Math.min(effSpan, dt); break; }
			}
			for (let j = i + 1; j < n; j++) {
				const dt = times[j] - ti;
				if (dt > effSpan) break;
				if (sharpMask[j]) { effSpan = Math.min(effSpan, dt); break; }
			}
		}
		let wSum = 1.0;
		let vSum = vals[i];
		for (let j = i - 1; j >= 0; j--) {
			const dt = ti - times[j];
			if (dt > effSpan + 1e-4) break;
			const w = Math.exp(-dt * dt * inv2Sig2);
			wSum += w;
			vSum += vals[j] * w;
			if (sharpMask && sharpMask[j]) break;
		}
		for (let j = i + 1; j < n; j++) {
			const dt = times[j] - ti;
			if (dt > effSpan + 1e-4) break;
			const w = Math.exp(-dt * dt * inv2Sig2);
			wSum += w;
			vSum += vals[j] * w;
			if (sharpMask && sharpMask[j]) break;
		}
		out[i] = vSum / wSum;
	}
	return out;
}

function _jetEvalHermite(p0, p1, p2, p3, t0, t1, t2, t3, t, sharp1, sharp2) {
	const h = t2 - t1;
	if (h < 1e-5) return p2;
	const u = Math.max(0.0, Math.min(1.0, (t - t1) / h));
	const slope12 = (p2 - p1) / h;
	const m1 = (!sharp1 && t1 > t0 + 1e-4) ? (0.5 * ((p1 - p0) / (t1 - t0) + slope12)) : slope12;
	const m2 = (!sharp2 && t3 > t2 + 1e-4) ? (0.5 * (slope12 + (p3 - p2) / (t3 - t2))) : slope12;
	const u2 = u * u;
	const u3 = u2 * u;
	return (2.0 * u3 - 3.0 * u2 + 1.0) * p1 +
		(u3 - 2.0 * u2 + u) * (m1 * h) +
		(-2.0 * u3 + 3.0 * u2) * p2 +
		(u3 - u2) * (m2 * h);
}

function _computeCentralDeriv(times, vals, sharpMask) {
	const n = vals.length;
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const iA = (i > 0 && !(sharpMask && sharpMask[i])) ? (i - 1) : i;
		const iB = (i < n - 1 && !(sharpMask && sharpMask[i])) ? (i + 1) : i;
		const dt = times[iB] - times[iA];
		if (dt > 1e-4) {
			out[i] = (vals[iB] - vals[iA]) / dt;
		} else if (i > 0 && times[i] > times[i - 1] + 1e-4) {
			out[i] = (vals[i] - vals[i - 1]) / (times[i] - times[i - 1]);
		}
	}
	return out;
}

function finalizePreSimulatedTracks() {
	const vehTracks = {};
	let vehSegCount = 0;

	for (const vehId in _vehRawSegs) {
		const rec = _vehRawSegs[vehId];
		const mode = rec.mode;
		const vName = rec.name || "";
		const isHeavyArmor = /(?:^|_)(?:tnk|apc|ifv|aav)(?:_|$)|tank|bmp|btr|abrams|leopard|challenger|merkava/.test(vName);
		const compiled = [];

		for (let si = 0; si < rec.segs.length; si++) {
			const raw = rec.segs[si];
			const n = raw.length;
			if (n < 3) continue;

			const times = new Float32Array(n);
			const rawX = new Float32Array(n);
			const rawY = new Float32Array(n);
			const rawZ = new Float32Array(n);
			const rawYaw = new Float32Array(n);

			for (let i = 0; i < n; i++) {
				times[i] = raw[i].t;
				rawX[i] = raw[i].x;
				rawY[i] = raw[i].y;
				rawZ[i] = raw[i].z;
				if (i === 0) {
					rawYaw[i] = raw[i].rot * Math.PI / 180.0;
				} else {
					const prevDeg = rawYaw[i - 1] * 180.0 / Math.PI;
					const dDeg = (((raw[i].rot - prevDeg) % 360) + 540) % 360 - 180;
					rawYaw[i] = rawYaw[i - 1] + dDeg * Math.PI / 180.0;
				}
			}

			if (mode === "jet") {
				// ---- JET: Zero-phase aerospace flight curve with rock-steady wings ----
				const smX = _jetGaussianSmooth(times, rawX, 0.34, true, null);
				const smY = _jetGaussianSmooth(times, rawY, 0.38, true, null);
				const smZ = _jetGaussianSmooth(times, rawZ, 0.34, true, null);

				const vx = _jetGaussianSmooth(times, _computeCentralDeriv(times, smX, null), 0.24, false, null);
				const vy = _jetGaussianSmooth(times, _computeCentralDeriv(times, smY, null), 0.28, false, null);
				const vz = _jetGaussianSmooth(times, _computeCentralDeriv(times, smZ, null), 0.24, false, null);

				const yawUnwrapped = new Float32Array(n);
				const vHorizArr = new Float32Array(n);
				const spdBlendArr = new Float32Array(n);
				for (let i = 0; i < n; i++) {
					const vh = Math.hypot(vx[i], vz[i]);
					vHorizArr[i] = vh;
					const sb = Math.max(0.0, Math.min(1.0, (vh - 12.0) / 18.0));
					spdBlendArr[i] = sb;
					const targetRad = (sb > 0.5) ? Math.atan2(vx[i], vz[i]) : rawYaw[i];
					if (i === 0) {
						yawUnwrapped[i] = targetRad;
					} else {
						let d = targetRad - yawUnwrapped[i - 1];
						while (d > Math.PI) d -= 2.0 * Math.PI;
						while (d < -Math.PI) d += 2.0 * Math.PI;
						yawUnwrapped[i] = yawUnwrapped[i - 1] + d;
					}
				}
				const smYaw = _jetGaussianSmooth(times, yawUnwrapped, 0.22, false, null);

				const pitchRaw = new Float32Array(n);
				for (let i = 0; i < n; i++) {
					pitchRaw[i] = Math.max(-0.96, Math.min(0.96, Math.atan2(vy[i], Math.max(18.0, vHorizArr[i])) * spdBlendArr[i]));
				}
				const smPitch = _jetGaussianSmooth(times, pitchRaw, 0.32, false, null);

				const smOmega = _jetGaussianSmooth(times, _computeCentralDeriv(times, smYaw, null), 0.65, false, null);
				const rollRaw = new Float32Array(n);
				for (let i = 0; i < n; i++) {
					const om = smOmega[i];
					const omAbs = Math.abs(om);
					const omEff = (omAbs > 0.025) ? (Math.sign(om) * (omAbs - 0.025)) : 0.0;
					rollRaw[i] = Math.max(-1.10, Math.min(1.10, -Math.atan2(vHorizArr[i] * omEff, 11.5) * spdBlendArr[i]));
				}
				const smRoll = _jetGaussianSmooth(times, rollRaw, 0.36, false, null);

				compiled.push({
					mode: "jet", tStart: times[0], tEnd: times[n - 1],
					t: times, x: smX, y: smY, z: smZ, yaw: smYaw, pitch: smPitch, roll: smRoll, sharp: null
				});
				vehSegCount++;
			} else if (mode === "heli") {
				// ---- HELICOPTER: Zero-phase smooth hover/cruise/J-hook flare & turn/strafe roll ----
				const smX = _jetGaussianSmooth(times, rawX, 0.30, true, null);
				const smY = _jetGaussianSmooth(times, rawY, 0.42, true, null);
				const smZ = _jetGaussianSmooth(times, rawZ, 0.30, true, null);
				const smYaw = _jetGaussianSmooth(times, rawYaw, 0.24, true, null);

				const vx = _jetGaussianSmooth(times, _computeCentralDeriv(times, smX, null), 0.28, false, null);
				const vz = _jetGaussianSmooth(times, _computeCentralDeriv(times, smZ, null), 0.28, false, null);
				const ax = _jetGaussianSmooth(times, _computeCentralDeriv(times, vx, null), 0.45, false, null);
				const az = _jetGaussianSmooth(times, _computeCentralDeriv(times, vz, null), 0.45, false, null);
				const smOmega = _jetGaussianSmooth(times, _computeCentralDeriv(times, smYaw, null), 0.55, false, null);

				const pitchRaw = new Float32Array(n);
				const rollRaw = new Float32Array(n);
				for (let i = 0; i < n; i++) {
					const fX = Math.sin(smYaw[i]), fZ = Math.cos(smYaw[i]);
					const rX = fZ, rZ = -fX;
					const vFwd = vx[i] * fX + vz[i] * fZ;
					const vRight = vx[i] * rX + vz[i] * rZ;
					const vHoriz = Math.hypot(vx[i], vz[i]);
					const aFwd = ax[i] * fX + az[i] * fZ;
					const aLat = ax[i] * rX + az[i] * rZ;

					// Pitch: gentle forward drag tilt + anticipatory accel/braking J-hook flare (never nosediving!)
					const vFwdAbs = Math.abs(vFwd);
					const vFwdEff = (vFwdAbs > 1.2) ? (Math.sign(vFwd) * (vFwdAbs - 1.2)) : 0.0;
					const aFwdAbs = Math.abs(aFwd);
					const aFwdEff = (aFwdAbs > 1.5) ? (Math.sign(aFwd) * (aFwdAbs - 1.5)) : 0.0;
					const dragP = -Math.atan(vFwdEff / 55.0) * 0.24;
					const accelP = -Math.atan(aFwdEff / 14.0) * 0.26;
					pitchRaw[i] = Math.max(-0.30, Math.min(0.33, dragP + accelP));

					// Roll: coordinated bank in turns + smooth sideways strafe tilt (rock-steady 0 deg in hover!)
					const om = smOmega[i];
					const omAbs = Math.abs(om);
					const omEff = (omAbs > 0.03) ? (Math.sign(om) * (omAbs - 0.03)) : 0.0;
					const turnR = (vHoriz > 4.0) ? (-Math.atan2(vHoriz * omEff, 14.5)) : 0.0;

					const vRightAbs = Math.abs(vRight);
					const vRightEff = (vRightAbs > 1.2) ? (Math.sign(vRight) * (vRightAbs - 1.2)) : 0.0;
					const aLatAbs = Math.abs(aLat);
					const aLatEff = (aLatAbs > 1.8) ? (Math.sign(aLat) * (aLatAbs - 1.8)) : 0.0;
					const strafeR = -Math.atan(vRightEff / 20.0) * 0.24 - Math.atan(aLatEff / 16.0) * 0.22;
					rollRaw[i] = Math.max(-0.61, Math.min(0.61, turnR + strafeR));
				}

				const smPitch = _jetGaussianSmooth(times, pitchRaw, 0.35, false, null);
				const smRoll = _jetGaussianSmooth(times, rollRaw, 0.38, false, null);

				compiled.push({
					mode: "heli", tStart: times[0], tEnd: times[n - 1],
					t: times, x: smX, y: smY, z: smZ, yaw: smYaw, pitch: smPitch, roll: smRoll, sharp: null
				});
				vehSegCount++;
			} else {
				// ---- GROUND VEHICLE: Impact/Collision-preserving smoothing + Suspension squat/dive/lean ----
				// 1. Detect crashes, wall impacts, and sudden stops/reverses so two colliding cars NEVER smear through each other!
				const sharp = new Uint8Array(n);
				sharp[0] = 1;
				sharp[n - 1] = 1;
				for (let i = 1; i < n - 1; i++) {
					const dtPrev = times[i] - times[i - 1];
					const dtNext = times[i + 1] - times[i];
					if (dtPrev < 1e-4 || dtNext < 1e-4) continue;
					const vx1 = (rawX[i] - rawX[i - 1]) / dtPrev;
					const vz1 = (rawZ[i] - rawZ[i - 1]) / dtPrev;
					const vx2 = (rawX[i + 1] - rawX[i]) / dtNext;
					const vz2 = (rawZ[i + 1] - rawZ[i]) / dtNext;
					const dv = Math.hypot(vx2 - vx1, vz2 - vz1);
					const spd1 = Math.hypot(vx1, vz1);
					const spd2 = Math.hypot(vx2, vz2);
					// Sharp impact / crash / abrupt stop or collision rebound
					if (dv > 7.5 || (spd1 > 7.0 && spd2 < 1.5)) {
						sharp[i] = 1;
					}
				}

				// 2. Short impact-preserving Gaussian on X, Z, Yaw (eliminates 1m accel/decel micro-stutter without cutting corners!)
				const smX = _jetGaussianSmooth(times, rawX, 0.16, true, sharp);
				const smZ = _jetGaussianSmooth(times, rawZ, 0.16, true, sharp);
				const smYaw = _jetGaussianSmooth(times, rawYaw, 0.14, true, sharp);

				// 3. Subtle suspension dynamics (squat on acceleration, nose-dive on braking/crash, outward chassis lean in turns)
				const vx = _jetGaussianSmooth(times, _computeCentralDeriv(times, smX, sharp), 0.18, false, sharp);
				const vz = _jetGaussianSmooth(times, _computeCentralDeriv(times, smZ, sharp), 0.18, false, sharp);
				const ax = _jetGaussianSmooth(times, _computeCentralDeriv(times, vx, sharp), 0.22, false, null);
				const az = _jetGaussianSmooth(times, _computeCentralDeriv(times, vz, sharp), 0.22, false, null);
				const om = _jetGaussianSmooth(times, _computeCentralDeriv(times, smYaw, sharp), 0.25, false, null);

				// Tanks/APCs have stiffer torsion-bar suspension than jeeps/trucks
				const pitchGain = isHeavyArmor ? 0.045 : 0.085;
				const rollGain = isHeavyArmor ? 0.035 : 0.095;
				const maxSuspPitch = isHeavyArmor ? 0.055 : 0.095; // ~3.1 deg tank, ~5.4 deg truck/jeep
				const maxSuspRoll = isHeavyArmor ? 0.045 : 0.110;  // ~2.6 deg tank, ~6.3 deg truck/jeep

				const suspPitchRaw = new Float32Array(n);
				const suspRollRaw = new Float32Array(n);
				for (let i = 0; i < n; i++) {
					const fX = Math.sin(smYaw[i]), fZ = Math.cos(smYaw[i]);
					const vHoriz = Math.hypot(vx[i], vz[i]);
					const aFwd = ax[i] * fX + az[i] * fZ;
					const aAbs = Math.abs(aFwd);
					const aEff = (aAbs > 1.8) ? (Math.sign(aFwd) * (aAbs - 1.8)) : 0.0;
					// Positive aFwd (accelerating) -> nose lifts (+pitch squat); negative aFwd (braking/crash) -> nose dips (-pitch dive)
					suspPitchRaw[i] = Math.max(-maxSuspPitch, Math.min(maxSuspPitch, Math.atan(aEff / 10.0) * pitchGain));

					// Ground vehicle body rolls OUTWARD in a turn (opposite of aircraft bank!)
					const latAccel = (vHoriz > 2.5) ? (vHoriz * om[i]) : 0.0;
					const latAbs = Math.abs(latAccel);
					const latEff = (latAbs > 1.2) ? (Math.sign(latAccel) * (latAbs - 1.2)) : 0.0;
					// Turning right (om > 0) -> body leans left -> right side rises -> +roll
					suspRollRaw[i] = Math.max(-maxSuspRoll, Math.min(maxSuspRoll, Math.atan(latEff / 12.0) * rollGain));
				}

				const smSuspPitch = _jetGaussianSmooth(times, suspPitchRaw, 0.20, false, null);
				const smSuspRoll = _jetGaussianSmooth(times, suspRollRaw, 0.22, false, null);

				compiled.push({
					mode: "ground", tStart: times[0], tEnd: times[n - 1],
					t: times, x: smX, y: rawY, z: smZ, yaw: smYaw, pitch: smSuspPitch, roll: smSuspRoll, sharp: sharp
				});
				vehSegCount++;
			}
		}

		if (compiled.length > 0) {
			vehTracks[vehId] = compiled;
		}
	}

	// ---- PROJECTILES: Smooth 3D parabolic / ATGM / mortar arcs with real 3D pitch & yaw ----
	const projTracks = {};
	let projSegCount = 0;
	for (const projId in _projRawSegs) {
		const rawSegs = _projRawSegs[projId];
		const compiled = [];
		for (let si = 0; si < rawSegs.length; si++) {
			const pts = rawSegs[si].pts;
			const n = pts.length;
			if (n < 2) continue;

			const times = new Float32Array(n);
			const rawX = new Float32Array(n);
			const rawY = new Float32Array(n);
			const rawZ = new Float32Array(n);
			const rawYaw = new Float32Array(n);
			for (let i = 0; i < n; i++) {
				times[i] = pts[i].t;
				rawX[i] = pts[i].x;
				rawY[i] = pts[i].y;
				rawZ[i] = pts[i].z;
				rawYaw[i] = pts[i].yaw * Math.PI / 180.0;
			}

			// Lock exact launch & impact endpoints; gently smooth intermediate Int16 points
			const smX = (n >= 4) ? _jetGaussianSmooth(times, rawX, 0.12, true, null) : rawX;
			const smY = (n >= 4) ? _jetGaussianSmooth(times, rawY, 0.14, true, null) : rawY;
			const smZ = (n >= 4) ? _jetGaussianSmooth(times, rawZ, 0.12, true, null) : rawZ;

			const vx = _computeCentralDeriv(times, smX, null);
			const vy = _computeCentralDeriv(times, smY, null);
			const vz = _computeCentralDeriv(times, smZ, null);

			const yawArr = new Float32Array(n);
			const pitchArr = new Float32Array(n);
			for (let i = 0; i < n; i++) {
				const vh = Math.hypot(vx[i], vz[i]);
				const targetYaw = (vh > 3.0) ? Math.atan2(vx[i], vz[i]) : rawYaw[i];
				if (i === 0) {
					yawArr[i] = targetYaw;
				} else {
					let d = targetYaw - yawArr[i - 1];
					while (d > Math.PI) d -= 2.0 * Math.PI;
					while (d < -Math.PI) d += 2.0 * Math.PI;
					yawArr[i] = yawArr[i - 1] + d;
				}
				pitchArr[i] = (vh > 1.5 || Math.abs(vy[i]) > 1.5)
					? Math.max(-1.45, Math.min(1.45, Math.atan2(vy[i], Math.max(0.5, vh))))
					: 0.0;
			}

			compiled.push({
				tStart: times[0], tEnd: times[n - 1],
				t: times, x: smX, y: smY, z: smZ, yaw: yawArr, pitch: pitchArr
			});
			projSegCount++;
		}
		if (compiled.length > 0) {
			projTracks[projId] = compiled;
		}
	}

	window.VehicleMotionTracks = vehTracks;
	window.JetFlightTracks = vehTracks;
	window.ProjMotionTracks = projTracks;
	_vehRawSegs = {};
	_projRawSegs = {};
	return { vehSegs: vehSegCount, projSegs: projSegCount };
}
function finalizeJetFlightTracks() { return finalizePreSimulatedTracks().vehSegs; }

window.sampleVehicleTrack = function(vehId, timeSec) {
	const tracks = window.VehicleMotionTracks;
	if (!tracks) return null;
	const segs = tracks[vehId];
	if (!segs || segs.length === 0) return null;

	let seg = null;
	for (let s = 0; s < segs.length; s++) {
		const cand = segs[s];
		if (timeSec >= cand.tStart - 0.35 && timeSec <= cand.tEnd + 0.35) {
			seg = cand;
			break;
		}
	}
	if (!seg) return null;

	const times = seg.t;
	const n = times.length;
	const tClamped = Math.max(seg.tStart, Math.min(seg.tEnd, timeSec));

	let lo = 0;
	let hi = n - 2;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (times[mid] <= tClamped) lo = mid;
		else hi = mid - 1;
	}
	const i1 = lo;
	const i0 = Math.max(0, i1 - 1);
	const i2 = Math.min(n - 1, i1 + 1);
	const i3 = Math.min(n - 1, i1 + 2);
	const t0 = times[i0], t1 = times[i1], t2 = times[i2], t3 = times[i3];
	const sh = seg.sharp;
	const s1 = sh ? !!sh[i1] : false;
	const s2 = sh ? !!sh[i2] : false;

	const x = _jetEvalHermite(seg.x[i0], seg.x[i1], seg.x[i2], seg.x[i3], t0, t1, t2, t3, tClamped, s1, s2);
	const y = _jetEvalHermite(seg.y[i0], seg.y[i1], seg.y[i2], seg.y[i3], t0, t1, t2, t3, tClamped, s1, s2);
	const z = _jetEvalHermite(seg.z[i0], seg.z[i1], seg.z[i2], seg.z[i3], t0, t1, t2, t3, tClamped, s1, s2);
	const yawRad = _jetEvalHermite(seg.yaw[i0], seg.yaw[i1], seg.yaw[i2], seg.yaw[i3], t0, t1, t2, t3, tClamped, s1, s2);
	const pitch = _jetEvalHermite(seg.pitch[i0], seg.pitch[i1], seg.pitch[i2], seg.pitch[i3], t0, t1, t2, t3, tClamped, false, false);
	const roll = _jetEvalHermite(seg.roll[i0], seg.roll[i1], seg.roll[i2], seg.roll[i3], t0, t1, t2, t3, tClamped, false, false);

	return {
		mode: seg.mode,
		x: x,
		y: y,
		z: z,
		yawDeg: ((yawRad * 180.0 / Math.PI) % 360 + 360) % 360,
		pitch: pitch,
		roll: roll
	};
};
window.sampleJetFlightTrack = window.sampleVehicleTrack;

window.sampleProjTrack = function(projId, timeSec) {
	const tracks = window.ProjMotionTracks;
	if (!tracks) return null;
	const segs = tracks[projId];
	if (!segs || segs.length === 0) return null;

	let seg = null;
	for (let s = 0; s < segs.length; s++) {
		const cand = segs[s];
		if (timeSec >= cand.tStart - 0.30 && timeSec <= cand.tEnd + 0.30) {
			seg = cand;
			break;
		}
	}
	if (!seg) return null;

	const times = seg.t;
	const n = times.length;
	const tClamped = Math.max(seg.tStart, Math.min(seg.tEnd, timeSec));

	let lo = 0;
	let hi = n - 2;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (times[mid] <= tClamped) lo = mid;
		else hi = mid - 1;
	}
	const i1 = lo;
	const i0 = Math.max(0, i1 - 1);
	const i2 = Math.min(n - 1, i1 + 1);
	const i3 = Math.min(n - 1, i1 + 2);
	const t0 = times[i0], t1 = times[i1], t2 = times[i2], t3 = times[i3];

	const x = _jetEvalHermite(seg.x[i0], seg.x[i1], seg.x[i2], seg.x[i3], t0, t1, t2, t3, tClamped, false, false);
	const y = _jetEvalHermite(seg.y[i0], seg.y[i1], seg.y[i2], seg.y[i3], t0, t1, t2, t3, tClamped, false, false);
	const z = _jetEvalHermite(seg.z[i0], seg.z[i1], seg.z[i2], seg.z[i3], t0, t1, t2, t3, tClamped, false, false);
	const yawRad = _jetEvalHermite(seg.yaw[i0], seg.yaw[i1], seg.yaw[i2], seg.yaw[i3], t0, t1, t2, t3, tClamped, false, false);
	const pitch = _jetEvalHermite(seg.pitch[i0], seg.pitch[i1], seg.pitch[i2], seg.pitch[i3], t0, t1, t2, t3, tClamped, false, false);

	return {
		x: x,
		y: y,
		z: z,
		yawDeg: ((yawRad * 180.0 / Math.PI) % 360 + 360) % 360,
		pitch: pitch,
		tStart: seg.tStart,
		tEnd: seg.tEnd
	};
};

var messageHandlers = []
$(() =>
{
	for (var i = 0; i < 256; i++)
		messageHandlers[i] = unknownMessage

	//Map message types to handlers
	messageHandlers[MESSAGETYPE.SERVERDETAILS] = ServerDetails
	messageHandlers[MESSAGETYPE.DODLIST] = DODList

	messageHandlers[MESSAGETYPE.PLAYER_UPDATE] = PlayerUpdate
	messageHandlers[MESSAGETYPE.PLAYER_ADD] = PlayerAdd
	messageHandlers[MESSAGETYPE.PLAYER_REMOVE] = PlayerRemove

	messageHandlers[MESSAGETYPE.VEHICLE_UPDATE] = VehicleUpdate
	messageHandlers[MESSAGETYPE.VEHICLE_ADD] = VehicleAdd
	messageHandlers[MESSAGETYPE.VEHICLE_DESTROYED] = eventArrays.vehicleDestroyers.message

	messageHandlers[MESSAGETYPE.FLAG_LIST] = FlagList
	messageHandlers[MESSAGETYPE.FLAG_UPDATE] = FlagUpdate

	messageHandlers[MESSAGETYPE.RALLY_ADD] = RallyAdd
	messageHandlers[MESSAGETYPE.RALLY_REMOVE] = RallyRemove

	messageHandlers[MESSAGETYPE.KILL] = eventArrays.kills.message

	messageHandlers[MESSAGETYPE.FOB_ADD] = FoBAdd
	messageHandlers[MESSAGETYPE.FOB_REMOVE] = FoBRemove

	messageHandlers[MESSAGETYPE.TICKETS_TEAM1] = Tickets_Team1
	messageHandlers[MESSAGETYPE.TICKETS_TEAM2] = Tickets_Team2

	messageHandlers[MESSAGETYPE.CHAT] = eventArrays.chat.message
	
	messageHandlers[MESSAGETYPE.CACHE_ADD] = CacheAdd
	messageHandlers[MESSAGETYPE.CACHE_REMOVE] = CacheDestroyed
	messageHandlers[MESSAGETYPE.CACHE_REVEAL] = CacheReveal
	messageHandlers[MESSAGETYPE.INTEL_CHANGE] = intelChanged
	
	messageHandlers[MESSAGETYPE.REVIVE] = eventArrays.revives.message
	messageHandlers[MESSAGETYPE.KITALLOCATED] = eventArrays.kitAllocations.message
	messageHandlers[MESSAGETYPE.SQUADNAME] = SquadName
	messageHandlers[MESSAGETYPE.SLORDERS] = SLOrder
	
	messageHandlers[MESSAGETYPE.ROUNDEND] = Stop

	messageHandlers[MESSAGETYPE.MARKER_ADD] = MarkerDiagnostic
	messageHandlers[MESSAGETYPE.MARKER_REMOVE] = MarkerDiagnostic
	
	messageHandlers[MESSAGETYPE.PROJ_UPDATE] = ProjUpdate
	messageHandlers[MESSAGETYPE.PROJ_ADD] = ProjAdd
	messageHandlers[MESSAGETYPE.PROJ_REMOVE] = ProjRemoved
	
	messageHandlers[MESSAGETYPE.TICK] = message_Tick
})
