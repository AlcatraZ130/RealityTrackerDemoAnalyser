"use strict";

var highlights = []

const fadePersecond = 1.5

class HighLightArea extends AnimationInstance {
	constructor(x, z) {
		super();
		this.x = x;
		this.z = z;
		this.fade = 1
	}
	onTick(timePassed) {
		
		this.fade = Math.max(this.fade - timePassed * fadePersecond, 0);
	}
	shouldDelete() {
		return this.fade == 0;
    }
	draw(context) {
		const x = XtoCanvas(this.x)
		const y = YtoCanvas(this.z)

		context.save()

		context.globalAlpha = this.fade
		Context.strokeStyle = "red"
		Context.lineWidth = 2

		context.beginPath()
		context.moveTo(x, 0);
		context.lineTo(x, Canvas.height);
		context.stroke();

		context.beginPath()
		context.moveTo(0, y);
		context.lineTo(Canvas.width, y);
		context.stroke();


		context.restore()
    }
}

function highlight(x, z, panIfOffscreen = true)
{
	if (!Number.isFinite(x) || !Number.isFinite(z)) return;
	new HighLightArea(x, z);
	if (panIfOffscreen) {
		if (typeof is3DMode !== "undefined" && is3DMode) {
			if (typeof focusCameraOnWorldPos === "function") {
				focusCameraOnWorldPos(x, z);
			}
		} else if (typeof XtoCanvas === "function" && typeof YtoCanvas === "function" && typeof Canvas !== "undefined") {
			const cx = XtoCanvas(x);
			const cy = YtoCanvas(z);
			const scale = (typeof options_canvasScale !== "undefined" && options_canvasScale > 0) ? options_canvasScale : 1.0;
			const vw = Canvas.width / scale;
			const vh = Canvas.height / scale;
			if (cx < 40 || cx > vw - 40 || cy < 40 || cy > vh - 40) {
				if (typeof focusCameraOnWorldPos === "function") {
					focusCameraOnWorldPos(x, z);
				}
			}
		}
	}
	if (typeof requestUpdate === "function") requestUpdate();
}
