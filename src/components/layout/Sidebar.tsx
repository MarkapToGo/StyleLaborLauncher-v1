import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { version } from '../../../package.json';
import {
  Home,
  Package,
  Settings,
  Download,
  Terminal,
  Image as ImageIcon,
  Users,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDownloadStore } from '../../stores/downloadStore';
import { useConsoleStore } from '../../stores/consoleStore';

const navItems = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/profiles', label: 'Profiles', icon: Users },
  { path: '/modpacks', label: 'Packs', icon: Package },
  { path: '/gallery', label: 'Gallery', icon: ImageIcon },
];

const settingsItem = { path: '/settings', label: 'Settings', icon: Settings };

export function Sidebar() {
  const { isInstalling } = useDownloadStore();
  const { isGameRunning } = useConsoleStore();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const visibleItems = [...navItems];

  return (
    <aside
      className="w-20 h-full bg-bg-secondary border-r border-border flex flex-col items-center py-4"
      data-tauri-drag-region="false"
    >
      {/* Logo */}
      <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-6 overflow-hidden">
        <img
          src="/logo-256.png"
          alt="StyleLabor"
          className="w-12 h-12 object-contain brightness-0 invert"
          draggable={false}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col items-center gap-3">
        {visibleItems.map((item) => (
          <div key={item.path} className="relative">
            <NavLink
              to={item.path}
              onMouseEnter={() => setHoveredItem(item.path)}
              onMouseLeave={() => setHoveredItem(null)}
              className={({ isActive }) =>
                cn(
                  'nav-item w-12 h-12 relative group',
                  isActive
                    ? 'text-white'
                    : 'text-text-muted hover:text-white'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Active Background Glow */}
                  {isActive && (
                    <div className="absolute inset-0 bg-accent rounded-2xl blur-md opacity-15" />
                  )}
                  {/* Active Background Solid */}
                  {isActive && (
                    <div className="absolute inset-0 bg-accent/10 border-[3px] border-accent/25 rounded-2xl" />
                  )}

                  <item.icon className={cn(
                    "w-7 h-7 transition-all duration-300 relative z-10",
                    isActive ? "text-accent drop-shadow-[0_0_8px_rgba(123,108,255,0.5)]" : "group-hover:text-accent group-hover:scale-110"
                  )} />
                </>
              )}
            </NavLink>

            {/* Tooltip */}
            <div className={cn(
              'tooltip',
              hoveredItem === item.path && 'tooltip-visible'
            )}>
              {item.label}
            </div>
          </div>
        ))}

        <div className="flex-1" />

        {/* Settings Item */}
        <div className="relative">
          <NavLink
            to={settingsItem.path}
            onMouseEnter={() => setHoveredItem(settingsItem.path)}
            onMouseLeave={() => setHoveredItem(null)}
            className={({ isActive }) =>
              cn(
                'nav-item w-12 h-12 relative group',
                isActive
                  ? 'text-white'
                  : 'text-text-muted hover:text-white'
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Active Background Glow */}
                {isActive && (
                  <div className="absolute inset-0 bg-accent rounded-xl blur-md opacity-20" />
                )}
                {/* Active Background Solid */}
                {isActive && (
                  <div className="absolute inset-0 bg-accent/10 border border-accent/20 rounded-xl" />
                )}

                <settingsItem.icon className={cn(
                  "w-7 h-7 transition-all duration-300 relative z-10",
                  isActive ? "text-accent drop-shadow-[0_0_8px_rgba(123,108,255,0.5)]" : "group-hover:text-accent group-hover:scale-110"
                )} />
              </>
            )}
          </NavLink>

          {/* Tooltip */}
          <div className={cn(
            'tooltip',
            hoveredItem === settingsItem.path && 'tooltip-visible'
          )}>
            {settingsItem.label}
          </div>
        </div>
      </nav>

      {/* Download indicator */}
      {isInstalling && (
        <div className="mb-2">
          <div className="w-9 h-9 rounded-lg bg-bg-tertiary flex items-center justify-center">
            <Download className="w-4 h-4 text-accent animate-pulse" />
          </div>
        </div>
      )}

      {/* Console button - shows when game is running */}
      {isGameRunning && (
        <div className="relative mb-2 mt-4">
          <NavLink
            to="/console"
            onMouseEnter={() => setHoveredItem('console')}
            onMouseLeave={() => setHoveredItem(null)}
            className={({ isActive }) =>
              cn(
                'nav-item w-12 h-12 relative group text-text-muted hover:text-white',
                isActive && 'text-green-400'
              )
            }
            title="Game Console"
          >
            <div className="absolute inset-0 bg-green-500 rounded-2xl blur-md opacity-15" />
            <div className="absolute inset-0 bg-green-500/10 border-[3px] border-green-500/25 rounded-2xl" />
            <Terminal className="w-7 h-7 transition-all duration-300 relative z-10 text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.5)]" />
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </NavLink>

          {/* Tooltip */}
          <div className={cn(
            'tooltip',
            hoveredItem === 'console' && 'tooltip-visible'
          )}>
            Console
          </div>
        </div>
      )}

      {/* Version */}
      <div className="text-[10px] text-text-muted mt-6">
        {version}
      </div>
    </aside>
  );
}
