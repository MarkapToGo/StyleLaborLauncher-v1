//! Discord Rich Presence integration for the launcher.
//!
//! Manages Discord IPC connection and updates presence when playing Minecraft.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Discord Application ID for StyleLabor Launcher.
/// Replace this with your own application ID from https://discord.com/developers/applications
const DISCORD_APP_ID: &str = "1456968997130997803";

/// Global Discord RPC client instance.
static DISCORD_CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
static IS_CONNECTED: AtomicBool = AtomicBool::new(false);

/// Initialize and connect to Discord.
/// Returns Ok(()) if successful or if already connected.
/// Returns Err if Discord is not running or connection fails.
pub fn connect() -> Result<(), String> {
    if IS_CONNECTED.load(Ordering::SeqCst) {
        return Ok(());
    }

    let mut client = DiscordIpcClient::new(DISCORD_APP_ID)
        .map_err(|e| format!("Failed to create Discord client: {}", e))?;

    client
        .connect()
        .map_err(|e| format!("Failed to connect to Discord: {}", e))?;

    log::info!("Connected to Discord Rich Presence");

    let mut guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    *guard = Some(client);
    IS_CONNECTED.store(true, Ordering::SeqCst);

    Ok(())
}

/// Disconnect from Discord.
pub fn disconnect() -> Result<(), String> {
    if !IS_CONNECTED.load(Ordering::SeqCst) {
        return Ok(());
    }

    let mut guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut client) = *guard {
        let _ = client.close();
    }
    *guard = None;
    IS_CONNECTED.store(false, Ordering::SeqCst);

    log::info!("Disconnected from Discord Rich Presence");
    Ok(())
}

/// Check if Discord is connected.
pub fn is_connected() -> bool {
    IS_CONNECTED.load(Ordering::SeqCst)
}

/// Set the Discord presence to show what profile is being played.
///
/// # Arguments
/// * `profile_name` - The name of the profile/modpack being played
/// * `version` - Minecraft version (e.g., "1.20.1")
/// * `loader` - Mod loader name (e.g., "NeoForge", "Fabric", "Vanilla")
pub fn set_presence(profile_name: &str, version: &str, loader: &str) -> Result<(), String> {
    // Try to connect if not already connected
    if !IS_CONNECTED.load(Ordering::SeqCst) {
        // Attempt connection, but don't fail if Discord isn't running
        if let Err(e) = connect() {
            log::warn!("Discord not available (is Discord running?): {}", e);
            return Ok(()); // Silently succeed - Discord integration is optional
        }
    }

    let mut guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    let client = guard.as_mut().ok_or("Discord client not initialized")?;

    // Build state string
    let state = if loader.to_lowercase() == "vanilla" {
        format!("Minecraft {}", version)
    } else {
        format!("{} • {}", version, loader)
    };

    // Get current timestamp for elapsed time
    let start_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Build strings first to avoid lifetime issues with temporaries
    let details = format!("Playing {}", profile_name);

    let activity = activity::Activity::new()
        .details(&details)
        .state(&state)
        .assets(
            activity::Assets::new()
                .large_image("launcher_icon")
                .large_text("StyleLabor Launcher"),
        )
        .timestamps(activity::Timestamps::new().start(start_time));

    client
        .set_activity(activity)
        .map_err(|e| format!("Failed to set Discord activity: {}", e))?;

    log::info!(
        "Discord presence updated: {} ({} {})",
        profile_name,
        version,
        loader
    );
    Ok(())
}

/// Clear the game presence and return to idle (browsing launcher).
pub fn clear_presence() -> Result<(), String> {
    if !IS_CONNECTED.load(Ordering::SeqCst) {
        return Ok(());
    }

    // Return to idle presence instead of clearing completely
    log::info!("Game ended, returning to idle presence");
    set_idle_presence()
}

/// Set idle presence (browsing launcher, not playing).
pub fn set_idle_presence() -> Result<(), String> {
    if !IS_CONNECTED.load(Ordering::SeqCst) {
        return Err("Not connected to Discord".to_string());
    }

    let mut guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    let client = guard.as_mut().ok_or("Discord client not initialized")?;

    let activity = activity::Activity::new()
        .details("Browsing modpacks")
        .state("In Launcher")
        .assets(
            activity::Assets::new()
                .large_image("launcher_icon")
                .large_text("StyleLabor Launcher"),
        );

    client
        .set_activity(activity)
        .map_err(|e| format!("Failed to set Discord idle activity: {}", e))?;

    log::info!("Discord idle presence set");
    Ok(())
}
