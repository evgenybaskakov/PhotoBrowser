const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cors = require('cors');
const sharp = require('sharp');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    thumbnail: true,
    sharp: typeof sharp === 'function' || typeof sharp === 'object'
  });
});

/** Browsing root: `PHOTO_DIR` or `$HOME` (same as the rest of the API). */
function getPhotoDir() {
  return process.env.PHOTO_DIR || process.env.HOME;
}

app.get('/api/config', (req, res) => {
  const root = getPhotoDir();
  if (!root) {
    return res.status(500).json({ error: 'Set PHOTO_DIR or HOME environment variable' });
  }
  res.json({ rootPath: path.normalize(root) });
});

// Image extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

// Simple in-memory thumbnail cache (bounded).
const THUMB_CACHE_MAX_ITEMS = 300;
/** @type {Map<string, {buf: Buffer, contentType: string, mtimeMs: number, size: number}>} */
const thumbCache = new Map();

function cacheGet(key) {
  const v = thumbCache.get(key);
  if (!v) return null;
  // refresh LRU order
  thumbCache.delete(key);
  thumbCache.set(key, v);
  return v;
}

function cacheSet(key, value) {
  if (thumbCache.has(key)) thumbCache.delete(key);
  thumbCache.set(key, value);
  while (thumbCache.size > THUMB_CACHE_MAX_ITEMS) {
    const oldestKey = thumbCache.keys().next().value;
    thumbCache.delete(oldestKey);
  }
}

/**
 * Get directory structure and images
 * GET /api/files?dir=/path/to/directory
 */
app.get('/api/files', (req, res) => {
  try {
    let dirPath = req.query.dir || '/';
    
    // Security: prevent directory traversal attacks
    const photoDir = getPhotoDir();
    const fullPath = path.resolve(photoDir, dirPath);
    
    if (!fullPath.startsWith(photoDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const stats = fs.statSync(fullPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }

    const items = fs.readdirSync(fullPath);
    const folders = [];
    const images = [];

    items.forEach(item => {
      const itemPath = path.join(fullPath, item);
      const itemStats = fs.statSync(itemPath);
      const relativePath = path.relative(photoDir, itemPath);

      if (itemStats.isDirectory()) {
        folders.push({
          name: item,
          path: relativePath,
          isDirectory: true
        });
      } else if (IMAGE_EXTENSIONS.includes(path.extname(item).toLowerCase())) {
        images.push({
          name: item,
          path: relativePath,
          isDirectory: false,
          size: itemStats.size
        });
      }
    });

    // Sort folders and images alphabetically
    folders.sort((a, b) => a.name.localeCompare(b.name));
    images.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      currentPath: dirPath,
      folders,
      images
    });
  } catch (error) {
    console.error('Error reading directory:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get image file
 * GET /api/image?path=/path/to/image.jpg
 */
app.get('/api/image', (req, res) => {
  try {
    const imagePath = req.query.path;
    const photoDir = getPhotoDir();
    const fullPath = path.resolve(photoDir, imagePath);

    // Security: prevent directory traversal
    if (!fullPath.startsWith(photoDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.sendFile(fullPath);
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get thumbnail image (resized + cached)
 * GET /api/thumbnail?path=/path/to/image.jpg&size=300
 */
app.get('/api/thumbnail', async (req, res) => {
  try {
    const imagePath = req.query.path;
    const requestedSize = Number(req.query.size || 300);
    const size = Number.isFinite(requestedSize) ? Math.max(48, Math.min(800, Math.floor(requestedSize))) : 300;

    const photoDir = getPhotoDir();
    const fullPath = path.resolve(photoDir, imagePath);

    // Security: prevent directory traversal
    if (!fullPath.startsWith(photoDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(fullPath).toLowerCase();
    const stat = fs.statSync(fullPath);
    const cacheKey = `${fullPath}|${stat.mtimeMs}|${size}|inside`;

    // If unsupported for resizing, fall back to original file.
    if (ext === '.svg') {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(fullPath);
    }

    const cached = cacheGet(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(cached.buf);
    }

    // Generate a small thumbnail (preserves aspect ratio within a size×size box).
    const pipeline = sharp(fullPath, { limitInputPixels: false })
      .rotate()
      .resize(size, size, { fit: 'inside' })
      .jpeg({ quality: 72, mozjpeg: true });

    const buf = await pipeline.toBuffer();
    const value = { buf, contentType: 'image/jpeg', mtimeMs: stat.mtimeMs, size };
    cacheSet(cacheKey, value);

    res.setHeader('Content-Type', value.contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (error) {
    console.error('Error serving thumbnail:', error);
    res.status(500).json({ error: error.message });
  }
});

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function uniqueTrashDestination(trashFilesDir, basename) {
  let destPath = path.join(trashFilesDir, basename);
  if (!fs.existsSync(destPath)) {
    return destPath;
  }

  const ext = path.extname(basename);
  const stem = path.basename(basename, ext);
  let counter = 1;
  while (fs.existsSync(destPath)) {
    destPath = path.join(trashFilesDir, `${stem}_${counter}${ext}`);
    counter += 1;
  }
  return destPath;
}

/** Resolved browsing root for path security checks. */
function getResolvedPhotoDir() {
  return path.resolve(getPhotoDir() || '');
}

/** True when `targetPath` is the photo root or a path inside it. */
function isPathInsidePhotoDir(targetPath, photoDir) {
  if (targetPath === photoDir) return true;
  return targetPath.startsWith(photoDir + path.sep);
}

/**
 * Move a file or directory to the system trash / recycle bin.
 */
async function moveToTrash(fullPath) {
  const platform = process.platform;

  if (platform === 'darwin') {
    // Use FileManager.trashItem (not Finder AppleScript) so paths with spaces
    // and non-ASCII names are handled reliably.
    const swift = [
      'import Foundation',
      'let url = URL(fileURLWithPath: CommandLine.arguments[1])',
      'do {',
      '  try FileManager.default.trashItem(at: url, resultingItemURL: nil)',
      '} catch {',
      '  fputs(error.localizedDescription + "\\n", stderr)',
      '  exit(1)',
      '}'
    ].join('\n');
    await execFileAsync('swift', ['-e', swift, fullPath]);
    return;
  }

  if (platform === 'win32') {
    const stats = fs.statSync(fullPath);
    const escaped = escapePowerShellSingleQuoted(fullPath);
    const command = stats.isDirectory()
      ? `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escaped}','OnlyErrorDialog','SendToRecycleBin')`
      : `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}','OnlyErrorDialog','SendToRecycleBin')`;
    await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName Microsoft.VisualBasic; ${command}`
    ]);
    return;
  }

  const trashFilesDir = path.join(os.homedir(), '.local/share/Trash/files');
  const trashInfoDir = path.join(os.homedir(), '.local/share/Trash/info');
  fs.mkdirSync(trashFilesDir, { recursive: true });
  fs.mkdirSync(trashInfoDir, { recursive: true });

  const basename = path.basename(fullPath);
  const destPath = uniqueTrashDestination(trashFilesDir, basename);
  const infoPath = path.join(trashInfoDir, `${path.basename(destPath)}.trashinfo`);
  const deletionDate = new Date().toISOString().slice(0, 19);
  const trashInfo = `[Trash Info]\nPath=${encodeURIComponent(fullPath)}\nDeletionDate=${deletionDate}\n`;

  fs.renameSync(fullPath, destPath);
  fs.writeFileSync(infoPath, trashInfo);
}

function clearThumbnailCacheForPath(fullPath) {
  for (const key of thumbCache.keys()) {
    if (key.startsWith(`${fullPath}|`) || key.startsWith(`${fullPath}${path.sep}`)) {
      thumbCache.delete(key);
    }
  }
}

/**
 * Move file to trash
 * DELETE /api/file?path=/path/to/file
 */
app.delete('/api/file', async (req, res) => {
  try {
    const filePath = req.query.path;
    const photoDir = getResolvedPhotoDir();
    const fullPath = path.resolve(photoDir, filePath);

    // Security: prevent directory traversal
    if (!isPathInsidePhotoDir(fullPath, photoDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Not a file' });
    }

    await moveToTrash(fullPath);
    clearThumbnailCacheForPath(fullPath);
    res.json({ success: true, message: 'File moved to trash' });
  } catch (error) {
    console.error('Error moving file to trash:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Move directory to trash
 * DELETE /api/directory?path=/path/to/folder
 */
app.delete('/api/directory', async (req, res) => {
  try {
    const dirPath = req.query.path;
    const photoDir = getResolvedPhotoDir();
    const fullPath = path.resolve(photoDir, dirPath);

    // Security: prevent directory traversal
    if (!isPathInsidePhotoDir(fullPath, photoDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const stats = fs.statSync(fullPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }

    await moveToTrash(fullPath);
    clearThumbnailCacheForPath(fullPath);
    res.json({ success: true, message: 'Directory moved to trash' });
  } catch (error) {
    console.error('Error moving directory to trash:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Open item in system file manager
 * POST /api/reveal
 * body: { path: "/relative/path", isDirectory: boolean }
 */
app.post('/api/reveal', (req, res) => {
  try {
    const itemPath = req.body?.path;
    const isDirectory = Boolean(req.body?.isDirectory);
    if (!itemPath || typeof itemPath !== 'string') {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const photoDir = getPhotoDir();
    const fullPath = path.resolve(photoDir, itemPath);

    // Security: prevent directory traversal
    if (!fullPath.startsWith(photoDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const stats = fs.statSync(fullPath);
    if (isDirectory && !stats.isDirectory()) {
      return res.status(400).json({ error: 'Expected a directory path' });
    }
    if (!isDirectory && !stats.isFile()) {
      return res.status(400).json({ error: 'Expected a file path' });
    }

    const platform = process.platform;
    let command = '';
    let args = [];

    if (platform === 'darwin') {
      // -R reveals the item in its parent (selected for folders, not opened)
      command = 'open';
      args = ['-R', fullPath];
    } else if (platform === 'win32') {
      command = 'explorer';
      args = [`/select,${fullPath}`];
    } else if (isDirectory) {
      // GNOME Files: select folder in parent; fallback opens parent only
      command = 'nautilus';
      args = ['--select', fullPath];
    } else {
      command = 'xdg-open';
      args = [path.dirname(fullPath)];
    }

    execFile(command, args, (error) => {
      if (error) {
        console.error('Error opening file manager:', error);
        return res.status(500).json({ error: 'Failed to open in file manager' });
      }
      res.json({ success: true });
    });
  } catch (error) {
    console.error('Error revealing path:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Photo Browser running at http://localhost:${PORT}`);
  console.log(`Set $PHOTO_DIR environment variable to specify the photo directory; will use $HOME by default`);
});
