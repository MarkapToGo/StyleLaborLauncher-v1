use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct McLogsResponse {
    success: bool,
    #[serde(default)]
    #[allow(dead_code)]
    id: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[tauri::command]
pub async fn upload_log(content: String) -> Result<String, String> {
    let client = reqwest::Client::new();

    let params = [("content", content)];

    let response = client
        .post("https://api.mclo.gs/1/log")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to upload log: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "MCLogs returned error status: {}",
            response.status()
        ));
    }

    let result: McLogsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse MCLogs response: {}", e))?;

    if result.success {
        result.url.ok_or_else(|| "No URL in response".to_string())
    } else {
        Err(result.error.unwrap_or_else(|| "Unknown error".to_string()))
    }
}
