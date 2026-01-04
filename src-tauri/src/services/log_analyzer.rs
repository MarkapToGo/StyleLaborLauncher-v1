use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CrashReport {
    pub title: String,
    pub description: String,
    pub solution: String,
}

pub fn analyze_log(log_content: &str) -> Option<CrashReport> {
    // 1. OutOfMemoryError
    if log_content.contains("java.lang.OutOfMemoryError") || log_content.contains("Out of memory") {
        return Some(CrashReport {
            title: "Out of Memory".into(),
            description: "The game ran out of dedicated RAM.".into(),
            solution: "Increase the maximum memory allocation in Settings. We recommend at least 4GB for modern modpacks, or 6-8GB for large packs.".into(),
        });
    }

    // 2. Class Version Error (Java Version)
    // "has been compiled by a more recent version of the Java Runtime"
    // "UnsupportedClassVersionError"
    if log_content.contains("UnsupportedClassVersionError")
        || log_content.contains("has been compiled by a more recent version")
    {
        return Some(CrashReport {
            title: "Java Version Mismatch".into(),
            description: "A mod requires a newer version of Java than what is currently used.".into(),
            solution: "Go to Settings and ensure you are using the correct Java version. For older versions (1.16 and below) use Java 8/11. For 1.17+, use Java 17 or 21/25.".into(),
        });
    }

    // 3. Mixin / Generic Mod Error
    // "Mixin apply failed"
    if log_content.contains("Mixin apply failed")
        || log_content
            .contains("org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError")
    {
        return Some(CrashReport {
            title: "Mod Incompatibility (Mixin)".into(),
            description: "A core mod failed to apply its changes to the game code.".into(),
            solution: "This is usually caused by conflicting mods. Check if you have duplicate versions of the same mod or incompatible optimization mods (like OptiFine with Sodium/Rubidium).".into(),
        });
    }

    // 4. Missing Dependency
    if let Some(captures) = Regex::new(r"requires\s+([a-zA-Z0-9_]+)\s+of\s+([a-zA-Z0-9_\-\.]+)")
        .ok()?
        .captures(log_content)
    {
        let mod_name = captures.get(1).map_or("Unknown", |m| m.as_str());
        return Some(CrashReport {
            title: "Missing Dependency".into(),
            description: format!("A mod requires '{}' to be installed.", mod_name),
            solution:
                "Please look for the missing mod on CurseForge/Modrinth and add it to your profile."
                    .into(),
        });
    }

    // 5. Fabric/NeoForge generic API error
    if log_content.contains("net.fabricmc.loader.impl.FormattedException: Mod resolution encountered an incompatible mod") {
         return Some(CrashReport {
            title: "Incompatible Mod".into(),
            description: "Fabric Loader found an incompatible mod.".into(),
            solution: "Read the error log closely usually listed just below 'Incompatible mod'. Remove the conflicting mod.".into(),
        });
    }

    // 6. Graphics Driver (more common than you think)
    // "EXCEPTION_ACCESS_VIOLATION" is generic but often driver related or bad java
    if log_content.contains("EXCEPTION_ACCESS_VIOLATION") && log_content.contains("atio6axx.dll") {
        return Some(CrashReport {
            title: "Graphics Driver Crash (AMD)".into(),
            description: "AMD OpenGL driver crash detected.".into(),
            solution: "Update your AMD graphics drivers. If that doesn't work, try allocating LESS RAM (weirdly enough) or disable Mipmaps in options.txt.".into(),
        });
    }

    None
}
