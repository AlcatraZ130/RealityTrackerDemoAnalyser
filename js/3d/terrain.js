"use strict";


// x, y, z, u, v
const HEIGHTMAP_STRIDE_SIZE = 5 * 4

var terrainRenderer;
class TerrainRenderer extends Initializable {
    indices = null;
    TERRAINSEGMENT_SIZE = 128;
    TERRAINSEGMENT_LODSIZE = [129];
    TERRAINSEGMENT_LODSCALE = [1];
    TERRAINSEGMENT_LODINDEXSIZE = [];

    mapTexture = null;
    dodTexture = null;
    splatArrayTexture = null;
    detailArrayTexture = null;
    usingRealTerrain = false;
    hasDodPolygons = false;
    detailReady = false;
    _dodBuiltSignature = null;
    _builtDetailSig = null;
    detailLayerRepeats = new Float32Array(6);
    detailActiveMask = 0;
    terrainProgram = null;

    gpu_verticesCoords = null;
    gpu_textureCoords = null;
    //gpu_verticesNormal = null;

    gpu_projectionMatrix = null;
    gpu_viewMatrix = null;
    gpu_uSampler = null;
    gpu_uDodSampler = null;
    gpu_uUseDodOverlay = null;
    gpu_uSplatArray = null;
    gpu_uDetailArray = null;
    gpu_uCameraPos = null;
    gpu_uLayerRepeats = null;
    gpu_uActiveMask = null;
    gpu_uUseDetail = null;

    segments = [];

    constructor() {
        super();

        for (let i = 0; i < this.TERRAINSEGMENT_LODSIZE.length; i++)
            this.TERRAINSEGMENT_LODINDEXSIZE.push(this._getElementCount(this.TERRAINSEGMENT_LODSIZE[i]))
        this.dataReady = true;
    }

    getIsDataReady() {
        const hasTerrainTexture = (typeof TerrainImage !== "undefined" && TerrainImage != null)
            || (typeof TerrainImageFailed !== "undefined" && TerrainImageFailed && MapImage != null);
        return hasTerrainTexture && heightmap.initialized;
    }

    init() {
        if (this.initialized)
            return true;

        const gl = renderer3d.gl;

        this._createIndicesBuffers(gl);
        this._loadMapImageAsTexture();
        this._initPlaceholderDetailTextures(gl);
        this.updateDodOverlay();
        this._createProgram();
        this._createSegments();
        this.initialized = true;
        this.tryInitDetailResources(true);
        return true;
    }

    _initPlaceholderDetailTextures(gl) {
        this.detailReady = false;
        this._builtDetailSig = null;
        this.detailActiveMask = 0;

        const dummyPixel = new Uint8Array([128, 128, 128, 255]);
        if (!this.splatArrayTexture) {
            this.splatArrayTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.splatArrayTexture);
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, dummyPixel);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        if (!this.detailArrayTexture) {
            this.detailArrayTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.detailArrayTexture);
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, dummyPixel);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    }

    _createProgram() {
        // Vertex shader
        const vsSource = `#version 300 es
            in vec4 aVertexPosition;
            in vec2 aTextureUV;

            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;
            out highp vec2 vTextureCoord;
            out highp vec3 vWorldPos;
            out lowp vec3 vLighting;

            void main(void) {
              gl_Position = uProjectionMatrix * uViewMatrix * aVertexPosition;
              vTextureCoord = aTextureUV;
              vWorldPos = aVertexPosition.xyz;
            }
          `;
        // Pixel shader
        const fsSource = `#version 300 es
            precision highp float;
            precision highp int;
            precision mediump sampler2DArray;
            precision highp sampler2DShadow;

            in highp vec2 vTextureCoord;
            in highp vec3 vWorldPos;
            in lowp vec3 vLighting;

            uniform sampler2D uSampler;
            uniform sampler2D uDodSampler;
            uniform int uUseDodOverlay;

            uniform sampler2DArray uSplatArray;
            uniform sampler2DArray uDetailArray;
            uniform vec3 uCameraPos;
            uniform float uLayerRepeats[6];
            uniform int uActiveMask;
            uniform int uUseDetail;

            uniform mat4 uLightSpaceMatrix;
            uniform sampler2DShadow uShadowMap;
            uniform int uUseShadows;

            out vec4 fragColor;

            float sampleTerrainShadow(vec3 worldPos) {
              vec4 ls = uLightSpaceMatrix * vec4(worldPos + vec3(0.0, 0.08, 0.0), 1.0);
              vec3 proj = (ls.xyz / ls.w) * 0.5 + 0.5;
              if (proj.x <= 0.002 || proj.x >= 0.998 || proj.y <= 0.002 || proj.y >= 0.998 || proj.z <= 0.0 || proj.z >= 1.0) {
                return 1.0;
              }
              float edge = min(min(proj.x, 1.0 - proj.x), min(proj.y, 1.0 - proj.y));
              float edgeFade = smoothstep(0.0, 0.12, edge);
              float zRef = proj.z - 0.00035;
              // 5-tap rotated Poisson PCF (with hardware LINEAR shadow comparison)
              float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
              float ca = cos(ang), sa = sin(ang);
              mat2 rot = mat2(ca, -sa, sa, ca);
              const float rad = 1.55 / 2048.0;
              float s = texture(uShadowMap, vec3(proj.xy, zRef));
              s += texture(uShadowMap, vec3(proj.xy + (rot * vec2( 0.85217,  0.32419)) * rad, zRef));
              s += texture(uShadowMap, vec3(proj.xy + (rot * vec2(-0.82292,  0.38165)) * rad, zRef));
              s += texture(uShadowMap, vec3(proj.xy + (rot * vec2( 0.28898, -0.86354)) * rad, zRef));
              s += texture(uShadowMap, vec3(proj.xy + (rot * vec2(-0.34467, -0.80801)) * rad, zRef));
              s *= 0.2;
              return mix(1.0, s, edgeFade);
            }

            void main() {
              vec4 baseColor = texture(uSampler, vTextureCoord);

              if (uUseDetail == 1) {
                vec2 uvDx = dFdx(vTextureCoord);
                vec2 uvDy = dFdy(vTextureCoord);
                float dist = distance(vWorldPos, uCameraPos);
                float detailFade = 1.0 - smoothstep(140.0, 440.0, dist);
                if (detailFade > 0.004) {
                  vec3 splat0 = texture(uSplatArray, vec3(vTextureCoord, 0.0)).rgb;
                  vec3 splat1 = texture(uSplatArray, vec3(vTextureCoord, 1.0)).rgb;
                  float w[6];
                  w[0] = splat0.r;
                  w[1] = splat0.g;
                  w[2] = splat0.b;
                  w[3] = splat1.r;
                  w[4] = splat1.g;
                  w[5] = splat1.b;

                  vec3 accumDetail = vec3(0.0);
                  float weightSum = 0.0;
                  for (int i = 0; i < 6; i++) {
                    int bit = 1 << i;
                    float wi = w[i];
                    if ((uActiveMask & bit) != 0 && wi > 0.01) {
                      float rep = uLayerRepeats[i];
                      vec3 d = textureGrad(
                        uDetailArray,
                        vec3(vTextureCoord * rep, float(i)),
                        uvDx * rep,
                        uvDy * rep
                      ).rgb;
                      accumDetail += d * wi;
                      weightSum += wi;
                    }
                  }
                  if (weightSum > 0.01) {
                    vec3 blendedDetail = accumDetail / weightSum;
                    vec3 modulated = clamp(baseColor.rgb * (blendedDetail * 2.0), 0.0, 1.0);
                    baseColor.rgb = mix(baseColor.rgb, modulated, detailFade);
                  }
                }
              }

              if (uUseShadows == 1) {
                float sh = sampleTerrainShadow(vWorldPos);
                // Luminance-aware soft blend: avoids double-darkening PR's baked terrain shadows
                // while keeping dynamic shadows visible on sunlit ground (vehicles, soldiers, structures).
                float luma = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
                float sunlitWeight = smoothstep(0.18, 0.52, luma);
                float minShadow = mix(0.94, 0.78, sunlitWeight);
                baseColor.rgb *= mix(minShadow, 1.0, sh);
              }

              if (uUseDodOverlay == 1) {
                vec4 dod = texture(uDodSampler, vTextureCoord);
                if (dod.a > 0.004) {
                  vec3 dodColor = dod.rgb / max(dod.a, 0.004);
                  baseColor.rgb = mix(baseColor.rgb, dodColor, 0.22 * dod.a);
                }
              }
              fragColor = baseColor;
            }`;
        const gl = renderer3d.gl;

        const terrainProgram = gl.createProgram();
        gl.attachShader(terrainProgram, renderer3d.loadShader(gl.VERTEX_SHADER, vsSource));
        gl.attachShader(terrainProgram, renderer3d.loadShader(gl.FRAGMENT_SHADER, fsSource));
        gl.linkProgram(terrainProgram);

        if (!gl.getProgramParameter(terrainProgram, gl.LINK_STATUS)) {
            alert('Unable to initialize the shader program: ' + gl.getProgramInfoLog(terrainProgram));
            return null;
        }

        this.terrainProgram = terrainProgram;
        this.gpu_verticesCoords = gl.getAttribLocation(terrainProgram, 'aVertexPosition');
        this.gpu_textureCoords = gl.getAttribLocation(terrainProgram, 'aTextureUV');
        //this.gpu_verticesNormal = gl.getAttribLocation(terrainProgram, 'aVertexNormal');

        this.gpu_projectionMatrix = gl.getUniformLocation(terrainProgram, 'uProjectionMatrix');
        this.gpu_viewMatrix = gl.getUniformLocation(terrainProgram, 'uViewMatrix');
        this.gpu_uSampler = gl.getUniformLocation(terrainProgram, 'uSampler');
        this.gpu_uDodSampler = gl.getUniformLocation(terrainProgram, 'uDodSampler');
        this.gpu_uUseDodOverlay = gl.getUniformLocation(terrainProgram, 'uUseDodOverlay');
        this.gpu_uSplatArray = gl.getUniformLocation(terrainProgram, 'uSplatArray');
        this.gpu_uDetailArray = gl.getUniformLocation(terrainProgram, 'uDetailArray');
        this.gpu_uCameraPos = gl.getUniformLocation(terrainProgram, 'uCameraPos');
        this.gpu_uLayerRepeats = gl.getUniformLocation(terrainProgram, 'uLayerRepeats');
        this.gpu_uActiveMask = gl.getUniformLocation(terrainProgram, 'uActiveMask');
        this.gpu_uUseDetail = gl.getUniformLocation(terrainProgram, 'uUseDetail');
        this.gpu_uLightSpaceMatrix = gl.getUniformLocation(terrainProgram, 'uLightSpaceMatrix');
        this.gpu_uShadowMap = gl.getUniformLocation(terrainProgram, 'uShadowMap');
        this.gpu_uUseShadows = gl.getUniformLocation(terrainProgram, 'uUseShadows');

        console.log("TERRAIN: Compiled terrain shaders");
    }

    // Create coords for the vertices of the heightmap 
    _createSegments() {
        if (this.segments && this.segments.length > 0) {
            const gl = renderer3d.gl;
            if (gl) {
                for (const row of this.segments) {
                    for (const seg of row) {
                        if (seg.gpu_vertexBuffer) {
                            for (const buf of seg.gpu_vertexBuffer) gl.deleteBuffer(buf);
                        }
                    }
                }
            }
        }
        this.segments = [];

        // Adaptive segment count capped to 8x8 max (64 segments total)
        // Eliminates out-of-memory crashes on large 4km maps like Grozny!
        const segmentCount = Math.min(8, Math.max(4, Math.floor(heightmap.size / 128)));
        const span = heightmap.size / segmentCount;
        const lodScale = span / 128.0;

        for (let i = 0; i < segmentCount; i++) {
            const row = [];
            this.segments.push(row);
            const xstart = i * span;
            for (let j = 0; j < segmentCount; j++) {
                const zstart = j * span;
                row.push(new TerrainSegment(xstart, zstart, span, lodScale, 129));
            }
        }
        console.log("TERRAIN: initialized heightmap segments: " + segmentCount + "x" + segmentCount + " (Span: " + span + ", LodScale: " + lodScale + ")");
    }

    _configureTerrainSampler(gl, useAniso) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (useAniso) {
            const ext = gl.getExtension("EXT_texture_filter_anisotropic")
                || gl.getExtension("MOZ_EXT_texture_filter_anisotropic")
                || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
            if (ext) {
                const maxAniso = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
                gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
            }
        }
    }

    _resolveTerrainSourceImage(overrideImage) {
        const wantRealTerrain = (typeof options_RealTerrain === "undefined") ? true : !!options_RealTerrain;
        if (overrideImage) {
            const isReal = wantRealTerrain && (typeof TerrainImage !== "undefined" && overrideImage === TerrainImage);
            if (isReal) {
                return { img: overrideImage, isRealTerrain: true };
            }
            if (typeof TerrainImage === "undefined" || overrideImage !== TerrainImage) {
                return { img: overrideImage, isRealTerrain: false };
            }
        }
        if (wantRealTerrain && typeof TerrainImage !== "undefined" && TerrainImage != null) {
            return { img: TerrainImage, isRealTerrain: true };
        }
        const fallback = (typeof options_DrawDOD !== "undefined" && options_DrawDOD && typeof MapImageWithCombatArea !== "undefined" && MapImageWithCombatArea)
            ? MapImageWithCombatArea
            : MapImage;
        return { img: fallback, isRealTerrain: false };
    }

    _loadMapImageAsTexture() {
        const resolved = this._resolveTerrainSourceImage();
        if (!resolved.img) {
            console.error("TERRAIN: Called load texture for map when map isn't ready");
            return;
        }
        const gl = renderer3d.gl;
        if (!gl) return;

        this.mapTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.mapTexture);

        const level = 0;
        const internalFormat = gl.RGBA;
        const srcFormat = gl.RGBA;
        const srcType = gl.UNSIGNED_BYTE;
        gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
            srcFormat, srcType, resolved.img);
        gl.generateMipmap(gl.TEXTURE_2D);
        this._configureTerrainSampler(gl, true);
        this.usingRealTerrain = resolved.isRealTerrain;

        console.log("TERRAIN: Loaded " + (resolved.isRealTerrain ? "3D TerrainMaps WebP" : "2D fallback map") + " (" + resolved.img.width + "x" + resolved.img.height + ")");
    }

    updateMapTexture(sourceImage) {
        const resolved = this._resolveTerrainSourceImage(sourceImage);
        if (!resolved.img || !this.mapTexture || !this.initialized) return;
        const gl = renderer3d.gl;
        if (!gl) return;
        gl.bindTexture(gl.TEXTURE_2D, this.mapTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, resolved.img);
        gl.generateMipmap(gl.TEXTURE_2D);
        this._configureTerrainSampler(gl, true);
        this.usingRealTerrain = resolved.isRealTerrain;
    }

    updateDodOverlay() {
        const gl = renderer3d.gl;
        if (!gl) return;

        const list = (typeof currentDODList !== "undefined" && Array.isArray(currentDODList)) ? currentDODList : [];
        const sig = list.map((ca) => (ca.inverted | 0) + ":" + (ca.team | 0) + ":" + (ca.points ? ca.points.length : 0)).join(",")
            + "@" + (typeof MapSize !== "undefined" ? MapSize : 0);

        if (this.dodTexture && sig === this._dodBuiltSignature) {
            return;
        }

        if (!this.dodTexture) {
            this.dodTexture = gl.createTexture();
        }
        gl.bindTexture(gl.TEXTURE_2D, this.dodTexture);

        let hasPoly = false;
        if (typeof MapSize !== "undefined" && MapSize > 0 && list.length > 0) {
            const dodSize = 512;
            const scale = dodSize / 1024;
            const canvas = document.createElement("canvas");
            canvas.width = dodSize;
            canvas.height = dodSize;
            const ctx = canvas.getContext("2d");

            for (const ca of list) {
                if (ca.inverted == 1 || !ca.points || ca.points.length < 3) continue;
                if (ca.team == 0) ctx.fillStyle = "rgb(0, 0, 0)";
                else if (ca.team == 2) ctx.fillStyle = "rgb(255, 0, 0)";
                else ctx.fillStyle = "rgb(0, 0, 255)";

                ctx.beginPath();
                for (let idx = 0; idx < ca.points.length; idx++) {
                    const pt = ca.points[idx];
                    const px = ((pt[0] / MapSize) + 512) * scale;
                    const py = ((pt[1] / -MapSize) + 512) * scale;
                    if (idx === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
                hasPoly = true;
            }

            if (hasPoly) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
                gl.generateMipmap(gl.TEXTURE_2D);
                this._configureTerrainSampler(gl, false);
            }
        }

        if (!hasPoly) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }

        this.hasDodPolygons = hasPoly;
        this._dodBuiltSignature = sig;
    }

    _createIndicesBuffers() {
        if (this.indices != null)
            return;
        this.indices = [];

        for (let i = 0; i < this.TERRAINSEGMENT_LODSIZE.length; i++)
            this.indices.push(this._createIndicesBuffer(this.TERRAINSEGMENT_LODSIZE[i]));
    }

    _createIndicesBuffer(size) {
        const gl = renderer3d.gl;
        const indicesSize = this._getElementCount(size);
        const indices = new Uint16Array(indicesSize);
        let indicesIterator = 0;
        for (let i = 0; i < size - 1; i++) // row
        {
            for (let j = 0; j < size; j++) { // columns
                indices[indicesIterator++] = ((i + 0) * size + (j + 0));
                indices[indicesIterator++] = ((i + 1) * size + (j + 0));
            }

            // 2 degenerate verticies for next row, the last and the first of the lower row
            indices[indicesIterator++] = ((i + 1) * size + (size - 1));
            indices[indicesIterator++] = ((i + 1) * size + 0);
        }

        console.assert(indicesIterator == indicesSize);

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        return buffer;
    }

    // How many indices do we need for a sizeXsize terrain segment
    _getElementCount(size) {
        return (size - 1) * (2 * size + 2);
    }

    _resizeDetailToCanvas(img, size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        return canvas;
    }

    tryInitDetailResources(fromInit = false) {
        if (!this.initialized || typeof renderer3d === "undefined" || !renderer3d.gl)
            return false;
        if (typeof MapName === "undefined" || !MapName || typeof TERRAIN_DETAIL_DB === "undefined" || !TERRAIN_DETAIL_DB)
            return false;
        if (typeof TerrainSplatImage === "undefined" || !TerrainSplatImage || !TerrainSplatImage.complete || TerrainSplatImage.naturalWidth <= 1)
            return false;

        const mapKey = MapName.toLowerCase();
        const meta = TERRAIN_DETAIL_DB[mapKey];
        if (!meta || !Array.isArray(meta.layers) || meta.layers.length === 0)
            return false;

        const layerImgs = new Array(6).fill(null);
        let readyMask = 0;
        let readyCount = 0;
        const imgsMap = (typeof TerrainDetailImages !== "undefined" && TerrainDetailImages) ? TerrainDetailImages : null;

        for (let i = 0; i < 6 && i < meta.layers.length; i++) {
            const lyr = meta.layers[i];
            if (!lyr || !lyr.tex) continue;
            const img = imgsMap ? imgsMap[lyr.tex] : null;
            if (!img || !img.complete)
                return false;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                layerImgs[i] = img;
                readyMask |= (1 << i);
                readyCount++;
            }
        }

        if (readyMask === 0)
            return false;

        const sig = `${mapKey}|${TerrainSplatImage.src}|${readyMask}|${readyCount}`;
        if (this.detailReady && this._builtDetailSig === sig)
            return true;

        const gl = renderer3d.gl;
        const splatW = TerrainSplatImage.naturalWidth || TerrainSplatImage.width;
        const splatH = TerrainSplatImage.naturalHeight || TerrainSplatImage.height;
        const halfW = Math.floor(splatW / 2);
        if (halfW <= 0 || splatH <= 0)
            return false;

        // Upload 2048x1024 atlas as 2-slice 1024x1024x2 TEXTURE_2D_ARRAY
        if (this.splatArrayTexture)
            gl.deleteTexture(this.splatArrayTexture);
        this.splatArrayTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.splatArrayTexture);
        const splatLevels = Math.floor(Math.log2(Math.max(halfW, splatH))) + 1;
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, splatLevels, gl.RGBA8, halfW, splatH, 2);

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, splatW);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);

        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        gl.texSubImage3D(
            gl.TEXTURE_2D_ARRAY, 0,
            0, 0, 0, halfW, splatH, 1,
            gl.RGBA, gl.UNSIGNED_BYTE, TerrainSplatImage
        );

        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, halfW);
        gl.texSubImage3D(
            gl.TEXTURE_2D_ARRAY, 0,
            0, 0, 1, halfW, splatH, 1,
            gl.RGBA, gl.UNSIGNED_BYTE, TerrainSplatImage
        );

        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);

        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);

        // Upload 6 detail layers into 512x512x6 TEXTURE_2D_ARRAY
        const detailSize = 512;
        const detailLevels = Math.floor(Math.log2(detailSize)) + 1;
        if (this.detailArrayTexture)
            gl.deleteTexture(this.detailArrayTexture);
        this.detailArrayTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.detailArrayTexture);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, detailLevels, gl.RGBA8, detailSize, detailSize, 6);

        this.detailLayerRepeats.fill(24.0);
        for (let i = 0; i < 6; i++) {
            const img = layerImgs[i];
            if (!img) continue;
            const src = (img.naturalWidth === detailSize && img.naturalHeight === detailSize)
                ? img
                : this._resizeDetailToCanvas(img, detailSize);
            gl.texSubImage3D(
                gl.TEXTURE_2D_ARRAY, 0,
                0, 0, i, detailSize, detailSize, 1,
                gl.RGBA, gl.UNSIGNED_BYTE, src
            );
            this.detailLayerRepeats[i] = Math.max(Number(meta.layers[i].repeat) || 24.0, 24.0);
        }

        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic')
            || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
        if (anisoExt) {
            const maxAniso = gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
            gl.texParameterf(gl.TEXTURE_2D_ARRAY, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8.0, maxAniso));
        }
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

        this.detailActiveMask = readyMask;
        this.detailReady = true;
        this._builtDetailSig = sig;
        console.log(`TERRAIN: Detail splat initialized (${readyCount} layers, ${halfW}x${splatH})`);

        if (!fromInit && typeof requestUpdate === "function")
            requestUpdate();
        return true;
    }

    draw() {
        const gl = renderer3d.gl;
        gl.useProgram(this.terrainProgram);
        gl.uniformMatrix4fv(this.gpu_projectionMatrix, false, renderer3d.getCurrentProjectionMatrix());
        gl.uniformMatrix4fv(this.gpu_viewMatrix, false, renderer3d.getCurrentViewMatrix());

        // Texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.mapTexture);
        gl.uniform1i(this.gpu_uSampler, 0);

        const useDod = this.usingRealTerrain
            && this.dodTexture != null
            && this.hasDodPolygons
            && typeof options_DrawDOD !== "undefined"
            && options_DrawDOD;
        if (this.dodTexture) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.dodTexture);
            gl.uniform1i(this.gpu_uDodSampler, 1);
        }
        gl.uniform1i(this.gpu_uUseDodOverlay, useDod ? 1 : 0);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.splatArrayTexture);
        gl.uniform1i(this.gpu_uSplatArray, 2);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.detailArrayTexture);
        gl.uniform1i(this.gpu_uDetailArray, 3);

        const useShadows = !!(renderer3d.shadowsActiveThisFrame && renderer3d.shadowDepthTex);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, useShadows ? renderer3d.shadowDepthTex : (renderer3d.shadowDummyTex || null));
        if (this.gpu_uShadowMap !== null) gl.uniform1i(this.gpu_uShadowMap, 4);
        if (this.gpu_uUseShadows !== null) gl.uniform1i(this.gpu_uUseShadows, useShadows ? 1 : 0);
        if (useShadows && this.gpu_uLightSpaceMatrix !== null) {
            gl.uniformMatrix4fv(this.gpu_uLightSpaceMatrix, false, renderer3d.lightViewProjMatrix);
        }

        gl.activeTexture(gl.TEXTURE0);

        const useDetail = this.usingRealTerrain
            && this.detailReady
            && (typeof options_TerrainDetail === "undefined" || options_TerrainDetail);
        gl.uniform1i(this.gpu_uUseDetail, useDetail ? 1 : 0);
        if (useDetail) {
            const cam = renderer3d.cameraPos;
            gl.uniform3f(this.gpu_uCameraPos, cam[0], cam[1], cam[2]);
            gl.uniform1fv(this.gpu_uLayerRepeats, this.detailLayerRepeats);
            gl.uniform1i(this.gpu_uActiveMask, this.detailActiveMask);
        }

        for (let l of this.segments)
            for (let segment of l) {
                segment.draw(0);
            }
    }

    drawDepth(aPosLoc) {
        if (!this.segments) return;
        for (let l of this.segments) {
            for (let segment of l) {
                segment.drawDepth(aPosLoc, 0);
            }
        }
    }
}

class TerrainSegment {  
    gpu_vertexBuffer = [];

    constructor(xstart, zstart, span, lodScale = 1.0, size = 129) {
        const gl = renderer3d.gl;
        if (!gl) return;

        const totalFloats = size * size * 5; // 5 floats: x, y, z, u, v
        const vertexData = new Float32Array(totalFloats);

        const hSize = heightmap.size;
        const scaleX = heightmap.scalex;
        const scaleZ = heightmap.scalez;
        const halfTerrain = heightmap.terrainSize / 2;

        let ptr = 0;
        for (let row = 0; row < size; row++) {
            const i = Math.min(hSize, Math.round(xstart + row * lodScale));
            const u = i / hSize;
            const worldX = (i * scaleX) - halfTerrain;

            for (let col = 0; col < size; col++) {
                const j = Math.min(hSize, Math.round(zstart + col * lodScale));
                const v = j / hSize;
                const worldZ = (j * scaleZ) - halfTerrain;
                const safeRow = Math.max(0, Math.min(hSize - 1, (hSize - 1) - j));
                const safeCol = Math.max(0, Math.min(hSize - 1, i));
                const worldY = heightmap.getHeightFromOffset(safeRow, safeCol);

                vertexData[ptr++] = worldX;
                vertexData[ptr++] = worldY;
                vertexData[ptr++] = worldZ;
                vertexData[ptr++] = u;
                vertexData[ptr++] = v;
            }
        }

        const gpuvertices = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, gpuvertices);
        gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
        this.gpu_vertexBuffer.push(gpuvertices);
    }

    draw(lod) {
        const gl = renderer3d.gl;
        const vertexbuffer = this.gpu_vertexBuffer[lod || 0];
        if (!vertexbuffer) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexbuffer);

        const stride = HEIGHTMAP_STRIDE_SIZE; // 20 bytes
        gl.vertexAttribPointer(terrainRenderer.gpu_verticesCoords, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(terrainRenderer.gpu_verticesCoords);

        gl.vertexAttribPointer(terrainRenderer.gpu_textureCoords, 2, gl.FLOAT, false, stride, 12);
        gl.enableVertexAttribArray(terrainRenderer.gpu_textureCoords);

        const indicesForLod = terrainRenderer.indices[lod || 0];
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indicesForLod);

        gl.drawElements(gl.TRIANGLE_STRIP, terrainRenderer.TERRAINSEGMENT_LODINDEXSIZE[lod || 0], gl.UNSIGNED_SHORT, 0);
    }

    drawDepth(aPosLoc, lod) {
        const gl = renderer3d.gl;
        const vertexbuffer = this.gpu_vertexBuffer[lod || 0];
        if (!vertexbuffer) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexbuffer);

        const stride = HEIGHTMAP_STRIDE_SIZE; // 20 bytes: pos at offset 0
        gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(aPosLoc);

        const indicesForLod = terrainRenderer.indices[lod || 0];
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indicesForLod);

        gl.drawElements(gl.TRIANGLE_STRIP, terrainRenderer.TERRAINSEGMENT_LODINDEXSIZE[lod || 0], gl.UNSIGNED_SHORT, 0);
    }
}

$(() => {
    terrainRenderer = new TerrainRenderer();
});