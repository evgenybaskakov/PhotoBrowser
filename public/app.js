// State management — set from server, see `/api/config`
let rootPath = '';

let currentPath = null;
let itemToDelete = null;
let pendingThumbnailRefreshPath = null;
let staleHoverCleanup = null;
let staleHoverTimeoutId = null;

// DOM Elements
const foldersList = document.getElementById('foldersList');
const imagesList = document.getElementById('imagesList');
const breadcrumbPath = document.getElementById('breadcrumbPath');
const deleteModal = document.getElementById('deleteModal');
const confirmDeleteBtn = document.getElementById('confirmDelete');
const cancelDeleteBtn = document.getElementById('cancelDelete');
const deleteMessage = document.getElementById('deleteMessage');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await fetchRootPathFromServer();
    applyPathFromUrl();
    loadContent();
    setupEventListeners();
});

async function fetchRootPathFromServer() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('config request failed');
        const data = await response.json();
        if (typeof data.rootPath === 'string' && data.rootPath.length > 0) {
            rootPath = data.rootPath;
        }
    } catch (e) {
        console.error('Could not load /api/config:', e);
    }
}

function setupEventListeners() {
    confirmDeleteBtn.addEventListener('click', deleteItem);
    cancelDeleteBtn.addEventListener('click', closeDeleteModal);
    deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) closeDeleteModal();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            onReturnToPhotoBrowser();
        }
    });

    // Some browsers/apps do not always emit visibility or focus in a consistent order.
    window.addEventListener('focus', onReturnToPhotoBrowser);

    window.addEventListener('popstate', () => {
        applyPathFromUrl();
        loadContent();
    });
}

function onReturnToPhotoBrowser() {
    clearStaleHoverOverlays();
    refreshPendingThumbnail();
}

function clearStaleHoverOverlays() {
    if (staleHoverTimeoutId != null) {
        clearTimeout(staleHoverTimeoutId);
        staleHoverTimeoutId = null;
    }
    if (typeof staleHoverCleanup === 'function') {
        staleHoverCleanup();
        staleHoverCleanup = null;
    }

    document.body.classList.add('clear-stale-hover');

    const ae = document.activeElement;
    if (ae && ae !== document.body && typeof ae.blur === 'function') {
        ae.blur();
    }

    const finish = () => {
        document.body.classList.remove('clear-stale-hover');
        staleHoverCleanup = null;
        if (staleHoverTimeoutId != null) {
            clearTimeout(staleHoverTimeoutId);
            staleHoverTimeoutId = null;
        }
    };

    const onPointer = () => {
        document.removeEventListener('mousemove', onPointer);
        document.removeEventListener('pointerdown', onPointer, true);
        document.removeEventListener('touchstart', onPointer, true);
        finish();
    };

    document.addEventListener('mousemove', onPointer, { once: true });
    document.addEventListener('pointerdown', onPointer, { once: true, capture: true });
    document.addEventListener('touchstart', onPointer, { once: true, capture: true });

    staleHoverCleanup = () => {
        document.removeEventListener('mousemove', onPointer);
        document.removeEventListener('pointerdown', onPointer, true);
        document.removeEventListener('touchstart', onPointer, true);
        finish();
    };

    staleHoverTimeoutId = setTimeout(finish, 5000);
}

async function loadContent() {
    foldersList.innerHTML = '<div class="loading">Loading folders...</div>';
    imagesList.innerHTML = '<div class="loading">Loading images...</div>';

    try {
        if (!currentPath) {
            currentPath = rootPath;
        }
        console.log('Loading content for path:', currentPath);
        console.log('Loading content for path (encoded):', encodeURIComponent(currentPath));
        const response = await fetch(`/api/files?dir=${encodeURIComponent(currentPath)}`);
        if (!response.ok) {
            throw new Error('Failed to load content');
        }

        const data = await response.json();
        updateBreadcrumb();
        renderFolders(data.folders);
        renderImages(data.images);
    } catch (error) {
        console.error('Error loading content:', error);
        foldersList.innerHTML = '<div class="empty-message">Error loading folders</div>';
        imagesList.innerHTML = '<div class="empty-message">Error loading images</div>';
    }
}

function isSubpath(prefix, path) {
    const cleanPrefix = prefix.replace(/\/+$/, '');
    const cleanPath = path.replace(/\/+$/, '');
  
    if (cleanPath === cleanPrefix)
        return true;
    else
        return cleanPath.startsWith(cleanPrefix + '/');
}

function pathsEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const na = a.replace(/\/+$/, '') || '/';
    const nb = b.replace(/\/+$/, '') || '/';
    return na === nb;
}

function urlForPath(p) {
    const pathname = window.location.pathname || '/';
    if (pathsEqual(p, rootPath)) {
        return pathname;
    }
    return `${pathname}?dir=${encodeURIComponent(p)}`;
}

function applyPathFromUrl() {
    const dir = new URLSearchParams(window.location.search).get('dir');
    currentPath = dir ? dir : null;
}

function updateBreadcrumb() {
    const currentPathWithoutRoot = isSubpath(rootPath, currentPath) ?
        currentPath.slice(rootPath.length) : currentPath;
    const parts = [rootPath, ...currentPathWithoutRoot.split("/").filter(p => p)];
    const buttons = parts.map((part, index) => {
        const path = parts.slice(0, index + 1).join('/');
        return `<button class="breadcrumb-btn" onclick="navigateTo('${escapeForInlineHandlerArg(path)}')">${escapeHtml(part)}</button>`;
    }).join(' / ');

    breadcrumbPath.innerHTML = buttons ? buttons : '';
}

function navigateTo(path) {
    console.log('Navigating to:', path);
    currentPath = path;
    history.pushState(null, '', urlForPath(path));
    loadContent();
}

function renderFolders(folders) {
    const foldersSection = document.querySelector('.folders-section');

    if (folders.length === 0) {
        if (foldersSection) {
            foldersSection.style.display = 'none';
        }
    }
    else {
        if (foldersSection) {
            foldersSection.style.display = 'block';
        }

        foldersList.innerHTML = folders.map(folder => `
            <div class="folder-item" tabindex="0" onclick="navigateTo('${escapeForInlineHandlerArg(folder.path)}')">
                <div class="icon">📁</div>
                <div class="name" title="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</div>
                <div class="folder-delete-overlay item-actions">
                    <button class="btn btn-secondary btn-small" onclick="event.stopPropagation(); revealInFileManager('${escapeForInlineHandlerArg(folder.path)}', true)">Reveal</button>
                    <button class="btn btn-danger btn-small" onclick="event.stopPropagation(); confirmDeleteFolder('${escapeForInlineHandlerArg(folder.path)}', '${escapeForInlineHandlerArg(folder.name)}')">Delete</button>
                </div>
            </div>
        `).join('');
    }
}

function renderImages(images) {
    const imagesSection = document.querySelector('.images-section');

    if (images.length === 0) {
        if (imagesSection) {
            imagesSection.style.display = 'none';
        }
    }
    else {
        if (imagesSection) {
            imagesSection.style.display = 'block';
        }

        imagesList.innerHTML = images.map(image => `
            <div class="image-item is-loading" tabindex="0">
                <div class="image-thumb-frame">
                    <img class="image-thumbnail"
                        src="/api/thumbnail?path=${encodeURIComponent(image.path)}&size=320&fit=inside"
                        data-image-path="${escapeHtml(image.path)}"
                        alt="${escapeHtml(image.name)}"
                        onclick="openImageInNewTab('${escapeForInlineHandlerArg(image.path)}')"
                        loading="lazy"
                        decoding="async"
                        onload="handleThumbnailLoad(this)"
                        onerror="handleThumbnailError(this)">
                </div>
                <div class="image-delete-overlay item-actions">
                    <button class="btn btn-secondary btn-small"
                        onclick="event.stopPropagation(); revealInFileManager('${escapeForInlineHandlerArg(image.path)}', false)">
                        Reveal
                    </button>
                    <button class="btn btn-danger btn-small"
                        onclick="event.stopPropagation(); confirmDeleteImage('${escapeForInlineHandlerArg(image.path)}', '${escapeForInlineHandlerArg(image.name)}')">
                        Delete
                    </button>
                </div>
            </div>
        `).join('');

        // Some browsers won't fire `onload` reliably for already-cached images after DOM updates.
        // Also, `onload` can happen before decode/rasterization is finished, so we re-check.
        requestAnimationFrame(() => {
            const thumbs = imagesList.querySelectorAll('.image-thumbnail');
            thumbs.forEach((img) => {
                if (img.complete && img.naturalWidth > 0) {
                    handleThumbnailLoad(img);
                }
            });
        });
    }
}

function handleThumbnailLoad(imgEl) {
    const container = imgEl?.closest?.('.image-item');
    if (!container) return;

    const w = imgEl.naturalWidth;
    const h = imgEl.naturalHeight;
    if (w > 0 && h > 0) {
        container.style.setProperty('--thumb-ar', String(w / h));
        if (w < h) {
            container.dataset.thumbOrientation = 'portrait';
        } else if (w > h) {
            container.dataset.thumbOrientation = 'landscape';
        } else {
            container.dataset.thumbOrientation = 'square';
        }
    }

    // Keep placeholder visible until decoding is done to avoid white flashes.
    const finish = () => container.classList.remove('is-loading');
    if (typeof imgEl.decode === 'function') {
        imgEl.decode().then(finish).catch(finish);
    } else {
        finish();
    }
}

function handleThumbnailError(imgEl) {
    // Keep a non-empty thumbnail slot, even if the preview fails.
    imgEl.src = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22200%22%20height=%22200%22%3E%3Cdefs%3E%3ClinearGradient%20id=%22g%22%20x1=%220%22%20x2=%221%22%3E%3Cstop%20offset=%220%25%22%20stop-color=%22%23f3f4f6%22/%3E%3Cstop%20offset=%22100%25%22%20stop-color=%22%23e5e7eb%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20fill=%22url(%23g)%22%20width=%22200%22%20height=%22200%22/%3E%3Ctext%20x=%2250%25%22%20y=%2250%25%22%20text-anchor=%22middle%22%20dy=%22.35em%22%20font-family=%22system-ui,-apple-system,BlinkMacSystemFont,Segoe%20UI,Roboto%22%20font-size=%2216%22%20fill=%22%239ca3af%22%3EPreview%20unavailable%3C/text%3E%3C/svg%3E';
    const container = imgEl?.closest?.('.image-item');
    if (container) {
        container.style.setProperty('--thumb-ar', '1');
        container.dataset.thumbOrientation = 'square';
        container.classList.remove('is-loading');
    }
}

function openImageInNewTab(imagePath) {
    pendingThumbnailRefreshPath = imagePath;
    const imageUrl = `/api/image?path=${encodeURIComponent(imagePath)}`;
    window.open(imageUrl, '_blank', 'noopener,noreferrer');
}

async function revealInFileManager(itemPath, isDirectory) {
    try {
        if (!isDirectory) {
            pendingThumbnailRefreshPath = itemPath;
        }

        const response = await fetch('/api/reveal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: itemPath, isDirectory })
        });

        if (!response.ok) {
            throw new Error('Failed to open in file manager');
        }
    } catch (error) {
        console.error('Error opening in file manager:', error);
        alert('Error opening in file manager: ' + error.message);
    }
}

function refreshPendingThumbnail() {
    if (!pendingThumbnailRefreshPath) return;
    const imagePath = pendingThumbnailRefreshPath;
    pendingThumbnailRefreshPath = null;
    refreshThumbnailByPath(imagePath);
}

function refreshThumbnailByPath(imagePath) {
    const thumbnails = imagesList.querySelectorAll('.image-thumbnail');
    const target = Array.from(thumbnails).find((img) => img.dataset.imagePath === imagePath);
    if (!target) return;

    const container = target.closest('.image-item');
    if (container) {
        container.classList.add('is-loading');
        container.style.removeProperty('--thumb-ar');
        delete container.dataset.thumbOrientation;
    }

    const url = new URL(target.src, window.location.origin);
    url.searchParams.set('_t', Date.now().toString());
    target.src = url.pathname + url.search;
}

function confirmDeleteImage(imagePath, imageName) {
    itemToDelete = { path: imagePath, isFolder: false };
    deleteMessage.textContent = `Are you sure you want to delete "${imageName}"? This cannot be undone.`;
    deleteModal.classList.add('show');
}

function confirmDeleteFolder(folderPath, folderName) {
    itemToDelete = { path: folderPath, isFolder: true };
    deleteMessage.textContent = `Are you sure you want to delete the folder "${folderName}" and all its contents? This cannot be undone.`;
    deleteModal.classList.add('show');
}

function closeDeleteModal() {
    deleteModal.classList.remove('show');
    itemToDelete = null;
}

async function deleteItem() {
    if (!itemToDelete) return;

    try {
        const endpoint = itemToDelete.isFolder ? '/api/directory' : '/api/file';
        const response = await fetch(`${endpoint}?path=${encodeURIComponent(itemToDelete.path)}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete item');
        }

        closeDeleteModal();
        loadContent();
    } catch (error) {
        console.error('Error deleting item:', error);
        alert('Error deleting item: ' + error.message);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** For paths/names embedded in `onclick="...('...')"` — `escapeHtml` alone leaves `'` intact and breaks the JS string. */
function escapeJsSingleQuotedString(s) {
    return String(s)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function escapeForInlineHandlerArg(s) {
    return escapeHtml(escapeJsSingleQuotedString(s));
}
