use crate::utils::paths;

#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    crate::utils::open_file_explorer(&path)
}

#[tauri::command]
pub async fn get_game_directory() -> Result<String, String> {
    let path = paths::get_game_dir();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    Ok(())
}
