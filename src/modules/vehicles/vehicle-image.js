import multer from 'multer';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sendError } from '../../middleware/errors.js';

const prefix = '/uploads/vehicles/';
function imageExtension(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { return 'png'; }
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) { return 'jpg'; }
  if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) { return 'gif'; }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') { return 'webp'; }
  return null;
}

export function vehicleImageHandlers({ vehicleStore, vehicleUploadDir, logger = console }) {
  const directory = resolve(vehicleUploadDir);
  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 } }).single('image');
  const removeFile = async imageUrl => {
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith(prefix)) { return; }
    const filename = imageUrl.slice(prefix.length);
    if (!/^[0-9a-f-]{36}\.(jpg|png|gif|webp)$/.test(filename)) { return; }
    try { await unlink(resolve(directory, filename)); }
    catch (err) { if (err.code !== 'ENOENT') { throw err; } }
  };
  return {
    checkVehicle: async (req, res, next) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1 || id > 2147483647 || !await vehicleStore.get(id)) {
        return sendError(req, res, 404, 'NOT_FOUND', 'Vehicle not found.');
      }
      req.vehicleId = id;
      next();
    },
    upload: (req, res, next) => parse(req, res, err => {
      if (!err) { return next(); }
      if (err.code === 'LIMIT_FILE_SIZE') { return sendError(req, res, 413, 'PAYLOAD_TOO_LARGE', 'Image must be at most 5 MB.'); }
      return sendError(req, res, 400, 'INVALID_UPLOAD', 'Send one image file using the image field.');
    }),
    save: async (req, res) => {
      const extension = req.file && imageExtension(req.file.buffer);
      if (!extension) { return sendError(req, res, 400, 'INVALID_IMAGE', 'Send a JPEG, PNG, GIF or WebP image using the image field.'); }
      await mkdir(directory, { recursive: true });
      const imageUrl = prefix + randomUUID() + '.' + extension;
      try {
        await writeFile(resolve(directory, imageUrl.slice(prefix.length)), req.file.buffer, { flag: 'wx', mode: 0o640 });
        const result = await vehicleStore.setVehicleImage(req.vehicleId, imageUrl);
        if (!result) {
          await removeFile(imageUrl);
          return sendError(req, res, 404, 'NOT_FOUND', 'Vehicle not found.');
        }
        // The database now points at the replacement; cleanup cannot undo the save.
        try { await removeFile(result.previousImageUrl); }
        catch (err) { logger.error(JSON.stringify({ event: 'vehicle_image_cleanup_failed', code: err.code })); }
        return res.json({ vehicle: result.vehicle });
      } catch (err) {
        await removeFile(imageUrl);
        throw err;
      }
    },
    remove: async (req, res) => {
      const result = await vehicleStore.setVehicleImage(req.vehicleId, null, removeFile);
      if (!result) { return sendError(req, res, 404, 'NOT_FOUND', 'Vehicle not found.'); }
      return res.json({ vehicle: result.vehicle });
    },
  };
}
