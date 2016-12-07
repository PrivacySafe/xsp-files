/* Copyright(c) 2015 - 2016 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";
/**
 * This file contains code for working with file headers and (un)packing
 * file segments.
 * Exported classes should be used inside xsp library, and must be wrapped,
 * if such functionality is needed externally.
 */
const ecma_nacl_1 = require("ecma-nacl");
/**
 * @param x
 * @param i
 * @return unsigned 16-bit integer (2 bytes), stored littleendian way in x,
 * starting at index i.
 */
function loadUintFrom2Bytes(x, i) {
    return (x[i] << 8) | x[i + 1];
}
/**
 * @param x
 * @param i
 * @param u is an unsigned 16-bit integer (2 bytes) to be stored littleendian
 * way in x, starting at index i.
 */
function storeUintIn2Bytes(x, i, u) {
    x[i] = u >>> 8;
    x[i + 1] = u;
}
/**
 * @param x
 * @param i
 * @return unsigned 32-bit integer (4 bytes), stored littleendian way in x,
 * starting at index i.
 */
function loadUintFrom4Bytes(x, i) {
    return (x[i] << 24) | (x[i + 1] << 16) | (x[i + 2] << 8) | x[i + 3];
}
/**
 * @param x
 * @param i
 * @param u is an unsigned 32-bit integer (4 bytes) to be stored littleendian
 * way in x, starting at index i.
 */
function storeUintIn4Bytes(x, i, u) {
    x[i] = u >>> 24;
    x[i + 1] = u >>> 16;
    x[i + 2] = u >>> 8;
    x[i + 3] = u;
}
/**
 * @param x
 * @param i
 * @return unsigned 40-bit integer (5 bytes), stored littleendian way in x,
 * starting at index i.
 */
function loadUintFrom5Bytes(x, i) {
    var int = (x[i + 1] << 24) | (x[i + 2] << 16) | (x[i + 3] << 8) | x[i + 4];
    int += 0x100000000 * x[i];
    return int;
}
/**
 * @param x
 * @param i
 * @param u is an unsigned 40-bit integer (5 bytes) to be stored littleendian
 * way in x, starting at index i.
 */
function storeUintIn5Bytes(x, i, u) {
    x[i] = (u / 0x100000000) | 0;
    x[i + 1] = u >>> 24;
    x[i + 2] = u >>> 16;
    x[i + 3] = u >>> 8;
    x[i + 4] = u;
}
class SegInfoHolder {
    /**
     * Use this methods in inheriting classes.
     * @param header is a 65 bytes of a with-nonce pack, containing
     * 1) 1 byte, indicating segment size in 256byte chuncks, and
     * 2) 24 bytes of the first segment's nonce.
     * @param key is this file's key
     * @param arrFactory
     */
    initForEndlessFile(header, key, arrFactory) {
        header = ecma_nacl_1.secret_box.formatWN.open(header, key, arrFactory);
        this.totalSegsLen = undefined;
        this.totalContentLen = undefined;
        this.totalNumOfSegments = undefined;
        this.segSize = (header[0] << 8);
        this.segChains = [{
                numOfSegs: undefined,
                lastSegSize: undefined,
                nonce: new Uint8Array(header.subarray(1, 25))
            }];
        arrFactory.wipe(header);
    }
    /**
     * Use this methods in inheriting classes.
     * @param header is 46+n*30 bytes with-nonce pack, containing
     * 1) 5 bytes with total segments' length,
     * 2) 1 byte, indicating segment size in 256byte chuncks
     * 3) n 30-bytes chunks for each segments chain (n===0 for an empty file):
     * 3.1) 4 bytes with number of segments in this chain,
     * 3.2) 2 bytes with this chain's last segments size,
     * 3.3) 24 bytes with the first nonce in this chain.
     * @param key is this file's key
     * @param arrFactory
     */
    initForFiniteFile(header, key, arrFactory) {
        header = ecma_nacl_1.secret_box.formatWN.open(header, key, arrFactory);
        this.totalSegsLen = loadUintFrom5Bytes(header, 0);
        this.segSize = (header[5] << 8);
        if (this.segSize === 0) {
            throw new Error("Given header is malformed: default segment size is zero");
        }
        // empty file
        if (this.totalSegsLen === 0) {
            this.segChains = [];
            this.totalContentLen = 0;
            this.totalNumOfSegments = 0;
            return;
        }
        // non-empty file
        this.segChains = new Array((header.length - 6) / 30);
        var segChain;
        this.totalContentLen = 0;
        this.totalNumOfSegments = 0;
        var isHeaderOK = 1; // 1 for OK, and 0 for not-OK
        var offset = 6;
        for (var i = 0; i < this.segChains.length; i += 1) {
            offset += i * 30;
            segChain = {
                numOfSegs: loadUintFrom4Bytes(header, offset),
                lastSegSize: loadUintFrom2Bytes(header, offset + 4),
                nonce: new Uint8Array(header.subarray(offset + 6, offset + 30))
            };
            this.segChains[i] = segChain;
            // collect totals
            this.totalContentLen += segChain.lastSegSize +
                this.segSize * (segChain.numOfSegs - 1) -
                16 * segChain.numOfSegs;
            this.totalNumOfSegments += segChain.numOfSegs;
            // check consistency of segments' length information
            isHeaderOK *= ((segChain.numOfSegs < 1) ? 0 : 1) *
                ((segChain.lastSegSize < 17) ? 0 : 1) *
                ((segChain.lastSegSize > this.segSize) ? 0 : 1);
        }
        arrFactory.wipe(header);
        // check consistency of totals
        isHeaderOK *= ((this.totalSegsLen ===
            ((this.totalContentLen + 16 * this.totalNumOfSegments))) ? 1 : 0);
        if (isHeaderOK === 0) {
            throw new Error("Given header is malformed.");
        }
    }
    isEndlessFile() {
        return (this.totalNumOfSegments === undefined);
    }
    contentLength() {
        return this.totalContentLen;
    }
    setContentLength(totalContentLen) {
        if (!this.isEndlessFile()) {
            throw new Error("Cannot set an end to an already finite file.");
        }
        if (totalContentLen < 0) {
            throw new Error("File length is out of bounds.");
        }
        if (totalContentLen === 0) {
            this.totalContentLen = 0;
            this.totalNumOfSegments = 0;
            this.totalSegsLen = 0;
            this.segChains = [];
        }
        else {
            var numOfSegs = Math.floor(totalContentLen / (this.segSize - 16));
            if (numOfSegs * (this.segSize - 16) != totalContentLen) {
                numOfSegs += 1;
            }
            var totalSegsLen = totalContentLen + 16 * numOfSegs;
            if (totalSegsLen > 0xffffffffff) {
                throw new Error("Content length is out of bounds.");
            }
            this.totalContentLen = totalContentLen;
            this.totalNumOfSegments = numOfSegs;
            this.totalSegsLen = totalSegsLen;
            var segChain = this.segChains[0];
            segChain.numOfSegs = this.totalNumOfSegments;
            segChain.lastSegSize = this.totalSegsLen -
                (this.totalNumOfSegments - 1) * this.segSize;
        }
    }
    /**
     * @param pos is byte's position index in file content.
     * @return corresponding location in segment with segment's info.
     */
    locationInSegments(pos) {
        if (pos < 0) {
            throw new Error("Given position is out of bounds.");
        }
        var contentSegSize = this.segSize - 16;
        var segInd;
        if (this.isEndlessFile()) {
            segInd = Math.floor(pos / contentSegSize);
            return {
                seg: {
                    ind: segInd,
                    start: (segInd * this.segSize),
                    len: this.segSize
                },
                pos: (pos - segInd * contentSegSize)
            };
        }
        if (pos >= this.totalContentLen) {
            throw new Error("Given position is out of bounds.");
        }
        segInd = 0;
        var segStart = 0;
        var contentOffset = 0;
        var segChain;
        var chainLen;
        for (var i = 0; i < this.segChains.length; i += 1) {
            segChain = this.segChains[i];
            chainLen = segChain.lastSegSize +
                (segChain.numOfSegs - 1) * this.segSize;
            contentOffset += chainLen - 16 * segChain.numOfSegs;
            if (contentOffset <= pos) {
                segInd += segChain.numOfSegs;
                segStart += chainLen;
                continue;
            }
            // @ this point contentOffset > pos
            contentOffset -= segChain.lastSegSize - 16;
            if (contentOffset <= pos) {
                return {
                    pos: (pos - contentOffset),
                    seg: {
                        ind: (segInd + segChain.numOfSegs - 1),
                        start: (chainLen - segChain.lastSegSize),
                        len: segChain.lastSegSize
                    }
                };
            }
            contentOffset -= (segChain.numOfSegs - 1) * (this.segSize - 16);
            var dSegInd = Math.floor((pos - contentOffset) / contentSegSize);
            contentOffset += dSegInd * (this.segSize - 16);
            return {
                pos: (pos - contentOffset),
                seg: {
                    ind: (segInd + dSegInd),
                    start: (segStart + dSegInd * this.segSize),
                    len: this.segSize
                }
            };
        }
        throw new Error("If we get here, there is an error in the loop above.");
    }
    packInfoToBytes() {
        var head;
        if (this.isEndlessFile()) {
            head = new Uint8Array(24 + 1);
            // 1) pack segment common size in 256 chunks
            head[0] = this.segSize >>> 8;
            // 2) 24 bytes with the first segment's nonce
            head.set(this.segChains[0].nonce, 1);
        }
        else {
            head = new Uint8Array(6 + 30 * this.segChains.length);
            // 1) pack total segments length
            storeUintIn5Bytes(head, 0, this.totalSegsLen);
            // 2) pack segment common size in 256 chunks
            head[5] = this.segSize >>> 8;
            // 3) pack info about chained segments
            var segChain;
            var offset = 6;
            for (var i = 0; i < this.segChains.length; i += 1) {
                segChain = this.segChains[i];
                // 3.1) 4 bytes with number of segments in this chain
                storeUintIn4Bytes(head, offset, segChain.numOfSegs);
                // 3.2) 2 bytes with this chain's last segments size
                storeUintIn2Bytes(head, offset + 4, segChain.lastSegSize);
                // 3.3) 24 bytes with the first nonce in this chain
                head.set(segChain.nonce, offset + 6);
                // add an offset
                offset += 30;
            }
        }
        return head;
    }
    /**
     * @param segInd
     * @return segment's nonce, recyclable after its use.
     */
    getSegmentNonce(segInd, arrFactory) {
        if (this.isEndlessFile()) {
            if (segInd > 0xffffffff) {
                throw new Error("Given segment index is out of bounds.");
            }
            return ecma_nacl_1.nonce.calculateNonce(this.segChains[0].nonce, segInd, arrFactory);
        }
        if ((segInd >= this.totalNumOfSegments) ||
            (segInd < 0)) {
            throw new Error("Given segment index is out of bounds.");
        }
        var segChain;
        var lastSegInd = 0;
        for (var i = 0; i < this.segChains.length; i += 1) {
            segChain = this.segChains[i];
            if ((lastSegInd + segChain.numOfSegs) <= segInd) {
                lastSegInd += segChain.numOfSegs;
                continue;
            }
            else {
                return ecma_nacl_1.nonce.calculateNonce(segChain.nonce, (segInd - lastSegInd), arrFactory);
            }
        }
        throw new Error("If we get here, there is an error in the loop above.");
    }
    numberOfSegments() {
        return this.totalNumOfSegments;
    }
    segmentSize(segInd) {
        if (typeof segInd !== 'number') {
            throw new TypeError(`Given segment index is not a number, it is ${segInd}`);
        }
        if (this.isEndlessFile()) {
            if (segInd > 0xffffffff) {
                throw new Error("Given segment index is out of bounds.");
            }
            return this.segSize;
        }
        if ((segInd >= this.totalNumOfSegments) ||
            (segInd < 0)) {
            throw new Error("Given segment index is out of bounds.");
        }
        var segChain;
        var lastSegInd = 0;
        for (var i = 0; i < this.segChains.length; i += 1) {
            segChain = this.segChains[i];
            if ((lastSegInd + segChain.numOfSegs) <= segInd) {
                lastSegInd += segChain.numOfSegs;
                continue;
            }
            return (((lastSegInd + segChain.numOfSegs - 1) === segInd) ?
                segChain.lastSegSize : this.segSize);
        }
        throw new Error("If we get here, there is an error in the loop above.");
    }
    segmentsLength() {
        return this.totalSegsLen;
    }
}
exports.SegInfoHolder = SegInfoHolder;
Object.freeze(SegInfoHolder.prototype);
Object.freeze(SegInfoHolder);
Object.freeze(exports);
