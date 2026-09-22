import { Link, useLocation } from 'react-router-dom';

// ponytail: tabs are plain links to the EXISTING routes — no page code moved.
// Deep links, bookmarks and every navigate('/posts') keep working unchanged.
export const SECTIONS = {
  today: [
    { path: '/',          label: 'היום' },
    { path: '/insights',  label: 'תובנות' },
    { path: '/tasks',     label: 'משימות' },
    { path: '/events',    label: 'אירועים' },
  ],
  business: [
    { path: '/reviews',   label: 'ביקורות' },
    { path: '/posts',     label: 'פוסטים' },
    { path: '/marketing', label: 'פרסום ממומן' },
  ],
  competitors: [
    { path: '/competitors',        label: 'מי הם' },
    { path: '/social-competition', label: 'מה הם מפרסמים' },
    { path: '/competitors-offers', label: 'מבצעים שלהם' },
  ],
};

/** @param {string} path @param {string} pathname */
function matches(path, pathname) {
  if (path === '/') return pathname === '/' || pathname === '/dashboard';
  return pathname === path || pathname.startsWith(path + '/');
}

/** @param {string} section @param {string} pathname */
export function isInSection(section, pathname) {
  return (SECTIONS[section] || []).some(({ path }) => matches(path, pathname));
}

export default function SectionTabs({ section }) {
  const { pathname } = useLocation();
  const tabs = SECTIONS[section];
  if (!tabs) return null;

  return (
    <nav dir="rtl" className="flex flex-wrap items-center gap-1.5">
      {tabs.map(({ path, label }) => {
        const active = matches(path, pathname);
        return (
          <Link
            key={path}
            to={path}
            className="px-3 py-1.5 rounded-full text-[13px] transition-colors"
            style={{
              background: active ? 'hsl(var(--sidebar-primary))' : 'transparent',
              color: active ? '#fff' : '#888888',
              fontWeight: active ? 600 : 400,
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
