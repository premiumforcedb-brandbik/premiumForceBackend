/**
 * utils/fileUtils.js
 *
 * Shared file validation helpers for S3-uploaded assets.
 * Used across booking and hourly-booking creation/update routes.
 */

const { deleteFromS3 } = require('../config/s3config');

// ── Audio constants ────────────────────────────────────────────────────────────

const ALLOWED_AUDIO_MIME = new Set([
  'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/x-wav',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/aac', 'audio/ogg', 'audio/webm', 'audio/flac'
]);

const ALLOWED_AUDIO_EXT = new Set([
  'mp3', 'wav', 'mp4', 'm4a', 'aac', 'ogg', 'webm', 'flac', 'mpeg'
]);

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deletes one or more S3 objects silently (errors are logged, not thrown).
 * Accepts a list of S3 file objects (each must have a `.key` property).
 *
 * @param {...object} files - S3 file objects e.g. req.files.carimage[0]
 */
async function cleanupS3Files(...files) {
  await Promise.all(
    files
      .filter(Boolean)
      .map(f => deleteFromS3(f.key).catch(err => console.error('[S3 Cleanup]', err.message)))
  );
}

/**
 * Validates an uploaded audio file for size and format.
 * Returns null if valid, or an error object { status, body } if not.
 *
 * Usage:
 *   const audioError = validateAudioFile(req.files?.specialRequestAudio?.[0]);
 *   if (audioError) {
 *     await cleanupS3Files(...filesToClean);
 *     return res.status(audioError.status).json(audioError.body);
 *   }
 *
 * @param {object|undefined} file - The uploaded file from multer/S3
 * @returns {{ status: number, body: object }|null}
 */
function validateAudioFile(file) {
  if (!file) return null;

  if (file.size > MAX_AUDIO_BYTES) {
    return {
      status: 400,
      body: {
        success: false,
        message: `Audio file exceeds 10MB limit (received ${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        field: 'specialRequestAudio'
      }
    };
  }

  const ext = file.originalname.split('.').pop().toLowerCase();
  if (!ALLOWED_AUDIO_MIME.has(file.mimetype) && !ALLOWED_AUDIO_EXT.has(ext)) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Unsupported audio format. Allowed: MP3, WAV, M4A, AAC, OGG, WebM, FLAC',
        field: 'specialRequestAudio'
      }
    };
  }

  return null;
}

module.exports = { validateAudioFile, cleanupS3Files };
