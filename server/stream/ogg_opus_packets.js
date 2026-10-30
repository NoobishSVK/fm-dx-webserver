'use strict';

// Extract complete Opus packets from Ogg pages. FFmpeg pipe chunks do not
// correspond to either Ogg pages or codec packets.
class OggOpusPackets {
    constructor() {
        this.buffer = Buffer.alloc(0);
        this.packet = [];
        this.packetBytes = 0;
        this.sequence = null;
    }

    push(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const packets = [];
        while (this.buffer.length >= 27) {
            if (this.buffer.toString('ascii', 0, 4) !== 'OggS' || this.buffer[4] !== 0) {
                throw new Error('Invalid Ogg page header');
            }
            const count = this.buffer[26];
            if (this.buffer.length < 27 + count) break;
            const segments = this.buffer.subarray(27, 27 + count);
            let payloadLength = 0;
            for (const length of segments) payloadLength += length;
            const pageLength = 27 + count + payloadLength;
            if (this.buffer.length < pageLength) break;
            const sequence = this.buffer.readUInt32LE(18);
            if (this.sequence !== null && sequence !== (this.sequence + 1) >>> 0) throw new Error('Missing Ogg page');
            this.sequence = sequence;
            const continued = (this.buffer[5] & 1) !== 0;
            if (continued !== (this.packet.length > 0)) throw new Error('Unexpected Ogg packet continuation');
            let offset = 27 + count;
            for (const length of segments) {
                this.packet.push(Buffer.from(this.buffer.subarray(offset, offset + length)));
                this.packetBytes += length;
                if (this.packetBytes > 1024 * 1024) throw new Error('Ogg packet exceeds size limit');
                offset += length;
                if (length < 255) {
                    const packet = Buffer.concat(this.packet, this.packetBytes);
                    this.packet = [];
                    this.packetBytes = 0;
                    if (!packet.subarray(0, 8).equals(Buffer.from('OpusHead')) && !packet.subarray(0, 8).equals(Buffer.from('OpusTags'))) packets.push(packet);
                }
            }
            this.buffer = this.buffer.subarray(pageLength);
        }
        return packets;
    }
}

module.exports = { OggOpusPackets };
