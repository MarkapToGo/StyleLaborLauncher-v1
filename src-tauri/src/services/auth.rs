use crate::models::MinecraftProfile;
use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

// Using Azure AD public client
const CLIENT_ID: &str = "bc5c7afa-ee10-4aa2-b5d0-1f69ee2d0b2c"; // StyleLabor Launcher Client ID
const APP_REG_INFO_URL: &str = "https://aka.ms/AppRegInfo";

#[derive(Clone)]
pub struct AuthService {
    client: Client,
}

/// Response from device code request
#[derive(Deserialize, Debug, Clone)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

#[derive(Deserialize, Debug)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

impl AuthService {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Step 1: Request device code - returns URL and user code for user to enter
    pub async fn request_device_code(&self) -> Result<DeviceCodeResponse> {
        let params = [
            ("client_id", CLIENT_ID),
            ("scope", "XboxLive.signin offline_access"),
        ];

        println!("[DEBUG] Requesting device code...");

        let response = self
            .client
            .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode")
            .form(&params)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            println!("[DEBUG] Device code request failed: {} - {}", status, body);
            return Err(anyhow!("Failed to get device code: {} - {}", status, body));
        }

        let device_code: DeviceCodeResponse = response.json().await?;
        println!(
            "[DEBUG] Got device code! User code: {}",
            device_code.user_code
        );
        println!("[DEBUG] Verification URL: {}", device_code.verification_uri);

        Ok(device_code)
    }

    /// Step 2: Poll for token - call this repeatedly until success or timeout
    pub async fn poll_for_token(&self, device_code: &str) -> Result<Option<OAuthTokenResponse>> {
        let params = [
            ("client_id", CLIENT_ID),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ];

        let response = self
            .client
            .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
            .form(&params)
            .send()
            .await?;

        if response.status().is_success() {
            let token: OAuthTokenResponse = response.json().await?;
            return Ok(Some(token));
        }

        // Check for pending/slow_down errors
        let body = response.text().await.unwrap_or_default();

        if body.contains("authorization_pending") {
            // User hasn't authorized yet - keep polling
            return Ok(None);
        } else if body.contains("slow_down") {
            // Should wait longer between polls
            tokio::time::sleep(Duration::from_secs(5)).await;
            return Ok(None);
        } else if body.contains("expired_token") {
            return Err(anyhow!("Device code expired. Please try again."));
        } else if body.contains("authorization_declined") {
            return Err(anyhow!("Authorization was declined."));
        }

        // Some other error
        println!("[DEBUG] Token poll error: {}", body);
        Err(anyhow!("Token request failed: {}", body))
    }

    /// Refresh tokens using refresh_token
    pub async fn refresh_tokens(&self, refresh_token: &str) -> Result<OAuthTokenResponse> {
        let params = [
            ("client_id", CLIENT_ID),
            ("scope", "XboxLive.signin offline_access"),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ];

        let response = self
            .client
            .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
            .form(&params)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Failed to refresh tokens: {} - {}", status, body));
        }

        let token_resp: OAuthTokenResponse = response.json().await?;
        Ok(token_resp)
    }

    /// Complete Xbox authentication flow: MSA token -> XBL token -> XSTS token -> MC token
    pub async fn xbox_auth_flow(&self, access_token: &str) -> Result<(String, String)> {
        println!("[DEBUG] Starting Xbox auth flow...");

        // Step 1: XBL (Xbox Live) Authentication
        let xbl_token = self.xbl_authenticate(access_token).await?;
        println!("[DEBUG] XBL token obtained");

        // Step 2: XSTS Authentication
        let (xsts_token, user_hash) = self.xsts_authenticate(&xbl_token).await?;
        println!("[DEBUG] XSTS token obtained, user hash: {}", user_hash);

        // Step 3: Minecraft Authentication
        let mc_token = self.minecraft_authenticate(&xsts_token, &user_hash).await?;
        println!("[DEBUG] Minecraft token obtained!");

        Ok((mc_token, user_hash))
    }

    async fn xbl_authenticate(&self, access_token: &str) -> Result<String> {
        #[derive(Serialize)]
        #[allow(non_snake_case)]
        struct XblRequest {
            Properties: XblProperties,
            RelyingParty: String,
            TokenType: String,
        }

        #[derive(Serialize)]
        #[allow(non_snake_case)]
        struct XblProperties {
            AuthMethod: String,
            SiteName: String,
            RpsTicket: String,
        }

        #[derive(Deserialize)]
        #[allow(non_snake_case)]
        struct XblResponse {
            Token: String,
        }

        let req = XblRequest {
            Properties: XblProperties {
                AuthMethod: "RPS".to_string(),
                SiteName: "user.auth.xboxlive.com".to_string(),
                RpsTicket: format!("d={}", access_token),
            },
            RelyingParty: "http://auth.xboxlive.com".to_string(),
            TokenType: "JWT".to_string(),
        };

        let res = self
            .client
            .post("https://user.auth.xboxlive.com/user/authenticate")
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&req)
            .send()
            .await?;

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            println!("[DEBUG] XBL auth failed: {} - {}", status, body);
            return Err(anyhow!("XBL auth failed: {} - {}", status, body));
        }

        let data: XblResponse = res.json().await?;
        Ok(data.Token)
    }

    async fn xsts_authenticate(&self, xbl_token: &str) -> Result<(String, String)> {
        #[derive(Serialize)]
        #[allow(non_snake_case)]
        struct XstsRequest {
            Properties: XstsProperties,
            RelyingParty: String,
            TokenType: String,
        }

        #[derive(Serialize)]
        #[allow(non_snake_case)]
        struct XstsProperties {
            SandboxId: String,
            UserTokens: Vec<String>,
        }

        #[derive(Deserialize)]
        #[allow(non_snake_case)]
        struct XstsResponse {
            Token: String,
            DisplayClaims: DisplayClaims,
        }

        #[derive(Deserialize)]
        #[allow(non_snake_case)]
        struct DisplayClaims {
            xui: Vec<Xui>,
        }

        #[derive(Deserialize)]
        #[allow(non_snake_case)]
        struct Xui {
            uhs: String,
        }

        let req = XstsRequest {
            Properties: XstsProperties {
                SandboxId: "RETAIL".to_string(),
                UserTokens: vec![xbl_token.to_string()],
            },
            RelyingParty: "rp://api.minecraftservices.com/".to_string(),
            TokenType: "JWT".to_string(),
        };

        let res = self
            .client
            .post("https://xsts.auth.xboxlive.com/xsts/authorize")
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&req)
            .send()
            .await?;

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            println!("[DEBUG] XSTS auth failed: {} - {}", status, body);
            return Err(anyhow!("XSTS auth failed: {} - {}", status, body));
        }

        let data: XstsResponse = res.json().await?;
        let uhs = data
            .DisplayClaims
            .xui
            .first()
            .ok_or(anyhow!("No UHS found in XSTS response"))?
            .uhs
            .clone();
        Ok((data.Token, uhs))
    }

    async fn minecraft_authenticate(&self, xsts_token: &str, user_hash: &str) -> Result<String> {
        #[derive(Serialize)]
        #[allow(non_snake_case)]
        struct McReq {
            identityToken: String,
        }

        #[derive(Deserialize)]
        #[allow(non_snake_case)]
        struct McRes {
            access_token: String,
        }

        let req = McReq {
            identityToken: format!("XBL3.0 x={};{}", user_hash, xsts_token),
        };

        let res = self
            .client
            .post("https://api.minecraftservices.com/authentication/login_with_xbox")
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&req)
            .send()
            .await?;

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            println!("[DEBUG] MC auth failed: {} - {}", status, body);

            // Mojang/Minecraft Services now requires app registrations to be allowlisted for
            // `login_with_xbox`. When not approved, they return 403 with:
            // "Invalid app registration, see https://aka.ms/AppRegInfo"
            if status.as_u16() == 403
                && (body.contains("Invalid app registration")
                    || body.contains("aka.ms/AppRegInfo")
                    || body.contains("AppRegInfo"))
            {
                return Err(anyhow!(
                    "Minecraft authentication was blocked: **Invalid app registration**.\n\
Your Microsoft OAuth client_id is not approved for Minecraft Services yet.\n\
\n\
What to do (keeps your client_id, no Azure config changes required):\n\
- Submit your app/client_id for Minecraft Services access at {url}\n\
- Wait for approval, then try again\n\
\n\
Details: HTTP {status} - {body}",
                    url = APP_REG_INFO_URL,
                    status = status,
                    body = body
                ));
            }

            return Err(anyhow!("Minecraft auth failed: {} - {}", status, body));
        }

        let data: McRes = res.json().await?;
        Ok(data.access_token)
    }

    pub async fn get_profile(&self, mc_token: &str) -> Result<MinecraftProfile> {
        let res = self
            .client
            .get("https://api.minecraftservices.com/minecraft/profile")
            .bearer_auth(mc_token)
            .send()
            .await?;

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            println!("[DEBUG] Get profile failed: {} - {}", status, body);
            return Err(anyhow!("Failed to get profile: {} - {}", status, body));
        }

        let profile: MinecraftProfile = res.json().await?;
        Ok(profile)
    }
}
