import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ToastContainer } from '../ui/Toast';
import { cn } from '../../lib/utils';

export function Layout() {
  const location = useLocation();
  // Home and Profile Settings (which has its own full-page layout) are full width
  const isFullWidth = location.pathname === '/' || (location.pathname.startsWith('/profiles/') && location.pathname.endsWith('/settings'));

  return (
    <div className="flex h-screen bg-bg-primary overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <Header />

        {/* Page content */}
        <main
          className={cn(
            "flex-1 overflow-y-auto scroll-smooth-container",
            isFullWidth ? "p-0" : "p-5"
          )}
          data-tauri-drag-region="false"
        >
          <Outlet />
        </main>
      </div>

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}
