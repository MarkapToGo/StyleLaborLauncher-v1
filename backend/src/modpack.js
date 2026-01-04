const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const AdmZip = require('adm-zip');
const cf = require('./curseforge');
const downloader = require('./downloader');
const modrinth = require('./modrinth');
const colors = require('colors');
const nbt = require('prismarine-nbt');
const { promisify } = require('util');
const zlib = require('zlib');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MODPACKS_DIR = path.join(DATA_DIR, 'modpacks');

/**
 * Create a servers.dat NBT file with the specified server
 * @param {string} serverIp - Server IP (with optional port, e.g., "play.example.com" or "play.example.com:25566")
 * @param {string} serverName - Display name for the server
 * @returns {Promise<Buffer>} - Gzipped NBT data for servers.dat
 */
async function createServersDat(serverIp, serverName) {
    // Parse IP and port
    let ip = serverIp;
    // Keep the full address as-is (Minecraft handles ip:port format natively)
    
    // Create NBT structure for servers.dat
    const nbtData = {
        type: 'compound',
        name: '',
        value: {
            servers: {
                type: 'list',
                value: {
                    type: 'compound',
                    value: [{
                        ip: { type: 'string', value: ip },
                        name: { type: 'string', value: serverName },
                        acceptTextures: { type: 'byte', value: 1 } // Auto-accept server resource pack
                    }]
                }
            }
        }
    };
    
    // Write NBT to buffer
    const nbtBuffer = nbt.writeUncompressed(nbtData, 'big');
    
    // Gzip compress (Minecraft expects gzipped servers.dat)
    const gzipAsync = promisify(zlib.gzip);
    const compressed = await gzipAsync(nbtBuffer);
    
    return compressed;
}

class ModpackManager {
    constructor() {
        fs.ensureDirSync(MODPACKS_DIR);
        this.cache = new Map(); // Plan cache
    }

    getModpackBaseDir(modpackId) {
        const dir = path.join(MODPACKS_DIR, String(modpackId));
        fs.ensureDirSync(dir);
        return dir;
    }

    getModpackVersionDir(modpackId, version) {
        // Sanitize version just in case, though usually safe
        const safeVersion = version.replace(/[^a-z0-9\.\-_]/gi, '_');
        const dir = path.join(this.getModpackBaseDir(modpackId), safeVersion);
        fs.ensureDirSync(dir);
        return dir;
    }

    async getInstallPlan(modpackConfig, baseUrl) {
        const modpackId = modpackConfig.id;
        const modpackName = modpackConfig.name;
        const removeFiles = modpackConfig.removeFiles || [];
        
        const shouldRemove = (name) => {
            if (!name || removeFiles.length === 0) return false;
            const lower = name.toLowerCase();
            return removeFiles.some(pattern => lower.includes(pattern.toLowerCase()));
        };
        
        console.log(colors.cyan(`\n════════════════════════════════════════════`));
        console.log(colors.cyan(`   Preparing: ${colors.bold(modpackName)} (ID: ${modpackId})`));
        if (removeFiles.length > 0) {
            console.log(colors.yellow(`   Blocking files containing: ${removeFiles.join(', ')}`));
        }
        console.log(colors.cyan(`════════════════════════════════════════════\n`));

        // 1. Get Main Zip & Manifest (Download to Base Dir Temporarily/Cache)
        const baseDir = this.getModpackBaseDir(modpackId);
        const zipPath = await this.downloadModpackZip(modpackId, modpackConfig.fileId, baseDir);
        
        const zip = new AdmZip(zipPath);
        const manifestEntry = zip.getEntry("manifest.json");
        if (!manifestEntry) throw new Error("manifest.json missing");
        
        const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
        const version = manifest.version;
        // Sanitize version for directory and URL usage
        const safeVersion = version.replace(/[^a-z0-9\.\-_]/gi, '_');
        
        console.log(colors.cyan(`   Detected Version: ${colors.bold(version)}`));

        // 2. Setup Versioned Directory
        const mpDir = this.getModpackVersionDir(modpackId, version);
        const modsDir = path.join(mpDir, 'mods');
        const cacheDir = path.join(DATA_DIR, 'cache', 'mods'); // Global mod cache
        fs.ensureDirSync(modsDir);
        fs.ensureDirSync(cacheDir);

        // Ensure source zip is also in the version dir for reference/overrides
        const versionSourcePath = path.join(mpDir, `source-${version}.zip`);
        if (!fs.existsSync(versionSourcePath)) {
            fs.copySync(zipPath, versionSourcePath);
        }

        // 2. Resolve Files (Batch Get Info for Original Names)
        const fileIds = manifest.files.map(f => f.fileID);
        const fileInfoCachePath = path.join(mpDir, 'files-info.json');
        
        let fileInfos = [];
        if (fs.existsSync(fileInfoCachePath)) {
            fileInfos = fs.readJsonSync(fileInfoCachePath);
        }

        if (fileInfos.length !== fileIds.length) {
            console.log(colors.yellow(`Resolving info for ${fileIds.length} mods...`));
            try {
                const chunks = [];
                for (let i = 0; i < fileIds.length; i += 50) chunks.push(fileIds.slice(i, i + 50));
                
                let fetchedFiles = [];
                // Simple progress for resolution
                const bar = downloader.multibar.create(chunks.length, 0, { filename: "Metadata API", speed: "req/s" });

                for (let chunk of chunks) {
                    const res = await cf.getFiles(chunk);
                    fetchedFiles = fetchedFiles.concat(res.data.data);
                    bar.increment();
                }
                bar.stop();
                downloader.multibar.remove(bar);

                fileInfos = fetchedFiles;
                fs.writeJsonSync(fileInfoCachePath, fileInfos);
                console.log(colors.green(`✔ Resolved metadata for ${fileInfos.length} mods.`));
            } catch (e) {
                console.error("Metadata resolution failed:", e.message);
                throw e; // Critical failure
            }
        }

        // Map IDs to Info
        const fileMap = new Map();
        fileInfos.forEach(f => fileMap.set(f.id, f));

        // 2b. Fetch Mod Project Info (names, authors, icons) - NEW
        const modIds = [...new Set(manifest.files.map(f => f.projectID))];
        const modMetadataPath = path.join(mpDir, 'mod-metadata.json');
        const iconsDir = path.join(mpDir, 'icons');
        fs.ensureDirSync(iconsDir);

        let modMetadata = { modpackVersion: manifest.version, mods: [] };
        
        if (fs.existsSync(modMetadataPath)) {
            const cached = fs.readJsonSync(modMetadataPath);
            if (cached.modpackVersion === manifest.version && cached.mods?.length > 0) {
                modMetadata = cached;
                console.log(colors.green(`✔ Using cached mod metadata (${modMetadata.mods.length} mods)`));
            }
        }

        if (modMetadata.mods.length === 0) {
            console.log(colors.yellow(`\nFetching mod project info for ${modIds.length} mods...`));
            try {
                const chunks = [];
                for (let i = 0; i < modIds.length; i += 50) chunks.push(modIds.slice(i, i + 50));
                
                let allModInfos = [];
                const bar = downloader.multibar.create(chunks.length, 0, { filename: "Mod Info API", speed: "req/s" });
                
                for (const chunk of chunks) {
                    const res = await cf.getMods(chunk);
                    allModInfos = allModInfos.concat(res.data.data);
                    bar.increment();
                }
                bar.stop();
                downloader.multibar.remove(bar);

                // Build metadata structure
                const modInfoMap = new Map();
                allModInfos.forEach(m => modInfoMap.set(m.id, m));

                // Process standard mods
                const standardMods = manifest.files.map(f => {
                    const fileInfo = fileMap.get(f.fileID);
                    const modInfo = modInfoMap.get(f.projectID);
                    
                    const primaryAuthor = modInfo?.authors?.find(a => a.id === modInfo.primaryAuthorId) 
                        || modInfo?.authors?.[0];
                    
                    return {
                        fileName: fileInfo?.fileName || `${f.projectID}-${f.fileID}.jar`,
                        modId: f.projectID,
                        fileId: f.fileID,
                        name: modInfo?.name || fileInfo?.displayName || 'Unknown Mod',
                        author: primaryAuthor?.name || 'Unknown',
                        description: modInfo?.summary || '',
                        iconUrl: modInfo?.logo?.thumbnailUrl || modInfo?.logo?.url || null,
                        iconPath: modInfo?.logo ? `icons/${f.projectID}.png` : null,
                        isExtra: false
                    };
                });
                
                modMetadata.mods = [...standardMods];

                // Process Extra Mods
                if (modpackConfig.extraMods && Array.isArray(modpackConfig.extraMods)) {
                    console.log(colors.cyan(`\nProcessing ${modpackConfig.extraMods.length} extra mods...`));
                    
                    for (const extra of modpackConfig.extraMods) {
                        try {
                            let resolvedMod = null;

                            if (extra.type === 'curseforge') {
                                // Resolve CurseForge Mod
                                // 1. Get Mod Info
                                const modResp = await cf.getMod(extra.projectId);
                                const modData = modResp.data.data;
                                
                                // 2. Find matching file
                                const loaderType = manifest.minecraft.modLoaders[0]?.id?.split('-')[0].toLowerCase(); // forge, neoforge, fabric
                                const mcVer = manifest.minecraft.version;
                                
                                // We need to search for files
                                // Since we don't have a complex search here, let's just use getModFiles (if available) or assume we can find latest
                                // For now, let's warn if not implemented fully, but we can try 'modrinth' logic or similar.
                                // Actually, we can assume we need to find a file.
                                // Let's use a imaginary 'getLatestFile' helper or implement iteration.
                                // Simplification: Just append to metadata with a flag, logic to find file comes in download phase?
                                // No, we need the file ID/URL now to plan.
                                
                                console.log(colors.dim(`   Resolving extra CF mod: ${extra.name || extra.projectId}`));
                                
                                // Search files for this mod
                                // Using a limit of 50 recent files should be enough to find matching version
                                const filesResp = await cf.getModpackFiles(extra.projectId, { pageSize: 50 });
                                
                                const files = filesResp.data.data;
                                const match = files.find(f => {
                                    const hasVersion = f.gameVersions.includes(mcVer);
                                    const hasLoader = f.gameVersions.some(v => v.toLowerCase().includes(loaderType));
                                    return hasVersion && hasLoader;
                                });

                                if (match) {
                                    resolvedMod = {
                                        fileName: match.fileName,
                                        modId: extra.projectId,
                                        fileId: match.id,
                                        name: modData.name,
                                        author: modData.authors[0]?.name || 'Extra',
                                        description: modData.summary,
                                        iconUrl: modData.logo?.url,
                                        iconPath: modData.logo ? `icons/${extra.projectId}.png` : null,
                                        isExtra: true,
                                        downloadUrl: match.downloadUrl
                                    };
                                } else {
                                    console.log(colors.red(`   Could not find compatible version for ${extra.name} (MC: ${mcVer}, Loader: ${loaderType})`));
                                }

                            } else if (extra.type === 'modrinth') {
                                // Modrinth resolution
                                const loaderType = manifest.minecraft.modLoaders[0]?.id?.split('-')[0].toLowerCase();
                                const mcVer = manifest.minecraft.version;
                                
                                const mrResult = await modrinth.findModDownload(extra.projectId, mcVer, loaderType);
                                if (mrResult) {
                                     resolvedMod = {
                                        fileName: mrResult.filename,
                                        modId: extra.projectId, // This might be slug string
                                        fileId: 0, // No CF file ID
                                        name: mrResult.projectName, // We might need to fetch project info for proper name if finding download didn't give it
                                        author: 'Modrinth',
                                        description: 'Extra mod from Modrinth',
                                        iconUrl: mrResult.iconUrl, // Assuming findModDownload returns this or we fetch it
                                        iconPath: mrResult.iconUrl ? `icons/${extra.projectId}.png` : null,
                                        isExtra: true,
                                        downloadUrl: mrResult.url
                                     };
                                }
                            } else if (extra.type === 'direct') {
                                 resolvedMod = {
                                    fileName: extra.fileName || path.basename(extra.url),
                                    modId: 0,
                                    fileId: 0,
                                    name: extra.name || extra.fileName,
                                    author: 'Direct',
                                    description: 'Directly downloaded extra mod',
                                    iconUrl: null,
                                    iconPath: null,
                                    isExtra: true,
                                    downloadUrl: extra.url
                                 };
                            }

                            if (resolvedMod) {
                                modMetadata.mods.push(resolvedMod);
                                
                                // Also ensure it gets into the download queue
                                // For that, we need to add it to fileMap or handle it separately.
                                // The current download loop iterates `manifest.files`. 
                                // We should probably inject these into the manifest.files list virtually OR 
                                // handle a separate "extra files" queue.
                                // To minimize disruption, I'll add them to `modMetadata.mods` and then
                                // iterate `modMetadata.mods` to build the download queue if they are missing locally.
                                
                                // Wait, the existing code iterates manifest.files to build downloadQueue.
                                // We need to handle extra mods there too.
                            }
                        } catch (e) {
                           console.error(colors.red(`   Failed to resolve extra mod ${extra.projectId || extra.type}: ${e.message}`));
                        }
                    }
                }

                fs.writeJsonSync(modMetadataPath, modMetadata, { spaces: 2 });
                console.log(colors.green(`✔ Saved mod metadata for ${modMetadata.mods.length} mods`));

                // Download icons
                console.log(colors.yellow(`\nDownloading mod icons...`));
                const iconBar = downloader.multibar.create(modMetadata.mods.length, 0, { filename: "Icons", speed: "img/s" });
                
                for (const mod of modMetadata.mods) {
                    if (mod.iconUrl) {
                        const iconPath = path.join(iconsDir, `${mod.modId}.png`);
                        if (!fs.existsSync(iconPath)) {
                            try {
                                const response = await require('axios').get(mod.iconUrl, { responseType: 'arraybuffer' });
                                fs.writeFileSync(iconPath, response.data);
                            } catch (e) {
                                // Icon download failed, not critical
                            }
                        }
                    }
                    iconBar.increment();
                }
                iconBar.stop();
                downloader.multibar.remove(iconBar);
                console.log(colors.green(`✔ Icons downloaded`));
                
            } catch (e) {
                console.error(colors.yellow(`Warning: Mod info fetch failed: ${e.message}`));
                // Non-critical, continue without rich metadata
            }
        }

        // 3. Download All Mods to Cache/Folder
        console.log(colors.yellow(`\nVerifying/Downloading Mod Files...`));
        const downloadQueue = [];

        // We want to store mods with original names in the modpack specific folder
        // But also check global cache to avoid redownloading
        
        // Combine manifest files with extra mods for downloading
        const allFilesToDownload = [...manifest.files];
        
        for (const f of manifest.files) {
            const info = fileMap.get(f.fileID);
            if (!info) continue; // Should not happen

            const fileName = info.fileName;
            // NEED TO CHECK BLOCKLIST HERE
            if (shouldRemove(fileName)) {
                console.log(colors.yellow(`Skipping blocked file: ${fileName}`));
                continue;
            }

            const destPath = path.join(modsDir, fileName); // Specific pack location
            const globalCachePath = path.join(cacheDir, `${f.projectID}-${f.fileID}.jar`);

            // If we have it in pack folder, good.
            if (fs.existsSync(destPath)) continue;

            // If we have it in global cache, copy it
            if (fs.existsSync(globalCachePath)) {
                fs.copySync(globalCachePath, destPath);
                continue;
            }

            // Need to download
            downloadQueue.push({
                fileId: f.fileID,
                modId: f.projectID, 
                url: info.downloadUrl,
                dest: destPath,
                cache: globalCachePath,
                name: fileName
            });
        }

        // Add extra mods to the list (AFTER standard mods)
        if (modMetadata && modMetadata.mods) {
             modMetadata.mods.forEach(m => {
                 if (m.isExtra) {
                     const destPath = path.join(modsDir, m.fileName);
                     const globalCachePath = path.join(cacheDir, `extra-${m.fileName}`);
                     
                     if (shouldRemove(m.fileName)) {
                         console.log(colors.yellow(`Skipping blocked extra mod: ${m.fileName}`));
                     } else if (!fs.existsSync(destPath)) {
                          if (fs.existsSync(globalCachePath)) {
                               fs.copySync(globalCachePath, destPath);
                          } else {
                               downloadQueue.push({
                                   fileId: m.fileId,
                                   modId: m.modId,
                                   url: m.downloadUrl,
                                   dest: destPath,
                                   cache: globalCachePath,
                                   name: m.fileName
                               });
                          }
                     }
                 }
             });
        }

        if (downloadQueue.length > 0) {
            console.log(colors.cyan(`\nDownloading ${downloadQueue.length} missing files...\n`));
            
            const failedMods = [];
            const maxRetries = 3; // Reduced since we have server pack fallback
            const concurrency = 5;
            
            // Phase 1: Try normal download methods (without server pack)
            const downloadWithRetry = async (item, attempt = 1) => {
                const methods = [
                    // Method 1: Use provided URL
                    async () => {
                        if (item.url && item.url !== "undefined" && item.url !== "null") {
                            return item.url;
                        }
                        throw new Error("No URL provided");
                    },
                    // Method 2: Get download URL from API
                    async () => {
                        const urlResp = await cf.getDownloadUrl(item.modId, item.fileId);
                        const url = urlResp.data.data;
                        if (!url) throw new Error("API returned no URL");
                        return url;
                    },
                    // Method 3: Get file info and extract URL
                    async () => {
                        const fileResp = await cf.getFileInfo(item.modId, item.fileId);
                        const url = fileResp.data.data.downloadUrl;
                        if (!url) throw new Error("File info has no URL");
                        return url;
                    },
                    // Method 4: Try constructing CDN URL
                    async () => {
                        const fileResp = await cf.getFileInfo(item.modId, item.fileId);
                        const fileData = fileResp.data.data;
                        if (fileData.fileName) {
                            const modIdPath = String(item.modId).slice(0, 4);
                            const fileIdPath = String(item.fileId).slice(0, 3);
                            return `https://edge.forgecdn.net/files/${modIdPath}/${fileIdPath}/${fileData.fileName}`;
                        }
                        throw new Error("Cannot construct CDN URL");
                    }
                ];

                for (let methodIndex = 0; methodIndex < methods.length; methodIndex++) {
                    try {
                        const url = await methods[methodIndex]();
                        await downloader.downloadFile(url, item.dest, item.name);
                        fs.copySync(item.dest, item.cache);
                        return { success: true, name: item.name };
                    } catch (e) {
                        if (methodIndex < methods.length - 1) {
                            continue; // Try next method
                        }
                        
                        // All methods failed
                        if (attempt < maxRetries) {
                            const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
                            await new Promise(r => setTimeout(r, delay));
                            return downloadWithRetry(item, attempt + 1);
                        } else {
                            return { success: false, name: item.name, item: item, error: e.message };
                        }
                    }
                }
            };
            
            // Download all mods with normal methods
            console.log(colors.cyan(`Phase 1: Downloading mods via direct methods...`));
            for (let i = 0; i < downloadQueue.length; i += concurrency) {
                const batch = downloadQueue.slice(i, i + concurrency);
                const results = await Promise.all(batch.map(item => downloadWithRetry(item)));
                
                results.forEach(result => {
                    if (!result.success) {
                        failedMods.push(result);
                    }
                });
            }
            
            const successCount = downloadQueue.length - failedMods.length;
            console.log(colors.green(`\n✔ Phase 1 Complete: ${successCount}/${downloadQueue.length} mods downloaded\n`));
            
            let phase2Extracted = 0;
            let phase3Downloaded = 0;
            let stillFailed = [];
            
            // Phase 2: Extract failed mods from server pack
            if (failedMods.length > 0) {
                console.log(colors.yellow(`\n⚠ ${failedMods.length} mods failed direct download. Attempting server pack extraction...\n`));
                
                try {
                    // Get ALL files for this modpack (not just latestFiles)
                    const filesResp = await cf.getModpackFiles(modpackId);
                    const allFiles = filesResp.data.data || [];
                    
                    // Also check latestFiles from modpack info
                    const modpackResp = await cf.getModpackInfo(modpackId);
                    const latestFiles = modpackResp.data.data.latestFiles || [];
                    
                    // Combine and find server pack
                    const combinedFiles = [...allFiles, ...latestFiles];
                    
                    // Better server pack detection:
                    // 1. Check serverPackFileId field on the main file we're using
                    const mainFile = combinedFiles.find(f => f.id === modpackConfig.fileId);
                    let serverFile = null;
                    
                    if (mainFile && mainFile.serverPackFileId) {
                        // The main file has a linked server pack
                        serverFile = combinedFiles.find(f => f.id === mainFile.serverPackFileId);
                        if (!serverFile) {
                            // Need to fetch it
                            try {
                                const spResp = await cf.getFileInfo(modpackId, mainFile.serverPackFileId);
                                serverFile = spResp.data.data;
                            } catch (e) {}
                        }
                    }
                    
                    // 2. Fallback: Look for "server" in filename
                    if (!serverFile) {
                        serverFile = combinedFiles.find(f => 
                            f.fileName && f.fileName.toLowerCase().includes('server')
                        );
                    }
                    
                    // 3. Fallback: Check isServerPack flag
                    if (!serverFile) {
                        serverFile = combinedFiles.find(f => f.isServerPack === true);
                    }
                    
                    if (!serverFile) {
                        console.log(colors.yellow(`No server pack found for this modpack.`));
                        stillFailed = [...failedMods];
                    } else {
                        console.log(colors.cyan(`Found server pack: ${serverFile.fileName} (ID: ${serverFile.id})`));
                        
                        // Download server pack
                        const serverPackPath = path.join(mpDir, `server-${serverFile.id}.zip`);
                        if (!fs.existsSync(serverPackPath)) {
                            const serverUrl = serverFile.downloadUrl;
                            if (!serverUrl) throw new Error("Server pack has no download URL");
                            console.log(colors.cyan(`Downloading server pack...`));
                            await downloader.downloadFile(serverUrl, serverPackPath, serverFile.fileName);
                        } else {
                            console.log(colors.green(`Server pack already cached`));
                        }
                        
                        // Extract failed mods from server pack
                        console.log(colors.cyan(`\nExtracting mods from server pack...\n`));
                        const serverZip = new AdmZip(serverPackPath);
                        const entries = serverZip.getEntries();
                        
                        for (const failedMod of failedMods) {
                            const modEntry = entries.find(e => {
                                const entryName = e.entryName.toLowerCase();
                                const modName = failedMod.name.toLowerCase();
                                return entryName.includes(modName) || 
                                       entryName.endsWith('/' + modName);
                            });
                            
                            if (modEntry && !modEntry.isDirectory) {
                                fs.writeFileSync(failedMod.item.dest, modEntry.getData());
                                fs.copySync(failedMod.item.dest, failedMod.item.cache);
                                console.log(colors.green(`✔ Extracted: ${failedMod.name}`));
                                phase2Extracted++;
                            } else {
                                stillFailed.push(failedMod);
                            }
                        }
                        
                        console.log(colors.green(`\n✔ Phase 2 Complete: ${phase2Extracted}/${failedMods.length} mods extracted from server pack`));
                        
                        // Clean up server pack
                        fs.unlinkSync(serverPackPath);
                        console.log(colors.dim(`Cleaned up server pack`));
                    }
                } catch (e) {
                    console.error(colors.red(`\nServer pack extraction failed: ${e.message}`));
                    stillFailed = [...failedMods];
                }
                
                // Phase 3: Try Modrinth for remaining failed mods
                if (stillFailed.length > 0) {
                    console.log(colors.yellow(`\n⚠ ${stillFailed.length} mods still missing. Trying Modrinth...\n`));
                    
                    const mcVersion = manifest.minecraft.version;
                    const loader = manifest.minecraft.modLoaders[0]?.id?.split('-')[0];
                    
                    for (const failedMod of stillFailed) {
                        try {
                            const modrinthResult = await modrinth.findModDownload(
                                failedMod.name,
                                mcVersion,
                                loader
                            );
                            
                            if (modrinthResult) {
                                console.log(colors.cyan(`Found on Modrinth: ${modrinthResult.projectName}`));
                                await downloader.downloadFile(
                                    modrinthResult.url,
                                    failedMod.item.dest,
                                    modrinthResult.filename
                                );
                                fs.copySync(failedMod.item.dest, failedMod.item.cache);
                                console.log(colors.green(`✔ Downloaded from Modrinth: ${failedMod.name}`));
                                phase3Downloaded++;
                                
                                // Remove from stillFailed
                                const idx = stillFailed.indexOf(failedMod);
                                if (idx > -1) stillFailed.splice(idx, 1);
                            }
                        } catch (e) {
                            console.log(colors.dim(`Modrinth fallback failed for ${failedMod.name}: ${e.message}`));
                        }
                    }
                    
                    if (phase3Downloaded > 0) {
                        console.log(colors.green(`\n✔ Phase 3 Complete: ${phase3Downloaded} mods downloaded from Modrinth`));
                    }
                }
            }
            
            // Final Summary
            console.log(colors.cyan(`\n════════════════════════════════════════════`));
            console.log(colors.cyan(`   DOWNLOAD SUMMARY`));
            console.log(colors.cyan(`════════════════════════════════════════════`));
            console.log(colors.green(`   Phase 1 (Direct):      ${successCount}/${downloadQueue.length} mods`));
            if (failedMods.length > 0) {
                console.log(colors.green(`   Phase 2 (Server Pack): ${phase2Extracted}/${failedMods.length} mods`));
                if (stillFailed.length > 0 || phase3Downloaded > 0) {
                    console.log(colors.green(`   Phase 3 (Modrinth):    ${phase3Downloaded} mods`));
                }
            }
            const totalSuccess = successCount + phase2Extracted + phase3Downloaded;
            const totalMods = downloadQueue.length;
            console.log(colors.cyan(`────────────────────────────────────────────`));
            console.log(colors.bold(`   Total: ${totalSuccess}/${totalMods} mods (${Math.round(totalSuccess/totalMods*100)}%)`));
            
            if (stillFailed.length > 0) {
                console.log(colors.red(`\n   ⚠ ${stillFailed.length} mods could not be obtained:`));
                stillFailed.forEach(mod => {
                    console.log(colors.red(`     - ${mod.name}`));
                });
            }
            console.log(colors.cyan(`════════════════════════════════════════════\n`));
        } else {
            console.log(colors.green(`✔ All mod files present locally.`));
        }

        // 4. Create Final Bundle (Mods + Overrides)
        const bundleName = `bundle-${manifest.version}.zip`;
        const bundlePath = path.join(mpDir, bundleName);

        if (!fs.existsSync(bundlePath)) {
            console.log(colors.cyan(`\nCreating Bundle: ${bundleName}...`));
            const bundleZip = new AdmZip();
            
            // Monitor add local folder? AdmZip is sync and blocking.
            // We can iterate files and add them to update a progress bar manually.
            
            const modFiles = fs.readdirSync(modsDir);
            const bundleBar = downloader.multibar.create(modFiles.length, 0, { filename: "Bundling Mods", speed: "files" });
            
            // Add files one by one for progress
            for (const file of modFiles) {
                if (shouldRemove(file)) {
                    // console.log(colors.yellow(`Excluding blocked file from bundle: ${file}`));
                    bundleBar.increment();
                    continue;
                }
                const p = path.join(modsDir, file);
                bundleZip.addLocalFile(p, "mods");
                bundleBar.increment();
            }
            bundleBar.stop();
            downloader.multibar.remove(bundleBar);

            // Add Overrides from Source Zip
            const overridesDir = manifest.overrides || "overrides";
            zip.getEntries().forEach(entry => {
                if (entry.entryName.startsWith(overridesDir + "/")) {
                    const relativePath = entry.entryName.substring(overridesDir.length + 1);
                    if (relativePath.length > 0 && !entry.isDirectory) {
                        if (!shouldRemove(relativePath)) {
                            bundleZip.addFile(relativePath, entry.getData());
                        } else {
                            console.log(colors.yellow(`Excluding blocked override: ${relativePath}`));
                        }
                    }
                }
            });

            // Add mod-metadata.json to bundle
            if (fs.existsSync(modMetadataPath)) {
                bundleZip.addLocalFile(modMetadataPath, '', 'mod-metadata.json');
                console.log(colors.green(`✔ Added mod-metadata.json to bundle`));
            }

            // Add icons folder to bundle
            if (fs.existsSync(iconsDir)) {
                const iconFiles = fs.readdirSync(iconsDir);
                for (const iconFile of iconFiles) {
                    const iconPath = path.join(iconsDir, iconFile);
                    if (fs.statSync(iconPath).isFile()) {
                        bundleZip.addLocalFile(iconPath, 'icons');
                    }
                }
                console.log(colors.green(`✔ Added ${iconFiles.length} icons to bundle`));
            }

            // Add servers.dat if serverIp is configured
            if (modpackConfig.serverIp) {
                try {
                    const serverName = modpackConfig.name || 'Official Server';
                    const serversDatBuffer = await createServersDat(modpackConfig.serverIp, serverName);
                    bundleZip.addFile('servers.dat', serversDatBuffer);
                    console.log(colors.green(`✔ Added servers.dat with server: ${modpackConfig.serverIp}`));
                } catch (e) {
                    console.log(colors.yellow(`⚠ Failed to create servers.dat: ${e.message}`));
                }
            }

            console.log(colors.yellow(`Writing zip file (this may take a moment)...`));
            bundleZip.writeZip(bundlePath);
            console.log(colors.green(`✔ Bundle created successfully (${(fs.statSync(bundlePath).size / 1024 / 1024).toFixed(2)} MB)`));
        } else {
            console.log(colors.green(`✔ Bundle already exists.`));
        }

        return {
            name: manifest.name,
            version: manifest.version,
            minecraftVersion: manifest.minecraft.version,
            modLoader: manifest.minecraft.modLoaders.find(ml => ml.primary) || manifest.minecraft.modLoaders[0],
            // New Plan Type: Bundle
            isBundle: true,
            bundleUrl: `${baseUrl}/api/modpacks/${modpackId}/${safeVersion}/bundle/${bundleName}`
        };
    }

    async downloadModpackZip(modpackId, specificFileId, mpDir) {
        let fileId = specificFileId;
        if (!fileId) {
             const resp = await cf.getModpackInfo(modpackId);
             fileId = resp.data.data.mainFileId;
        }

        const fileName = `source-${fileId}.zip`;
        const destPath = path.join(mpDir, fileName);

        if (!fs.existsSync(destPath)) {
            console.log(`Downloading Modpack Source: ${fileName}`);
            const urlResp = await cf.getFileInfo(modpackId, fileId);
            await downloader.downloadFile(urlResp.data.data.downloadUrl, destPath, fileName);
        }
        return destPath;
    }

    async createOverridesZip(sourceZip, overridesDir, destPath) {
        if(fs.existsSync(destPath)) return;
        
        const overridesZip = new AdmZip();
        let count = 0;
        sourceZip.getEntries().forEach(entry => {
             if (entry.entryName.startsWith(overridesDir + "/")) {
                 const relativePath = entry.entryName.substring(overridesDir.length + 1);
                 if (relativePath.length > 0 && !entry.isDirectory) {
                     overridesZip.addFile(relativePath, entry.getData());
                     count++;
                 }
             }
        });
        
        if (count > 0) {
            overridesZip.writeZip(destPath);
            console.log(`Created Overrides Zip with ${count} files.`);
        }
    }

    /*
    async serveFile(modpackId, fileId, fileName, res) {
        // Needs modpack config to find folder?
        // Actually, we store mods in a "cache/mods" global or per modpack?
        // User wants "everything related to ATM 10 in this folder".
        // BUT, `/download` endpoint usually doesn't know the Modpack NAME, only ID.
        // We can look up ID in config.
        const config = require('../config.json'); // Reload config
        const mpConfig = config.modpacks.find(m => parseInt(m.id) === parseInt(modpackId));
        
        if (!mpConfig) return res.status(404).send("Modpack config not found");
        
        // This method is deprecated as we moved to versioned directories and bundles
        // const mpDir = this.getModpackDir(mpConfig.name);
        return res.status(410).send("Gone");
    }
    */
}

module.exports = new ModpackManager();
