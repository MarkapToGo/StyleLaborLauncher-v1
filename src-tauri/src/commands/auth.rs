use crate::models::Account;
use crate::services::auth::AuthService;
use crate::state::AppState;
use std::sync::Arc;

use tauri::State;
use tokio::sync::Mutex;

type AppStateType = Arc<Mutex<AppState>>;

#[derive(serde::Serialize, Clone)]
pub struct DeviceCodeInfo {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub message: String,
}

#[tauri::command]
pub async fn start_login() -> Result<DeviceCodeInfo, String> {
    let auth_service = AuthService::new();

    let device_code = auth_service
        .request_device_code()
        .await
        .map_err(|e| e.to_string())?;

    // Store device_code in a static or pass back - for now we'll use a different approach
    // The device_code.device_code needs to be stored for polling

    // We'll store it in a simple way - return to frontend and have frontend call poll
    // For now, return user-facing info
    Ok(DeviceCodeInfo {
        user_code: device_code.user_code,
        verification_uri: device_code.verification_uri,
        expires_in: device_code.expires_in,
        message: device_code.message,
    })
}

#[tauri::command]
pub async fn poll_login(
    device_code: String,
    state: State<'_, AppStateType>,
) -> Result<Option<Account>, String> {
    let auth_service = AuthService::new();

    // Try to get token
    let token_result = auth_service
        .poll_for_token(&device_code)
        .await
        .map_err(|e| e.to_string())?;

    match token_result {
        None => {
            // Still waiting for user to authorize
            Ok(None)
        }
        Some(token_resp) => {
            println!("[DEBUG] Got tokens! Completing Xbox auth flow...");

            // Complete Xbox/Minecraft auth flow
            let (mc_token, _user_hash) = auth_service
                .xbox_auth_flow(&token_resp.access_token)
                .await
                .map_err(|e| e.to_string())?;

            // Get Profile
            let profile = auth_service
                .get_profile(&mc_token)
                .await
                .map_err(|e| e.to_string())?;

            // Create Account object
            let account = Account {
                uuid: profile.id,
                username: profile.name,
                access_token: mc_token.clone(),
                refresh_token: token_resp.refresh_token.clone(),
                expires_at: chrono::Utc::now().timestamp() + 86400,
                is_active: true,
                skin_url: None,
            };

            // Save to state
            let state_lock = state.lock().await;
            let mut accounts = state_lock.accounts.write().await;

            // Remove existing if any
            accounts.accounts.retain(|a| a.uuid != account.uuid);

            // Set others inactive
            for a in accounts.accounts.iter_mut() {
                a.is_active = false;
            }

            accounts.accounts.push(account.clone());
            drop(accounts);

            state_lock
                .save_accounts()
                .await
                .map_err(|e| e.to_string())?;

            println!("[DEBUG] Login complete! User: {}", account.username);

            Ok(Some(account))
        }
    }
}

// We need to return the device_code for polling - update start_login
#[derive(serde::Serialize, Clone)]
pub struct LoginStartResult {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String, // Internal - for polling
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

#[tauri::command]
pub async fn start_device_login() -> Result<LoginStartResult, String> {
    let auth_service = AuthService::new();

    let dc = auth_service
        .request_device_code()
        .await
        .map_err(|e| e.to_string())?;

    Ok(LoginStartResult {
        user_code: dc.user_code,
        verification_uri: dc.verification_uri,
        device_code: dc.device_code,
        expires_in: dc.expires_in,
        interval: dc.interval,
        message: dc.message,
    })
}

#[tauri::command]
pub async fn logout(uuid: String, state: State<'_, AppStateType>) -> Result<(), String> {
    let state = state.lock().await;
    let mut accounts = state.accounts.write().await;

    accounts.accounts.retain(|a| a.uuid != uuid);

    if !accounts.accounts.is_empty() && !accounts.accounts.iter().any(|a| a.is_active) {
        accounts.accounts[0].is_active = true;
    }

    drop(accounts);
    state.save_accounts().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn refresh_token(
    uuid: String,
    state: State<'_, AppStateType>,
) -> Result<Account, String> {
    let state_lock = state.lock().await;
    let accounts_read = state_lock.accounts.read().await;

    let account = accounts_read
        .accounts
        .iter()
        .find(|a| a.uuid == uuid)
        .ok_or("Account not found")?
        .clone();

    drop(accounts_read);

    let auth_service = AuthService::new();
    let token_resp = auth_service
        .refresh_tokens(&account.refresh_token)
        .await
        .map_err(|e| e.to_string())?;

    let (mc_token, _user_hash) = auth_service
        .xbox_auth_flow(&token_resp.access_token)
        .await
        .map_err(|e| e.to_string())?;

    let mut accounts_write = state_lock.accounts.write().await;
    if let Some(acc) = accounts_write.accounts.iter_mut().find(|a| a.uuid == uuid) {
        acc.access_token = mc_token;
        acc.refresh_token = token_resp.refresh_token;
        acc.expires_at = chrono::Utc::now().timestamp() + 86400;
    }

    let updated_account = accounts_write
        .accounts
        .iter()
        .find(|a| a.uuid == uuid)
        .cloned()
        .ok_or("Account not found after update")?;

    drop(accounts_write);
    state_lock
        .save_accounts()
        .await
        .map_err(|e| e.to_string())?;

    Ok(updated_account)
}

#[tauri::command]
pub async fn get_accounts(state: State<'_, AppStateType>) -> Result<Vec<Account>, String> {
    let state = state.lock().await;
    let accounts = state.accounts.read().await;
    Ok(accounts.accounts.clone())
}

#[tauri::command]
pub async fn switch_account(uuid: String, state: State<'_, AppStateType>) -> Result<(), String> {
    let state = state.lock().await;
    let mut accounts = state.accounts.write().await;

    for account in accounts.accounts.iter_mut() {
        account.is_active = account.uuid == uuid;
    }

    drop(accounts);
    state.save_accounts().await.map_err(|e| e.to_string())?;

    Ok(())
}
