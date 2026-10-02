use serde::Serialize;
use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW};

// GetDriveTypeW 返回值：DRIVE_UNKNOWN=0 / DRIVE_NO_ROOT_DIR=1 / DRIVE_REMOVABLE=2 / DRIVE_FIXED=3 / DRIVE_REMOTE=4 / DRIVE_CDROM=5 / DRIVE_RAMDISK=6
const DRIVE_FIXED: u32 = 3;

#[derive(Serialize)]
pub struct DiskInfo {
    pub mount: String,
    pub total: u64,
    pub free: u64,
    pub used: u64,
    pub used_percent: f64,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn drive_type(path: &str) -> u32 {
    let w = wide(path);
    unsafe { GetDriveTypeW(w.as_ptr()) }
}

/// 磁盘空间命令：原生枚举固定磁盘（C/D/E 等）容量，不再调用系统命令行工具。
/// 返回 { mount, total, free, used, used_percent } 列表。
#[tauri::command]
pub fn disk_space() -> Result<Vec<DiskInfo>, String> {
    let mut result = Vec::new();
    for c in b'A'..=b'Z' {
        let mount = format!("{}:", c as char);
        let path = format!("{}\\", mount);
        if drive_type(&path) != DRIVE_FIXED {
            continue;
        }
        let w = wide(&path);
        let mut total: u64 = 0;
        let mut free: u64 = 0;
        // 参数 2（可用字节）传 null 是允许的
        let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), std::ptr::null_mut(), &mut total, &mut free) };
        if ok == 0 || total == 0 {
            continue;
        }
        let used = total.saturating_sub(free);
        let used_percent = used as f64 / total as f64 * 100.0;
        result.push(DiskInfo {
            mount,
            total,
            free,
            used,
            used_percent,
        });
    }
    Ok(result)
}
