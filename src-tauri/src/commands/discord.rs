//! Discord Rich Presence Tauri commands.

use crate::services::discord;

/// Set Discord Rich Presence when a game is launched.
#[tauri::command]
pub async fn discord_set_presence(
    profile_name: String,
    version: String,
    loader: String,
) -> Result<(), String> {
    discord::set_presence(&profile_name, &version, &loader)
}

/// Clear Discord Rich Presence when the game stops.
#[tauri::command]
pub async fn discord_clear_presence() -> Result<(), String> {
    discord::clear_presence()
}

/// Manually connect to Discord.
#[tauri::command]
pub async fn discord_connect() -> Result<(), String> {
    discord::connect()
}

/// Manually disconnect from Discord.
#[tauri::command]
pub async fn discord_disconnect() -> Result<(), String> {
    discord::disconnect()
}

/// Check if Discord is connected.
#[tauri::command]
pub async fn discord_is_connected() -> bool {
    discord::is_connected()
}
