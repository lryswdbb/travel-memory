/* ============ 照片 GPS 读取（纯前端，无依赖） ============
 * 目的：照片是按「地图当前停在哪一层」归档的，位置点错就整批存进错误地点
 *      （用户遇到过：多个地方的照片全进了青岛）。iPhone/安卓照片通常带 GPS，
 *      读出来就能自动归到正确地点。
 *
 * 只解析 JPEG 的 APP1/Exif 段里的 GPS IFD。不做完整 EXIF 解析，够用即可。
 * 返回 { lat, lng } 或 null。
 */
(function () {
  'use strict';

  // 从 Uint8Array 读 TIFF 里的一个值
  function readValue(dv, tiffStart, entryOffset, tiffLittle, type, count, valueOffsetPos) {
    const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const size = (SIZES[type] || 1) * count;
    let dataPos = entryOffset + 8;
    if (size > 4) {
      dataPos = tiffStart + dv.getUint32(entryOffset + 8, tiffLittle);
    }
    const vals = [];
    for (let i = 0; i < count; i++) {
      if (type === 3) vals.push(dv.getUint16(dataPos + i * 2, tiffLittle));
      else if (type === 4) vals.push(dv.getUint32(dataPos + i * 4, tiffLittle));
      else if (type === 5) {
        const num = dv.getUint32(dataPos + i * 8, tiffLittle);
        const den = dv.getUint32(dataPos + i * 8 + 4, tiffLittle);
        vals.push(den ? num / den : 0);
      } else if (type === 9) vals.push(dv.getInt32(dataPos + i * 4, tiffLittle));
      else vals.push(dv.getUint8(dataPos + i));
    }
    return vals;
  }

  // 寻找并解析 EXIF 的 GPS IFD
  function parseExifGps(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null;   // 不是 JPEG

    // 遍历标记段，找 APP1 里的 Exif
    let p = 2;
    let exifStart = -1;
    while (p + 4 <= dv.byteLength) {
      if (dv.getUint8(p) !== 0xFF) { p++; continue; }
      const marker = dv.getUint8(p + 1);
      if (marker === 0xDA || marker === 0xD9) break;        // 进入图像数据，收工
      if (marker === 0x00 || marker === 0xFF) { p++; continue; }
      const len = dv.getUint16(p + 2);
      if (marker === 0xE1) {
        // "Exif\0\0"
        if (dv.getUint32(p + 4) === 0x45786966 && dv.getUint16(p + 8) === 0x0000) {
          exifStart = p + 10;
          break;
        }
      }
      p += 2 + len;
    }
    if (exifStart < 0) return null;

    const tiff = exifStart;
    if (tiff + 8 > dv.byteLength) return null;
    const bom = dv.getUint16(tiff);
    let little;
    if (bom === 0x4949) little = true;         // "II"
    else if (bom === 0x4D4D) little = false;   // "MM"
    else return null;

    const ifd0 = tiff + dv.getUint32(tiff + 4, little);
    if (ifd0 + 2 > dv.byteLength) return null;
    const n0 = dv.getUint16(ifd0, little);

    // 在 IFD0 里找 GPS IFD 指针（tag 0x8825）
    let gpsIfd = -1;
    for (let i = 0; i < n0; i++) {
      const e = ifd0 + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      if (dv.getUint16(e, little) === 0x8825) {
        gpsIfd = tiff + dv.getUint32(e + 8, little);
        break;
      }
    }
    if (gpsIfd < 0 || gpsIfd + 2 > dv.byteLength) return null;

    const ng = dv.getUint16(gpsIfd, little);
    let lat = null, lng = null, latRef = '', lngRef = '';
    for (let i = 0; i < ng; i++) {
      const e = gpsIfd + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      const tag = dv.getUint16(e, little);
      const type = dv.getUint16(e + 2, little);
      const count = dv.getUint32(e + 4, little);
      if (tag === 1) {
        const v = readValue(dv, tiff, e, little, type, count);
        latRef = String.fromCharCode(v[0] || 0);
      } else if (tag === 2) {
        const v = readValue(dv, tiff, e, little, type, count);
        if (v.length >= 3) lat = v[0] + v[1] / 60 + v[2] / 3600;
      } else if (tag === 3) {
        const v = readValue(dv, tiff, e, little, type, count);
        lngRef = String.fromCharCode(v[0] || 0);
      } else if (tag === 4) {
        const v = readValue(dv, tiff, e, little, type, count);
        if (v.length >= 3) lng = v[0] + v[1] / 60 + v[2] / 3600;
      }
    }
    if (lat == null || lng == null) return null;
    if (latRef === 'S') lat = -lat;
    if (lngRef === 'W') lng = -lng;
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    if (lat === 0 && lng === 0) return null;       // 无效坐标
    return { lat, lng };
  }

  // 从 File/Blob 读取（只读文件头部 256KB，足够覆盖 EXIF）
  async function readGps(blob) {
    try {
      const head = blob.slice(0, 256 * 1024);
      const buf = await head.arrayBuffer();
      return parseExifGps(new Uint8Array(buf));
    } catch (e) {
      console.warn('读取 GPS 失败：', e);
      return null;
    }
  }

  window.EXIF = { readGps, __parse: parseExifGps };
})();
