"use strict";


var renderer3d;
class Renderer3d extends Initializable {

    initialized = false;
    // canvas HTML object
    canvas = null;
    // canvas 3d context
    gl = null;
    // DIV containing 3d canvas
    mapDiv = null;
    aspect = 4 / 3;


    isTopDown = false;
    targetTopDownAltitude = null;
    cameraPos = vec4.create();
    cameraYaw = 0;
    cameraPitch = 0;

    followTarget = null;

    red = vec3.set(vec3.create(), 1.0, 0.0, 0.0);
    green = vec3.set(vec3.create(), 0.0, 1.0, 0.0);
    blue = vec3.set(vec3.create(), 0.0, 0.25, 1.0);
    white = vec3.set(vec3.create(), 1.0, 1.0, 1.0);

    
    baseFov = 90.0;
    zoomTargetFov = 12.0;
    fov = 90.0;
    aspect = 1.0;

    initialized = false;
    dataReady = true;

    constructor() {
        super();
        this.canvas = document.querySelector("#map3d");
        this.mapDiv = document.querySelector("#renderers");
        this.dataReady = true;
    }

    getIsDataReady() {
        return true;
    }

    getInitializationList() { return [skyboxRenderer, terrainRenderer, building3dRenderer, water3dRenderer, geometry2dRenderer, entities3dRenderer, lines3dRenderer, smoke3dRenderer, hud3d]; }
    getDependencyList() { return [heightmap]; }

    init() {
        if (this.initialized) return true;

        this.canvas = document.querySelector("#map3d");
        this.mapDiv = document.querySelector("#renderers");
        if (!this.canvas) return false;

        const gl = this.canvas.getContext("webgl2", {
            alpha: true,
            depth: true,
            stencil: false,
            antialias: true,
            powerPreference: "high-performance",
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        });

        if (gl === null) {
            alert("Unable to initialize WebGL2. Your browser or machine may not support it.");
            return false;
        }

        this.gl = gl;

        // Enable Depth Testing
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);

        // Extensions
        this.extExtColorBufferFloat = gl.getExtension('EXT_color_buffer_float');

        if (!this.runInitList())
            return false;

        this._initVisionDepthPass();
        this._initFullscreenVolumetricPass();
        this._initSceneFbo();
        this._initShadowPass();
        this._initSsaoPass();
        this._initFxaaPass();

        this._updateRenderingSize();
        vec4.set(this.cameraPos, 0, 300, 0, 0);

        this.initialized = true;
        return true;
    }

    setTopDownView() {
        this.isTopDown = true;
        this.cameraPitch = -89.9;
        this.cameraYaw = 0;
        this.targetTopDownAltitude = null;
        if (this.cameraPos[1] < 300.0) {
            this.cameraPos[1] = 600.0;
        }
    }

    getMousePos(event) {
        var rect = this.canvas.getBoundingClientRect()

        return {
            X: (event.clientX - rect.left),
            Y: (event.clientY - rect.top),
        };
    }

    mouseClick(pos) {
        if (!this.canvas || !this.cameraPos) return null;

        // Prioritize clicking floating 3D HUD icons (especially soldiers/vehicles at distance)
        if (typeof hud3d !== "undefined" && hud3d.initialized && typeof hud3d.pickEntityAtScreenPos === "function") {
            const iconHit = hud3d.pickEntityAtScreenPos(pos.X, pos.Y);
            if (iconHit) return iconHit;
        }

        // Convert mouse coordinates to NDC [-1, 1]
        const x = 2 * (pos.X / (this.canvas.width - 1)) - 1;
        const y = 2 * (pos.Y / (this.canvas.height - 1)) - 1;
        const fovRadHalf = this.fov / 180 * Math.PI / 2;
        const tangent = Math.tan(fovRadHalf);

        const directionx = tangent * this.aspect * x;
        const directiony = tangent * -y;
        const directionz = -1.0;

        let rayDir = vec3.normalize(vec3.create(), vec3.set(vec3.create(), directionx, directiony, directionz));
        const cameraQuat = this.getCameraQuat();
        vec3.transformQuat(rayDir, rayDir, cameraQuat);

        const camPos = this.cameraPos;

        let bestEntity = null;
        let bestRayDist = Infinity;

        // 1. Raycast Soldiers
        if (typeof AllPlayers !== "undefined") {
            for (let i in AllPlayers) {
                const p = AllPlayers[i];
                if (!p || p.isJoining || !p.isAlive || (p.vehicleid && p.vehicleid >= 0)) continue;

                let px = (typeof p.getX === "function") ? p.getX() : p.X;
                let py = (typeof p.getY === "function") ? p.getY() : (p.Y || 0);
                let pz = (typeof p.getZ === "function") ? p.getZ() : p.Z;
                if (px == null || isNaN(px) || pz == null || isNaN(pz)) continue;

                if (typeof heightmap !== "undefined") {
                    const gh = heightmap.getHeightFromCoords(px, pz);
                    py = Math.max(py, gh + 0.1);
                }

                // Vector from camera to player center (center of mass at Y + 0.9m)
                const targetCenter = vec3.set(vec3.create(), px, py + 0.9, -pz);
                const toTarget = vec3.sub(vec3.create(), targetCenter, camPos);

                // Distance along ray
                const t = vec3.dot(toTarget, rayDir);
                if (t < 0.5 || t > bestRayDist) continue;

                // Perpendicular distance from ray to soldier center
                const projPoint = vec3.scaleAndAdd(vec3.create(), camPos, rayDir, t);
                const perpDist = vec3.dist(targetCenter, projPoint);

                // Soldier selection radius: 1.5 meters
                if (perpDist <= 1.5) {
                    bestRayDist = t;
                    bestEntity = p;
                }
            }
        }

        // 2. Raycast Vehicles
        if (typeof AllVehicles !== "undefined") {
            const showEmptyVehs = (typeof options_DrawEmptyVehicles !== "undefined") ? options_DrawEmptyVehicles : true;
            for (let i in AllVehicles) {
                const v = AllVehicles[i];
                if (!v || v.isClimbingVehicle) continue;
                if (!showEmptyVehs && (!v.Passengers || v.Passengers.size === 0)) continue;

                let vx = (typeof v.getX === "function") ? v.getX() : v.X;
                let vy = (typeof v._smoothY === "number" && !isNaN(v._smoothY)) ? v._smoothY : ((typeof v.getY === "function") ? v.getY() : (v.Y || 0));
                let vz = (typeof v.getZ === "function") ? v.getZ() : v.Z;
                if (vx == null || isNaN(vx) || vz == null || isNaN(vz)) continue;

                // Vehicle center (elevated ~1.2m)
                const targetCenter = vec3.set(vec3.create(), vx, vy + 1.2, -vz);
                const toTarget = vec3.sub(vec3.create(), targetCenter, camPos);

                const t = vec3.dot(toTarget, rayDir);
                if (t < 0.5 || t > bestRayDist) continue;

                const projPoint = vec3.scaleAndAdd(vec3.create(), camPos, rayDir, t);
                const perpDist = vec3.dist(targetCenter, projPoint);

                // Vehicle selection radius: 3.5 to 6.0 meters
                const vehRadius = (v.isFlyingVehicle) ? 6.0 : 3.5;
                if (perpDist <= vehRadius) {
                    bestRayDist = t;
                    bestEntity = v;
                }
            }
        }

        return bestEntity;
    }

    _updateRenderingSize() {
        if (!this.mapDiv) this.mapDiv = document.querySelector("#renderers");
        if (!this.canvas) this.canvas = document.querySelector("#map3d");
        const w = (this.mapDiv && this.mapDiv.clientWidth) ? this.mapDiv.clientWidth : (window.innerWidth || 800);
        const h = (this.mapDiv && this.mapDiv.clientHeight) ? this.mapDiv.clientHeight : (window.innerHeight || 600);
        if (this.canvas && (this.canvas.width !== w || this.canvas.height !== h)) {
            this.canvas.width = w;
            this.canvas.height = h;
            this.aspect = this.canvas.width / this.canvas.height;
            this._resizeSceneFbo(w, h);
        }
        if (this.gl && this.canvas) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    };



    loadShader(type, source){
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
            
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    getCurrentViewMatrix() {
        if (this.isTopDown) {
            const eye = vec3.fromValues(this.cameraPos[0], this.cameraPos[1], this.cameraPos[2]);
            const target = vec3.fromValues(this.cameraPos[0], 0, this.cameraPos[2]);
            const up = vec3.fromValues(0, 0, -1); // North (+Z in game is -Z in WebGL) is Top
            const viewMatrix = mat4.create();
            mat4.lookAt(viewMatrix, eye, target, up);
            return viewMatrix;
        }

        const cameraRot = this.getCameraQuat();
        const forward = this.getCameraForward(cameraRot);
        const up = this.getCameraUp(cameraRot);

        const fowrardPoint = vec3.create();
        vec3.add(fowrardPoint, this.cameraPos, forward);

        const viewMatrix = mat4.create();
        mat4.lookAt(viewMatrix, this.cameraPos, fowrardPoint, up);

        return viewMatrix;
    }

    getCurrentProjectionMatrix() {
        const fieldOfView = this.fov * Math.PI / 180;
        const zNear = 0.25;
        const zFar = 20000.0; // 20km view distance prevents terrain horizon clipping
        const projectionMatrix = mat4.create();
        mat4.perspective(projectionMatrix,
            fieldOfView,
            this.aspect,
            zNear,
            zFar);
        return projectionMatrix;
    }

    getCameraQuat() {
        const cameraRot = quat.create();
        quat.fromEuler(cameraRot, this.cameraPitch, this.cameraYaw, 0);
        return cameraRot;
    }
    getCameraForward(quat) {
        if (quat == null)
            quat = this.getCameraQuat();
        const forward = vec3.create();
        vec3.set(forward, 0, 0, -1, 0);
        vec3.transformQuat(forward, forward, quat);
        return forward;
    }
    getCameraForwardUp(quat) {
        if (quat == null)
            quat = this.getCameraQuat();
        const forward = vec3.create();
        vec3.set(forward, 0, 0.3, -1, 0);
        vec3.normalize(forward, forward);
        vec3.transformQuat(forward, forward, quat);
        return forward;
    }
    getCameraRight(quat) {
        if (quat == null)
            quat = this.getCameraQuat();
        const right = vec3.create();
        vec3.set(right, 1, 0, 0, 0);
        vec3.transformQuat(right, right, quat);
        return right;
    }

    getCameraUp(quat) {
        if (quat == null)
            quat = this.getCameraQuat();
        const up = vec3.create();
        vec3.set(up, 0, 1, 0, 0);
        vec3.transformQuat(up, up, quat);
        return up;
    }

    // Called when mouse is moved when held down
    mouseMove(x, y) {
        if (this.isTopDown) {
            // Pan smoothly across terrain
            const panFactor = (this.cameraPos[1] / 650.0) * 1.2;
            this.cameraPos[0] -= x * panFactor;
            this.cameraPos[2] -= y * panFactor;
            this.clampPosition();
            requestUpdate();
            return;
        }

        const zoomScale = Math.max(0.02, Math.tan((this.fov * Math.PI) / 360.0) / Math.tan(((this.baseFov || 90.0) * Math.PI) / 360.0));
        this.cameraYaw += (x / 6) * zoomScale;
        this.cameraPitch += (y / 6) * zoomScale;

        this.clampRotation();

        requestUpdate();
    };

    clampRotation() {
        if (this.cameraYaw < 0)
            this.cameraYaw += 360;
        else
            this.cameraYaw = this.cameraYaw % 360;

        this.cameraPitch = clamp(-89, this.cameraPitch, 89);
    }
    clampPosition() {
        if (this.isTopDown) {
            const groundH = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(this.cameraPos[0], -this.cameraPos[2]) : 0;
            const minH = groundH + 40.0;
            if (this.cameraPos[1] < minH) this.cameraPos[1] = minH;
        }
        // Free 3D camera allows full ground-level and underground terrain noclip
    }


    orbitDistance = 20.0;
    trackedHeightOffset = 1.1;

    adjustOrbitDistance(delta) {
        this.orbitDistance = clamp(2.0, this.orbitDistance + delta, 300.0);
    }

    _getTrackedVehiclePos(v) {
        if (!v) return null;
        const vx = (typeof v.getX === "function") ? v.getX() : v.X;
        const hasSmoothY = (typeof v._smoothY === "number" && Number.isFinite(v._smoothY));
        let vy = hasSmoothY ? v._smoothY : ((typeof v.getY === "function") ? v.getY() : (v.Y || 0));
        const vz = (typeof v.getZ === "function") ? v.getZ() : v.Z;
        if (!hasSmoothY && typeof heightmap !== "undefined" && !v.isFlyingVehicle) {
            vy = Math.max(vy, heightmap.getHeightFromCoords(vx, vz));
        }
        return vec3.set(vec3.create(), vx, vy + this.trackedHeightOffset, -vz);
    }

    update(frameTime) {
        let renderNeeded = false;

        const isTracking = (typeof options_CameraTracking !== "undefined" && options_CameraTracking);
        let trackedTargetPos = null;

        if (isTracking) {
            if (typeof SelectedPlayer !== "undefined" && SelectedPlayer != SELECTED_NOTHING && typeof AllPlayers !== "undefined") {
                const p = AllPlayers[SelectedPlayer];
                if (p && !p.isJoining) {
                    if (p.vehicleid >= 0 && typeof AllVehicles !== "undefined") {
                        trackedTargetPos = this._getTrackedVehiclePos(AllVehicles[p.vehicleid]);
                    } else {
                        let px = (typeof p.getX === "function") ? p.getX() : p.X;
                        let py = (typeof p.getY === "function") ? p.getY() : (p.Y || 0);
                        let pz = (typeof p.getZ === "function") ? p.getZ() : p.Z;
                        const floorY = (typeof heightmap !== "undefined")
                            ? Math.max(heightmap.getHeightFromCoords(px, pz), py - 0.85)
                            : (py - 0.85);
                        // Match Entities3dRenderer soldier ground baseline (0..1.58m mesh) and apply vertical offset
                        trackedTargetPos = vec3.set(vec3.create(), px, floorY + (this.trackedHeightOffset - 0.2), -pz);
                    }
                }
            } else if (typeof SelectedVehicle !== "undefined" && SelectedVehicle != SELECTED_NOTHING && typeof AllVehicles !== "undefined") {
                trackedTargetPos = this._getTrackedVehiclePos(AllVehicles[SelectedVehicle]);
            }
        }

        if (this.isTopDown) {
            let altDir = 0;
            if (keysDown.has(69)) altDir += 1; // E (Up +Y)
            if (keysDown.has(81)) altDir -= 1; // Q (Down -Y)
            if (altDir !== 0) {
                if (this.targetTopDownAltitude == null) {
                    this.targetTopDownAltitude = this.cameraPos[1];
                }
                const altRate = keysDown.has(16) ? 2.2 : 1.0;
                this.targetTopDownAltitude = clamp(
                    50.0,
                    this.targetTopDownAltitude * Math.exp(altDir * altRate * Math.min(frameTime, 0.25)),
                    3500.0
                );
                renderNeeded = true;
            }

            // Smooth Top-Down Altitude Interpolation
            if (this.targetTopDownAltitude != null) {
                const lerpAlt = Math.min(1.0, frameTime * 12.0);
                this.cameraPos[1] += (this.targetTopDownAltitude - this.cameraPos[1]) * lerpAlt;
                const preClampY = this.cameraPos[1];
                this.clampPosition();
                if (this.cameraPos[1] > preClampY && this.targetTopDownAltitude <= this.cameraPos[1]) {
                    this.targetTopDownAltitude = null;
                } else if (Math.abs(this.targetTopDownAltitude - this.cameraPos[1]) < 0.5) {
                    this.cameraPos[1] = this.targetTopDownAltitude;
                    this.targetTopDownAltitude = null;
                } else if (typeof requestUpdate === "function") {
                    requestUpdate();
                }
                renderNeeded = true;
            }

            if (trackedTargetPos) {
                // Top-Down Tracking Mode: Smoothly follow entity on ground plane (X, Z),
                // while altitude (Y) remains freely controllable by the user (50m to 3500m)!
                const lerpFactor = Math.min(1.0, frameTime * 16.0);
                this.cameraPos[0] += (trackedTargetPos[0] - this.cameraPos[0]) * lerpFactor;
                this.cameraPos[2] += (trackedTargetPos[2] - this.cameraPos[2]) * lerpFactor;
                this.clampPosition();
                renderNeeded = true;
            } else {
                let speed = Math.max(200, this.cameraPos[1] * 0.8);
                if (keysDown.has(16)) speed *= 3.0; // Shift boost

                if (keysDown.has(87)) { // W (North)
                    this.cameraPos[2] -= frameTime * speed;
                    renderNeeded = true;
                }
                if (keysDown.has(83)) { // S (South)
                    this.cameraPos[2] += frameTime * speed;
                    renderNeeded = true;
                }
                if (keysDown.has(65)) { // A (West)
                    this.cameraPos[0] -= frameTime * speed;
                    renderNeeded = true;
                }
                if (keysDown.has(68)) { // D (East)
                    this.cameraPos[0] += frameTime * speed;
                    renderNeeded = true;
                }

                this.clampPosition();
            }
        } else if (trackedTargetPos) {
            let zoomSpeed = 40.0;
            let rotateSpeed = 80.0;
            let heightSpeed = 6.0;
            if (keysDown.has(16)) { // Shift multiplier
                zoomSpeed *= 3.0;
                rotateSpeed *= 2.0;
                heightSpeed *= 3.0;
            }

            const prevHeightOffset = this.trackedHeightOffset;

            // W: Move closer towards where looking
            if (keysDown.has(87)) {
                this.orbitDistance = Math.max(2.0, this.orbitDistance - frameTime * zoomSpeed);
                renderNeeded = true;
            }
            // S: Move back away
            if (keysDown.has(83)) {
                this.orbitDistance = Math.min(300.0, this.orbitDistance + frameTime * zoomSpeed);
                renderNeeded = true;
            }
            // A: Orbit left around target
            if (keysDown.has(65)) {
                this.cameraYaw -= frameTime * rotateSpeed;
                this.clampRotation();
                renderNeeded = true;
            }
            // D: Orbit right around target
            if (keysDown.has(68)) {
                this.cameraYaw += frameTime * rotateSpeed;
                this.clampRotation();
                renderNeeded = true;
            }
            // E: Raise vertical orbit target offset
            if (keysDown.has(69)) {
                this.trackedHeightOffset = clamp(0.2, this.trackedHeightOffset + frameTime * heightSpeed, 20.0);
                renderNeeded = true;
            }
            // Q: Lower vertical orbit target offset
            if (keysDown.has(81)) {
                this.trackedHeightOffset = clamp(0.2, this.trackedHeightOffset - frameTime * heightSpeed, 20.0);
                renderNeeded = true;
            }

            if (this.trackedHeightOffset !== prevHeightOffset) {
                trackedTargetPos[1] += (this.trackedHeightOffset - prevHeightOffset);
            }

            // Use the exact view forward vector so the tracked target stays centered when orbiting
            const fwd = this.getCameraForward();
            const fwdX = fwd[0];
            const fwdY = fwd[1];
            const fwdZ = fwd[2];

            // Camera placed at distance along the independent look line of sight
            const targetCamX = trackedTargetPos[0] - fwdX * this.orbitDistance;
            const targetCamY = trackedTargetPos[1] - fwdY * this.orbitDistance;
            const targetCamZ = trackedTargetPos[2] - fwdZ * this.orbitDistance;

            const lerpFactor = Math.min(1.0, frameTime * 16.0);
            this.cameraPos[0] += (targetCamX - this.cameraPos[0]) * lerpFactor;
            this.cameraPos[1] += (targetCamY - this.cameraPos[1]) * lerpFactor;
            this.cameraPos[2] += (targetCamZ - this.cameraPos[2]) * lerpFactor;

            this.clampPosition();
            renderNeeded = true;
        } else {
            let speed = this.cameraSpeed || 200;
            if (keysDown.has(16))
                speed = speed * 3.5;

            if (keysDown.has(87)) { // W
                const forward = vec3.scale(vec3.create(), this.getCameraForward(), frameTime * speed);
                vec3.add(this.cameraPos, this.cameraPos, forward);
                renderNeeded = true;
            }
            if (keysDown.has(83)) { // S
                const forward = vec3.scale(vec3.create(), this.getCameraForward(), -frameTime * speed);
                vec3.add(this.cameraPos, this.cameraPos, forward);
                renderNeeded = true;
            }
            if (keysDown.has(68)) { // D
                const right = vec3.scale(vec3.create(), this.getCameraRight(), frameTime * speed);
                vec3.add(this.cameraPos, this.cameraPos, right);
                renderNeeded = true;
            }
            if (keysDown.has(65)) { // A
                const right = vec3.scale(vec3.create(), this.getCameraRight(), -frameTime * speed);
                vec3.add(this.cameraPos, this.cameraPos, right);
                renderNeeded = true;
            }
            if (keysDown.has(69)) { // E (Up +Y)
                this.cameraPos[1] += frameTime * speed;
                renderNeeded = true;
            }
            if (keysDown.has(81)) { // Q (Down -Y)
                this.cameraPos[1] -= frameTime * speed;
                renderNeeded = true;
            }

            this.clampPosition();
        }

        // Smooth Optical Zoom (V key = 86)
        const targetZoomFov = clamp(3.0, (this.zoomTargetFov != null) ? this.zoomTargetFov : 12.0, 65.0);
        const desiredFov = (typeof is3DMode !== "undefined" && is3DMode && keysDown.has(86))
            ? targetZoomFov
            : this.baseFov;
        if (Math.abs(desiredFov - this.fov) > 0.05) {
            this.fov += (desiredFov - this.fov) * Math.min(1.0, frameTime * 14.0);
            if (Math.abs(desiredFov - this.fov) <= 0.05) {
                this.fov = desiredFov;
            }
            renderNeeded = true;
        } else if (this.fov !== desiredFov) {
            this.fov = desiredFov;
            renderNeeded = true;
        }

        if (renderNeeded)
            requestUpdate();
    }

    draw() {
        this._updateRenderingSize();
        const gl = this.gl;

        // Compute active 1:1 fog state up front so both shadow pass & building culling can use fog-wall culling
        const fogEnabled = (typeof options_3dFog !== "undefined" && !!options_3dFog);
        const playerFogOrigin = (fogEnabled && typeof options_3dFogOnPlayer !== "undefined" && !!options_3dFogOnPlayer)
            ? this.getSelectedFogOrigin()
            : null;
        const useFog = fogEnabled && (!this.isTopDown || !!playerFogOrigin);
        const fogOrigin = playerFogOrigin || this.cameraPos;
        const fogCfg = useFog ? this.getMapFogConfig() : null;
        this.fogCullActive = !!(useFog && fogCfg && fogCfg.effectiveDist > 0);
        this.fogCullOrigin = fogOrigin;
        this.fogCullDist = (this.fogCullActive) ? (fogCfg.effectiveDist + 32.0) : 0.0;

        // 0. Optional Shadow Map Pre-Pass (2048x2048 Directional Sun Depth)
        this._renderShadowPass();

        const aaMode = (typeof options_3dAntiAliasing !== "undefined") ? (parseInt(options_3dAntiAliasing, 10) || 0) : 1;
        const wantMsaa = (aaMode === 2 || aaMode === 3);
        const wantFxaa = (aaMode === 1 || aaMode === 3);
        if (wantMsaa) {
            this._ensureMsaaFbo(this.canvas.width, this.canvas.height);
        }
        const useMsaa = wantMsaa && this.msaaReady;

        // 1. Pass 0: Render 3D Scene into MSAA FBO (if enabled) or Scene FBO (Color + Selection Mask MRT + Depth)
        gl.bindFramebuffer(gl.FRAMEBUFFER, useMsaa ? this.sceneMsaaFbo : this.sceneFbo);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        if (this.selectionFboReady) {
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        }
        if (fogCfg) {
            gl.clearColor(fogCfg.fogColor[0], fogCfg.fogColor[1], fogCfg.fogColor[2], 1.0);
        } else {
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
        }
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (this.selectionFboReady) {
            if (!this._clearZeroVec) this._clearZeroVec = new Float32Array([0.0, 0.0, 0.0, 0.0]);
            gl.clearBufferfv(gl.COLOR, 1, this._clearZeroVec);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        }

        if (typeof skyboxRenderer !== "undefined" && skyboxRenderer.initialized) {
            skyboxRenderer.draw();
        }
        terrainRenderer.draw();
        if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized) {
            building3dRenderer.draw();
        }
        if (typeof entities3dRenderer !== "undefined" && entities3dRenderer.initialized) {
            if (this.selectionFboReady) {
                gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
            }
            gl.disable(gl.BLEND);
            entities3dRenderer.draw();
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            if (this.selectionFboReady) {
                gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
            }
        }
        if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized && typeof building3dRenderer.drawBushes === "function") {
            building3dRenderer.drawBushes();
        }
        if (typeof water3dRenderer !== "undefined" && water3dRenderer.initialized) {
            water3dRenderer.draw();
        }
        if (typeof lines3dRenderer !== "undefined" && lines3dRenderer.initialized) {
            lines3dRenderer.draw();
        }
        geometry2dRenderer.draw();

        const hasOutline = !!(this.selectionFboReady && typeof entities3dRenderer !== "undefined" && entities3dRenderer.initialized && entities3dRenderer.hasSelection);

        // 1b. Resolve MSAA renderbuffers into sceneFbo textures before SSAO & post-processing
        if (useMsaa) {
            this._resolveMsaaToSceneFbo(hasOutline);
        }

        // 2. Pass 1: Soldier Eye Depth Pre-Pass (if vision cone active & respects LOS)
        const vc = this.activeVisionCone;
        if (vc && vc.respect) {
            this._renderSoldierEyeDepth(vc.eyeX, vc.eyeY, vc.eyeZ, vc.rotDeg, vc.range, vc.coneAngle);
        }

        // 2b. Optional SSAO + Bilateral Blur Pass (uses sceneDepthTex)
        const useSsao = this._renderSsaoPass();

        // 3. Pass 2: Fullscreen Post-Process (SSAO + Volumetric Cone + Selection Outline)
        //    If FXAA is active, render into postFbo and finish with Pass 3 (FXAA -> screen).
        if (wantFxaa) {
            this._ensurePostFbo(this.canvas.width, this.canvas.height);
        }
        const useFxaa = wantFxaa && this.postFboReady && !!this.fxaaProgram;

        gl.bindFramebuffer(gl.FRAMEBUFFER, useFxaa ? this.postFbo : null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);

        this._renderFullscreenVolumetricPass(vc, hasOutline, useSsao, useFog, fogCfg, fogOrigin);

        // 3b. Volumetric 3D Smoke Screens rendered AFTER SSAO (soft-particle depth tested against sceneDepthTex)
        //     Eliminates SSAO bleed-through behind transparent smoke and blends smoothly with terrain/walls.
        if (typeof smoke3dRenderer !== "undefined" && smoke3dRenderer.initialized) {
            smoke3dRenderer.draw(useFog, fogCfg, fogOrigin);
        }

        if (useFxaa) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            this._renderFxaaPass();
        }

        // 4. Overlays & HUD on top of final image
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        if (typeof hud3d !== "undefined" && hud3d.initialized) {
            hud3d.draw();
        }
        if (typeof analyserTimeline !== "undefined") {
            analyserTimeline.draw();
        }

        this.activeVisionCone = null;
    };

    getGeometry(name) {
        let geom = this.getGeometry3d(name);
        if (geom == null)
            return this.getGeometry2d(name);
    }

    getGeometry2d(name) {
        if (!this.initialized)
            return null;

        return geometry2dRenderer.getCreate2DGeometry(name);
    }

    _initVisionDepthPass(quality = 'normal') {
        const gl = this.gl;
        if (!gl) return;

        const resMap = {
            normal: { w: 512, h: 128 },
            high: { w: 1024, h: 256 },
            ultra: { w: 2048, h: 512 },
            extreme: { w: 4096, h: 1024 }
        };
        const res = resMap[quality] || resMap.normal;
        const W = res.w;
        const H = res.h;
        this.visionDepthWidth = W;
        this.visionDepthHeight = H;

        // Cleanup existing resources if re-initializing
        if (this.visionColorTex) gl.deleteTexture(this.visionColorTex);
        if (this.visionDepthRb) gl.deleteRenderbuffer(this.visionDepthRb);
        if (this.visionDepthFbo) gl.deleteFramebuffer(this.visionDepthFbo);

        // 1. Color Texture (RGBA to store packed linear depth)
        this.visionColorTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.visionColorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        // 2. Depth Renderbuffer
        this.visionDepthRb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.visionDepthRb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);

        // 3. FBO
        this.visionDepthFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.visionDepthFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.visionColorTex, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.visionDepthRb);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // 4. Depth Shader Program (Packed Linear Depth)
        if (!this.visionDepthProgram) {
            const vs = `
                attribute vec3 a_position;
                uniform mat4 u_eyeViewProj;
                varying float v_depth;
                void main() {
                    vec4 pos = u_eyeViewProj * vec4(a_position, 1.0);
                    gl_Position = pos;
                    v_depth = pos.w;
                }
            `;
            const fs = `
                precision highp float;
                varying float v_depth;
                uniform float u_far;
                void main() {
                    float linearDepth = clamp(v_depth / u_far, 0.0, 1.0);
                    vec4 enc = fract(linearDepth * vec4(1.0, 255.0, 65025.0, 16581375.0));
                    enc -= enc.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0);
                    gl_FragColor = enc;
                }
            `;
            const p = gl.createProgram();
            gl.attachShader(p, this.loadShader(gl.VERTEX_SHADER, vs));
            gl.attachShader(p, this.loadShader(gl.FRAGMENT_SHADER, fs));
            gl.linkProgram(p);

            this.visionDepthProgram = p;
            this.vision_aPosition = gl.getAttribLocation(p, "a_position");
            this.vision_uEyeViewProj = gl.getUniformLocation(p, "u_eyeViewProj");
            this.vision_uFar = gl.getUniformLocation(p, "u_far");
        }

        this.visionPixelBuffer = new Uint8Array(W * H * 4);
        console.log(`[Renderer3D] GPU Vision Depth FBO initialized (${W}x${H}) [${quality}]`);
    }

    makeVisionFrustum(fovHDeg, fovVDeg, near, far) {
        const tanH = Math.tan((fovHDeg * Math.PI / 180.0) / 2.0);
        const tanV = Math.tan((fovVDeg * Math.PI / 180.0) / 2.0);
        const right = tanH * near, left = -right;
        const top = tanV * near, bottom = -top;

        const rl = 1.0 / (right - left);
        const tb = 1.0 / (top - bottom);
        const nf = 1.0 / (near - far);

        return new Float32Array([
            (2.0 * near) * rl, 0, 0, 0,
            0, (2.0 * near) * tb, 0, 0,
            (right + left) * rl, (top + bottom) * tb, (far + near) * nf, -1,
            0, 0, (2.0 * far * near) * nf, 0
        ]);
    }

    renderVisionDepth(eyeX, eyeY, eyeZ, rotDeg, rangeM, coneAngleDeg) {
        const gl = this.gl;
        if (!gl || !this.visionDepthFbo) return null;

        const W = this.visionDepthWidth;
        const H = this.visionDepthHeight;
        const fovH = coneAngleDeg || 94.9;
        const fovV = 48.0;
        const near = 0.2;
        const far = rangeM || 500.0;

        const projMatrix = this.makeVisionFrustum(fovH, fovV, near, far);

        // In WebGL coordinate space: Y is up, -Z is game's +Z (apexZ = -eyeZ)
        const rad = (rotDeg || 0) / 180.0 * Math.PI;
        const dirX = Math.sin(rad);
        const dirZ = Math.cos(rad);

        const glEyeX = eyeX;
        const glEyeY = eyeY;
        const glEyeZ = -eyeZ;

        const glTargetX = glEyeX + dirX * 100.0;
        const glTargetY = glEyeY;
        const glTargetZ = glEyeZ - dirZ * 100.0;

        const eyePos = vec3.set(vec3.create(), glEyeX, glEyeY, glEyeZ);
        const eyeTarget = vec3.set(vec3.create(), glTargetX, glTargetY, glTargetZ);
        const up = vec3.set(vec3.create(), 0, 1, 0);

        const viewMatrix = mat4.lookAt(mat4.create(), eyePos, eyeTarget, up);
        const eyeViewProj = mat4.multiply(mat4.create(), projMatrix, viewMatrix);

        // Bind FBO and clear to 1.0 (far plane)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.visionDepthFbo);
        gl.viewport(0, 0, W, H);
        gl.clearColor(1.0, 1.0, 1.0, 1.0);
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Use Depth Shader
        gl.useProgram(this.visionDepthProgram);
        gl.uniformMatrix4fv(this.vision_uEyeViewProj, false, eyeViewProj);
        gl.uniform1f(this.vision_uFar, far);

        // Draw Terrain
        if (typeof terrainRenderer !== "undefined" && terrainRenderer.initialized) {
            terrainRenderer.drawDepth(this.vision_aPosition);
        }

        // Draw 3D Buildings, Bunkers & Static Trees
        if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized) {
            building3dRenderer.drawDepth(this.vision_aPosition);
        }

        // Read pixels
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, this.visionPixelBuffer);

        // Restore default framebuffer & viewport
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        return {
            width: W,
            height: H,
            pixels: this.visionPixelBuffer,
            far: far,
            fovH: fovH,
            fovV: fovV,
            tanH: Math.tan((fovH * Math.PI / 180.0) / 2.0),
            tanV: Math.tan((fovV * Math.PI / 180.0) / 2.0)
        };
    }

    _initSceneFbo(w, h) {
        const gl = this.gl;
        if (!gl) return;
        w = Math.max(1, w || this.canvas.width || 1280);
        h = Math.max(1, h || this.canvas.height || 720);

        this.sceneFboWidth = w;
        this.sceneFboHeight = h;

        this.sceneFbo = gl.createFramebuffer();
        this.sceneColorTex = gl.createTexture();
        this.sceneDepthTex = gl.createTexture();
        this.selectionMaskTex = gl.createTexture();
        this.selectionFboReady = false;

        this._resizeSceneFbo(w, h);
    }

    _resizeSceneFbo(w, h) {
        const gl = this.gl;
        if (!gl || !this.sceneFbo) return;
        w = Math.max(1, w);
        h = Math.max(1, h);

        this.sceneFboWidth = w;
        this.sceneFboHeight = h;

        // Color texture (RGBA8)
        gl.bindTexture(gl.TEXTURE_2D, this.sceneColorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Selection exterior silhouette mask texture (RGBA8, COLOR_ATTACHMENT1 MRT)
        gl.bindTexture(gl.TEXTURE_2D, this.selectionMaskTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Depth texture (DEPTH_COMPONENT24 in WebGL 2.0)
        gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneColorTex, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.selectionMaskTex, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.sceneDepthTex, 0);

        this.selectionFboReady = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);
        if (!this.selectionFboReady) {
            // Detach MRT attachment if GPU doesn't support it cleanly so sceneFbo stays valid
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
        }
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        if (this.ssaoInitialized) {
            this._resizeSsaoFbo(w, h);
        }
        if (this.sceneMsaaFbo) {
            this._resizeMsaaFbo(w, h);
        }
        if (this.postFbo) {
            this._resizePostFbo(w, h);
        }
    }

    _initFullscreenVolumetricPass(quality = 'normal') {
        const gl = this.gl;
        if (!gl) return;

        // Fullscreen single-triangle covering [-1..3, -1..3]
        if (!this.fsQuadVbo) {
            this.fsQuadVbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.fsQuadVbo);
            const quadVerts = new Float32Array([
                -1.0, -1.0,
                 3.0, -1.0,
                -1.0,  3.0
            ]);
            gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
        }

        const stepsMap = { normal: 64, high: 128, ultra: 256, extreme: 512 };
        const numSteps = stepsMap[quality] || 64;

        if (this.volFullscreenProgram) {
            gl.deleteProgram(this.volFullscreenProgram);
        }

        const vs = `#version 300 es
            in vec2 a_position;
            out vec2 v_uv;
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        const fs = `#version 300 es
            precision highp float;
            precision highp int;
            precision highp sampler2D;
            in vec2 v_uv;
            out vec4 fragColor;

            uniform sampler2D u_sceneColorTex;
            uniform sampler2D u_sceneDepthTex;
            uniform sampler2D u_eyeDepthTex;
            uniform sampler2D u_selectionMaskTex;
            uniform sampler2D u_ssaoTex;
            uniform int u_useSsao;
            uniform int u_useFog;
            uniform vec4 u_fogColor;
            uniform vec4 u_fogRange;
            uniform vec3 u_fogOrigin;

            uniform mat4 u_invViewProj;
            uniform vec3 u_camPos;
            uniform float u_camNear;
            uniform float u_camFar;

            uniform vec3 u_eyePos;
            uniform vec3 u_eyeForward;
            uniform vec3 u_eyeRight;
            uniform vec3 u_eyeUp;
            uniform float u_tanH;
            uniform float u_tanV;
            uniform float u_far;
            uniform int u_respectLOS;
            uniform int u_isXRay;
            uniform int u_hasCone;
            uniform mat4 u_eyeViewProj;

            uniform int u_hasOutline;
            uniform vec2 u_texelSize;
            uniform vec3 u_outlineColor;

            float decodeDepth(vec4 rgba) {
                return dot(rgba, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0));
            }

            float getSceneLinearDist(vec2 uv) {
                float z_b = texture(u_sceneDepthTex, uv).r;
                float z_ndc = z_b * 2.0 - 1.0;
                float linDist = (2.0 * u_camNear * u_camFar) / (u_camFar + u_camNear - z_ndc * (u_camFar - u_camNear));
                return linDist;
            }

            bool intersectConeFrustum(vec3 ro, vec3 rd, out float tNear, out float tFar) {
                tNear = -1e9;
                tFar  =  1e9;

                vec3 nLeft   = normalize( u_eyeRight + u_eyeForward * u_tanH);
                vec3 nRight  = normalize(-u_eyeRight + u_eyeForward * u_tanH);
                vec3 nBottom = normalize( u_eyeUp    + u_eyeForward * u_tanV);
                vec3 nTop    = normalize(-u_eyeUp    + u_eyeForward * u_tanV);

                // Left plane
                float d0 = dot(rd, nLeft);   float dist0 = dot(u_eyePos - ro, nLeft);
                if (abs(d0) > 1e-6) { float t = dist0/d0; if (d0 > 0.0) tNear = max(tNear, t); else tFar = min(tFar, t); } else if (dist0 < 0.0) return false;

                // Right plane
                float d1 = dot(rd, nRight);  float dist1 = dot(u_eyePos - ro, nRight);
                if (abs(d1) > 1e-6) { float t = dist1/d1; if (d1 > 0.0) tNear = max(tNear, t); else tFar = min(tFar, t); } else if (dist1 < 0.0) return false;

                // Bottom plane
                float d2 = dot(rd, nBottom); float dist2 = dot(u_eyePos - ro, nBottom);
                if (abs(d2) > 1e-6) { float t = dist2/d2; if (d2 > 0.0) tNear = max(tNear, t); else tFar = min(tFar, t); } else if (dist2 < 0.0) return false;

                // Top plane
                float d3 = dot(rd, nTop);    float dist3 = dot(u_eyePos - ro, nTop);
                if (abs(d3) > 1e-6) { float t = dist3/d3; if (d3 > 0.0) tNear = max(tNear, t); else tFar = min(tFar, t); } else if (dist3 < 0.0) return false;

                // Far plane (-u_eyeForward)
                vec3 farPt = u_eyePos + u_eyeForward * u_far;
                float dFar = dot(rd, -u_eyeForward);
                float distFar = dot(farPt - ro, -u_eyeForward);
                if (abs(dFar) > 1e-6) { float t = distFar/dFar; if (dFar > 0.0) tNear = max(tNear, t); else tFar = min(tFar, t); } else if (distFar < 0.0) return false;

                // Near/Apex plane (+u_eyeForward)
                float dNear = dot(rd, u_eyeForward);
                float distNear = dot(u_eyePos - ro, u_eyeForward);
                if (abs(dNear) > 1e-6) { float t = distNear/dNear; if (dNear > 0.0) tNear = max(tNear, t); else tFar = min(tFar, t); } else if (distNear < 0.0) return false;

                tNear = max(tNear, 0.0);
                return tFar > tNear;
            }

            float calcPrFogVis(float fogDistance) {
                vec2 fogValues = fogDistance * u_fogRange.xy + u_fogRange.zw;
                float closeFog = max(fogValues.y, u_fogColor.a);
                float fx = max(fogValues.x, 0.0);
                float farFog = fx * fx * fx;
                return smoothstep(0.0, 1.0, closeFog - farFog);
            }

            void main() {
                vec4 sceneColor = texture(u_sceneColorTex, v_uv);
                vec4 outColor = sceneColor;

                if (u_useSsao == 1) {
                    float ao = texture(u_ssaoTex, v_uv).r;
                    outColor.rgb *= mix(1.0, ao, 0.78);
                }

                // Authentic 1:1 Project Reality / BF2 Distance Fog (racommon.fxh -> Ra_GetFogValue)
                if (u_useFog == 1) {
                    float z_b = texture(u_sceneDepthTex, v_uv).r;
                    if (z_b < 0.999995) {
                        vec2 ndcFog = v_uv * 2.0 - 1.0;
                        vec4 worldPos4 = u_invViewProj * vec4(ndcFog, z_b * 2.0 - 1.0, 1.0);
                        vec3 worldPos = worldPos4.xyz / worldPos4.w;
                        float fogValue = calcPrFogVis(length(worldPos - u_fogOrigin));
                        outColor.rgb = mix(u_fogColor.rgb, outColor.rgb, fogValue);
                    }
                }

                if (u_hasCone == 1) {
                    // Reconstruct world ray from main camera
                    vec2 ndc = v_uv * 2.0 - 1.0;
                    vec4 farPoint = u_invViewProj * vec4(ndc, 1.0, 1.0);
                    vec3 worldFar = farPoint.xyz / farPoint.w;
                    vec3 rayDir = normalize(worldFar - u_camPos);

                    float tNear, tFar;
                    bool hit = intersectConeFrustum(u_camPos, rayDir, tNear, tFar);
                    if (hit) {
                        // Physical obstacle occlusion by bunkers, terrain and trees
                        if (u_isXRay == 0) {
                            float sceneDist = getSceneLinearDist(v_uv);
                            tFar = min(tFar, sceneDist);
                        }

                        if (tFar > tNear + 0.05) {
                            // Raymarching between [tNear, tFar]
                            const int NUM_STEPS = ${numSteps};
                            float stepLength = (tFar - tNear) / float(NUM_STEPS);
                            float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43722.1217);
                            bool camFogSeparate = (u_useFog == 1 && u_isXRay == 0 && length(u_fogOrigin - u_eyePos) > 4.0);

                            float accumDensity = 0.0;
                            float maxFogVis = (u_useFog == 1) ? 0.0 : 1.0;
                            for (int i = 0; i < NUM_STEPS; i++) {
                                float t = tNear + (float(i) + dither * 0.95) * stepLength;
                                vec3 p = u_camPos + rayDir * t;

                                vec4 clip = u_eyeViewProj * vec4(p, 1.0);
                                if (clip.w <= 0.0) continue;

                                vec3 eNdc = clip.xyz / clip.w;
                                if (abs(eNdc.x) > 1.0 || abs(eNdc.y) > 1.0 || abs(eNdc.z) > 1.0) continue;

                                // True spherical range cutoff (prevents flat frustum corners poking past circular fog)
                                float euclidDist = length(p - u_eyePos);
                                if (euclidDist > u_far) continue;

                                float fogWeight = 1.0;
                                if (u_useFog == 1) {
                                    fogWeight = calcPrFogVis(euclidDist);
                                    if (camFogSeparate) {
                                        fogWeight *= calcPrFogVis(length(p - u_fogOrigin));
                                    }
                                    if (fogWeight <= 0.002) continue;
                                    maxFogVis = max(maxFogVis, fogWeight);
                                }

                                vec2 uv = eNdc.xy * 0.5 + 0.5;
                                float distToEye = clip.w;

                                if (u_respectLOS == 1) {
                                    vec4 depthSample = texture(u_eyeDepthTex, uv);
                                    float storedDist = decodeDepth(depthSample) * u_far;
                                    if (distToEye > storedDist + 0.40) {
                                        continue; // In shadow behind tree or building!
                                    }
                                }

                                float radialSq = eNdc.x * eNdc.x + eNdc.y * eNdc.y;
                                float edgeFade = clamp(1.0 - radialSq * 0.55, 0.0, 1.0);
                                float distFade = clamp(1.0 - (euclidDist / u_far), 0.0, 1.0);

                                accumDensity += 0.10 * edgeFade * (0.35 + 0.65 * distFade) * fogWeight * (stepLength / 2.5);
                                if (accumDensity >= 1.6) break;
                            }

                            if (accumDensity > 0.003 && maxFogVis > 0.002) {
                                vec3 coneColor = vec3(1.0, 0.88, 0.22);
                                float baseBoost = 0.180185 * smoothstep(0.0, 0.35, accumDensity);
                                float finalAlpha = clamp(accumDensity * 0.55 + baseBoost, 0.0, 0.75) * maxFogVis;
                                outColor.rgb = mix(outColor.rgb, coneColor, finalAlpha);
                            }
                        }
                    }
                }

                // Exterior-Only Screen-Space Selection Silhouette (zero internal limb/armor seams)
                if (u_hasOutline == 1) {
                    float centerMask = texture(u_selectionMaskTex, v_uv).r;
                    if (centerMask < 0.5) {
                        vec2 r1 = u_texelSize * 1.05;
                        float hit1 = 0.0;
                        hit1 = max(hit1, texture(u_selectionMaskTex, v_uv + vec2( r1.x,  0.0)).r);
                        hit1 = max(hit1, texture(u_selectionMaskTex, v_uv + vec2(-r1.x,  0.0)).r);
                        hit1 = max(hit1, texture(u_selectionMaskTex, v_uv + vec2( 0.0,  r1.y)).r);
                        hit1 = max(hit1, texture(u_selectionMaskTex, v_uv + vec2( 0.0, -r1.y)).r);
                        vec2 r1d = r1 * 0.7071;
                        hit1 = max(hit1, texture(u_selectionMaskTex, v_uv + vec2( r1d.x,  r1d.y)).r);
                        hit1 = max(hit1, texture(u_selectionMaskTex, v_uv + vec2(-r1d.x,  r1d.y)).r);
                        hit1 = max(hit1, texture(u_selectionMaskTex, v_uv + vec2( r1d.x, -r1d.y)).r);
                        hit1 = max(hit1, texture(u_selectionMaskTex, v_uv + vec2(-r1d.x, -r1d.y)).r);

                        if (hit1 > 0.5) {
                            outColor.rgb = u_outlineColor;
                        } else {
                            vec2 r2 = u_texelSize * 1.95;
                            float hit2 = 0.0;
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2( r2.x,  0.0)).r);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2(-r2.x,  0.0)).r);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2( 0.0,  r2.y)).r);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2( 0.0, -r2.y)).r);
                            vec2 r2a = r2 * vec2(0.8660, 0.5000);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2( r2a.x,  r2a.y)).r);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2(-r2a.x,  r2a.y)).r);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2( r2a.x, -r2a.y)).r);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2(-r2a.x, -r2a.y)).r);
                            vec2 r2b = r2 * vec2(0.5000, 0.8660);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2( r2b.x,  r2b.y)).r);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2(-r2b.x,  r2b.y)).r);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2( r2b.x, -r2b.y)).r);
                            hit2 = max(hit2, texture(u_selectionMaskTex, v_uv + vec2(-r2b.x, -r2b.y)).r);

                            if (hit2 > 0.5) {
                                outColor.rgb = mix(outColor.rgb, u_outlineColor, 0.82);
                            }
                        }
                    }
                }

                fragColor = outColor;
            }
        `;

        const p = gl.createProgram();
        gl.attachShader(p, this.loadShader(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, this.loadShader(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);

        this.volFullscreenProgram = p;
        this.fs_aPosition = gl.getAttribLocation(p, "a_position");
        this.fs_uSceneColorTex = gl.getUniformLocation(p, "u_sceneColorTex");
        this.fs_uSceneDepthTex = gl.getUniformLocation(p, "u_sceneDepthTex");
        this.fs_uEyeDepthTex = gl.getUniformLocation(p, "u_eyeDepthTex");
        this.fs_uSelectionMaskTex = gl.getUniformLocation(p, "u_selectionMaskTex");
        this.fs_uInvViewProj = gl.getUniformLocation(p, "u_invViewProj");
        this.fs_uCamPos = gl.getUniformLocation(p, "u_camPos");
        this.fs_uCamNear = gl.getUniformLocation(p, "u_camNear");
        this.fs_uCamFar = gl.getUniformLocation(p, "u_camFar");
        this.fs_uEyePos = gl.getUniformLocation(p, "u_eyePos");
        this.fs_uEyeForward = gl.getUniformLocation(p, "u_eyeForward");
        this.fs_uEyeRight = gl.getUniformLocation(p, "u_eyeRight");
        this.fs_uEyeUp = gl.getUniformLocation(p, "u_eyeUp");
        this.fs_uTanH = gl.getUniformLocation(p, "u_tanH");
        this.fs_uTanV = gl.getUniformLocation(p, "u_tanV");
        this.fs_uFar = gl.getUniformLocation(p, "u_far");
        this.fs_uRespectLOS = gl.getUniformLocation(p, "u_respectLOS");
        this.fs_uIsXRay = gl.getUniformLocation(p, "u_isXRay");
        this.fs_uHasCone = gl.getUniformLocation(p, "u_hasCone");
        this.fs_uEyeViewProj = gl.getUniformLocation(p, "u_eyeViewProj");
        this.fs_uHasOutline = gl.getUniformLocation(p, "u_hasOutline");
        this.fs_uTexelSize = gl.getUniformLocation(p, "u_texelSize");
        this.fs_uOutlineColor = gl.getUniformLocation(p, "u_outlineColor");
        this.fs_uSsaoTex = gl.getUniformLocation(p, "u_ssaoTex");
        this.fs_uUseSsao = gl.getUniformLocation(p, "u_useSsao");
        this.fs_uUseFog = gl.getUniformLocation(p, "u_useFog");
        this.fs_uFogColor = gl.getUniformLocation(p, "u_fogColor");
        this.fs_uFogRange = gl.getUniformLocation(p, "u_fogRange");
        this.fs_uFogOrigin = gl.getUniformLocation(p, "u_fogOrigin");

        console.log(`[Renderer3D] Fullscreen Post-Process Volumetric Vision Cone Program Initialized (${numSteps} steps) [${quality}]`);
    }

    updateVisionConeQuality(qual) {
        if (!this.gl) return;
        this.visionConeQuality = qual;
        this._initVisionDepthPass(qual);
        this._initFullscreenVolumetricPass(qual);
        if (typeof requestUpdate === "function") requestUpdate();
    }

    _renderSoldierEyeDepth(eyeX, eyeY, eyeZ, rotDeg, rangeM, coneAngleDeg) {
        const gl = this.gl;
        if (!gl || !this.visionDepthFbo) return;

        const W = this.visionDepthWidth;
        const H = this.visionDepthHeight;
        const fovH = coneAngleDeg || 94.9;
        const fovV = 48.0;
        const near = 0.2;
        const far = rangeM || 150.0;

        const projMatrix = this.makeVisionFrustum(fovH, fovV, near, far);

        const rad = (rotDeg || 0) / 180.0 * Math.PI;
        const dirX = Math.sin(rad);
        const dirZ = Math.cos(rad);

        const glEyeX = eyeX;
        const glEyeY = eyeY;
        const glEyeZ = -eyeZ;

        const glTargetX = glEyeX + dirX * 100.0;
        const glTargetY = glEyeY;
        const glTargetZ = glEyeZ - dirZ * 100.0;

        const eyePos = vec3.set(vec3.create(), glEyeX, glEyeY, glEyeZ);
        const eyeTarget = vec3.set(vec3.create(), glTargetX, glTargetY, glTargetZ);
        const up = vec3.set(vec3.create(), 0, 1, 0);

        const viewMatrix = mat4.lookAt(mat4.create(), eyePos, eyeTarget, up);
        const eyeViewProj = mat4.multiply(mat4.create(), projMatrix, viewMatrix);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.visionDepthFbo);
        gl.viewport(0, 0, W, H);
        gl.clearColor(1.0, 1.0, 1.0, 1.0);
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(this.visionDepthProgram);
        gl.uniformMatrix4fv(this.vision_uEyeViewProj, false, eyeViewProj);
        gl.uniform1f(this.vision_uFar, far);

        if (typeof terrainRenderer !== "undefined" && terrainRenderer.initialized) {
            terrainRenderer.drawDepth(this.vision_aPosition);
        }
        if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized) {
            building3dRenderer.drawDepth(this.vision_aPosition);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _renderFullscreenVolumetricPass(vc, hasOutline = false, useSsao = false, useFog = false, fogCfg = null, fogOrigin = null) {
        const gl = this.gl;
        if (!gl || !this.volFullscreenProgram) return;

        gl.useProgram(this.volFullscreenProgram);

        // Main Camera Matrices & Uniforms
        const projMatrix = this.getCurrentProjectionMatrix();
        const viewMatrix = this.getCurrentViewMatrix();
        const viewProj = mat4.multiply(mat4.create(), projMatrix, viewMatrix);
        const invViewProj = mat4.invert(mat4.create(), viewProj);

        gl.uniformMatrix4fv(this.fs_uInvViewProj, false, invViewProj);
        gl.uniform3f(this.fs_uCamPos, this.cameraPos[0], this.cameraPos[1], this.cameraPos[2]);
        gl.uniform1f(this.fs_uCamNear, 0.25);
        gl.uniform1f(this.fs_uCamFar, 20000.0);

        // Textures: unit 0 = sceneColorTex, unit 1 = sceneDepthTex, unit 2 = eyeDepthTex, unit 3 = selectionMaskTex, unit 4 = ssaoTex
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneColorTex);
        gl.uniform1i(this.fs_uSceneColorTex, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
        gl.uniform1i(this.fs_uSceneDepthTex, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.visionColorTex);
        gl.uniform1i(this.fs_uEyeDepthTex, 2);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this.selectionMaskTex || null);
        gl.uniform1i(this.fs_uSelectionMaskTex, 3);

        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, (useSsao && this.ssaoBlurTex) ? this.ssaoBlurTex : (this.ssaoDummyTex || null));
        gl.uniform1i(this.fs_uSsaoTex, 4);
        gl.uniform1i(this.fs_uUseSsao, (useSsao && this.ssaoBlurTex) ? 1 : 0);

        if (this.fs_uUseFog !== null) {
            if (useFog && fogCfg) {
                const fo = fogOrigin || this.cameraPos;
                gl.uniform1i(this.fs_uUseFog, 1);
                gl.uniform4fv(this.fs_uFogColor, fogCfg.fogColor);
                gl.uniform4fv(this.fs_uFogRange, fogCfg.fogRange);
                if (this.fs_uFogOrigin !== null) {
                    gl.uniform3f(this.fs_uFogOrigin, fo[0], fo[1], fo[2]);
                }
            } else {
                gl.uniform1i(this.fs_uUseFog, 0);
            }
        }

        gl.uniform1i(this.fs_uHasOutline, hasOutline ? 1 : 0);
        gl.uniform2f(this.fs_uTexelSize, 1.0 / Math.max(1, this.canvas.width), 1.0 / Math.max(1, this.canvas.height));
        gl.uniform3f(this.fs_uOutlineColor, 0.745, 0.643, 0.145);

        if (vc) {
            const fovH = vc.coneAngle || 94.9;
            const fovV = 48.0;
            const far = vc.range || 150.0;
            const near = 0.2;
            const rad = (vc.rotDeg || 0) / 180.0 * Math.PI;

            // Soldier Eye in WebGL coordinates (Y up, -Z forward for game's +Z)
            const glEyeX = vc.eyeX;
            const glEyeY = vc.eyeY;
            const glEyeZ = -vc.eyeZ;

            const dirX = Math.sin(rad);
            const dirZ = -Math.cos(rad);

            // Orthonormal basis of soldier eye
            const eyeForward = [dirX, 0.0, dirZ];
            const eyeRight = [Math.cos(rad), 0.0, Math.sin(rad)];
            const eyeUp = [0.0, 1.0, 0.0];

            const tanH = Math.tan((fovH * Math.PI / 180.0) / 2.0);
            const tanV = Math.tan((fovV * Math.PI / 180.0) / 2.0);

            // Eye View-Proj for shadow testing
            const eyeProjMatrix = this.makeVisionFrustum(fovH, fovV, near, far);
            const eyeTarget = [glEyeX + dirX * 100.0, glEyeY, glEyeZ + dirZ * 100.0];
            const eyeViewMatrix = mat4.lookAt(mat4.create(), [glEyeX, glEyeY, glEyeZ], eyeTarget, eyeUp);
            const eyeViewProj = mat4.multiply(mat4.create(), eyeProjMatrix, eyeViewMatrix);

            const isXRay = (typeof options_VisionConeXRay !== "undefined" && options_VisionConeXRay) ? 1 : 0;

            gl.uniform1i(this.fs_uHasCone, 1);
            gl.uniform3f(this.fs_uEyePos, glEyeX, glEyeY, glEyeZ);
            gl.uniform3fv(this.fs_uEyeForward, eyeForward);
            gl.uniform3fv(this.fs_uEyeRight, eyeRight);
            gl.uniform3fv(this.fs_uEyeUp, eyeUp);
            gl.uniform1f(this.fs_uTanH, tanH);
            gl.uniform1f(this.fs_uTanV, tanV);
            gl.uniform1f(this.fs_uFar, far);
            gl.uniform1i(this.fs_uRespectLOS, vc.respect ? 1 : 0);
            gl.uniform1i(this.fs_uIsXRay, isXRay);
            gl.uniformMatrix4fv(this.fs_uEyeViewProj, false, eyeViewProj);
        } else {
            gl.uniform1i(this.fs_uHasCone, 0);
        }

        // Draw Fullscreen Triangle
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fsQuadVbo);
        gl.enableVertexAttribArray(this.fs_aPosition);
        gl.vertexAttribPointer(this.fs_aPosition, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disableVertexAttribArray(this.fs_aPosition);

        // Unbind FBO textures across units 0..4 to avoid feedback loops on subsequent passes
        for (let unit = 0; unit < 5; unit++) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }
        gl.activeTexture(gl.TEXTURE0);
    }

    // =========================================================================
    // Map Sky, 1:1 PR Fog & Sun Direction (from SKY_DB / Sky*.con + Init.con)
    // =========================================================================
    getActiveSkyEntry() {
        let mk = "";
        if (typeof buildingHeightmap !== "undefined" && buildingHeightmap && buildingHeightmap._mapKey) {
            mk = String(buildingHeightmap._mapKey).toLowerCase();
        } else if (typeof MapName !== "undefined" && MapName) {
            mk = String(MapName).toLowerCase();
        }
        const mode = (typeof GameMode !== "undefined" && GameMode) ? String(GameMode).toLowerCase() : "";
        const layer = (typeof Layer !== "undefined" && Layer != null) ? String(Layer) : "";
        const cacheKey = mk + "|" + mode + "|" + layer;
        if (this._activeSkyCacheKey === cacheKey && this._activeSkyEntry !== undefined) {
            return this._activeSkyEntry;
        }
        this._activeSkyCacheKey = cacheKey;
        const base = (typeof SKY_DB !== "undefined" && SKY_DB && mk) ? SKY_DB[mk] : null;
        if (!base) {
            this._activeSkyEntry = null;
            return null;
        }
        const layerOv = (base.layers && mode)
            ? (base.layers[mode + ":" + layer] || base.layers[mode + ":*"] || null)
            : null;
        this._activeSkyEntry = layerOv ? Object.assign({}, base, layerOv) : base;
        return this._activeSkyEntry;
    }

    getSelectedFogOrigin() {
        if (!this._playerFogOriginBuf) {
            this._playerFogOriginBuf = new Float32Array(3);
        }
        const out = this._playerFogOriginBuf;
        const selNone = (typeof SELECTED_NOTHING !== "undefined") ? SELECTED_NOTHING : -1;

        if (typeof SelectedPlayer !== "undefined" && SelectedPlayer != selNone && typeof AllPlayers !== "undefined") {
            const p = AllPlayers[SelectedPlayer];
            if (p && !p.isJoining && p.isAlive !== false) {
                if (p.vehicleid >= 0 && typeof AllVehicles !== "undefined" && AllVehicles[p.vehicleid]) {
                    const vPos = this._getTrackedVehiclePos(AllVehicles[p.vehicleid]);
                    if (vPos) {
                        out[0] = vPos[0];
                        out[1] = vPos[1];
                        out[2] = vPos[2];
                        return out;
                    }
                }
                const px = (typeof p.getX === "function") ? p.getX() : p.X;
                const py = (typeof p.getY === "function") ? p.getY() : (p.Y || 0);
                const pz = (typeof p.getZ === "function") ? p.getZ() : p.Z;
                if (Number.isFinite(px) && Number.isFinite(pz)) {
                    const floorY = (typeof heightmap !== "undefined" && heightmap && heightmap.initialized)
                        ? Math.max(heightmap.getHeightFromCoords(px, pz), (Number.isFinite(py) ? py : 0) - 0.85)
                        : ((Number.isFinite(py) ? py : 0) - 0.85);
                    out[0] = px;
                    out[1] = floorY + 1.55;
                    out[2] = -pz;
                    return out;
                }
            }
        } else if (typeof SelectedVehicle !== "undefined" && SelectedVehicle != selNone && typeof AllVehicles !== "undefined" && AllVehicles[SelectedVehicle]) {
            const vPos = this._getTrackedVehiclePos(AllVehicles[SelectedVehicle]);
            if (vPos) {
                out[0] = vPos[0];
                out[1] = vPos[1];
                out[2] = vPos[2];
                return out;
            }
        }
        return null;
    }

    getMapFogConfig() {
        const entry = this.getActiveSkyEntry();
        const key = this._activeSkyCacheKey || "";
        if (this._fogConfigCache && this._fogConfigKey === key) {
            return this._fogConfigCache;
        }
        this._fogConfigKey = key;
        const fogRgb = (entry && Array.isArray(entry.fog) && entry.fog.length === 3) ? entry.fog : [0.45, 0.50, 0.55];
        const fp = (entry && Array.isArray(entry.fogParams) && entry.fogParams.length >= 4) ? entry.fogParams : [0.0, 700.0, 0.5, 0.5];
        const f0 = Number(fp[0]) || 0.0;
        const f1 = Math.max(f0 + 1.0, Number(fp[1]) || 700.0);
        const f2 = Math.max(0.0, Number(fp[2]) || 0.0);
        const f3 = Math.max(0.0, Math.min(1.0, Number(fp[3]) || 0.0));
        const span = Math.max(1.0, f1 - f0);

        if (!this._fogConfigCache) {
            this._fogConfigCache = {
                fogColor: new Float32Array(4),
                fogRange: new Float32Array(4),
                fogEnd: f1,
                effectiveDist: f1,
            };
        }
        const fc = this._fogConfigCache.fogColor;
        fc[0] = Number(fogRgb[0]) || 0.45;
        fc[1] = Number(fogRgb[1]) || 0.50;
        fc[2] = Number(fogRgb[2]) || 0.55;
        fc[3] = f3;

        const fr = this._fogConfigCache.fogRange;
        fr[0] = 1.0 / span;
        fr[1] = -f2 / span;
        fr[2] = -f0 / span;
        fr[3] = 1.0 + (f2 * f0) / span;
        this._fogConfigCache.fogEnd = f1;

        // Compute exact 0% visibility distance for fog-wall culling
        let lo = 0.0, hi = f1;
        for (let i = 0; i < 24; i++) {
            const mid = 0.5 * (lo + hi);
            const t = (mid - f0) / span;
            const c = Math.max(1.0 - f2 * t, f3);
            const fx = Math.max(0.0, t);
            const x = Math.max(0.0, Math.min(1.0, c - fx * fx * fx));
            const vis = x * x * (3.0 - 2.0 * x);
            if (vis > 0.002) lo = mid;
            else hi = mid;
        }
        this._fogConfigCache.effectiveDist = hi;
        return this._fogConfigCache;
    }

    getMapSunDirection() {
        if (!this._sunDirCache) {
            this._sunDirCache = new Float32Array([0.4508, 0.8515, -0.3005]);
            this._sunDirCacheKey = null;
        }
        const entry = this.getActiveSkyEntry();
        const ck = this._activeSkyCacheKey || "";
        if (ck !== this._sunDirCacheKey) {
            this._sunDirCacheKey = ck;
            if (entry && Array.isArray(entry.sunDir) && entry.sunDir.length === 3) {
                const lx = Number(entry.sunDir[0]), ly = Number(entry.sunDir[1]), lz = Number(entry.sunDir[2]);
                const len = Math.hypot(lx, ly, lz) || 1.0;
                this._sunDirCache[0] = lx / len;
                this._sunDirCache[1] = Math.max(0.12, ly / len);
                this._sunDirCache[2] = lz / len;
                const l2 = Math.hypot(this._sunDirCache[0], this._sunDirCache[1], this._sunDirCache[2]) || 1.0;
                this._sunDirCache[0] /= l2;
                this._sunDirCache[1] /= l2;
                this._sunDirCache[2] /= l2;
            } else {
                this._sunDirCache[0] = 0.4508;
                this._sunDirCache[1] = 0.8515;
                this._sunDirCache[2] = -0.3005;
            }
        }
        return this._sunDirCache;
    }

    _initShadowPass() {
        const gl = this.gl;
        if (!gl) return;
        this.shadowMapSize = 2048;
        this.lightViewProjMatrix = mat4.create();
        this.shadowsActiveThisFrame = false;

        // 2048x2048 Hardware Comparison Depth Texture (sampler2DShadow)
        this.shadowDepthTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.shadowDepthTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowMapSize, this.shadowMapSize, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

        this.shadowFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowDepthTex, 0);
        gl.drawBuffers([gl.NONE]);
        gl.readBuffer(gl.NONE);
        this.shadowFboReady = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // 1x1 dummy comparison depth texture (cleared to 1.0) so sampler2DShadow is always valid when OFF
        this.shadowDummyTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.shadowDummyTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 1, 1, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
        const tmpFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, tmpFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowDummyTex, 0);
        gl.viewport(0, 0, 1, 1);
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(tmpFbo);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    _renderShadowPass() {
        const gl = this.gl;
        const enabled = (typeof options_3dShadows !== "undefined" && options_3dShadows);
        if (!gl || !enabled || !this.shadowFboReady || !this.shadowFbo) {
            this.shadowsActiveThisFrame = false;
            return;
        }

        const sunDir = this.getMapSunDirection(); // normalized vector TOWARD sun
        const camX = this.cameraPos[0], camY = this.cameraPos[1], camZ = this.cameraPos[2];

        // Ground height under camera to adapt shadow frustum size
        let groundY = 0.0;
        if (typeof heightmap !== "undefined" && heightmap && heightmap.initialized) {
            const h = heightmap.getHeightFromCoords(camX, -camZ);
            if (Number.isFinite(h)) groundY = h;
        }
        const camAboveGround = Math.max(2.0, camY - groundY);

        // Center orthographic box ahead of camera (or directly beneath in top-down)
        const forward = this.getCameraForward();
        const horizLen = Math.hypot(forward[0], forward[2]);
        const lookAhead = this.isTopDown ? 0.0 : Math.min(85.0, Math.max(20.0, camAboveGround * 0.7));
        let focusX = camX + (horizLen > 0.05 ? (forward[0] / horizLen) * lookAhead : 0.0);
        let focusZ = camZ + (horizLen > 0.05 ? (forward[2] / horizLen) * lookAhead : 0.0);
        let focusY = groundY;
        if (typeof heightmap !== "undefined" && heightmap && heightmap.initialized) {
            const fh = heightmap.getHeightFromCoords(focusX, -focusZ);
            if (Number.isFinite(fh)) focusY = fh;
        }

        // Half-extent in meters: ~115m close up (~11cm/texel) up to ~240m when high up
        const halfExtent = Math.max(115.0, Math.min(240.0, 105.0 + camAboveGround * 0.55));
        this.shadowFocusX = focusX;
        this.shadowFocusZ = focusZ;
        this.shadowHalfExtent = halfExtent;
        const lightDist = 310.0;

        const up = (Math.abs(sunDir[1]) > 0.97) ? [0, 0, 1] : [0, 1, 0];
        const tempEye = [focusX + sunDir[0] * lightDist, focusY + sunDir[1] * lightDist, focusZ + sunDir[2] * lightDist];
        const tempTarget = [focusX, focusY, focusZ];
        const lightView = mat4.lookAt(mat4.create(), tempEye, tempTarget, up);

        // Texel-snapping in light space to eliminate edge shimmering while moving the camera
        const texelWorld = (halfExtent * 2.0) / this.shadowMapSize;
        const originLS = vec4.transformMat4(vec4.create(), [focusX, focusY, focusZ, 1.0], lightView);
        const snapX = Math.floor(originLS[0] / texelWorld) * texelWorld - originLS[0];
        const snapY = Math.floor(originLS[1] / texelWorld) * texelWorld - originLS[1];

        const lightProj = mat4.ortho(
            mat4.create(),
            -halfExtent + snapX, halfExtent + snapX,
            -halfExtent + snapY, halfExtent + snapY,
            1.0, 620.0
        );
        mat4.multiply(this.lightViewProjMatrix, lightProj, lightView);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
        gl.viewport(0, 0, this.shadowMapSize, this.shadowMapSize);
        gl.colorMask(false, false, false, false);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.4, 2.0);
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized && typeof building3dRenderer.drawShadowPass === "function") {
            building3dRenderer.drawShadowPass(this.lightViewProjMatrix);
        }
        if (typeof entities3dRenderer !== "undefined" && entities3dRenderer.initialized && typeof entities3dRenderer.drawShadowPass === "function") {
            entities3dRenderer.drawShadowPass(this.lightViewProjMatrix);
        }

        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.colorMask(true, true, true, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.shadowsActiveThisFrame = true;
    }

    _initSsaoPass() {
        const gl = this.gl;
        if (!gl) return;

        // 1x1 white dummy texture
        this.ssaoDummyTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.ssaoDummyTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, null);

        const vs = `#version 300 es
            in vec2 a_position;
            out vec2 v_uv;
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        this.ssaoQuality = (typeof options_3dSsaoQuality !== "undefined") ? Math.max(0, Math.min(2, parseInt(options_3dSsaoQuality, 10) || 1)) : 1;

        // Screen-Space Ambient Occlusion (configurable 12-tap or 20-tap crisp contact hemisphere)
        const ssaoFs = `#version 300 es
            precision highp float;
            in vec2 v_uv;
            out vec4 fragColor;

            uniform sampler2D u_depthTex;
            uniform mat4 u_invProj;
            uniform mat4 u_proj;
            uniform vec2 u_invRes;
            uniform int u_ssaoQuality;

            vec3 getViewPos(vec2 uv) {
                float d = texture(u_depthTex, uv).r;
                vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
                vec4 vp = u_invProj * clip;
                return vp.xyz / vp.w;
            }

            void main() {
                float centerDepth = texture(u_depthTex, v_uv).r;
                if (centerDepth >= 0.99985) {
                    fragColor = vec4(1.0);
                    return;
                }

                vec3 viewPos = getViewPos(v_uv);
                float dist = -viewPos.z;
                float distFade = 1.0 - smoothstep(140.0, 290.0, dist);
                if (distFade <= 0.0050974) {
                    fragColor = vec4(1.0);
                    return;
                }

                // Reconstruct crisp face normal using nearest depth neighbors to avoid halo seams
                vec3 posR = getViewPos(v_uv + vec2(u_invRes.x, 0.0));
                vec3 posL = getViewPos(v_uv - vec2(u_invRes.x, 0.0));
                vec3 posU = getViewPos(v_uv + vec2(0.0, u_invRes.y));
                vec3 posD = getViewPos(v_uv - vec2(0.0, u_invRes.y));

                vec3 dpdx = (abs(posR.z - viewPos.z) < abs(viewPos.z - posL.z)) ? (posR - viewPos) : (viewPos - posL);
                vec3 dpdy = (abs(posU.z - viewPos.z) < abs(viewPos.z - posD.z)) ? (posU - viewPos) : (viewPos - posD);
                vec3 normal = normalize(cross(dpdx, dpdy));

                // Interleaved gradient noise rotation (cleaner than sin-hash, far less speckle)
                float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
                float ang = ign * 6.2831853;
                vec3 randVec = vec3(cos(ang), sin(ang), 0.0);
                vec3 tangent = normalize(randVec - normal * dot(randVec, normal));
                vec3 bitangent = cross(normal, tangent);
                mat3 TBN = mat3(tangent, bitangent, normal);

                // Tighter contact radius in Balanced/High to eliminate soft diffused halos
                float baseRad = (u_ssaoQuality == 0) ? 0.72 : (u_ssaoQuality == 1 ? 0.48 : 0.42);
                float radSlope = (u_ssaoQuality == 0) ? 0.011 : 0.0085;
                float radius = clamp(baseRad + dist * radSlope, baseRad, 2.2);
                float bias = 0.032 + dist * 0.0007;

                // 20 well-distributed hemisphere offsets (first 12 used for Fast/Balanced, all 20 for High)
                const vec3 KERNEL[20] = vec3[20](
                    vec3( 0.11747,  0.07692, 0.14474),
                    vec3(-0.16,  0.12, 0.18),
                    vec3( 0.08, -0.20, 0.17),
                    vec3(-0.15, -0.18, 0.28),
                    vec3( 0.30591,  0.10775, 0.22408),
                    vec3(-0.28,  0.24, 0.34),
                    vec3( 0.19,  0.38, 0.26),
                    vec3(-0.40, -0.12, 0.30),
                    vec3( 0.48, -0.28, 0.42),
                    vec3(-0.11851,  0.54663, 0.38775),
                    vec3( 0.36,  0.46, 0.50),
                    vec3(-0.48, -0.40, 0.46),
                    vec3( 0.04,  0.25, 0.12),
                    vec3(-0.24, -0.04, 0.16),
                    vec3( 0.26, -0.14, 0.24),
                    vec3(-0.08,  0.32, 0.29),
                    vec3( 0.52131,  0.18471, 0.36935),
                    vec3(-0.44,  0.36, 0.44),
                    vec3( 0.16, -0.52, 0.48),
                    vec3(-0.28, -0.50, 0.54)
                );

                int sampleCount = (u_ssaoQuality >= 2) ? 20 : 12;
                float occlusion = 0.0;
                for (int i = 0; i < 20; i++) {
                    if (i >= sampleCount) break;
                    vec3 samplePos = viewPos + (TBN * KERNEL[i]) * radius;
                    vec4 offset = u_proj * vec4(samplePos, 1.0);
                    vec2 sUv = (offset.xy / offset.w) * 0.5 + 0.5;
                    if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) continue;

                    float sampleZ = getViewPos(sUv).z;
                    float dz = abs(viewPos.z - sampleZ);
                    float rangeCheck = smoothstep(0.0, 1.0, radius / max(dz, 0.001));
                    occlusion += (sampleZ >= samplePos.z + bias ? 1.0 : 0.0) * rangeCheck;
                }

                float ao = 1.0 - (occlusion / float(sampleCount)) * distFade;
                ao = pow(clamp(ao, 0.0, 1.0), (u_ssaoQuality == 0) ? 1.35 : 1.45);
                fragColor = vec4(ao, ao, ao, 1.0);
            }
        `;

        // 3x3 Sharp Depth-Aware Bilateral Blur
        const blurFs = `#version 300 es
            precision highp float;
            in vec2 v_uv;
            out vec4 fragColor;

            uniform sampler2D u_ssaoRawTex;
            uniform sampler2D u_depthTex;
            uniform vec2 u_texelSize;
            uniform float u_camNear;
            uniform float u_camFar;
            uniform float u_depthSharpness;

            float linDepth(vec2 uv) {
                float z = texture(u_depthTex, uv).r * 2.0 - 1.0;
                return (2.0 * u_camNear * u_camFar) / (u_camFar + u_camNear - z * (u_camFar - u_camNear));
            }

            void main() {
                float centerD = linDepth(v_uv);
                float sum = 0.0;
                float wSum = 0.0;
                for (int x = -1; x <= 1; x++) {
                    for (int y = -1; y <= 1; y++) {
                        vec2 uv = v_uv + vec2(float(x), float(y)) * u_texelSize;
                        float s = texture(u_ssaoRawTex, uv).r;
                        float d = linDepth(uv);
                        float spatial = (x == 0 && y == 0) ? 1.6 : ((x == 0 || y == 0) ? 1.0 : 0.7);
                        float dw = spatial * exp(-abs(centerD - d) * u_depthSharpness);
                        sum += s * dw;
                        wSum += dw;
                    }
                }
                float res = (wSum > 0.0001) ? (sum / wSum) : 1.0;
                fragColor = vec4(res, res, res, 1.0);
            }
        `;

        const vsObj = this.loadShader(gl.VERTEX_SHADER, vs);

        this.ssaoProgram = gl.createProgram();
        gl.attachShader(this.ssaoProgram, vsObj);
        gl.attachShader(this.ssaoProgram, this.loadShader(gl.FRAGMENT_SHADER, ssaoFs));
        gl.linkProgram(this.ssaoProgram);
        this.ssao_aPos = gl.getAttribLocation(this.ssaoProgram, "a_position");
        this.ssao_uDepthTex = gl.getUniformLocation(this.ssaoProgram, "u_depthTex");
        this.ssao_uInvProj = gl.getUniformLocation(this.ssaoProgram, "u_invProj");
        this.ssao_uProj = gl.getUniformLocation(this.ssaoProgram, "u_proj");
        this.ssao_uInvRes = gl.getUniformLocation(this.ssaoProgram, "u_invRes");
        this.ssao_uQuality = gl.getUniformLocation(this.ssaoProgram, "u_ssaoQuality");

        this.ssaoBlurProgram = gl.createProgram();
        gl.attachShader(this.ssaoBlurProgram, this.loadShader(gl.VERTEX_SHADER, vs));
        gl.attachShader(this.ssaoBlurProgram, this.loadShader(gl.FRAGMENT_SHADER, blurFs));
        gl.linkProgram(this.ssaoBlurProgram);
        this.ssaoBlur_aPos = gl.getAttribLocation(this.ssaoBlurProgram, "a_position");
        this.ssaoBlur_uRawTex = gl.getUniformLocation(this.ssaoBlurProgram, "u_ssaoRawTex");
        this.ssaoBlur_uDepthTex = gl.getUniformLocation(this.ssaoBlurProgram, "u_depthTex");
        this.ssaoBlur_uTexelSize = gl.getUniformLocation(this.ssaoBlurProgram, "u_texelSize");
        this.ssaoBlur_uCamNear = gl.getUniformLocation(this.ssaoBlurProgram, "u_camNear");
        this.ssaoBlur_uCamFar = gl.getUniformLocation(this.ssaoBlurProgram, "u_camFar");
        this.ssaoBlur_uDepthSharpness = gl.getUniformLocation(this.ssaoBlurProgram, "u_depthSharpness");

        this.ssaoRawFbo = gl.createFramebuffer();
        this.ssaoRawTex = gl.createTexture();
        this.ssaoBlurFbo = gl.createFramebuffer();
        this.ssaoBlurTex = gl.createTexture();
        this.ssaoInitialized = true;

        this._resizeSsaoFbo(this.sceneFboWidth || 1280, this.sceneFboHeight || 720);
    }

    setSsaoQuality(qual) {
        this.ssaoQuality = Math.max(0, Math.min(2, parseInt(qual, 10) || 0));
        if (this.ssaoInitialized) {
            this._resizeSsaoFbo(this.sceneFboWidth || this.canvas.width || 1280, this.sceneFboHeight || this.canvas.height || 720);
        }
    }

    _resizeSsaoFbo(w, h) {
        const gl = this.gl;
        if (!gl || !this.ssaoInitialized) return;
        const qual = (typeof options_3dSsaoQuality !== "undefined") ? Math.max(0, Math.min(2, parseInt(options_3dSsaoQuality, 10) || 0)) : (this.ssaoQuality || 1);
        this.ssaoQuality = qual;
        const div = (qual === 0) ? 2 : 1;
        const sw = Math.max(1, Math.floor(w / div));
        const sh = Math.max(1, Math.floor(h / div));
        this.ssaoWidth = sw;
        this.ssaoHeight = sh;

        gl.bindTexture(gl.TEXTURE_2D, this.ssaoRawTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, sw, sh, 0, gl.RED, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoRawFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ssaoRawTex, 0);

        gl.bindTexture(gl.TEXTURE_2D, this.ssaoBlurTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, sw, sh, 0, gl.RED, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoBlurFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ssaoBlurTex, 0);

        this.ssaoFboReady = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    _renderSsaoPass() {
        const gl = this.gl;
        const enabled = (typeof options_3dAoSsao !== "undefined" && options_3dAoSsao);
        if (!gl || !enabled || !this.ssaoInitialized || !this.ssaoFboReady || !this.sceneDepthTex) {
            return false;
        }

        const proj = this.getCurrentProjectionMatrix();
        const invProj = mat4.invert(mat4.create(), proj);

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fsQuadVbo);

        // Pass 1: Raw SSAO (half-res for Fast, full-res for Balanced/High)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoRawFbo);
        gl.viewport(0, 0, this.ssaoWidth, this.ssaoHeight);
        gl.useProgram(this.ssaoProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
        gl.uniform1i(this.ssao_uDepthTex, 0);
        gl.uniformMatrix4fv(this.ssao_uInvProj, false, invProj);
        gl.uniformMatrix4fv(this.ssao_uProj, false, proj);
        gl.uniform2f(this.ssao_uInvRes, 1.0 / this.ssaoWidth, 1.0 / this.ssaoHeight);
        if (this.ssao_uQuality !== null) gl.uniform1i(this.ssao_uQuality, this.ssaoQuality || 0);
        gl.enableVertexAttribArray(this.ssao_aPos);
        gl.vertexAttribPointer(this.ssao_aPos, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disableVertexAttribArray(this.ssao_aPos);

        // Pass 2: Bilateral depth-aware blur
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoBlurFbo);
        gl.viewport(0, 0, this.ssaoWidth, this.ssaoHeight);
        gl.useProgram(this.ssaoBlurProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.ssaoRawTex);
        gl.uniform1i(this.ssaoBlur_uRawTex, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
        gl.uniform1i(this.ssaoBlur_uDepthTex, 1);
        gl.uniform2f(this.ssaoBlur_uTexelSize, 1.0 / this.ssaoWidth, 1.0 / this.ssaoHeight);
        gl.uniform1f(this.ssaoBlur_uCamNear, 0.25);
        gl.uniform1f(this.ssaoBlur_uCamFar, 20000.0);
        if (this.ssaoBlur_uDepthSharpness !== null) {
            gl.uniform1f(this.ssaoBlur_uDepthSharpness, (this.ssaoQuality === 0) ? 0.95 : 2.6);
        }
        gl.enableVertexAttribArray(this.ssaoBlur_aPos);
        gl.vertexAttribPointer(this.ssaoBlur_aPos, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disableVertexAttribArray(this.ssaoBlur_aPos);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return true;
    }

    // =========================================================================
    // Anti-Aliasing: WebGL2 MSAA 4x (On-Demand FBO) & FXAA 3.11 Post-Process
    // =========================================================================
    _ensureMsaaFbo(w, h) {
        const gl = this.gl;
        if (!gl) return;
        w = Math.max(1, w);
        h = Math.max(1, h);
        if (this.sceneMsaaFbo && this.msaaWidth === w && this.msaaHeight === h) return;

        if (!this.sceneMsaaFbo) {
            const maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
            this.msaaSamples = Math.min(4, maxSamples);
            if (this.msaaSamples < 2) {
                this.msaaReady = false;
                return;
            }
            this.sceneMsaaFbo = gl.createFramebuffer();
            this.msaaColorRb = gl.createRenderbuffer();
            this.msaaMaskRb = gl.createRenderbuffer();
            this.msaaDepthRb = gl.createRenderbuffer();
        }
        this._resizeMsaaFbo(w, h);
    }

    _resizeMsaaFbo(w, h) {
        const gl = this.gl;
        if (!gl || !this.sceneMsaaFbo || this.msaaSamples < 2) return;
        w = Math.max(1, w);
        h = Math.max(1, h);
        this.msaaWidth = w;
        this.msaaHeight = h;

        gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaColorRb);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.msaaSamples, gl.RGBA8, w, h);

        gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaDepthRb);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.msaaSamples, gl.DEPTH_COMPONENT24, w, h);

        if (this.selectionFboReady && this.msaaMaskRb) {
            gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaMaskRb);
            gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.msaaSamples, gl.RGBA8, w, h);
        }
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneMsaaFbo);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msaaColorRb);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msaaDepthRb);
        if (this.selectionFboReady && this.msaaMaskRb) {
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.RENDERBUFFER, this.msaaMaskRb);
        }

        this.msaaReady = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);
        if (!this.msaaReady && this.selectionFboReady) {
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.RENDERBUFFER, null);
            this.msaaReady = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);
        }
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _resolveMsaaToSceneFbo(hasOutline) {
        const gl = this.gl;
        if (!gl || !this.msaaReady || !this.sceneMsaaFbo || !this.sceneFbo) return;
        const W = this.msaaWidth;
        const H = this.msaaHeight;

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneMsaaFbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sceneFbo);

        // 1. Resolve Color Attachment 0
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);

        // 2. Resolve Depth Buffer (WebGL2 requires NEAREST for depth)
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.DEPTH_BUFFER_BIT, gl.NEAREST);

        // 3. Resolve Selection Mask MRT Attachment 1 (only when a selection outline is active)
        if (hasOutline && this.selectionFboReady && this.msaaMaskRb) {
            gl.readBuffer(gl.COLOR_ATTACHMENT1);
            gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
            gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        }

        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }

    _ensurePostFbo(w, h) {
        const gl = this.gl;
        if (!gl) return;
        w = Math.max(1, w);
        h = Math.max(1, h);
        if (this.postFbo && this.postFboWidth === w && this.postFboHeight === h) return;

        if (!this.postFbo) {
            this.postFbo = gl.createFramebuffer();
            this.postColorTex = gl.createTexture();
        }
        this._resizePostFbo(w, h);
    }

    _resizePostFbo(w, h) {
        const gl = this.gl;
        if (!gl || !this.postFbo) return;
        w = Math.max(1, w);
        h = Math.max(1, h);
        this.postFboWidth = w;
        this.postFboHeight = h;

        gl.bindTexture(gl.TEXTURE_2D, this.postColorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.postFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.postColorTex, 0);
        this.postFboReady = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _initFxaaPass() {
        const gl = this.gl;
        if (!gl) return;

        const vs = `#version 300 es
            in vec2 a_position;
            out vec2 v_uv;
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        // FXAA 3.11 Luma-Adaptive (conservative subpix=0.55 to preserve crisp textures)
        const fxaaFs = `#version 300 es
            precision highp float;
            in vec2 v_uv;
            out vec4 fragColor;

            uniform sampler2D u_colorTex;
            uniform vec2 u_invScreenSize;

            float rgb2luma(vec3 rgb) {
                return sqrt(dot(rgb, vec3(0.299, 0.587, 0.114)));
            }

            void main() {
                vec3 colorCenter = texture(u_colorTex, v_uv).rgb;
                float lumaCenter = rgb2luma(colorCenter);

                float lumaDown  = rgb2luma(textureOffset(u_colorTex, v_uv, ivec2( 0, -1)).rgb);
                float lumaUp    = rgb2luma(textureOffset(u_colorTex, v_uv, ivec2( 0,  1)).rgb);
                float lumaLeft  = rgb2luma(textureOffset(u_colorTex, v_uv, ivec2(-1,  0)).rgb);
                float lumaRight = rgb2luma(textureOffset(u_colorTex, v_uv, ivec2( 1,  0)).rgb);

                float lumaMin = min(lumaCenter, min(min(lumaDown, lumaUp), min(lumaLeft, lumaRight)));
                float lumaMax = max(lumaCenter, max(max(lumaDown, lumaUp), max(lumaLeft, lumaRight)));
                float lumaRange = lumaMax - lumaMin;

                if (lumaRange < max(0.0312, lumaMax * 0.125)) {
                    fragColor = vec4(colorCenter, 1.0);
                    return;
                }

                float lumaDownLeft  = rgb2luma(textureOffset(u_colorTex, v_uv, ivec2(-1, -1)).rgb);
                float lumaUpRight   = rgb2luma(textureOffset(u_colorTex, v_uv, ivec2( 1,  1)).rgb);
                float lumaUpLeft    = rgb2luma(textureOffset(u_colorTex, v_uv, ivec2(-1,  1)).rgb);
                float lumaDownRight = rgb2luma(textureOffset(u_colorTex, v_uv, ivec2( 1, -1)).rgb);

                float lumaDownUp = lumaDown + lumaUp;
                float lumaLeftRight = lumaLeft + lumaRight;
                float lumaLeftCorners = lumaDownLeft + lumaUpLeft;
                float lumaDownCorners = lumaDownLeft + lumaDownRight;
                float lumaRightCorners = lumaDownRight + lumaUpRight;
                float lumaUpCorners = lumaUpRight + lumaUpLeft;

                float edgeHorizontal = abs(-2.0 * lumaLeft + lumaLeftCorners) + abs(-2.0 * lumaCenter + lumaDownUp) * 2.0 + abs(-2.0 * lumaRight + lumaRightCorners);
                float edgeVertical   = abs(-2.0 * lumaUp + lumaUpCorners) + abs(-2.0 * lumaCenter + lumaLeftRight) * 2.0 + abs(-2.0 * lumaDown + lumaDownCorners);
                bool isHorizontal = (edgeHorizontal >= edgeVertical);

                float luma1 = isHorizontal ? lumaDown : lumaLeft;
                float luma2 = isHorizontal ? lumaUp : lumaRight;
                float gradient1 = luma1 - lumaCenter;
                float gradient2 = luma2 - lumaCenter;
                bool is1Steepest = abs(gradient1) >= abs(gradient2);
                float gradientScaled = 0.25 * max(abs(gradient1), abs(gradient2));

                float stepLength = isHorizontal ? u_invScreenSize.y : u_invScreenSize.x;
                float lumaLocalAverage = 0.0;
                if (is1Steepest) {
                    stepLength = -stepLength;
                    lumaLocalAverage = 0.5 * (luma1 + lumaCenter);
                } else {
                    lumaLocalAverage = 0.5 * (luma2 + lumaCenter);
                }

                vec2 currentUv = v_uv;
                if (isHorizontal) currentUv.y += stepLength * 0.5;
                else currentUv.x += stepLength * 0.5;

                vec2 offset = isHorizontal ? vec2(u_invScreenSize.x, 0.0) : vec2(0.0, u_invScreenSize.y);
                vec2 uv1 = currentUv - offset;
                vec2 uv2 = currentUv + offset;

                float lumaEnd1 = rgb2luma(texture(u_colorTex, uv1).rgb) - lumaLocalAverage;
                float lumaEnd2 = rgb2luma(texture(u_colorTex, uv2).rgb) - lumaLocalAverage;
                bool reached1 = abs(lumaEnd1) >= gradientScaled;
                bool reached2 = abs(lumaEnd2) >= gradientScaled;
                bool reachedBoth = reached1 && reached2;

                if (!reached1) uv1 -= offset;
                if (!reached2) uv2 += offset;

                if (!reachedBoth) {
                    const float QUALITY[7] = float[7](1.0, 1.5, 2.0, 2.0, 2.0, 4.0, 8.0);
                    for (int i = 0; i < 7; i++) {
                        if (!reached1) {
                            lumaEnd1 = rgb2luma(texture(u_colorTex, uv1).rgb) - lumaLocalAverage;
                            reached1 = abs(lumaEnd1) >= gradientScaled;
                        }
                        if (!reached2) {
                            lumaEnd2 = rgb2luma(texture(u_colorTex, uv2).rgb) - lumaLocalAverage;
                            reached2 = abs(lumaEnd2) >= gradientScaled;
                        }
                        if (reached1 && reached2) break;
                        if (!reached1) uv1 -= offset * QUALITY[i];
                        if (!reached2) uv2 += offset * QUALITY[i];
                    }
                }

                float distance1 = isHorizontal ? (v_uv.x - uv1.x) : (v_uv.y - uv1.y);
                float distance2 = isHorizontal ? (uv2.x - v_uv.x) : (uv2.y - v_uv.y);
                bool isDirection1 = distance1 < distance2;
                float distanceFinal = min(distance1, distance2);
                float edgeThickness = max(distance1 + distance2, 1e-5);
                float pixelOffset = -distanceFinal / edgeThickness + 0.5;

                bool isLumaCenterSmaller = lumaCenter < lumaLocalAverage;
                bool correctVariation = ((isDirection1 ? lumaEnd1 : lumaEnd2) < 0.0) != isLumaCenterSmaller;
                float finalOffset = correctVariation ? pixelOffset : 0.0;

                // Conservative subpixel AA (0.55) keeps building/terrain detail sharp
                float lumaAverage = (1.0 / 12.0) * (2.0 * (lumaDownUp + lumaLeftRight) + lumaLeftCorners + lumaRightCorners);
                float subPixelOffset1 = clamp(abs(lumaAverage - lumaCenter) / lumaRange, 0.0, 1.0);
                float subPixelOffset2 = (-2.0 * subPixelOffset1 + 3.0) * subPixelOffset1 * subPixelOffset1;
                float subPixelOffsetFinal = subPixelOffset2 * subPixelOffset2 * 0.55;

                finalOffset = max(finalOffset, subPixelOffsetFinal);
                vec2 finalUv = v_uv;
                if (isHorizontal) finalUv.y += finalOffset * stepLength;
                else finalUv.x += finalOffset * stepLength;

                fragColor = vec4(texture(u_colorTex, finalUv).rgb, 1.0);
            }
        `;

        const p = gl.createProgram();
        gl.attachShader(p, this.loadShader(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, this.loadShader(gl.FRAGMENT_SHADER, fxaaFs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            console.error("FXAA shader link failed:", gl.getProgramInfoLog(p));
            return;
        }
        this.fxaaProgram = p;
        this.fxaa_aPos = gl.getAttribLocation(p, "a_position");
        this.fxaa_uColorTex = gl.getUniformLocation(p, "u_colorTex");
        this.fxaa_uInvScreenSize = gl.getUniformLocation(p, "u_invScreenSize");
    }

    _renderFxaaPass() {
        const gl = this.gl;
        if (!gl || !this.fxaaProgram || !this.postColorTex) return;

        gl.useProgram(this.fxaaProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.postColorTex);
        gl.uniform1i(this.fxaa_uColorTex, 0);
        gl.uniform2f(this.fxaa_uInvScreenSize, 1.0 / Math.max(1, this.canvas.width), 1.0 / Math.max(1, this.canvas.height));

        gl.bindBuffer(gl.ARRAY_BUFFER, this.fsQuadVbo);
        gl.enableVertexAttribArray(this.fxaa_aPos);
        gl.vertexAttribPointer(this.fxaa_aPos, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disableVertexAttribArray(this.fxaa_aPos);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
};

$(() => {
    renderer3d = new Renderer3d();
});