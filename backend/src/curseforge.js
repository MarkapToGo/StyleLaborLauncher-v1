const axios = require('axios');
require('dotenv').config();

const CF_API_KEY = process.env.CF_API_KEY || '$2a$10$sOmNsFsLjHEA2FFIT5thSebGSMHDDqJuBHHk7LgzBFAW6d2IPwyt6';
const CF_API_BASE = 'https://api.curseforge.com';

const client = axios.create({
    baseURL: CF_API_BASE,
    headers: {
        'x-api-key': CF_API_KEY,
        'Accept': 'application/json'
    }
});

module.exports = {
    getMod: (modId) => client.get(`/v1/mods/${modId}`),
    getModpackInfo: (modId) => client.get(`/v1/mods/${modId}`),
    getFileInfo: (modId, fileId) => client.get(`/v1/mods/${modId}/files/${fileId}`),
    getFiles: (fileIds) => client.post('/v1/mods/files', { fileIds }),
    getDownloadUrl: (modId, fileId) => client.get(`/v1/mods/${modId}/files/${fileId}/download-url`),
    getModpackFiles: (modId, params) => client.get(`/v1/mods/${modId}/files`, { params }),
    // Batch fetch mod project info (name, author, icon, etc.)
    getMods: (modIds) => client.post('/v1/mods', { modIds }),
};
