use crate::services::screenshot_watcher::GalleryImage;
use crate::utils::paths;
use arboard::Clipboard;
use std::fs;
use tauri::command;

#[command]
pub async fn get_gallery_images() -> Result<Vec<GalleryImage>, String> {
    let meta_path = paths::get_game_data_dir().join("gallery_metadata.json");

    if !meta_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(meta_path).map_err(|e| e.to_string())?;
    let mut images: Vec<GalleryImage> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Sort by timestamp descending (newest first)
    images.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(images)
}

#[command]
pub async fn delete_gallery_image(id: String) -> Result<(), String> {
    let gallery_dir = paths::get_game_data_dir().join("gallery");
    let meta_path = paths::get_game_data_dir().join("gallery_metadata.json");

    if !meta_path.exists() {
        return Err("Metadata file not found".to_string());
    }

    let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let mut images: Vec<GalleryImage> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(index) = images.iter().position(|img| img.id == id) {
        let image = &images[index];
        let file_path = gallery_dir.join(&image.filename);

        // Delete file
        if file_path.exists() {
            fs::remove_file(file_path).map_err(|e| e.to_string())?;
        }

        // Remove from list
        images.remove(index);

        // Save metadata
        let new_content = serde_json::to_string_pretty(&images).map_err(|e| e.to_string())?;
        fs::write(meta_path, new_content).map_err(|e| e.to_string())?;

        Ok(())
    } else {
        Err("Image not found".to_string())
    }
}

#[command]
pub async fn open_gallery_folder() -> Result<(), String> {
    let gallery_dir = paths::get_game_data_dir().join("gallery");
    if !gallery_dir.exists() {
        fs::create_dir_all(&gallery_dir).map_err(|e| e.to_string())?;
    }
    crate::utils::open_file_explorer(&gallery_dir.to_string_lossy())
}

#[command]
pub async fn copy_image_to_clipboard(path: String) -> Result<(), String> {
    use arboard::ImageData;
    use std::path::Path;

    let img_path = Path::new(&path);
    if !img_path.exists() {
        return Err("Image file not found".to_string());
    }

    // Read the image file
    let img_data = fs::read(img_path).map_err(|e| format!("Failed to read image: {}", e))?;

    // Decode the image using the image crate
    let img =
        image::load_from_memory(&img_data).map_err(|e| format!("Failed to decode image: {}", e))?;

    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    // Create ImageData for clipboard
    let img_data = ImageData {
        width: width as usize,
        height: height as usize,
        bytes: rgba.into_raw().into(),
    };

    // Use a thread to avoid blocking and clipboard issues with async
    std::thread::spawn(move || {
        let mut clipboard =
            Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
        clipboard
            .set_image(img_data)
            .map_err(|e| format!("Failed to copy to clipboard: {}", e))
    })
    .join()
    .map_err(|_| "Thread panicked".to_string())?
}
