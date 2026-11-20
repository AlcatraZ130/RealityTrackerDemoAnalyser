"use strict";


var heightmap;
class Heightmap {
    heightdataview = null;
    bitresolution = null;
    bytesize = null;

    size = null;
    terrainSize = null;

    scalex = null;
    scaley = null;
    scalez = null;

    waterlevel = 0;

    dataReady = true;
    initialized = false;

    constructor() {

    }

    init(link, data) {
        try {
            this.size = parseInt(data.size.split(" ")[0]);
            this.terrainSize = parseInt(data.fullsize);
            //this.waterlevel = parseInt(data.waterlevel);
            this.scalex = parseFloat(data.scale.split("/")[0]);
            this.scaley = parseFloat(data.scale.split("/")[1]);
            this.scalez = parseFloat(data.scale.split("/")[2]);
            this.bitresolution = parseInt(data.bitresolution); 
            this.bytesize = this.bitresolution / 8;
            
        } catch (e) {
            console.error(e);
            console.error("Could not parse heightmap data. Aborting");
            console.error(data);
        }


        this._downloadHeightmap(link);
    };

    _downloadHeightmap(link) {
        downloadManager.download(link, "bin", (data) => {
            console.log("Heightmap downloaded");
            this.heightdataview = new DataView(data);
            this.initialized = true;
        }, "Map Heightmap");
    }

    

    getHeightFromOffset(i, j) {      
        if (!this.heightdataview) return this.waterlevel;
        const offset = (i * this.size + j) * this.bytesize;
        if (offset + this.bytesize - 1 > this.heightdataview.byteLength)
            return this.waterlevel;
        if (offset < 0)
            return this.waterlevel;

        switch (this.bytesize) {
            case 1:
                return (this.heightdataview.getUint8(offset) * this.scaley);
            case 2:
                return (this.heightdataview.getUint16(offset, true) * this.scaley);
            case 4:
                return (this.heightdataview.getUint32(offset, true) * this.scaley);
        }
        return this.waterlevel;
    };

    getHeightFromCoords(x, z) {
        x += this.terrainSize / 2;
        z += this.terrainSize / 2;
        x /= this.scalex;
        z /= this.scalez;

        const maxIdx = Math.max(0, (this.size || 1) - 1);
        const xint = Math.max(0, Math.min(maxIdx, Math.floor(x)));
        const zint = Math.max(0, Math.min(maxIdx, Math.floor(z)));
        const xnext = Math.min(maxIdx, xint + 1);
        const znext = Math.min(maxIdx, zint + 1);
        const dx1 = Math.max(0.0, Math.min(1.0, x - xint));
        const dz1 = Math.max(0.0, Math.min(1.0, z - zint));
        const dx2 = 1.0 - dx1;
        const dz2 = 1.0 - dz1;
        const q11 = this.getHeightFromOffset(zint, xint);
        const q12 = this.getHeightFromOffset(zint, xnext);
        const q21 = this.getHeightFromOffset(znext, xint);
        const q22 = this.getHeightFromOffset(znext, xnext);

        return dx2 * q11 * dz2 + dx1 * q12 * dz2 + dx2 * q21 * dz1 + dx1 * q22 * dz1;
    }


}


$(() => {
    heightmap = new Heightmap();
});