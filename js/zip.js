/* Momentjes — minimale ZIP lezer/schrijver (alleen 'store', geen compressie).
   Genoeg voor backups: manifest.json + audiobestanden. Compatibel met
   standaard zip-tools (Finder, Python zipfile, etc.). */

const MiniZip = (() => {

  // ---- CRC32 ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const te = new TextEncoder();
  const td = new TextDecoder();

  function dosDateTime(date = new Date()) {
    const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xFFFF;
    const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
    return { time, day };
  }

  /* entries: [{ name: 'audio/x.m4a', data: Uint8Array }] → Blob */
  function write(entries) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const { time, day } = dosDateTime();

    for (const e of entries) {
      const nameBytes = te.encode(e.name);
      const data = e.data;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);          // version needed
      local.setUint16(6, 0x0800, true);      // UTF-8 flag
      local.setUint16(8, 0, true);           // store
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);

      chunks.push(new Uint8Array(local.buffer), nameBytes, data);
      central.push({ nameBytes, crc, size: data.length, offset });
      offset += 30 + nameBytes.length + data.length;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) {
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, day, true);
      cd.setUint32(16, c.crc, true);
      cd.setUint32(20, c.size, true);
      cd.setUint32(24, c.size, true);
      cd.setUint16(28, c.nameBytes.length, true);
      cd.setUint32(42, c.offset, true);
      chunks.push(new Uint8Array(cd.buffer), c.nameBytes);
      centralSize += 46 + c.nameBytes.length;
    }

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, central.length, true);
    end.setUint16(10, central.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralStart, true);
    chunks.push(new Uint8Array(end.buffer));

    return new Blob(chunks, { type: 'application/zip' });
  }

  /* ArrayBuffer → { 'name': Uint8Array, ... }
     Leest ook gecomprimeerde (deflate) zips via DecompressionStream. */
  async function read(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    // Zoek End Of Central Directory (vanaf achteren)
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Geen geldig zip-bestand');

    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const files = {};

    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Zip-index beschadigd');
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));

      // Local header bepaalt waar de data echt begint
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(dataStart, dataStart + compSize);

      if (!name.endsWith('/')) {
        if (method === 0) {
          files[name] = raw;
        } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
          const ds = new DecompressionStream('deflate-raw');
          const stream = new Blob([raw]).stream().pipeThrough(ds);
          files[name] = new Uint8Array(await new Response(stream).arrayBuffer());
        } else {
          throw new Error('Zip-compressie niet ondersteund op dit toestel');
        }
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  return { write, read, crc32 };
})();
