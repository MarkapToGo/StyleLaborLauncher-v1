const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const cliProgress = require('cli-progress');

class Downloader {
    constructor() {
        this.multibar = new cliProgress.MultiBar({
            clearOnComplete: false,
            hideCursor: true,
            format: colors.cyan('{bar}') + ' | {filename} | {percentage}% | {value}/{total} Bytes | {speed}/s',
        }, cliProgress.Presets.shades_grey);
        
        this.activeBars = new Map();
    }

    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    async downloadFile(url, destPath, filename, retries = 0) {
        try {
            await fs.ensureDir(path.dirname(destPath));

            // Check if exists
            if (await fs.pathExists(destPath)) {
                const stat = await fs.stat(destPath);
                if(stat.size > 0) return true;
            }

            console.log(colors.dim(`Downloading from: ${url.substring(0, 80)}...`));

            const writer = fs.createWriteStream(destPath);
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 30000, // 30 second timeout
                maxRedirects: 5
            });

            const totalLength = parseInt(response.headers['content-length'], 10);
            
            // Create Bar
            const bar = this.multibar.create(totalLength || 100, 0, {
                filename: filename.substring(0, 20).padEnd(20),
                speed: "0 B"
            });
            this.activeBars.set(destPath, bar);

            let downloaded = 0;
            let lastUpdate = Date.now();
            let lastDownloaded = 0;

            response.data.on('data', (chunk) => {
                downloaded += chunk.length;
                const now = Date.now();
                
                if (now - lastUpdate > 500) { 
                    const diffTime = (now - lastUpdate) / 1000;
                    const diffBytes = downloaded - lastDownloaded;
                    const speed = this.formatBytes(diffBytes / diffTime);
                    
                    bar.update(downloaded, { speed });
                    lastUpdate = now;
                    lastDownloaded = downloaded;
                } else {
                    bar.update(downloaded);
                }
            });

            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    bar.update(totalLength, { speed: "Done" });
                    this.multibar.remove(bar);
                    this.activeBars.delete(destPath);
                    resolve(true);
                });
                writer.on('error', (err) => {
                    this.multibar.remove(bar);
                    this.activeBars.delete(destPath);
                    reject(err);
                });
            });

        } catch (e) {
            console.error(colors.red(`Download error for ${filename}: ${e.message}`));
            if(this.activeBars.has(destPath)) {
                this.multibar.remove(this.activeBars.get(destPath));
                this.activeBars.delete(destPath);
            }
            throw e;
        }
    }
}

module.exports = new Downloader();
