"use strict";

// Drag and Zoom System
$(function ()
{
	const mapdiv = $("#renderers")[0]
	// var Context = Canvas.getContext("2d")
	// <!--  MouseDown, wheel, click are only relevant on the canvas -->
	mapdiv.addEventListener("mousedown", MouseDown, false)
	mapdiv.addEventListener("click", MouseClick, false)
	mapdiv.addEventListener("wheel", Wheel, { passive: false })
	const map3dCanvas = document.getElementById("map3d");
	if (map3dCanvas) map3dCanvas.addEventListener("wheel", Wheel, { passive: false });
	// <!-- Mouse Up/move is always important to catch everywhere so we can keep dragging when the mouse leaves the canvas -->
	document.addEventListener("mouseup", function (event)
	{
		if (event.button == 0) MouseIsDown = false
	}, false)
	document.addEventListener("mousemove", MouseMove, false)
});


// Position the mouse went down on
var MouseDownPosX
var MouseDownPosY

var MouseLastPosX
var MouseLastPosY

// Position of the Camera when the mouse went down
var MouseDownCameraX
var MouseDownCameraY
var MouseIsDown = false




function MouseDown(event)
{
	// Left click only
	if (event.button != 0)
		return

	event.preventDefault();

	//stop zooming
	if (ZoomAnimation.instance != null)
		ZoomAnimation.instance.delete();
	var pos = activeRenderer.getMousePos(event)
	MouseDownPosX = pos.X
	MouseDownPosY = pos.Y
	MouseLastPosX = pos.X;
	MouseLastPosY = pos.Y;
	MouseDownCameraX = CameraX
	MouseDownCameraY = CameraY
	MouseIsDown = true
}


function MouseMove(event)
{
	if (MouseIsDown)
	{
		event.preventDefault();
		var pos = activeRenderer.getMousePos(event)

		if (is3DMode) {
			renderer3d.mouseMove(pos.X - MouseLastPosX, pos.Y - MouseLastPosY);
		} else {
			CameraX = MouseDownCameraX + (pos.X - MouseDownPosX);
			CameraY = MouseDownCameraY + (pos.Y - MouseDownPosY);
        }

		MouseLastPosX = pos.X;
		MouseLastPosY = pos.Y;

		clampCamera();
		requestUpdate();
	}
}

function clampCamera()
{
	var maxh = (Canvas.height - 200) / options_canvasScale
	var maxw = (Canvas.width - 200) / options_canvasScale
	var min = (200 - MapImageDrawSize)
	CameraX = clamp(min, CameraX, maxw)
	CameraY = clamp(min, CameraY, maxh)
}


var doubleClickTimer = null
const doubleClickTime = 220
// Distance from point of click where players are selectable
const MinDistanceSquared = 350

function MouseClick(event)
{
	event.preventDefault();
	if (event.button != 0)
		return

	var pos = activeRenderer.getMousePos(event)

	// If mouse was dragged significantly, do not process click
	const dragDistSq = Math.pow(MouseDownPosX - pos.X, 2) + Math.pow(MouseDownPosY - pos.Y, 2);
	if (dragDistSq > 150)
		return;

	const objectToSelect = activeRenderer.mouseClick(pos);

	if (doubleClickTimer == null) {
		doubleclick_StartTimer();
		handleSingleClick(objectToSelect);
	} else {
		doubleclick_Clear();
		handleDoubleClick(objectToSelect);
	}

	requestUpdate();

}

function handleSingleClick(objectClicked) {
	selection_SelectObject(objectClicked)
}

function handleDoubleClick(objectClicked) {
	selection_selectObjectSquad(objectClicked)
}


function doubleclick_StartTimer()
{
	doubleclick_Clear()
	doubleClickTimer = setTimeout(() => doubleClickTimer = null, doubleClickTime)
}

function doubleclick_Clear()
{
	if (doubleClickTimer != null)
		clearTimeout(doubleClickTimer)
	doubleClickTimer = null
}



function Wheel(event)
{
	if (typeof is3DMode !== "undefined" && is3DMode && typeof renderer3d !== "undefined") {
		if (event.preventDefault) event.preventDefault();
		if (renderer3d.isTopDown) {
			const zoomFactor = (event.deltaY < 0) ? 0.85 : 1.18;
			renderer3d.cameraPos[1] = clamp(50.0, renderer3d.cameraPos[1] * zoomFactor, 3500.0);
			renderer3d.clampPosition();
			requestUpdate();
			return;
		}

		const isTracking = (typeof options_CameraTracking !== "undefined" && options_CameraTracking &&
			((typeof SelectedPlayer !== "undefined" && SelectedPlayer !== SELECTED_NOTHING) ||
			 (typeof SelectedVehicle !== "undefined" && SelectedVehicle !== SELECTED_NOTHING)));
		if (isTracking) {
			const delta = (event.deltaY < 0) ? -2.5 : 2.5;
			renderer3d.adjustOrbitDistance(delta);
			requestUpdate();
			return;
		}

		// In Free 3D mode: Mouse wheel smoothly adjusts camera flight speed
		if (renderer3d.cameraSpeed == null || isNaN(renderer3d.cameraSpeed)) renderer3d.cameraSpeed = 200;
		if (event.deltaY < 0) {
			renderer3d.cameraSpeed = Math.min(3000, Math.round(renderer3d.cameraSpeed * 1.35 + 20));
		} else {
			renderer3d.cameraSpeed = Math.max(15, Math.round(renderer3d.cameraSpeed * 0.70 - 10));
		}
		
		// Visual HUD speed notification
		if (typeof hud3d !== "undefined") {
			hud3d.showSpeedNotification = {
				speed: renderer3d.cameraSpeed,
				time: performance.now()
			};
		}

		requestUpdate();
		return;
	}

	if (MouseIsDown || event.ctrlKey)
		return;

	let pivotPos = activeRenderer.getMousePos(event);
	const scale = (typeof options_canvasScale !== "undefined" && options_canvasScale > 0) ? options_canvasScale : 1.0;
	if (typeof options_CameraTracking !== "undefined" && options_CameraTracking && ((typeof SelectedPlayer !== "undefined" && SelectedPlayer !== SELECTED_NOTHING) || (typeof SelectedVehicle !== "undefined" && SelectedVehicle !== SELECTED_NOTHING))) {
		pivotPos = { X: (Canvas.width / 2) / scale, Y: (Canvas.height / 2) / scale };
	}

	if (event.deltaY < 0)
		new ZoomAnimation(pivotPos, 1.05)
	else
		new ZoomAnimation(pivotPos, 0.95)
}

// -- Zoom animation system
const ZoomTotalTime = 0.3
const ZoomMinimum = 0.2
const ZoomMaximum = 32
class ZoomAnimation extends AnimationInstance {
	static instance = null;

	constructor(mousepos, amount) {
		super();
		if (ZoomAnimation.instance != null)
			ZoomAnimation.instance.delete();
		ZoomAnimation.instance = this;

		this.ZoomAmount = amount;
		this.ZoomMousePos = mousepos;

		this.ZoomTime = 0
		this.onTick(0);
	}
	onTick(timePassed) {
		
		var Amount = Math.pow(this.ZoomAmount, 1 / (this.ZoomTime * 20 + 1) );
		var OldZoom = CameraZoom
		CameraZoom *= Amount
		CameraZoom = clamp(ZoomMinimum, CameraZoom, ZoomMaximum)

		// Adjust Camera so mouse will still be pointing at the same pixel
		CameraX = this.ZoomMousePos.X - (CameraZoom / OldZoom) * (this.ZoomMousePos.X - CameraX)
		CameraY = this.ZoomMousePos.Y - (CameraZoom / OldZoom) * (this.ZoomMousePos.Y - CameraY)

		MapImageDrawSize = 1024 * CameraZoom

		this.ZoomTime += timePassed
		clampCamera()
	}
	shouldDelete() {
		return this.ZoomTime >= ZoomTotalTime || (MouseIsDown);
	}
	delete() {
		
		this.ZoomTicks = 99999999;
		ZoomAnimation.instance = null;
    }
}





function clamp(min, X, max)
{
	return Math.min(Math.max(X, min), max);
}
