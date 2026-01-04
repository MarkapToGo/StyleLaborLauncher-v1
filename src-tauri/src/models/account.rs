use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub uuid: String,
    pub username: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub is_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skin_url: Option<String>,
}

impl Account {
    pub fn is_expired(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        now >= self.expires_at
    }

    pub fn needs_refresh(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        // Refresh 5 minutes before expiry
        now >= self.expires_at - 300
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountStorage {
    pub accounts: Vec<Account>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_token: Option<DeviceToken>,
}

impl Default for AccountStorage {
    fn default() -> Self {
        Self {
            accounts: Vec::new(),
            device_token: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceToken {
    pub private_key: String,
    pub device_token: String,
    pub created_at: i64,
}

// Microsoft/Xbox authentication responses
#[derive(Debug, Deserialize)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct XboxAuthResponse {
    pub token: String,
    pub display_claims: DisplayClaims,
}

#[derive(Debug, Deserialize)]
pub struct DisplayClaims {
    pub xui: Vec<XuiClaim>,
}

#[derive(Debug, Deserialize)]
pub struct XuiClaim {
    pub uhs: String,
}

#[derive(Debug, Deserialize)]
pub struct MinecraftAuthResponse {
    pub access_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Deserialize)]
pub struct MinecraftProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<MinecraftSkin>,
}

#[derive(Debug, Deserialize)]
pub struct MinecraftSkin {
    pub url: String,
    pub variant: String,
}
