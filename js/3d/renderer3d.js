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

    
    fov = 90;
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

    getInitializationList() { return [terrainRenderer, building3dRenderer, geometry2dRenderer, entities3dRenderer, lines3dRenderer, hud3d]; }
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
            premultipliedAlpha: false
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
            for (let i in AllVehicles) {
                const v = AllVehicles[i];
                if (!v || v.isClimbingVehicle) continue;

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
        const zNear = 1.0;
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

        this.cameraYaw += x / 6;
        this.cameraPitch += y / 6;

        this.clampRotation();

        requestUpdate();
    };

    clampRotation() {
        if (this.cameraYaw < 0)
            this.cameraYaw += 360;
        else
            this.cameraYaw = this.cameraYaw % 360;

        this.cameraPitch = clamp(-80, this.cameraPitch, 80);
    }
    clampPosition() {
        if (this.isTopDown) {
            const groundH = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(this.cameraPos[0], -this.cameraPos[2]) : 0;
            const minH = groundH + 40.0;
            if (this.cameraPos[1] < minH) this.cameraPos[1] = minH;
            return;
        }

        const height = (typeof heightmap !== "undefined") ? heightmap.getHeightFromCoords(this.cameraPos[0], -this.cameraPos[2]) + 3.0 : 5.0;

        if (this.cameraPos[1] < height)
            this.cameraPos[1] = height;
    }


    orbitDistance = 20.0;

    adjustOrbitDistance(delta) {
        this.orbitDistance = clamp(2.0, this.orbitDistance + delta, 300.0);
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
                        const v = AllVehicles[p.vehicleid];
                        if (v) {
                            let vx = (typeof v.getX === "function") ? v.getX() : v.X;
                            let vy = (typeof v._smoothY === "number") ? v._smoothY : ((typeof v.getY === "function") ? v.getY() : (v.Y || 0));
                            let vz = (typeof v.getZ === "function") ? v.getZ() : v.Z;
                            if (typeof heightmap !== "undefined" && !v.isFlyingVehicle) vy = Math.max(vy, heightmap.getHeightFromCoords(vx, vz) + 0.5);
                            trackedTargetPos = vec3.set(vec3.create(), vx, vy + 1.8, -vz);
                        }
                    } else {
                        let px = (typeof p.getX === "function") ? p.getX() : p.X;
                        let py = (typeof p.getY === "function") ? p.getY() : (p.Y || 0);
                        let pz = (typeof p.getZ === "function") ? p.getZ() : p.Z;
                        if (typeof heightmap !== "undefined") py = Math.max(py, heightmap.getHeightFromCoords(px, pz) + 0.1);
                        trackedTargetPos = vec3.set(vec3.create(), px, py + 1.3, -pz);
                    }
                }
            } else if (typeof SelectedVehicle !== "undefined" && SelectedVehicle != SELECTED_NOTHING && typeof AllVehicles !== "undefined") {
                const v = AllVehicles[SelectedVehicle];
                if (v) {
                    let vx = (typeof v.getX === "function") ? v.getX() : v.X;
                    let vy = (typeof v._smoothY === "number") ? v._smoothY : ((typeof v.getY === "function") ? v.getY() : (v.Y || 0));
                    let vz = (typeof v.getZ === "function") ? v.getZ() : v.Z;
                    if (typeof heightmap !== "undefined" && !v.isFlyingVehicle) vy = Math.max(vy, heightmap.getHeightFromCoords(vx, vz) + 0.5);
                    trackedTargetPos = vec3.set(vec3.create(), vx, vy + 1.8, -vz);
                }
            }
        }

        if (this.isTopDown) {
            // Smooth Top-Down Altitude Interpolation
            if (this.targetTopDownAltitude != null) {
                const lerpAlt = Math.min(1.0, frameTime * 12.0);
                this.cameraPos[1] += (this.targetTopDownAltitude - this.cameraPos[1]) * lerpAlt;
                if (Math.abs(this.targetTopDownAltitude - this.cameraPos[1]) < 0.5) {
                    this.cameraPos[1] = this.targetTopDownAltitude;
                    this.targetTopDownAltitude = null;
                } else if (typeof requestUpdate === "function") {
                    requestUpdate();
                }
                this.clampPosition();
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
            if (keysDown.has(16)) { // Shift multiplier
                zoomSpeed *= 3.0;
                rotateSpeed *= 2.0;
            }

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

            const yawRad = (this.cameraYaw || 0) * Math.PI / 180.0;
            const pitchRad = (this.cameraPitch || -20.0) * Math.PI / 180.0;

            const cosPitch = Math.cos(pitchRad);
            const sinPitch = Math.sin(pitchRad);
            const sinYaw = Math.sin(yawRad);
            const cosYaw = Math.cos(yawRad);

            // Forward unit vector pointing towards focus point
            const fwdX = -sinYaw * cosPitch;
            const fwdY = sinPitch;
            const fwdZ = -cosYaw * cosPitch;

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
                const forward = vec3.scale(vec3.create(), this.getCameraForwardUp(), frameTime * speed);
                vec3.add(this.cameraPos, this.cameraPos, forward);
                renderNeeded = true;
            }
            if (keysDown.has(83)) { // S
                const forward = vec3.scale(vec3.create(), this.getCameraForwardUp(), -frameTime * speed);
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

            this.clampPosition();
        }

        if (renderNeeded)
            requestUpdate();
    }

    draw() {
        this._updateRenderingSize();
        const gl = this.gl;

        // 1. Pass 0: Render 3D Scene into Scene FBO (Color + Depth Texture)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        terrainRenderer.draw();
        if (typeof building3dRenderer !== "undefined" && building3dRenderer.initialized) {
            building3dRenderer.draw();
        }
        if (typeof entities3dRenderer !== "undefined" && entities3dRenderer.initialized) {
            entities3dRenderer.draw();
        }
        if (typeof lines3dRenderer !== "undefined" && lines3dRenderer.initialized) {
            lines3dRenderer.draw();
        }
        geometry2dRenderer.draw();

        // 2. Pass 1: Soldier Eye Depth Pre-Pass (if vision cone active & respects LOS)
        const vc = this.activeVisionCone;
        if (vc && vc.respect) {
            this._renderSoldierEyeDepth(vc.eyeX, vc.eyeY, vc.eyeZ, vc.rotDeg, vc.range, vc.coneAngle);
        }

        // 3. Pass 2: Fullscreen Post-Process with Analytical Volumetric Raymarching & Scene Depth Clamping
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);

        this._renderFullscreenVolumetricPass(vc);

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

        // 2. Depth Renderbuffer
        this.visionDepthRb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.visionDepthRb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);

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

        // Depth texture (DEPTH_COMPONENT24 in WebGL 2.0)
        gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneColorTex, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.sceneDepthTex, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
            precision highp sampler2D;
            in vec2 v_uv;
            out vec4 fragColor;

            uniform sampler2D u_sceneColorTex;
            uniform sampler2D u_sceneDepthTex;
            uniform sampler2D u_eyeDepthTex;

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

            void main() {
                vec4 sceneColor = texture(u_sceneColorTex, v_uv);
                if (u_hasCone == 0) {
                    fragColor = sceneColor;
                    return;
                }

                // Reconstruct world ray from main camera
                vec2 ndc = v_uv * 2.0 - 1.0;
                vec4 farPoint = u_invViewProj * vec4(ndc, 1.0, 1.0);
                vec3 worldFar = farPoint.xyz / farPoint.w;
                vec3 rayDir = normalize(worldFar - u_camPos);

                float tNear, tFar;
                bool hit = intersectConeFrustum(u_camPos, rayDir, tNear, tFar);
                if (!hit) {
                    fragColor = sceneColor;
                    return;
                }

                // Physical obstacle occlusion by bunkers, terrain and trees
                if (u_isXRay == 0) {
                    float sceneDist = getSceneLinearDist(v_uv);
                    tFar = min(tFar, sceneDist);
                }

                if (tFar <= tNear + 0.05) {
                    fragColor = sceneColor;
                    return;
                }

                // Raymarching between [tNear, tFar]
                const int NUM_STEPS = ${numSteps};
                float stepLength = (tFar - tNear) / float(NUM_STEPS);
                float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

                float accumDensity = 0.0;
                for (int i = 0; i < NUM_STEPS; i++) {
                    float t = tNear + (float(i) + dither * 0.95) * stepLength;
                    vec3 p = u_camPos + rayDir * t;

                    vec4 clip = u_eyeViewProj * vec4(p, 1.0);
                    if (clip.w <= 0.0) continue;

                    vec3 eNdc = clip.xyz / clip.w;
                    if (abs(eNdc.x) > 1.0 || abs(eNdc.y) > 1.0 || abs(eNdc.z) > 1.0) continue;

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
                    float distFade = clamp(1.0 - (distToEye / u_far), 0.0, 1.0);

                    accumDensity += 0.10 * edgeFade * (0.35 + 0.65 * distFade) * (stepLength / 2.5);
                    if (accumDensity >= 1.6) break;
                }

                if (accumDensity <= 0.003) {
                    fragColor = sceneColor;
                    return;
                }

                vec3 coneColor = vec3(1.0, 0.88, 0.22);
                float finalAlpha = clamp(accumDensity * 0.55 + 0.18, 0.0, 0.75);

                // Alpha blend directly with scene
                vec3 outRgb = mix(sceneColor.rgb, coneColor, finalAlpha);
                fragColor = vec4(outRgb, sceneColor.a);
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

        console.log(`[Renderer3D] Fullscreen Post-Process Volumetric Vision Cone Program Initialized (${numSteps} steps) [${quality}]`);
    }

    updateVisionConeQuality(qual) {
        if (!this.gl) return;
        this.visionConeQuality = qual;
        this._initVisionDepthPass(qual);
        this._initFullscreenVolumetricPass(qual);
        renderNeeded = true;
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
    }

    _renderFullscreenVolumetricPass(vc) {
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
        gl.uniform1f(this.fs_uCamNear, 1.0);
        gl.uniform1f(this.fs_uCamFar, 20000.0);

        // Textures: unit 0 = sceneColorTex, unit 1 = sceneDepthTex, unit 2 = visionColorTex (eyeDepthTex)
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneColorTex);
        gl.uniform1i(this.fs_uSceneColorTex, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
        gl.uniform1i(this.fs_uSceneDepthTex, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.visionColorTex);
        gl.uniform1i(this.fs_uEyeDepthTex, 2);

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
    }
};

$(() => {
    renderer3d = new Renderer3d();
});