// Derived from RealityTracker (https://github.com/yossizap/realitytracker)
// Licensed under the GNU General Public License v3.0 (GPL-3.0)
// Modified by [KKCK] AlcatraZ.jpg, 2026 - see LICENSE for full terms

"use strict";

var opSquadColors = ['#0000FF',
	'#9395ea',
	'#c4c400',
	'#800080',
	'#56a8a7',
	'#ff8040',
	'#2ed232',
	'#00ffff',
	'#ff0080',
	'#a56d5a'
]

var bluSquadColors = ['#FF0000',
	'#9395ea',
	'#c4c400',
	'#800080',
	'#56a8a7',
	'#ff8040',
	'#2ed232',
	'#00ffff',
	'#ff0080',
	'#a56d5a'
]

// this syntax is for collapsing regions in notepad++.
//{REGION

//}


//{ options
var options_DrawKillLines = true
var options_DrawEmptyVehicles = true
var options_DrawFlagRadius = true
var options_DrawKitIcons = true
var options_DrawDOD = true
var options_RealTerrain = true
var options_TerrainDetail = true
var options_3dRoads = false
var options_DrawSkybox = true
var options_3dFog = true
var options_3dFogOnPlayer = false
var options_StructureColors = false
var options_StructureTextures = false
var options_LodDistancePreset = 2 // 0=Very Low, 1=Low, 2=Balanced, 3=High, 4=Ultra
var options_LodFade = true
var options_TreeTextures = false
var options_BushTextures = false
var options_FactionTextures = false
var options_PredictiveEquipment = true
var options_3dShadows = false
var options_3dAoSsao = false
var options_3dSsaoQuality = 1 // 0=Fast (1/2 res), 1=Balanced (Full res, 12-tap), 2=High (Full res, 20-tap)
var options_3dPrReflections = false // PR RaShaderBM specular + sky fresnel + terrain sun-slope relief
var options_3dWind = false // PR RaShaderLeaf / Undergrowth vegetation wind sway
var options_3dWeather = false // PR Rain.fx GPU-instanced weather particles (rain / snow / desert dust)
var options_3dBloom = false // PR PostProduction_nv3x selective bloom + sun glare + subtle tone mapping
var options_3dAntiAliasing = 1 // 0=Off, 1=FXAA, 2=MSAA 4x, 3=MSAA 4x + FXAA
var options_ClampVehiclesToMap = true //Dont draw vehicles outside the map
var options_DrawVehicleHeight = true
var options_health_players = true
var options_health_vehicles = true
var options_drawAllOrderIcons = false
var options_UseFallbackRenderer = false
var options_DrawBuildingWireframes = false // Show real 2D vector footprints of static objects
var options_Interpolation = true // Smooth interpolation between frames/ticks
var options_VisionConeRespectsLOS = true // Dynamic visibility shadowcasting against walls and terrain
var options_CameraTracking = false // Smoothly track selected player
var options_FirstPersonView = false // 3D First-Person View from selected player or vehicle seat
	//}


// Called when Start/pause button is clicked 
function togglePlay()
{
	if (!isPlaying)
		Start()
	else
		Stop()
}

var lastUpdateTime = null;
var isPlaying = false;
function Start()
{
	isPlaying = true;
	lastUpdateTime = performance.now();
	requestUpdate();
	onResume()
}

function Stop()
{
	isPlaying = false;
	if (!window._autoStoppingKillReplay) {
		window._killReplayStopTick = null;
	}
	onPause()
}


var updateRequested = false;
function requestUpdate() {
	if (updateRequested) {
		return;
    }
		
	updateRequested = true;
	requestAnimationFrame(update);
}


function update() {
	updateRequested = false;
	if (!loadingComplete)
		return;


	const now = performance.now();
	if (lastUpdateTime == null)
		lastUpdateTime = now - 10;

	const frameTime = (now - lastUpdateTime) / 1000.0;
	lastUpdateTime = now;

	try {
		if (typeof updateCameraTracking === "function") {
			updateCameraTracking();
		}
		updateLogic(frameTime);	
		animations.update(frameTime);
		activeRenderer.update(frameTime);
				activeRenderer.draw();
		if (typeof clipRecorder !== 'undefined' && clipRecorder.isRecording && typeof is3DMode !== 'undefined' && is3DMode) {
			const mapCanvas = document.getElementById("map");
			const map3d = document.getElementById("map3d");
			const hud = document.getElementById("map3dHud");
			if (mapCanvas && map3d && map3d.width > 0 && map3d.height > 0) {
				if (mapCanvas.width !== map3d.width || mapCanvas.height !== map3d.height) {
					mapCanvas.width = map3d.width;
					mapCanvas.height = map3d.height;
				}
				const ctx = mapCanvas.getContext("2d");
				ctx.drawImage(map3d, 0, 0, mapCanvas.width, mapCanvas.height);
				if (hud && hud.style.display !== "none" && hud.width > 0) {
					ctx.drawImage(hud, 0, 0, mapCanvas.width, mapCanvas.height);
				}
			}
		}
	} catch (e) {
		console.error("Crash in update loop:", e);
	}

	if (animations.animationsPlaying() || isPlaying)
		requestUpdate();

	if (!updateRequested)
		lastUpdateTime = null;

}

function _getCurrentTickDurationSec()
{
	const fallbackDt = (typeof DetectedDemoHz !== "undefined" && DetectedDemoHz > 0)
		? (1.0 / DetectedDemoHz)
		: ((typeof DemoTimePerTick !== "undefined" && DemoTimePerTick > 0) ? DemoTimePerTick : 0.04);
	if (typeof tickToTime !== "undefined" && tickToTime && tickToTime.length > 1 && typeof Tick_Current === "number") {
		const idxCur = Math.max(1, Math.min(Tick_Current - 1, tickToTime.length - 1));
		const dtExact = tickToTime[idxCur] - tickToTime[idxCur - 1];
		if (dtExact > 0.005 && dtExact <= 2.5) {
			return dtExact;
		}
	}
	return fallbackDt;
}

function updateLogic(frameTime)
{
	if (!isPlaying)
		return;

	// Clamp wall-clock frameTime to prevent multi-tick lurches after tab-switch or GC stalls
	const safeFrameTime = Math.min(0.1, Math.max(0.0, frameTime || 0.0));
	let budgetSec = safeFrameTime * playSpeed;
	let safetyIters = 0;

	// Advance playback in EXACT real game seconds across variable-duration server ticks (0.28s / 0.32s / 0.36s ...)
	// Guarantees d(curTime)/d(wallTime) === playSpeed identically with zero tick-boundary slowdowns or hitches!
	while (budgetSec > 0 && safetyIters < 64)
	{
		safetyIters++;
		const curTickDt = _getCurrentTickDurationSec();
		const remInTickSec = Math.max(0.0, (1.0 - interpolation_CurrentAmount) * curTickDt);

		if (budgetSec < remInTickSec)
		{
			interpolation_CurrentAmount += budgetSec / curTickDt;
			budgetSec = 0;
			break;
		}

		budgetSec -= remInTickSec;
		if (!Update()) // If update returned false, loop if Debug Lab continuous mechanics mode is active!
		{
			if (window.debugLabState && window.debugLabState.active && window.debugLabState.mode === "mechanics" && window.debugLabState.autoLoop !== false) {
				const loopTick = window.debugLabState.loopStartTick || 30;
				goTo(loopTick);
				interpolation_CurrentAmount = 0.0;
				isPlaying = true;
				onResume();
				break;
			}
			return;
		}

		interpolation_CurrentAmount = 0.0;

		if (window.debugLabState && window.debugLabState.active && window.debugLabState.mode === "mechanics" && window.debugLabState.autoLoop !== false && Tick_Count > 60 && Tick_Current >= Tick_Count - 3) {
			const loopTick = window.debugLabState.loopStartTick || 30;
			goTo(loopTick);
			interpolation_CurrentAmount = 0.0;
			break;
		}

		if (window._killReplayStopTick != null && Tick_Current >= window._killReplayStopTick) {
			interpolation_CurrentAmount = 0;
			window._killReplayStopTick = null;
			window._autoStoppingKillReplay = true;
			Stop();
			window._autoStoppingKillReplay = false;
			break;
		}
		if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.checkPlaybackBounds === "function") {
			if (analyserTimeline.checkPlaybackBounds()) {
				interpolation_CurrentAmount = 0;
				break;
			}
		}
	}

	if (typeof updateAllPlayersFocusTracking === "function") {
		updateAllPlayersFocusTracking();
	}
	if (typeof updateSelectionSpeedAcousticLabel === "function") {
		updateSelectionSpeedAcousticLabel();
	}
	if (typeof playerRow_UpdateAll === "function") {
		playerRow_UpdateAll();
	}
	if (typeof analyserTimeline !== "undefined") {
		analyserTimeline.draw();
	}
}


const playBarChangeCooldown = 33.33;
var lastPlayBarChange = 0;
function onPlayBarChange()
{
	if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.updatePlayheadPosition === "function") {
		analyserTimeline.updatePlayheadPosition();
	}
	const now = performance.now();
	if (now - lastPlayBarChange < playBarChangeCooldown)
		return;
	lastPlayBarChange = now;

	window._killReplayStopTick = null;
	const targetVal = Number($("#playBar")[0].value);
	goTo(targetVal);
	requestUpdate(); 
}

function onPlaySpeedChange()
{
	// This makes the range nonlinear
	var rangevalue = $("#playSpeed")[0].value
	var speed = Math.pow(rangevalue, 2.5)

	setSpeed(speed)
}

function togglePlaySpeedMenu(ev)
{
	if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
	const wrap = document.getElementById("controlBarOptions");
	if (wrap) {
		wrap.classList.toggle("speed-open");
	}
}

function setDirectPlaySpeed(speedVal)
{
	const s = Math.max(0.1, Math.min(32.0, Number(speedVal) || 1.0));
	setSpeed(s);
	const slider = document.getElementById("playSpeed");
	if (slider) {
		slider.value = Math.pow(s, 1.0 / 2.5).toFixed(2);
	}
	if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.updateSpeedButtons === "function") {
		analyserTimeline.updateSpeedButtons(s);
	}
}

function updatePlayBar()
{
	const pb = $("#playBar")[0];
	if (pb) pb.value = Tick_Current;
	if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.updateClockDisplay === "function") {
		analyserTimeline.updateClockDisplay();
	}
}

function toggleSubMenu(submenu)
{
	const menu = $("#" + submenu + "Container")
	if (menu.dialog("isOpen"))
		menu.dialog("close");
	else
		menu.dialog("open");
}

const TICKS_JUMP_AMOUNT_SHIFT = 40
const TICKS_JUMP_AMOUNT = 10

var HealthButtonDown = false

var keysDown = new Set();
function isTextInputElement(target)
{
	if (!target)
		return false;
	if (target.isContentEditable)
		return true;
	const tag = target.tagName;
	if (tag === "TEXTAREA" || tag === "SELECT")
		return true;
	if (tag === "INPUT") {
		const inputType = (target.type || "text").toLowerCase();
		return ["text", "search", "url", "email", "password", "number"].includes(inputType);
	}
	return false;
}

function onKeyDown(e)
{
	// If a <select> dropdown still holds focus when pressing camera/nav keys, release focus automatically
	if (e.target && e.target.tagName === "SELECT") {
		const k = e.which;
		if (k === 87 || k === 65 || k === 83 || k === 68 || k === 81 || k === 69 || k === 16 || k === 86 || k === 71 || k === 70 || k === 219 || k === 221 || k === 32 || k === 27) {
			e.target.blur();
		} else {
			return;
		}
	}
	// Return if a modal is open or focus is inside a text input
	if ($("#addbookmarkComment").dialog("isOpen") || isTextInputElement(e.target))
		return

	keysDown.add(e.which);
	requestUpdate();
	// 1 - 9
	if (e.which >= 49 && e.which <= 57)
	{
		if (e.shiftKey)
			selection_SelectSquad(1, e.which - 48)
		else
			selection_SelectSquad(2, e.which - 48)
	}
	else
		switch (e.which)
		{
		case 32: //space
			togglePlay()
			break		
		case 72: //h
			HealthButtonDown = true
			requestUpdate()
			break
		case 73: //i
			toggleSubMenu("serverinfo")
			break;
		case 90: //z
			toggleSubMenu("scoreBoard")
			break
		case 88: //x
			toggleSubMenu("kills")
			break
		case 67: //c
			toggleSubMenu("vehicles")
			break
		case 84: // t
			if (typeof toggleCameraTracking === "function") {
				toggleCameraTracking();
			} else {
				toggleSubMenu("chat");
			}
			break
		case 82: //r
			toggleSubMenu("revives")
			break
		case 75: //k
			toggleSubMenu("kitAllocations")
			break
		//case 68: //d
		//	toggleSubMenu("vehicleDestroyers")
		//	break;
		case 70: // f
			if (typeof toggleFirstPersonView === "function") {
				toggleFirstPersonView();
			}
			break;
		case 219: // [
			if ((typeof options_FirstPersonView !== "undefined" && options_FirstPersonView) ||
				(typeof SelectedVehicle !== "undefined" && SelectedVehicle != SELECTED_NOTHING)) {
				if (typeof cycleSelectedVehiclePassenger === "function") {
					cycleSelectedVehiclePassenger(-1);
				}
			} else {
				return;
			}
			break;
		case 221: // ]
			if ((typeof options_FirstPersonView !== "undefined" && options_FirstPersonView) ||
				(typeof SelectedVehicle !== "undefined" && SelectedVehicle != SELECTED_NOTHING)) {
				if (typeof cycleSelectedVehiclePassenger === "function") {
					cycleSelectedVehiclePassenger(1);
				}
			} else {
				return;
			}
			break;
		case 71: //g
			toggle3dMode()
			break
		case 27: // Escape
			{
				const bvrModal = document.getElementById("bvrFocusModal");
				if (bvrModal && bvrModal.style.display !== "none" && typeof closeBVRFocusModal === "function") {
					closeBVRFocusModal();
					break;
				}
				if (document.querySelector(".hud-popover.open")) {
					closeTopRightMenus();
					break;
				}
			}
			return;
		case 37: // left
			if (e.shiftKey)
				goTo(Tick_Current - TICKS_JUMP_AMOUNT_SHIFT)
			else
				goTo(Tick_Current - TICKS_JUMP_AMOUNT)
			break

		case 39: // right
			if (e.shiftKey)
				goTo(Tick_Current + TICKS_JUMP_AMOUNT_SHIFT)
			else
				goTo(Tick_Current + TICKS_JUMP_AMOUNT);
			break
		default:
			return;
		}
	
	// prevent the default action (unless its i which opens console and its annoying to override it)
	if (e.which != 73)
		e.preventDefault(); 


}

function onKeyUp(e)
{
	keysDown.delete(e.which);
	switch (e.which)
	{
		case 72: //h
			HealthButtonDown = false
			requestUpdate();
			break
		case 86: //v
			requestUpdate();
			break
	}	
	e.preventDefault();
}

window.addEventListener("blur", () => {
	keysDown.clear();
	HealthButtonDown = false;
	if (typeof is3DMode !== "undefined" && is3DMode)
		requestUpdate();
});

// Sort of a placerholder
function updateHeader()
{
	if (GameMode == "gpm_insurgency")
		$("#headerInner")[0].innerHTML = tickets2 + " (Intel: " + intel + ") - Caches: " + tickets1 + " " + getTimeStringOfTick(Tick_Current) + " x" + playSpeed.toFixed(1)
	else
		$("#headerInner")[0].innerHTML = tickets2 + " - " + tickets1 + " " + getTimeStringOfTick(Tick_Current) + " x" + playSpeed.toFixed(1)
}

function getTimeInSecondsFromString(time) {
	const re = /(\d{0,2}):(\d{0,2}):(\d{0,2})/
	const match = re.exec(time)
	if (match)
		return (match[1] * 3600) + (match[2] * 60) + (match[3] * 1)
	return 0
	
}

function getTickfromTimeString(time) {
	const seconds = roundLength + briefingtime - getTimeInSecondsFromString(time)
	const tick = tickToTime.findIndex(x => x > seconds)
	return tick
}

function getTimeStringOfTick(tick)
{
	if (tick >= tickToTime.length) tick = tickToTime.length - 1
	
	const time = roundLength + briefingtime - tickToTime[tick]
	return getTimeString(time)
}
function getTimeString(time)
{
	if (isNaN(time) || time < 0) time = 0
	time = Math.floor(time)
	var sec = time % 60
	var min = Math.floor(time / 60) % 60
	const hour = Math.floor(time / 3600)

	if (sec < 10) sec = "0" + sec
	if (min < 10) min = "0" + min

	return hour + ":" + min + ":" + sec
}

function checkboxClicked(Checkbox)
{
	changeSetting(Checkbox.id, Checkbox.checked);
}

function set3dAntiAliasing(val) {
	const idx = Math.max(0, Math.min(3, parseInt(val, 10) || 0));
	window.options_3dAntiAliasing = idx;
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem("options_3dAntiAliasing", JSON.stringify(idx));
		}
	} catch (e) {}
	const sel = document.getElementById("options_3dAntiAliasing");
	if (sel) {
		if (String(sel.value) !== String(idx)) sel.value = String(idx);
		sel.blur();
	}
	requestUpdate();
}

function setSsaoQuality(val) {
	const idx = Math.max(0, Math.min(2, parseInt(val, 10) || 0));
	window.options_3dSsaoQuality = idx;
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem("options_3dSsaoQuality", JSON.stringify(idx));
		}
	} catch (e) {}
	const slider = document.getElementById("options_3dSsaoQuality");
	if (slider && String(slider.value) !== String(idx)) slider.value = idx;
	updateSsaoQualityLabel();
	if (typeof renderer3d !== "undefined" && renderer3d.initialized && typeof renderer3d.setSsaoQuality === "function") {
		renderer3d.setSsaoQuality(idx);
	}
	requestUpdate();
}

function updateSsaoQualityLabel() {
	const lbl = document.getElementById("lblSsaoQualVal");
	if (!lbl) return;
	const idx = Math.max(0, Math.min(2, parseInt(window.options_3dSsaoQuality, 10) || 0));
	const names = ["Fast", "Balanced", "High"];
	const colors = ["#90caf9", "#76ff03", "#ffb74d"];
	lbl.textContent = names[idx] || "Balanced";
	lbl.style.color = colors[idx] || "#76ff03";
}

function setLodDistancePreset(val) {
	const idx = Math.max(0, Math.min(4, Math.round(parseFloat(val) || 0)));
	window.options_LodDistancePreset = idx;
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem("options_LodDistancePreset", JSON.stringify(idx));
		}
	} catch (e) {}
	const slider = document.getElementById("options_LodDistancePreset");
	if (slider && String(slider.value) !== String(idx)) slider.value = idx;
	updateLodDistanceLabel();
	if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized && typeof building3dRenderer.markCullDirty === "function") {
		building3dRenderer.markCullDirty();
	}
	requestUpdate();
}

function updateLodDistanceLabel() {
	const lbl = document.getElementById("lblLodDistVal");
	if (!lbl) return;
	const idx = Math.max(0, Math.min(4, Math.round(window.options_LodDistancePreset ?? 2)));
	const t = (typeof getHudI18n === "function") ? getHudI18n() : null;
	const names = (t && Array.isArray(t.lodDistPresets) && t.lodDistPresets.length === 5)
		? t.lodDistPresets
		: ["Very Low", "Low", "Balanced", "High", "Ultra"];
	const colors = ["#ff8a65", "#ffb74d", "#76ff03", "#40c4ff", "#e040fb"];
	lbl.textContent = names[idx];
	lbl.style.color = colors[idx];
}

// Called when an options checkbox is clicked.
function changeSetting(settingName, val)
{
	if (settingName === "options_FirstPersonView") {
		if (typeof toggleFirstPersonView === "function") {
			toggleFirstPersonView(!!val);
		}
		return;
	}
	window[settingName] = val;
	try {
		if (typeof localStorage !== "undefined" && settingName !== "options_DrawBuildingWireframes" && settingName !== "options_CameraTracking" && settingName !== "options_FirstPersonView") {
			localStorage.setItem(settingName, JSON.stringify(val));
		}
	} catch (e) {}
	if (typeof updateHudDependencies === "function") updateHudDependencies();
	if (settingName === "options_RealTerrain") {
		if (typeof terrainRenderer !== "undefined" && terrainRenderer.initialized) {
			terrainRenderer.updateMapTexture();
		}
	} else if (settingName === "options_DrawTimeline") {
		if (typeof analyserTimeline !== "undefined") analyserTimeline.draw();
	} else if (settingName === "options_DrawDOD" && typeof terrainRenderer !== "undefined" && terrainRenderer.initialized) {
		if (terrainRenderer.usingRealTerrain) {
			terrainRenderer.updateDodOverlay();
		} else {
			terrainRenderer.updateMapTexture();
		}
	} else if (settingName === "options_LodFade") {
		if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized && typeof building3dRenderer.markCullDirty === "function") {
			building3dRenderer.markCullDirty();
		}
	} else if (
		(settingName === "options_StructureTextures" ||
		 settingName === "options_TreeTextures" ||
		 settingName === "options_BushTextures") &&
		typeof building3dRenderer !== "undefined" &&
		building3dRenderer.initialized
	) {
		if (settingName === "options_StructureTextures" && typeof updateHudDependencies === "function") {
			updateHudDependencies();
		}
		const mk = (typeof buildingHeightmap !== "undefined" && buildingHeightmap._mapKey)
			? buildingHeightmap._mapKey.toLowerCase()
			: "";
		if (val && mk && (!building3dRenderer._mapTex3dCache || !building3dRenderer._mapTex3dCache.has(mk) || !building3dRenderer._mapTex3dCache.get(mk).ready)) {
			if (typeof building3dRenderer._ensureStructureTexturesLoaded === "function") {
				building3dRenderer._ensureStructureTexturesLoaded(mk);
			}
		}
		if (typeof building3dRenderer.onTextureProfileChanged === "function") {
			building3dRenderer.onTextureProfileChanged();
		} else if (typeof building3dRenderer.rebuildBuffers === "function") {
			building3dRenderer.rebuildBuffers();
		}
	} else if (settingName === "options_StructureTextures") {
		if (typeof updateHudDependencies === "function") updateHudDependencies();
	}

	requestUpdate();
}


var playBarBubble
$(() => playBarBubble = $("#playBarBubble")[0])
function showPlayBarBubble()
{
	if (playBarBubble) playBarBubble.style.display = "block"
}

function setPlayBarBubble(e)
{
	if (typeof analyserTimeline !== "undefined" && typeof analyserTimeline.updateHoverBubble === "function") {
		analyserTimeline.updateHoverBubble(e);
		return;
	}
	if (!playBarBubble || !e || !e.target) return;
	const width = Math.max(1, e.target.clientWidth || 1);
	const Position = Math.max(0, Math.min(width, e.offsetX));
	const minVal = parseInt(e.target.min || "0", 10) || 0;
	const maxVal = parseInt(e.target.max || "1", 10) || 1;
	const Tick = Math.max(0, Math.round(minVal + (Position / width) * (maxVal - minVal)));
	const StringToShow = getTimeStringOfTick(Tick);

	playBarBubble.style.left = Math.max(4, Math.min(width - 48, Position - 22)) + "px";
	playBarBubble.textContent = StringToShow;
}

function hidePlayBarBubble()
{
	if (playBarBubble) playBarBubble.style.display = "none"
}

const VIEWPORT_2D = 0;
const VIEWPORT_3D_FREE = 1;
const VIEWPORT_3D_TOPDOWN = 2;
var viewportMode = VIEWPORT_2D;
var is3DMode = false;
var activeRenderer;

function showViewportModeToast(msg) {
	let toast = document.getElementById("viewportModeToast");
	if (!toast) {
		toast = document.createElement("div");
		toast.id = "viewportModeToast";
		toast.style.cssText = "position: absolute; top: 55px; left: 50%; transform: translateX(-50%); background: rgba(23, 35, 34, 0.93); color: rgb(239, 238, 241); border: 1px solid #555; border-radius: 2px; padding: 5px 14px; font-weight: bold; font-size: 13px; z-index: 1000; pointer-events: none; transition: opacity 0.3s ease;";
		document.body.appendChild(toast);
	}
	toast.textContent = msg;
	toast.style.opacity = "1";
	if (window._toastTimer) clearTimeout(window._toastTimer);
	window._toastTimer = setTimeout(() => {
		if (toast) toast.style.opacity = "0";
	}, 1500);
}

function closeTopRightMenus() {
	document.querySelectorAll(".hud-popover.open").forEach((el) => el.classList.remove("open"));
	document.querySelectorAll(".hud-menu-trigger.active").forEach((el) => el.classList.remove("active"));
}

function toggleTopRightMenu(popoverId, btnEl) {
	const target = document.getElementById(popoverId);
	if (!target) return;
	const wasOpen = target.classList.contains("open");
	closeTopRightMenus();
	if (!wasOpen) {
		target.classList.add("open");
		if (btnEl) btnEl.classList.add("active");
	}
}

function switchAnalyserTab(tabKey, btnEl) {
	const root = document.getElementById("analyserDiv");
	if (!root) return;
	root.querySelectorAll(".analyser-tab-btn").forEach((b) => b.classList.remove("active"));
	root.querySelectorAll(".analyser-tab-pane").forEach((p) => p.classList.remove("active"));
	if (btnEl) btnEl.classList.add("active");
	const pane = document.getElementById("analyserTab_" + tabKey);
	if (pane) pane.classList.add("active");
}

function updateHudDependencies() {
	const realTerrain = !!window.options_RealTerrain;
	const detailCheckbox = document.getElementById("options_TerrainDetail");
	if (detailCheckbox) detailCheckbox.disabled = !realTerrain;
	const depTerrain = document.getElementById("depTerrainDetail");
	if (depTerrain) depTerrain.classList.toggle("is-disabled-dep", !realTerrain);

	const fogOn = !!window.options_3dFog;
	const fogPlayerCb = document.getElementById("options_3dFogOnPlayer");
	if (fogPlayerCb) fogPlayerCb.disabled = !fogOn;
	const depFogPlayer = document.getElementById("depFogPlayerGroup");
	if (depFogPlayer) depFogPlayer.classList.toggle("is-disabled-dep", !fogOn);

	const visionCone = !!window.options_DrawVisionCone;
	const depVision = document.getElementById("depVisionConeGroup");
	if (depVision) depVision.classList.toggle("is-disabled-dep", !visionCone);
	const coneLosCb = document.getElementById("options_VisionConeRespectsLOS");
	if (coneLosCb) coneLosCb.disabled = !visionCone;
	const coneXrayCb = document.getElementById("options_VisionConeXRay");
	if (coneXrayCb) coneXrayCb.disabled = !visionCone;
	const qualDisabled = !visionCone || !window.options_VisionConeRespectsLOS;
	for (const qId of ["btnConeQualNormal", "btnConeQualHigh", "btnConeQualUltra", "btnConeQualExtreme"]) {
		const qb = document.getElementById(qId);
		if (qb) qb.disabled = qualDisabled;
	}

	const threatActive = !!window.options_DrawThreatLasers || !!window.options_DrawFlankChronometer;
	const depThreat = document.getElementById("depThreatLasersGroup");
	if (depThreat) depThreat.classList.toggle("is-disabled-dep", !threatActive);
	const coverCb = document.getElementById("options_ConeRespectsTerrain");
	if (coverCb) coverCb.disabled = !threatActive;

	const structTex = !!window.options_StructureTextures;
	const depStruct = document.getElementById("depStructureTexGroup");
	if (depStruct) depStruct.classList.toggle("is-disabled-dep", !structTex);
	const lodSlider = document.getElementById("options_LodDistancePreset");
	if (lodSlider) lodSlider.disabled = !structTex;
	const lodFadeCb = document.getElementById("options_LodFade");
	if (lodFadeCb) lodFadeCb.disabled = !structTex;
	updateLodDistanceLabel();

	const ssaoOn = !!window.options_3dAoSsao;
	const depSsao = document.getElementById("depSsaoQualityGroup");
	if (depSsao) depSsao.classList.toggle("is-disabled-dep", !ssaoOn);
	const ssaoSlider = document.getElementById("options_3dSsaoQuality");
	if (ssaoSlider) ssaoSlider.disabled = !ssaoOn;
	updateSsaoQualityLabel();
}

function getHudI18n() {
	if (typeof ANALYSER_I18N !== "undefined" && typeof currentAnalyserLang !== "undefined") {
		return ANALYSER_I18N[currentAnalyserLang] || ANALYSER_I18N.EN;
	}
	return null;
}

function updateViewportModeButton() {
	const t = getHudI18n();
	const labelFree = (t && t.mode3dBtnFree) || "3D FREE";
	const labelTop = (t && t.mode3dBtnTop) || "3D TOP";
	const title2d = (t && t.mode2dTitle) || "Viewport: 2D Map — Click or press [G] for 3D Free Camera";
	const titleFree = (t && t.mode3dFreeTitle) || "Viewport: 3D Free Camera — Click or press [G] for 3D Top-Down";
	const titleTop = (t && t.mode3dTopTitle) || "Viewport: 3D Top-Down — Click or press [G] to return to 2D Map";

	const btn = document.getElementById("btnViewportMode");
	if (btn) {
		btn.classList.remove("mode-2d", "mode-3d-free", "mode-3d-topdown");
		if (viewportMode === VIEWPORT_2D) {
			btn.classList.add("mode-2d");
			btn.textContent = "3D";
			btn.title = title2d;
		} else if (viewportMode === VIEWPORT_3D_FREE) {
			btn.classList.add("mode-3d-free");
			btn.textContent = labelFree;
			btn.title = titleFree;
		} else if (viewportMode === VIEWPORT_3D_TOPDOWN) {
			btn.classList.add("mode-3d-topdown");
			btn.textContent = labelTop;
			btn.title = titleTop;
		}
	}

	const pill = document.getElementById("lbl3DModeStatusPill");
	if (pill) {
		if (viewportMode === VIEWPORT_2D) pill.textContent = "2D";
		else if (viewportMode === VIEWPORT_3D_FREE) pill.textContent = labelFree;
		else if (viewportMode === VIEWPORT_3D_TOPDOWN) pill.textContent = labelTop;
	}

	const banner = document.getElementById("banner2dHint");
	if (banner) {
		banner.style.display = is3DMode ? "none" : "flex";
	}
}

function showAnalyserToast(msg) {
	showViewportModeToast(msg);
}

function setViewportMode(targetMode, showToast = true) {
	const hudCanvas = document.getElementById("map3dHud");
	const t = getHudI18n();
	const nextMode = ((parseInt(targetMode, 10) || 0) % 3 + 3) % 3;

	viewportMode = nextMode;
	is3DMode = (viewportMode !== VIEWPORT_2D);

	if (viewportMode !== VIEWPORT_3D_FREE && typeof options_FirstPersonView !== "undefined" && options_FirstPersonView) {
		options_FirstPersonView = false;
		const fpvChk = document.getElementById("options_FirstPersonView");
		if (fpvChk) fpvChk.checked = false;
		if (typeof renderer3d !== "undefined" && renderer3d) {
			renderer3d._fpvViewQuat = null;
			renderer3d._fpvActiveState = null;
			renderer3d._fpvInitialized = false;
		}
		if (typeof selection_UpdateInformationBox === "function") {
			selection_UpdateInformationBox();
		}
	}

	const isRec = (typeof clipRecorder !== 'undefined' && clipRecorder.isRecording);

	if (viewportMode === VIEWPORT_2D) {
		activeRenderer = renderer2d;
		if (typeof renderer3d !== "undefined" && renderer3d) {
			renderer3d.fov = renderer3d.baseFov;
		}
		$("#map")[0].style.display = "block";
		$("#map")[0].style.zIndex = "";
		$("#map3d")[0].style.display = "none";
		if (hudCanvas) hudCanvas.style.display = "none";
		if (showToast) showViewportModeToast((t && t.mode2dToast) || "2D Map");
		updateViewportModeButton();
		requestUpdate();
	} else if (viewportMode === VIEWPORT_3D_FREE) {
		if (!renderer3d.initialized) {
			if (!renderer3d.init()) {
				console.log("3D WebGL initialization failed");
				viewportMode = VIEWPORT_2D;
				is3DMode = false;
				updateViewportModeButton();
				return false;
			}
		}
		activeRenderer = renderer3d;
		renderer3d.isTopDown = false;
		if (isRec) {
			$("#map")[0].style.display = "block";
			$("#map")[0].style.zIndex = "0";
			$("#map3d")[0].style.zIndex = "1";
			if (hudCanvas) hudCanvas.style.zIndex = "2";
		} else {
			$("#map")[0].style.display = "none";
		}
		$("#map3d")[0].style.display = "block";
		if (hudCanvas) hudCanvas.style.display = "block";
		if (showToast) showViewportModeToast((t && t.mode3dFreeToast) || "3D Free Camera");
		updateViewportModeButton();
		renderer3d.draw();
	} else if (viewportMode === VIEWPORT_3D_TOPDOWN) {
		if (!renderer3d.initialized) {
			if (!renderer3d.init()) {
				console.log("3D WebGL initialization failed");
				viewportMode = VIEWPORT_2D;
				is3DMode = false;
				updateViewportModeButton();
				return false;
			}
		}
		activeRenderer = renderer3d;
		renderer3d.isTopDown = true;
		if (isRec) {
			$("#map")[0].style.display = "block";
			$("#map")[0].style.zIndex = "0";
			$("#map3d")[0].style.zIndex = "1";
			if (hudCanvas) hudCanvas.style.zIndex = "2";
		} else {
			$("#map")[0].style.display = "none";
		}
		$("#map3d")[0].style.display = "block";
		if (hudCanvas) hudCanvas.style.display = "block";
		if (showToast) showViewportModeToast((t && t.mode3dTopToast) || "3D Top-Down");
		updateViewportModeButton();
		renderer3d.draw();
	}
	return true;
}

function toggle3dMode() {
	// Cycle: 0 (2D Canvas) -> 1 (3D Free Camera) -> 2 (3D Top-Down) -> 0 (2D Canvas)
	setViewportMode((viewportMode + 1) % 3, true);
}

function toggleFirstPersonView(forceState = null) {
	const nextState = (forceState !== null) ? !!forceState : !options_FirstPersonView;
	const chk = document.getElementById("options_FirstPersonView");

	if (nextState) {
		const hasPlayer = (typeof SelectedPlayer !== "undefined" && SelectedPlayer != SELECTED_NOTHING && typeof AllPlayers !== "undefined" && !!AllPlayers[SelectedPlayer]);
		const hasVehicle = (typeof SelectedVehicle !== "undefined" && SelectedVehicle != SELECTED_NOTHING && typeof AllVehicles !== "undefined" && !!AllVehicles[SelectedVehicle]);

		if (!hasPlayer && hasVehicle) {
			const veh = AllVehicles[SelectedVehicle];
			if (veh && veh.Passengers && typeof veh.Passengers.forEach === "function" && typeof AllPlayers !== "undefined") {
				let slot0 = null;
				let slot1 = null;
				let firstAlive = null;
				veh.Passengers.forEach((pid) => {
					const cp = AllPlayers[pid];
					if (!cp || cp.isJoining || !cp.isAlive) return;
					if (!firstAlive) firstAlive = cp;
					if (cp.vehicleSlot === 0 && !slot0) slot0 = cp;
					else if (cp.vehicleSlot === 1 && !slot1) slot1 = cp;
				});
				const primary = slot0 || slot1 || firstAlive;
				if (primary && typeof selection_SelectPlayer === "function") {
					selection_SelectPlayer(primary.id, false);
				}
			}
		}

		const validPlayer = (typeof SelectedPlayer !== "undefined" && SelectedPlayer != SELECTED_NOTHING && typeof AllPlayers !== "undefined" && !!AllPlayers[SelectedPlayer]);
		const validVehicle = (typeof SelectedVehicle !== "undefined" && SelectedVehicle != SELECTED_NOTHING && typeof AllVehicles !== "undefined" && !!AllVehicles[SelectedVehicle]);

		if (!validPlayer && !validVehicle) {
			options_FirstPersonView = false;
			if (chk) chk.checked = false;
			const t = getHudI18n();
			showAnalyserToast((t && t.fpvNoTargetToast) || "Select a player or vehicle first for 1PV");
			if (typeof selection_UpdateInformationBox === "function") selection_UpdateInformationBox();
			return false;
		}

		if (viewportMode !== VIEWPORT_3D_FREE) {
			if (!setViewportMode(VIEWPORT_3D_FREE, false)) {
				options_FirstPersonView = false;
				if (chk) chk.checked = false;
				return false;
			}
		}
	}

	options_FirstPersonView = nextState;
	if (chk) chk.checked = options_FirstPersonView;

	if (typeof renderer3d !== "undefined" && renderer3d) {
		renderer3d.fpvYawOffset = 0;
		renderer3d.fpvPitch = 0;
		renderer3d._fpvInitialized = false;
		if (!options_FirstPersonView) {
			renderer3d._fpvViewQuat = null;
			renderer3d._fpvActiveState = null;
		}
	}

	if (typeof selection_UpdateInformationBox === "function") {
		selection_UpdateInformationBox();
	}
	if (typeof requestUpdate === "function") {
		requestUpdate();
	}
	return options_FirstPersonView;
}
$(() => {
	activeRenderer = renderer2d;
	updateViewportModeButton();
	updateHudDependencies();
});

//TODO menu styles
$( function() {$( "#menuList" ).menu(
{
	position: 
	{	
		collision: "fit"
	}
}
);});
