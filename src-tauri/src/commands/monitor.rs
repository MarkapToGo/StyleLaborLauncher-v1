use crate::state::AppState;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::State;

#[derive(serde::Serialize)]
pub struct ProcessStats {
    pub cpu_usage: f32,
    pub memory_usage: u64, // in bytes
}

#[tauri::command]
pub async fn get_process_stats(
    state: State<'_, AppState>,
    pid: u32,
) -> Result<ProcessStats, String> {
    let mut system = state.monitor_system.lock().map_err(|e| e.to_string())?;

    // Convert u32 PID to sysinfo PID
    let sys_pid = Pid::from_u32(pid);

    // Refresh only the specific process
    // In sysinfo 0.32, refresh_processes takes options to filter
    system.refresh_processes(ProcessesToUpdate::Some(&[sys_pid]), true);

    if let Some(process) = system.process(sys_pid) {
        return Ok(ProcessStats {
            cpu_usage: process.cpu_usage(),
            memory_usage: process.memory(),
        });
    }

    // Process not found
    Err(format!("Process with PID {} not found", pid))
}
