const https = require('https');
const http = require('http');
const { URL } = require('url');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB — generous headroom over typical screenshot sizes
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Downloads an image URL as a base64 buffer with safeguards: status validation,
 * bounded redirect following, a request timeout, and a max byte size.
 * @param {string} url
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
function fetchImageBuffer(url, redirectsLeft = MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const lib = parsedUrl.protocol === 'https:' ? https : http;

        const req = lib.get(parsedUrl, (res) => {
            const status = res.statusCode || 0;

            // Follow redirects a bounded number of times
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume(); // discard body
                if (redirectsLeft <= 0) {
                    reject(new Error('Too many redirects while fetching image'));
                    return;
                }
                const nextUrl = new URL(res.headers.location, url).toString();
                resolve(fetchImageBuffer(nextUrl, redirectsLeft - 1));
                return;
            }

            if (status < 200 || status >= 300) {
                res.resume();
                reject(new Error(`Image fetch failed with status ${status}`));
                return;
            }

            const chunks = [];
            let totalBytes = 0;

            res.on('data', (chunk) => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_IMAGE_BYTES) {
                    req.destroy(new Error(`Image exceeds max size of ${MAX_IMAGE_BYTES} bytes`));
                    return;
                }
                chunks.push(chunk);
            });

            res.on('end', () => {
                resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/jpeg' });
            });

            res.on('error', reject);
        });

        req.on('error', reject);
        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error(`Image fetch timed out after ${REQUEST_TIMEOUT_MS}ms`));
        });
    });
}

/**
 * Resolves a content-type header to a Claude-compatible media type, defaulting to jpeg.
 * @param {string} contentType
 */
function resolveMediaType(contentType) {
    if (contentType.includes('png')) return 'image/png';
    if (contentType.includes('gif')) return 'image/gif';
    if (contentType.includes('webp')) return 'image/webp';
    return 'image/jpeg';
}

module.exports = { fetchImageBuffer, resolveMediaType, MAX_IMAGE_BYTES };
