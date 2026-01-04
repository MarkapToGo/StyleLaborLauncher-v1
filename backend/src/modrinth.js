const axios = require('axios');

const API_BASE = 'https://api.modrinth.com/v2';

const client = axios.create({
    baseURL: API_BASE,
    headers: {
        'User-Agent': 'StyleLaborLauncher/1.0 (contact@stylelabor.com)'
    }
});

/**
 * Generate multiple search query variations from a mod filename
 */
function generateSearchQueries(modName) {
    const queries = [];
    
    // Remove file extension
    let name = modName.replace(/\.jar$/i, '');
    
    // Original name (without extension)
    queries.push(name);
    
    // Remove version info like -1.24.2- or -mc1.21.1- or -neoforge etc
    let cleaned = name
        .replace(/[-_]?(neo)?forge[-_]?/gi, ' ')
        .replace(/[-_]?fabric[-_]?/gi, ' ')
        .replace(/[-_]?quilt[-_]?/gi, ' ')
        .replace(/[-_]?mc?\d+\.\d+\.?\d*[-_]?/gi, ' ')
        .replace(/[-_]?\d+\.\d+\.?\d*[-_]?/gi, ' ')
        .replace(/[-_]+/g, ' ')
        .trim();
    
    if (cleaned && cleaned.length >= 2) queries.push(cleaned);
    
    // Take first word only
    const firstWord = cleaned.split(/\s+/)[0];
    if (firstWord && firstWord.length >= 3) queries.push(firstWord);
    
    // Try replacing common patterns
    // moreoverlays -> more overlays
    const withSpaces = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    if (withSpaces !== name.toLowerCase()) queries.push(withSpaces);
    
    // Remove duplicates
    return [...new Set(queries.filter(q => q && q.length >= 2))];
}

/**
 * Search for a mod on Modrinth by name and Minecraft version
 */
async function searchMod(modName, mcVersion, loader = null) {
    const queries = generateSearchQueries(modName);
    
    for (const query of queries) {
        try {
            // Build facets for filtering
            let facets = [[`versions:${mcVersion}`], ['project_type:mod']];
            if (loader) {
                facets.push([`categories:${loader.toLowerCase()}`]);
            }
            
            const response = await client.get('/search', {
                params: {
                    query: query,
                    facets: JSON.stringify(facets),
                    limit: 10
                }
            });
            
            if (response.data.hits && response.data.hits.length > 0) {
                // Try to find the best match
                const hits = response.data.hits;
                
                // First try exact slug match
                const queryLower = query.toLowerCase().replace(/\s+/g, '-');
                const exactMatch = hits.find(h => 
                    h.slug === queryLower || 
                    h.slug.includes(queryLower) ||
                    h.title.toLowerCase() === query.toLowerCase()
                );
                
                if (exactMatch) return exactMatch;
                
                // Otherwise return first result
                return hits[0];
            }
        } catch (e) {
            // Continue to next query variation
        }
    }
    
    return null;
}

/**
 * Get versions for a project
 */
async function getProjectVersions(projectId, mcVersion, loader = null) {
    try {
        const params = {
            game_versions: JSON.stringify([mcVersion])
        };
        if (loader) {
            params.loaders = JSON.stringify([loader.toLowerCase()]);
        }
        
        const response = await client.get(`/project/${projectId}/version`, { params });
        return response.data || [];
    } catch (e) {
        return [];
    }
}

/**
 * Search and download a mod from Modrinth
 * Returns the download URL and filename if found
 */
async function findModDownload(modName, mcVersion, loader = null) {
    try {
        console.log(`  Searching Modrinth for: ${modName} (${mcVersion}, ${loader || 'any'})`);
        
        const project = await searchMod(modName, mcVersion, loader);
        if (!project) {
            console.log(`  Not found on Modrinth: ${modName}`);
            return null;
        }
        
        console.log(`  Found project: ${project.title} (${project.slug})`);
        
        const versions = await getProjectVersions(project.project_id, mcVersion, loader);
        if (!versions || versions.length === 0) {
            console.log(`  No compatible version found for ${project.title}`);
            return null;
        }
        
        // Get first (latest) version that matches
        const version = versions[0];
        if (!version.files || version.files.length === 0) return null;
        
        // Get primary file
        const file = version.files.find(f => f.primary) || version.files[0];
        
        return {
            url: file.url,
            filename: file.filename,
            projectName: project.title,
            projectId: project.project_id
        };
    } catch (e) {
        console.error(`Modrinth findModDownload error: ${e.message}`);
        return null;
    }
}

/**
 * Get project info by ID or slug
 */
async function getProject(projectIdOrSlug) {
    try {
        const response = await client.get(`/project/${projectIdOrSlug}`);
        return response.data;
    } catch (e) {
        console.error(`Modrinth getProject error: ${e.message}`);
        return null;
    }
}

/**
 * Get a specific version by ID
 */
async function getVersion(versionId) {
    try {
        const response = await client.get(`/version/${versionId}`);
        return response.data;
    } catch (e) {
        console.error(`Modrinth getVersion error: ${e.message}`);
        return null;
    }
}

/**
 * Get latest version for a project (optionally filtered by game version/loader)
 */
async function getLatestVersion(projectIdOrSlug, gameVersion = null, loader = null) {
    try {
        const params = {};
        if (gameVersion) {
            params.game_versions = JSON.stringify([gameVersion]);
        }
        if (loader) {
            params.loaders = JSON.stringify([loader.toLowerCase()]);
        }
        
        const response = await client.get(`/project/${projectIdOrSlug}/version`, { params });
        const versions = response.data || [];
        
        // Return the first (latest) version
        return versions.length > 0 ? versions[0] : null;
    } catch (e) {
        console.error(`Modrinth getLatestVersion error: ${e.message}`);
        return null;
    }
}

/**
 * Get all versions for a project
 */
async function getAllVersions(projectIdOrSlug) {
    try {
        const response = await client.get(`/project/${projectIdOrSlug}/version`);
        return response.data || [];
    } catch (e) {
        console.error(`Modrinth getAllVersions error: ${e.message}`);
        return [];
    }
}

module.exports = {
    client, // Export client for direct use
    searchMod,
    getProjectVersions,
    findModDownload,
    getProject,
    getVersion,
    getLatestVersion,
    getAllVersions
};

