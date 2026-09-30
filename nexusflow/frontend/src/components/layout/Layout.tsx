import { useTheme } from '../../hooks/useTheme';
import { useAuth } from '../../hooks/useAuth';
import { ConnectionBadge } from '../ui/Card';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '⬛' },
  { to: '/pipelines', label: 'Pipelines', icon: '▶' },
  { to: '/tasks', label: 'Tasks', icon: '⚙' },
  { to: '/queue', label: 'Queue', icon: '↑' },
  { to: '/workers', label: 'Workers', icon: '⚡' },
];

interface LayoutProps {
  children: React.ReactNode;
  wsConnected: boolean;
}

export function Layout({ children, wsConnected }: LayoutProps) {
  const { theme, toggle } = useTheme();
  const { username, logout } = useAuth();
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-blue-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">NF</span>
            </div>
            <span className="font-bold text-gray-900 dark:text-white text-sm">NexusFlow</span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Pipeline Manager</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <ConnectionBadge connected={wsConnected} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">{username}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={toggle}
                className="p-1.5 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xs"
                title="Toggle theme"
              >
                {theme === 'dark' ? '☀' : '☾'}
              </button>
              <button
                onClick={() => void logout()}
                className="p-1.5 rounded text-gray-500 hover:text-red-600 dark:text-gray-400 text-xs"
                title="Logout"
              >
                ⏏
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
