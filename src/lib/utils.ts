import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Compares two semantic version strings.
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 * Handles "v" prefix, whitespace, and non-numeric segments.
 */
export function compareVersions(v1: string, v2: string): number {
  const extractVersion = (v: string) => {
    let s = v.trim();
    // 1. If it has spaces, take the last part (fixes "Name Version")
    if (s.includes(' ')) {
        const parts = s.split(' ');
        const last = parts[parts.length - 1];
        // Only use last part if it looks somewhat version-like (has digit)
        if (/\d/.test(last)) s = last;
    }
    
    // 2. Try to find a standard x.y(.z) pattern at the end of the string
    // This fixes "ATM10-5.4" -> extracting "5.4" instead of "10"
    const match = s.match(/(\d+(\.\d+)+)[^\d]*$/);
    if (match) {
        return match[1];
    }
    
    // Fallback: just remove leading 'v'
    return s.replace(/^v/i, '');
  };

  const parts1 = extractVersion(v1).split(/[.-]/);
  const parts2 = extractVersion(v2).split(/[.-]/);
  
  const maxLength = Math.max(parts1.length, parts2.length);
  
  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] || '0';
    const p2 = parts2[i] || '0';
    
    // Try numeric comparison first
    const n1 = parseInt(p1);
    const n2 = parseInt(p2);
    
    if (!isNaN(n1) && !isNaN(n2)) {
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    } else {
      // String comparison for alphabetic parts (e.g. beta)
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
  }
  
  return 0;
}
