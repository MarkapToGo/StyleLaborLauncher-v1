use regex::Regex;

pub fn slugify(name: &str) -> String {
    // 1. Lowercase
    let lower = name.to_lowercase();

    // 2. Replace non-alphanumeric with hyphens
    let re = Regex::new(r"[^a-z0-9]+").unwrap();
    let slug = re.replace_all(&lower, "-");

    // 3. Trim hyphens from ends
    let trimmed = slug.trim_matches('-');

    if trimmed.is_empty() {
        // Fallback for names entirely made of special chars
        return uuid::Uuid::new_v4().to_string();
    }

    trimmed.to_string()
}

pub fn get_unique_id(name: &str, existing_ids: &[String]) -> String {
    let base_slug = slugify(name);
    let mut candidate = base_slug.clone();
    let mut counter = 1;

    while existing_ids.contains(&candidate) {
        candidate = format!("{}-{}", base_slug, counter);
        counter += 1;
    }

    candidate
}
