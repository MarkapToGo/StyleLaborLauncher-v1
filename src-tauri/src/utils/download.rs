use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;

#[derive(Error, Debug)]
pub enum DownloadError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Hash mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },
    #[error("Download failed after {attempts} attempts: {message}")]
    RetryExhausted { attempts: u32, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub url: String,
    pub path: String,
    pub size: Option<u64>,
    pub sha1: Option<String>,
    pub sha512: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DownloadProgress {
    pub id: String,
    pub name: String,
    pub current: u64,
    pub total: u64,
    pub status: DownloadStatus,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DownloadStatus {
    Pending,
    Downloading,
    Completed,
    Failed(String),
}

pub struct DownloadManager {
    client: Client,
    semaphore: Arc<Semaphore>,
    max_retries: u32,
}

impl DownloadManager {
    pub fn new(concurrent_downloads: usize) -> Self {
        Self {
            client: Client::builder()
                .user_agent("StyleLaborLauncher/0.1.0")
                // Avoid hanging forever on bad networks / proxies.
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("Failed to create HTTP client"),
            semaphore: Arc::new(Semaphore::new(concurrent_downloads)),
            max_retries: 3,
        }
    }

    pub async fn download_file(&self, task: &DownloadTask) -> Result<(), DownloadError> {
        let _permit = self.semaphore.acquire().await.unwrap();

        let dest_path = Path::new(&task.path);

        // Create parent directories
        if let Some(parent) = dest_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // Check if file exists and has correct hash
        if dest_path.exists() {
            if let Some(expected_sha1) = &task.sha1 {
                if super::hash::verify_sha1(dest_path, expected_sha1).await? {
                    return Ok(());
                }
            } else if let Some(expected_sha512) = &task.sha512 {
                if super::hash::verify_sha512(dest_path, expected_sha512).await? {
                    return Ok(());
                }
            } else if task.size.is_some() {
                let metadata = tokio::fs::metadata(dest_path).await?;
                if metadata.len() == task.size.unwrap() {
                    return Ok(());
                }
            }
        }

        // Download with retries
        let mut last_error = None;
        for attempt in 1..=self.max_retries {
            match self.download_with_stream(&task.url, dest_path).await {
                Ok(_) => {
                    // Verify hash after download
                    if let Some(expected_sha1) = &task.sha1 {
                        if !super::hash::verify_sha1(dest_path, expected_sha1).await? {
                            let actual = super::hash::compute_sha1(dest_path).await?;
                            last_error = Some(DownloadError::HashMismatch {
                                expected: expected_sha1.clone(),
                                actual,
                            });
                            continue;
                        }
                    }
                    if let Some(expected_sha512) = &task.sha512 {
                        if !super::hash::verify_sha512(dest_path, expected_sha512).await? {
                            last_error = Some(DownloadError::HashMismatch {
                                expected: expected_sha512.clone(),
                                actual: "verification failed".to_string(),
                            });
                            continue;
                        }
                    }
                    return Ok(());
                }
                Err(e) => {
                    last_error = Some(e);
                    if attempt < self.max_retries {
                        tokio::time::sleep(tokio::time::Duration::from_millis(
                            500 * attempt as u64,
                        ))
                        .await;
                    }
                }
            }
        }

        Err(DownloadError::RetryExhausted {
            attempts: self.max_retries,
            message: last_error.map(|e| e.to_string()).unwrap_or_default(),
        })
    }

    async fn download_with_stream(&self, url: &str, dest: &Path) -> Result<(), DownloadError> {
        let response = self.client.get(url).send().await?.error_for_status()?;

        let mut file = File::create(dest).await?;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            file.write_all(&chunk).await?;
        }

        file.flush().await?;
        Ok(())
    }

    pub async fn download_many(&self, tasks: Vec<DownloadTask>) -> Vec<Result<(), DownloadError>> {
        let futures: Vec<_> = tasks.iter().map(|task| self.download_file(task)).collect();

        futures::future::join_all(futures).await
    }

    /// Download multiple files with progress callback.
    /// The callback receives (completed_count, total_count, current_file_name).
    pub async fn download_many_with_progress<F>(
        &self,
        tasks: Vec<DownloadTask>,
        on_progress: F,
    ) -> Vec<Result<(), DownloadError>>
    where
        F: Fn(usize, usize, &str) + Send + Sync + 'static,
    {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let total = tasks.len();
        let completed = Arc::new(AtomicUsize::new(0));
        let on_progress = Arc::new(on_progress);

        let futures: Vec<_> = tasks
            .into_iter()
            .map(|task| {
                let completed = completed.clone();
                let on_progress = on_progress.clone();
                let file_name = task
                    .path
                    .rsplit('/')
                    .next()
                    .unwrap_or(&task.path)
                    .to_string();

                async move {
                    let result = self.download_file(&task).await;
                    let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                    on_progress(done, total, &file_name);
                    result
                }
            })
            .collect();

        futures::future::join_all(futures).await
    }
}

impl Default for DownloadManager {
    fn default() -> Self {
        Self::new(8)
    }
}
