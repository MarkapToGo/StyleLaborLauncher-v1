const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const AdmZip = require('adm-zip');
const modpackManager = require('./src/modpack');
const modrinthModpack = require('./src/modrinth-modpack');
const colors = require('colors');
const NodeCache = require('node-cache');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const term = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
    red: "\x1b[31m"
};
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Cache: TTL 10 minutes, check expired every 2 minutes
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// Security Middleware
app.use(helmet());

// Rate Limiting (Global: 5000 requests per 15 mins)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});
app.use(limiter);

// Compression
app.use(compression());

// Middleware
app.use(cors());
app.use(express.json());

// Aesthetic Logging Middleware
app.use((req, res, next) => {
    const start = Date.now();
    const timestamp = new Date().toLocaleTimeString();

    // Log after response is finished to capture status code and duration
    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;

        let statusColor = term.green;
        if (status >= 400) statusColor = term.yellow;
        if (status >= 500) statusColor = term.magenta;

        console.log(
            `${term.gray}[${timestamp}]${term.reset}`,
            `${term.bright}${req.method}${term.reset}`,
            `${req.url}`,
            `${statusColor}${status}${term.reset}`,
            `${term.dim}${duration}ms${term.reset}`
        );
    });

    next();
});

// Health Endpoint
app.get('/api/health', (req, res) => {
    const uptime = process.uptime();
    res.json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptime: uptime,
        uptimeHuman: formatUptime(uptime)
    });
});

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);
    return `${d}d ${h}h ${m}m ${s}s`;
}

// Configuration
const CF_API_KEY = process.env.CF_API_KEY || '$2a$10$sOmNsFsLjHEA2FFIT5thSebGSMHDDqJuBHHk7LgzBFAW6d2IPwyt6';
const CF_API_BASE = 'https://api.curseforge.com';

// Paths
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const OVERRIDES_DIR = path.join(DATA_DIR, 'overrides');
const CONFIG_FILE = path.join(__dirname, 'config.yml');

fs.ensureDirSync(CACHE_DIR);
fs.ensureDirSync(OVERRIDES_DIR);

// Load Config (YAML)
let config = { modpacks: [] };
try {
    if (fs.existsSync(CONFIG_FILE)) {
        const fileContents = fs.readFileSync(CONFIG_FILE, 'utf8');
        const parsed = yaml.load(fileContents);

        // Basic Validation
        if (!parsed || typeof parsed !== 'object') {
            console.error(colors.red("Config validation failed: Config is not a valid YAML object"));
            config = { modpacks: [] };
        } else if (!Array.isArray(parsed.modpacks)) {
            console.error(colors.red("Config validation failed: 'modpacks' is not an array"));
            config = { modpacks: [] };
        } else {
            console.log(colors.green(`✔ Config loaded with ${parsed.modpacks.length} modpacks`));
            config = parsed;
        }
    } else {
        console.warn("Config file not found, creating default.");
        const defaultConfig = yaml.dump({ modpacks: [] });
        fs.writeFileSync(CONFIG_FILE, defaultConfig);
    }
} catch (e) {
    console.error("Error loading config:", e);
}

// 5. Version Check (Dynamic Latest)
app.get('/api/version', (req, res) => {
    try {
        const versionFile = path.join(__dirname, 'version.json');
        if (fs.existsSync(versionFile)) {
            const versions = fs.readJsonSync(versionFile);

            if (Array.isArray(versions) && versions.length > 0) {
                // Sort by version descending (YYYY.MM.DD)
                // We assume strict YYYY.MM.DD format which works with string comparison
                // But let's be safe and split
                versions.sort((a, b) => {
                    const vA = a.version.split('.').map(Number);
                    const vB = b.version.split('.').map(Number);

                    // Compare Year
                    if (vA[0] !== vB[0]) return vB[0] - vA[0];
                    // Compare Month
                    if (vA[1] !== vB[1]) return vB[1] - vA[1];
                    // Compare Day/Patch
                    return vB[2] - vA[2];
                });

                const latest = versions[0];
                res.json(latest);
            } else {
                res.status(500).json({ error: "Invalid version.json format" });
            }
        } else {
            res.json({ version: "0.0.0", error: "No version info found" });
        }
    } catch (e) {
        console.error(`${term.red}Error serving version info: ${e.message}${term.reset}`);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


// HTTP Client
const cfClient = axios.create({
    baseURL: CF_API_BASE,
    headers: {
        'x-api-key': CF_API_KEY,
        'Accept': 'application/json'
    }
});

// Helper: Format Bytes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper: Download File with Progress
async function downloadFile(url, destPath) {
    if (await fs.pathExists(destPath)) return;

    const writer = fs.createWriteStream(destPath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    const totalLength = response.headers['content-length'];
    let downloaded = 0;
    const startTime = Date.now();

    console.log(`${term.cyan}Starting download: ${path.basename(destPath)}${term.reset}`);

    response.data.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalLength) {
            const percent = ((downloaded / totalLength) * 100).toFixed(1);
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = (downloaded / elapsed); // bytes per second

            // Rewrite line
            process.stdout.write(`\r${term.yellow}Downloading: ${percent}% (${formatBytes(speed)}/s)${term.reset}`);
        }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            process.stdout.write('\n'); // New line after done
            console.log(`${term.green}✔ Download complete${term.reset}`);
            resolve();
        });
        writer.on('error', reject);
    });
}

// Helper: Get Modpack Main File (ZIP)
async function getModpackZip(projectID, specificFileId) {
    let fileId = specificFileId;

    // 1. If no specific file ID, get Latest/Main from Project Info
    if (!fileId) {
        try {
            const resp = await cfClient.get(`/v1/mods/${projectID}`);
            const mod = resp.data.data;
            fileId = mod.mainFileId;

            if (!fileId) throw new Error("No main file found");
        } catch (e) {
            throw new Error(`Failed to get modpack info: ${e.message}`);
        }
    }

    try {
        // Get File Download URL
        const fileResp = await cfClient.get(`/v1/mods/${projectID}/files/${fileId}`);
        const fileInfo = fileResp.data.data;
        const downloadUrl = fileInfo.downloadUrl; // Or use /download-url endpoint

        const fileName = `${projectID}-${fileId}.zip`;
        const filePath = path.join(CACHE_DIR, fileName);

        // Download if missing
        if (!(await fs.pathExists(filePath))) {
            console.log(`Downloading modpack zip: ${fileName} (File ID: ${fileId})`);
            await downloadFile(downloadUrl, filePath);
        }

        return filePath;
    } catch (e) {
        throw new Error(`Failed to get modpack zip: ${e.message}`);
    }
}

// ROUTES

// Modrinth API client
const modrinthClient = axios.create({
    baseURL: 'https://api.modrinth.com/v2',
    headers: {
        'User-Agent': 'StyleLaborLauncher/1.0 (contact@stylelabor.com)'
    }
});

// 1. List Modpacks (Enriched with details from various sources)
app.get('/api/modpacks', async (req, res) => {
    const CACHE_KEY = 'modpacks_list';

    // Check Cache
    const cachedData = cache.get(CACHE_KEY);
    if (cachedData) {
        // console.log(`${term.dim}[CACHE] HIT /api/modpacks${term.reset}`);
        return res.json(cachedData);
    }

    console.log(`${term.cyan}[DEBUG] Fetching ${config.modpacks.length} modpacks...${term.reset}`);

    try {
        // Fetch details for all configured modpacks
        const enrichedModpacks = await Promise.all(
            config.modpacks.map(async (modpack) => {
                const source = modpack.source || 'curseforge';
                console.log(`${term.dim}  Processing: ${modpack.name || modpack.id} (source: ${source})${term.reset}`);

                try {
                    // Handle different sources
                    if (source === 'modrinth') {
                        return await fetchModrinthModpack(modpack);
                    } else if (source === 'vanilla') {
                        return await fetchVanillaModpack(modpack);
                    } else {
                        // Default: CurseForge
                        return await fetchCurseForgeModpack(modpack);
                    }
                } catch (e) {
                    console.error(`${term.red}  Failed to fetch ${modpack.name || modpack.id}: ${e.message}${term.reset}`);
                    // Return basic info if API fails
                    return {
                        id: modpack.id,
                        name: modpack.name || String(modpack.id),
                        summary: 'Details unavailable',
                        description: '',
                        author: 'Unknown',
                        icon: null,
                        mcVersion: 'Unknown',
                        loaderType: 'Unknown',
                        source: source
                    };
                }
            })
        );

        console.log(`${term.green}[DEBUG] Cache set /api/modpacks (600s)${term.reset}`);
        cache.set(CACHE_KEY, enrichedModpacks);
        res.json(enrichedModpacks);
    } catch (e) {
        console.error(`${term.red}Error fetching modpacks: ${e.message}${term.reset}`);
        console.error(e.stack);
        res.status(500).json({ error: 'Failed to fetch modpack details' });
    }
});

// Fetch CurseForge modpack details
async function fetchCurseForgeModpack(modpack) {
    const response = await cfClient.get(`/v1/mods/${modpack.id}`);
    const mod = response.data.data;

    const primaryAuthor = mod.authors?.find(a => a.id === mod.primaryAuthorId)
        || mod.authors?.[0]
        || { name: 'Unknown' };

    const defaultIcon = mod.logo?.thumbnailUrl || mod.logo?.url || null;
    // Use alternativeImage from config if provided, otherwise use default icon
    const icon = modpack.alternativeImage || defaultIcon;

    const latestFile = mod.latestFiles?.find(f => f.id === mod.mainFileId)
        || mod.latestFiles?.[0];

    let mcVersion = 'Unknown';
    let loaderType = 'Unknown';

    if (latestFile?.gameVersions) {
        const mcVer = latestFile.gameVersions.find(v => /^\d+\.\d+(\.\d+)?$/.test(v));
        if (mcVer) mcVersion = mcVer;

        const loaders = ['NeoForge', 'Forge', 'Fabric', 'Quilt'];
        const foundLoader = latestFile.gameVersions.find(v => loaders.includes(v));
        if (foundLoader) loaderType = foundLoader;
    }

    console.log(`${term.green}    ✓ CurseForge: ${mod.name}${modpack.alternativeImage ? ' (custom image)' : ''}${term.reset}`);

    return {
        id: modpack.id,
        name: mod.name || modpack.name,
        slug: mod.slug,
        summary: mod.summary || '',
        description: mod.summary || '',
        author: primaryAuthor.name,
        authorUrl: primaryAuthor.url,
        icon: icon,
        downloads: mod.downloadCount,
        popularity: mod.popularityScore,
        dateCreated: mod.dateCreated,
        dateModified: mod.dateModified,
        dateReleased: mod.dateReleased,
        mcVersion: mcVersion,
        loaderType: loaderType,
        latestVersion: latestFile?.displayName || latestFile?.fileName || 'Unknown',
        websiteUrl: mod.links?.websiteUrl,
        source: 'curseforge',
        fileId: modpack.fileId || null,
        categories: mod.categories?.map(c => c.name) || []
    };
}

// Fetch Modrinth modpack details
async function fetchModrinthModpack(modpack) {
    console.log(`${term.cyan}    Fetching Modrinth project: ${modpack.id}${term.reset}`);

    // Fetch project info
    const projectResp = await modrinthClient.get(`/project/${modpack.id}`);
    const project = projectResp.data;

    console.log(`${term.dim}    Project found: ${project.title}${term.reset}`);

    // Fetch versions to get latest info
    const versionsResp = await modrinthClient.get(`/project/${modpack.id}/version`);
    const versions = versionsResp.data || [];

    // Get latest version or specified version
    let latestVersion = versions[0];
    if (modpack.versionId) {
        const specified = versions.find(v => v.version_number === modpack.versionId || v.id === modpack.versionId);
        if (specified) latestVersion = specified;
    }

    // Extract Minecraft version and loader from latest version
    let mcVersion = 'Unknown';
    let loaderType = 'Unknown';

    if (latestVersion) {
        mcVersion = latestVersion.game_versions?.[0] || 'Unknown';
        const loaders = latestVersion.loaders || [];
        if (loaders.includes('neoforge')) loaderType = 'NeoForge';
        else if (loaders.includes('forge')) loaderType = 'Forge';
        else if (loaders.includes('fabric')) loaderType = 'Fabric';
        else if (loaders.includes('quilt')) loaderType = 'Quilt';
        else loaderType = loaders[0] || 'Unknown';
    }

    // Get team/author info
    let author = 'Unknown';
    try {
        const teamResp = await modrinthClient.get(`/project/${modpack.id}/members`);
        const members = teamResp.data || [];
        const owner = members.find(m => m.role === 'Owner') || members[0];
        if (owner) author = owner.user?.username || 'Unknown';
    } catch (e) {
        console.log(`${term.dim}    Could not fetch team info${term.reset}`);
    }

    // Use alternativeImage from config if provided
    const icon = modpack.alternativeImage || project.icon_url;

    console.log(`${term.green}    ✓ Modrinth: ${project.title} (${mcVersion}, ${loaderType})${modpack.alternativeImage ? ' (custom image)' : ''}${term.reset}`);

    return {
        id: modpack.id,
        name: project.title || modpack.name,
        slug: project.slug,
        summary: project.description || '',
        description: project.body || project.description || '',
        author: author,
        authorUrl: null,
        icon: icon,
        downloads: project.downloads,
        popularity: project.followers,
        dateCreated: project.published,
        dateModified: project.updated,
        dateReleased: project.updated,
        mcVersion: mcVersion,
        loaderType: loaderType,
        latestVersion: latestVersion?.version_number || 'Unknown',
        websiteUrl: `https://modrinth.com/modpack/${project.slug}`,
        source: 'modrinth',
        versionId: modpack.versionId || (latestVersion?.id || null),
        categories: project.categories || []
    };
}

// Fetch Vanilla Minecraft pack details
async function fetchVanillaModpack(modpack) {
    // Use alternativeImage from config if provided
    const icon = modpack.alternativeImage || modpack.icon || 'https://launcher.mojang.com/v1/objects/0c8e1e8c95c7f8e6d5f8d6f8c8e8e8e8e8e8e8e8/minecraft.png';

    console.log(`${term.green}    ✓ Vanilla: ${modpack.name} (${modpack.minecraftVersion})${modpack.alternativeImage ? ' (custom image)' : ''}${term.reset}`);

    return {
        id: modpack.id,
        name: modpack.name || `Vanilla ${modpack.minecraftVersion}`,
        slug: modpack.id,
        summary: `Vanilla Minecraft ${modpack.minecraftVersion}`,
        description: 'Pure vanilla Minecraft experience without any modifications.',
        author: 'Mojang',
        authorUrl: 'https://www.minecraft.net',
        icon: icon,
        downloads: null,
        popularity: null,
        dateCreated: null,
        dateModified: null,
        dateReleased: null,
        mcVersion: modpack.minecraftVersion,
        loaderType: 'Vanilla',
        latestVersion: modpack.minecraftVersion,
        websiteUrl: 'https://www.minecraft.net',
        source: 'vanilla',
        categories: ['Vanilla']
    };
}

// 2. Install Plan (The "Magic" Endpoint)
app.get('/api/modpacks/:id/install', async (req, res) => {
    const idParam = req.params.id;

    // Support both numeric IDs (CurseForge) and string IDs (Modrinth)
    const numericId = parseInt(idParam);

    console.log(`${term.dim}[Install] Looking for modpack with ID: "${idParam}" (type: ${typeof idParam})${term.reset}`);

    const modpackConfig = config.modpacks.find(m => {
        const configId = String(m.id);
        const matches = configId === idParam;
        console.log(`${term.dim}  Checking: "${configId}" (${typeof m.id}) === "${idParam}" -> ${matches}${term.reset}`);
        return matches;
    });

    if (!modpackConfig) {
        console.error(`${term.red}Modpack not found: ${idParam}${term.reset}`);
        console.error(`${term.dim}Available IDs: ${config.modpacks.map(m => m.id).join(', ')}${term.reset}`);
        return res.status(404).json({ error: `Modpack "${idParam}" not found in configuration` });
    }

    console.log(`${term.cyan}[Install] Starting install plan for: ${modpackConfig.name} (${modpackConfig.source})${term.reset}`);

    try {
        const protocol = req.protocol;
        const host = req.get('host');
        const baseUrl = `${protocol}://${host}`;

        // Handle different sources
        if (modpackConfig.source === 'modrinth') {
            // Modrinth modpacks
            const plan = await modrinthModpack.getModrinthInstallPlan(modpackConfig, baseUrl);
            return res.json(plan);
        } else if (modpackConfig.source === 'vanilla') {
            // Vanilla Minecraft - no bundle needed, just return version info
            return res.json({
                name: modpackConfig.name,
                version: modpackConfig.minecraftVersion,
                minecraftVersion: modpackConfig.minecraftVersion,
                modLoader: { id: 'vanilla', primary: true },
                isBundle: false,
                files: []
            });
        }

        // CurseForge modpacks - use existing modpackManager
        const plan = await modpackManager.getInstallPlan(modpackConfig, baseUrl);
        res.json(plan);

    } catch (e) {
        console.error(colors.red(`\nInstall plan error: ${e.message}`));
        if (e.message.indexOf("manifest") !== -1) {
            res.status(500).json({ error: "Invalid modpack structure or manifest missing" });
        } else {
            res.status(500).json({ error: e.message });
        }
    }
});

// 3. Serve Bundle
// 3. Serve Bundle
app.get('/api/modpacks/:id/:version/bundle/:filename', async (req, res) => {
    const modpackId = parseInt(req.params.id);
    const version = req.params.version;
    const filename = req.params.filename;

    // Look up in manager logic
    const modpackConfig = config.modpacks.find(m => m.id === modpackId);
    if (!modpackConfig) return res.status(404).send("Modpack not found");

    // Construct path: data/modpacks/[ID]/[Version]/[Filename]
    // The ID folder should be the ID itself, not the name anymore as per request.
    const modpacksDir = path.join(DATA_DIR, 'modpacks');
    const mpDir = path.join(modpacksDir, String(modpackId), version);
    const filePath = path.join(mpDir, filename);

    if (fs.existsSync(filePath)) {
        console.log(`${term.cyan}Serving bundle: ${filePath}${term.reset}`);
        res.download(filePath);
    } else {
        console.warn(`${term.yellow}Bundle not found: ${filePath}${term.reset}`);
        res.status(404).send("Bundle not found");
    }
});

// 4. Serve Modrinth Bundle
app.get('/api/modrinth-modpacks/:slug/:version/:filename', async (req, res) => {
    const { slug, version, filename } = req.params;
    const filePath = path.join(modrinthModpack.MODPACKS_DIR, slug, version, filename);

    if (fs.existsSync(filePath)) {
        console.log(`${term.cyan}Serving Modrinth bundle: ${filename}${term.reset}`);
        res.download(filePath);
    } else {
        console.warn(`${term.yellow}Modrinth bundle not found: ${filePath}${term.reset}`);
        res.status(404).send("Bundle not found");
    }
});

app.listen(PORT, () => {
    console.clear();
    console.log(`${term.cyan}`);
    console.log(`╔════════════════════════════════════════════╗`);
    console.log(`║      ${term.bright}Backend Modpack Server${term.reset}${term.cyan}                ║`);
    console.log(`║      Running on port ${term.yellow}${PORT}${term.cyan}                  ║`);
    console.log(`╚════════════════════════════════════════════╝`);
    console.log(`${term.reset}`);
    console.log(`${term.green}✔ Ready to accept connections${term.reset}\n`);
});
