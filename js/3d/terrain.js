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
    terrainProgram = null;

    gpu_verticesCoords = null;
    gpu_textureCoords = null;
    //gpu_verticesNormal = null;

    gpu_projectionMatrix = null;
    gpu_viewMatrix = null;
    gpu_uSampler = null;

    segments = [];

    constructor() {
        super();

        for (let i = 0; i < this.TERRAINSEGMENT_LODSIZE.length; i++)
            this.TERRAINSEGMENT_LODINDEXSIZE.push(this._getElementCount(this.TERRAINSEGMENT_LODSIZE[i]))
        this.dataReady = true;
    }

    getIsDataReady() {
        return MapImage != null && heightmap.initialized;
    }

    init() {
        if (this.initialized)
            return true;

        const gl = renderer3d.gl;

        this._createIndicesBuffers(gl);
        this._loadMapImageAsTexture();
        this._createProgram();
        this._createSegments();
        this.initialized = true;
        return true;
    }

    _createProgram() {
        // Vertex shader
        const vsSource = `
            attribute vec4 aVertexPosition;
            attribute vec2 aTextureUV;

            uniform mat4 uViewMatrix;
            uniform mat4 uProjectionMatrix;
            varying highp vec2 vTextureCoord;


            varying lowp vec3 vLighting;
            void main(void) {      
              gl_Position = uProjectionMatrix * uViewMatrix * aVertexPosition;
              vTextureCoord = aTextureUV;
                

            }
          `;
        // Pixel shader
        const fsSource = `
            varying highp vec2 vTextureCoord;
            varying lowp vec3 vLighting;
            uniform sampler2D uSampler;

            void main() {
              gl_FragColor = texture2D(uSampler, vTextureCoord);
              //gl_FragColor = vec4(gl_FragColor.rgb * vLighting, gl_FragColor.a);
            }`
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

    _loadMapImageAsTexture() {
        if (MapImage == null) {
            console.error("TERRAIN: Called load texture for map when map isn't ready");
            return;
        }
        const img = (typeof options_DrawDOD !== "undefined" && options_DrawDOD && typeof MapImageWithCombatArea !== "undefined" && MapImageWithCombatArea) ? MapImageWithCombatArea : MapImage;
        const gl = renderer3d.gl;
        if (!gl) return;

        this.mapTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.mapTexture);

        const level = 0;
        const internalFormat = gl.RGBA;
        const srcFormat = gl.RGBA;
        const srcType = gl.UNSIGNED_BYTE;
        gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
            srcFormat, srcType, img);
        gl.generateMipmap(gl.TEXTURE_2D);

        console.log("TERRAIN: Loaded map image as texture");
    }

    updateMapTexture(sourceImage) {
        const img = sourceImage || ((typeof options_DrawDOD !== "undefined" && options_DrawDOD && typeof MapImageWithCombatArea !== "undefined" && MapImageWithCombatArea) ? MapImageWithCombatArea : MapImage);
        if (!img || !this.mapTexture || !this.initialized) return;
        const gl = renderer3d.gl;
        if (!gl) return;
        gl.bindTexture(gl.TEXTURE_2D, this.mapTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
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

    draw() {
        const gl = renderer3d.gl;
        gl.useProgram(this.terrainProgram);
        gl.uniformMatrix4fv(this.gpu_projectionMatrix, false, renderer3d.getCurrentProjectionMatrix());
        gl.uniformMatrix4fv(this.gpu_viewMatrix, false, renderer3d.getCurrentViewMatrix());

        // Texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.mapTexture);
        gl.uniform1i(this.gpu_uSampler, 0);

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
                const worldY = heightmap.getHeightFromOffset(hSize - j, i);

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