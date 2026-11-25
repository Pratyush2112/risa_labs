import React from 'react';

// Minimal stroke icon set (24px grid, 1.75 stroke). Decorative unless a label is passed.
const P = {
  overview: <><rect x="3.5" y="3.5" width="7" height="9" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.5" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.5" /><rect x="3.5" y="15.5" width="7" height="5" rx="1.5" /></>,
  campaigns: <><path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z" /><path d="M16 8.5a5 5 0 0 1 0 7" /><path d="M18.5 6a8.5 8.5 0 0 1 0 12" /></>,
  tasks: <><rect x="3.5" y="4" width="5" height="16" rx="1.2" /><rect x="10" y="4" width="5" height="11" rx="1.2" /><rect x="16.5" y="4" width="4" height="7" rx="1.2" /></>,
  bets: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  data: <><ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" /><path d="M5 12v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6" /></>,
  method: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5Z" /></>,
  chat: <><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7.5L7 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" /><path d="M8 10h8M8 13h5" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  send: <><path d="M4 12h12" /><path d="m12 6 6 6-6 6" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4Z" /><path d="M12 10v4.5" /><path d="M12 17.2v.3" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  trash: <><path d="M5 7h14" /><path d="M10 7V5h4v2" /><path d="M7 7l1 13h8l1-13" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16Z" /></>,
  reset: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /></>,
  chevron: <><path d="m9 6 6 6-6 6" /></>,
  arrowRight: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14" rx="1.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  database: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
};

export default function Icon({ name, size = 18, label, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined}
      aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      {P[name]}
    </svg>
  );
}
