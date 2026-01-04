/**
 * Modrinth Modpack Handler
 * Handles downloading and bundling Modrinth modpacks (.mrpack format)
 */
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const colors = require('colors');
const modrinth = require('./modrinth');
const nbt = require('prismarine-nbt');
const { promisify } = require('util');
const zlib = require('zlib');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MODPACKS_DIR = path.join(DATA_DIR, 'modrinth-modpacks');

// Ensure directory exists
fs.ensureDirSync(MODPACKS_DIR);

/**
 * Create a servers.dat NBT file with the specified server
 * @param {string} serverIp - Server IP (with optional port)
 * @param {string} serverName - Display name for the server
 * @returns {Promise<Buffer>} - Gzipped NBT data for servers.dat
 */
async function createServersDat(serverIp, serverName) {
    const nbtData = {
        type: 'compound',
        name: '',
        value: {
            servers: {
                type: 'list',
                value: {
                    type: 'compound',
                    value: [{
                        ip: { type: 'string', value: serverIp },
                        name: { type: 'string', value: serverName },
                        acceptTextures: { type: 'byte', value: 1 }
                    }]
                }
            }
        }
    };
    
    const nbtBuffer = nbt.writeUncompressed(nbtData, 'big');
    const gzipAsync = promisify(zlib.gzip);
    return await gzipAsync(nbtBuffer);
}

/**
 * Get install plan for a Modrinth modpack
 * @param {Object} modpackConfig - Config from config.yml
 * @param {string} baseUrl - Base URL for bundle serving
 * @returns {Object} Install plan compatible with client
 */
async function getModrinthInstallPlan(modpackConfig, baseUrl) {
    const projectId = modpackConfig.id;
    const requestedVersionId = modpackConfig.versionId;
    
    console.log(colors.cyan(`\n[Modrinth] Getting install plan for: ${modpackConfig.name || projectId}`));

    const removeFiles = modpackConfig.removeFiles || [];
    const shouldRemove = (name) => {
        if (!name || removeFiles.length === 0) return false;
        const lower = name.toLowerCase();
        return removeFiles.some(pattern => lower.includes(pattern.toLowerCase()));
    };

    if (removeFiles.length > 0) {
        console.log(colors.yellow(`  Blocking files containing: ${removeFiles.join(', ')}`));
    }
    
    // 1. Get project info
    const project = await modrinth.getProject(projectId);
    if (!project) {
        throw new Error(`Modrinth project not found: ${projectId}`);
    }
    
    console.log(colors.dim(`  Project: ${project.title} (${project.slug})`));
    
    // 2. Get the target version
    let targetVersion;
    if (requestedVersionId) {
        // Find specific version by version_number or id
        const allVersions = await modrinth.getAllVersions(projectId);
        targetVersion = allVersions.find(v => 
            v.version_number === requestedVersionId || 
            v.id === requestedVersionId
        );
        if (!targetVersion) {
            console.log(colors.yellow(`  Requested version ${requestedVersionId} not found, using latest`));
            targetVersion = allVersions[0];
        }
    } else {
        targetVersion = await modrinth.getLatestVersion(projectId);
    }
    
    if (!targetVersion) {
        throw new Error(`No versions found for project: ${projectId}`);
    }
    
    console.log(colors.dim(`  Version: ${targetVersion.version_number}`));
    
    // 3. Find the primary .mrpack file
    const mrpackFile = targetVersion.files.find(f => f.filename.endsWith('.mrpack'));
    if (!mrpackFile) {
        throw new Error(`No .mrpack file found in version ${targetVersion.version_number}`);
    }
    
    console.log(colors.dim(`  Downloading: ${mrpackFile.filename}`));
    
    // 4. Download the .mrpack file
    const modpackDir = path.join(MODPACKS_DIR, project.slug, targetVersion.version_number);
    fs.ensureDirSync(modpackDir);
    
    const mrpackPath = path.join(modpackDir, mrpackFile.filename);
    
    if (!fs.existsSync(mrpackPath)) {
        const response = await axios.get(mrpackFile.url, { responseType: 'arraybuffer' });
        fs.writeFileSync(mrpackPath, response.data);
        console.log(colors.green(`  ✓ Downloaded .mrpack`));
    } else {
        console.log(colors.dim(`  ✓ Using cached .mrpack`));
    }
    
    // 5. Extract and parse modrinth.index.json
    const zip = new AdmZip(mrpackPath);
    const indexEntry = zip.getEntry('modrinth.index.json');
    if (!indexEntry) {
        throw new Error('Invalid .mrpack: missing modrinth.index.json');
    }
    
    const manifest = JSON.parse(indexEntry.getData().toString('utf8'));
    console.log(colors.dim(`  Manifest: ${manifest.name} v${manifest.versionId}`));
    console.log(colors.dim(`  Files: ${manifest.files.length} mods`));
    
    // 6. Get Minecraft version and loader from dependencies
    const mcVersion = manifest.dependencies?.minecraft || 'unknown';
    let loader = 'vanilla';
    let loaderVersion = '';
    
    if (manifest.dependencies?.['fabric-loader']) {
        loader = 'fabric';
        loaderVersion = manifest.dependencies['fabric-loader'];
    } else if (manifest.dependencies?.['forge']) {
        loader = 'forge';
        loaderVersion = manifest.dependencies['forge'];
    } else if (manifest.dependencies?.['neoforge']) {
        loader = 'neoforge';
        loaderVersion = manifest.dependencies['neoforge'];
    } else if (manifest.dependencies?.['quilt-loader']) {
        loader = 'quilt';
        loaderVersion = manifest.dependencies['quilt-loader'];
    }
    
    console.log(colors.dim(`  MC: ${mcVersion}, Loader: ${loader} ${loaderVersion}`));
    
    // 7. Download all mod files
    const modsDir = path.join(modpackDir, 'mods');
    fs.ensureDirSync(modsDir);
    
    console.log(colors.cyan(`  Downloading ${manifest.files.length} mods...`));
    
    const downloadQueue = manifest.files.filter(f => f.path.startsWith('mods/'));
    let downloaded = 0;
    let cached = 0;
    
    // Download with concurrency limit
    const concurrency = 10;
    const chunks = [];
    for (let i = 0; i < downloadQueue.length; i += concurrency) {
        chunks.push(downloadQueue.slice(i, i + concurrency));
    }
    
    for (const chunk of chunks) {
        await Promise.all(chunk.map(async (file) => {
            const filename = path.basename(file.path);
            const destPath = path.join(modsDir, filename);
            
            if (fs.existsSync(destPath)) {
                cached++;
                return;
            }
            
            if (shouldRemove(filename)) {
                console.log(colors.yellow(`    Skipping blocked file: ${filename}`));
                return;
            }
            
            if (file.downloads && file.downloads.length > 0) {
                try {
                    const resp = await axios.get(file.downloads[0], { 
                        responseType: 'arraybuffer',
                        timeout: 30000
                    });
                    fs.writeFileSync(destPath, resp.data);
                    downloaded++;
                } catch (e) {
                    console.log(colors.yellow(`    ⚠ Failed to download: ${filename}`));
                }
            }
        }));
    }
    
    console.log(colors.green(`  ✓ Downloaded ${downloaded} mods (${cached} cached)`));
    
    // 8. Fetch mod metadata from Modrinth API (names, icons, descriptions)
    const iconsDir = path.join(modpackDir, 'icons');
    fs.ensureDirSync(iconsDir);
    const modMetadataPath = path.join(modpackDir, 'mod-metadata.json');
    
    let modMetadata = { modpackVersion: targetVersion.version_number, mods: [] };
    
    // Check for cached metadata
    if (fs.existsSync(modMetadataPath)) {
        try {
            const cached = fs.readJsonSync(modMetadataPath);
            if (cached.modpackVersion === targetVersion.version_number && cached.mods?.length > 0) {
                modMetadata = cached;
                console.log(colors.green(`  ✓ Using cached mod metadata (${modMetadata.mods.length} mods)`));
            }
        } catch (e) {
            // Ignore corrupt cache
        }
    }
    
    if (modMetadata.mods.length === 0 && downloadQueue.length > 0) {
        console.log(colors.cyan(`  Fetching mod metadata from Modrinth...`));
        
        // Extract project IDs from download URLs
        // Modrinth CDN URL format: https://cdn.modrinth.com/data/{PROJECT_ID}/versions/{VERSION_ID}/filename.jar
        const projectIds = [];
        for (const file of downloadQueue) {
            if (file.downloads && file.downloads[0]) {
                const match = file.downloads[0].match(/cdn\.modrinth\.com\/data\/([^\/]+)/);
                if (match && match[1]) {
                    projectIds.push({ id: match[1], filename: path.basename(file.path), fileSize: file.fileSize || 0 });
                }
            }
        }
        
        // Batch fetch project info (Modrinth supports up to 500 IDs at once)
        const uniqueIds = [...new Set(projectIds.map(p => p.id))];
        console.log(colors.dim(`  Fetching info for ${uniqueIds.length} projects...`));
        
        try {
            // Modrinth /projects endpoint for batch
            const projectsResp = await modrinth.client.get('/projects', {
                params: { ids: JSON.stringify(uniqueIds) }
            });
            const projectsData = projectsResp.data || [];
            const projectMap = new Map();
            projectsData.forEach(p => projectMap.set(p.id, p));
            
            // Build metadata
            for (const pInfo of projectIds) {
                const proj = projectMap.get(pInfo.id);
                if (proj) {
                    modMetadata.mods.push({
                        fileName: pInfo.filename,
                        sizeBytes: pInfo.fileSize,
                        modId: proj.id,
                        name: proj.title,
                        author: proj.author || 'Unknown',
                        description: proj.description,
                        iconPath: proj.icon_url ? `icons/${proj.id}.png` : null,
                        iconUrl: proj.icon_url
                    });
                } else {
                    // Fallback for missing project
                    modMetadata.mods.push({
                        fileName: pInfo.filename,
                        sizeBytes: pInfo.fileSize,
                        modId: pInfo.id,
                        name: pInfo.filename.replace('.jar', ''),
                        author: 'Unknown',
                        description: '',
                        iconPath: null,
                        iconUrl: null
                    });
                }
            }
            
            // Download icons in parallel
            console.log(colors.cyan(`  Downloading ${modMetadata.mods.filter(m => m.iconUrl).length} icons...`));
            let iconCount = 0;
            
            await Promise.all(modMetadata.mods.filter(m => m.iconUrl).map(async (mod) => {
                const iconPath = path.join(iconsDir, `${mod.modId}.png`);
                if (!fs.existsSync(iconPath)) {
                    try {
                        const resp = await axios.get(mod.iconUrl, { 
                            responseType: 'arraybuffer',
                            timeout: 10000
                        });
                        fs.writeFileSync(iconPath, resp.data);
                        iconCount++;
                    } catch (e) {
                        // Ignore icon download failures
                    }
                } else {
                    iconCount++;
                }
            }));
            
            console.log(colors.green(`  ✓ Downloaded ${iconCount} icons`));
            
            // Save metadata cache
            fs.writeJsonSync(modMetadataPath, modMetadata);
            console.log(colors.green(`  ✓ Saved mod metadata (${modMetadata.mods.length} mods)`));
            
        } catch (e) {
            console.log(colors.yellow(`  ⚠ Could not fetch mod metadata: ${e.message}`));
        }
    }
    
    // 9. Extract overrides
    const overridesDir = path.join(modpackDir, 'overrides');
    fs.ensureDirSync(overridesDir);
    
    const overrideEntries = zip.getEntries().filter(e => 
        e.entryName.startsWith('overrides/') && !e.isDirectory
    );
    
    for (const entry of overrideEntries) {
        const relativePath = entry.entryName.replace('overrides/', '');
        if (shouldRemove(relativePath)) {
            console.log(colors.yellow(`  Skipping blocked override: ${relativePath}`));
            continue;
        }
        const destPath = path.join(overridesDir, relativePath);
        fs.ensureDirSync(path.dirname(destPath));
        fs.writeFileSync(destPath, entry.getData());
    }
    
    if (overrideEntries.length > 0) {
        console.log(colors.green(`  ✓ Extracted ${overrideEntries.length} override files`));
    }
    
    // 10. Create the bundle ZIP
    const bundleFilename = `${project.slug}-${targetVersion.version_number}.zip`;
    const bundlePath = path.join(modpackDir, bundleFilename);
    
    console.log(colors.cyan(`  Creating bundle: ${bundleFilename}`));
    
    const bundleZip = new AdmZip();
    
    // Add mods
    const modFiles = fs.readdirSync(modsDir);
    for (const modFile of modFiles) {
        if (!shouldRemove(modFile)) {
            bundleZip.addLocalFile(path.join(modsDir, modFile), 'mods');
        }
    }
    
    // Add mod-metadata.json
    if (fs.existsSync(modMetadataPath)) {
        bundleZip.addLocalFile(modMetadataPath, '', 'mod-metadata.json');
    }
    
    // Add icons
    if (fs.existsSync(iconsDir)) {
        const iconFiles = fs.readdirSync(iconsDir);
        for (const iconFile of iconFiles) {
            const iconPath = path.join(iconsDir, iconFile);
            if (fs.statSync(iconPath).isFile()) {
                bundleZip.addLocalFile(iconPath, 'icons');
            }
        }
    }
    
    // Add overrides (config, etc.)
    if (fs.existsSync(overridesDir)) {
        const addDirRecursive = (dir, zipPath = '') => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const itemZipPath = zipPath ? `${zipPath}/${item}` : item;
                
                if (fs.statSync(fullPath).isDirectory()) {
                    addDirRecursive(fullPath, itemZipPath);
                } else {
                    bundleZip.addLocalFile(fullPath, path.dirname(itemZipPath) || undefined);
                }
            }
        };
        addDirRecursive(overridesDir);
    }
    
    // Add servers.dat if serverIp is configured
    if (modpackConfig.serverIp) {
        try {
            const serverName = modpackConfig.name || project.title || 'Official Server';
            const serversDatBuffer = await createServersDat(modpackConfig.serverIp, serverName);
            bundleZip.addFile('servers.dat', serversDatBuffer);
            console.log(colors.green(`  ✓ Added servers.dat with server: ${modpackConfig.serverIp}`));
        } catch (e) {
            console.log(colors.yellow(`  ⚠ Failed to create servers.dat: ${e.message}`));
        }
    }
    
    bundleZip.writeZip(bundlePath);
    console.log(colors.green(`  ✓ Bundle created: ${(fs.statSync(bundlePath).size / 1024 / 1024).toFixed(1)} MB`));
    
    // 11. Return install plan
    const bundleUrl = `${baseUrl}/api/modrinth-modpacks/${project.slug}/${targetVersion.version_number}/${bundleFilename}`;
    
    return {
        name: project.title,
        version: targetVersion.version_number,
        minecraftVersion: mcVersion,
        modLoader: {
            // Format as 'loader-version' to match CurseForge format expected by Rust parser
            // e.g., 'fabric-0.16.9', 'neoforge-21.1.115'
            id: loaderVersion ? `${loader}-${loaderVersion}` : loader,
            primary: true
        },
        isBundle: true,
        bundleUrl: bundleUrl,
        files: [], // Not used when isBundle is true
        source: 'modrinth'
    };
}

module.exports = {
    getModrinthInstallPlan,
    MODPACKS_DIR
};

