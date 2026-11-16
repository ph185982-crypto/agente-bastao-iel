// Ícones de traço (24x24), inline, sem dependências. O nome vem do menu (string serializável).
const P: Record<string, React.ReactNode> = {
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>,
  home: <><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9.5h4.5v-5h3v5H18V10" /></>,
  users: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 19.5c.6-3.3 3.1-5 6.5-5s5.9 1.7 6.5 5" /><path d="M16 5.3a3.4 3.4 0 0 1 0 6.4M18.5 14.8c1.6.7 2.7 2.2 3 4.7" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.6 2.6 4.6-5.2" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  truck: <><path d="M3 6.5h11v9H3zM14 9.5h3.7l2.8 3v3h-6.5" /><circle cx="7.5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  chart: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-4M12.5 16V8M17 16v-6.5" /></>,
  shield: <><path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6z" /><path d="m9.2 12 2 2 3.6-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 5h11l-2 4 2 4H5" /></>,
  store: <><path d="M4 9.5 5.5 4h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" /><path d="M5.5 12.5V20h13v-7.5" /><path d="M10 20v-4.5h4V20" /></>,
  signal: <><path d="M4 14.5a8 8 0 0 1 16 0" /><path d="M7.5 14.5a4.5 4.5 0 0 1 9 0" /><circle cx="12" cy="14.5" r="1.2" /><path d="M12 15.7V20" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="3.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>,
  folder: <><path d="M3.5 7.5a2.5 2.5 0 0 1 2.5-2.5h3.6l2 2.5H18a2.5 2.5 0 0 1 2.5 2.5v7.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z" /></>,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c.7-4 3.5-6 7.5-6s6.8 2 7.5 6" /></>,
  logout: <><path d="M14 4.5h3.5A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5H14" /><path d="M10 8.5 5.5 12 10 15.5M5.5 12H15" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  "chevrons-left": <><path d="m11 7-5 5 5 5" /><path d="m18 7-5 5 5 5" /></>,
  "chevrons-right": <><path d="m6 7 5 5-5 5" /><path d="m13 7 5 5-5 5" /></>,
  dashboard: <><rect x="3.5" y="3.5" width="7.5" height="9" rx="2" /><rect x="13" y="3.5" width="7.5" height="5.5" rx="2" /><rect x="13" y="11" width="7.5" height="9.5" rx="2" /><rect x="3.5" y="14.5" width="7.5" height="6" rx="2" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><path d="M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5H19a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5z" /><circle cx="16" cy="13.5" r="1.2" /></>,
  briefcase: <><rect x="3.5" y="7.5" width="17" height="12" rx="3" /><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 13h17" /></>,
  megaphone: <><path d="M4 10.5v3a1 1 0 0 0 1 1h2.5l7 4v-13l-7 4H5a1 1 0 0 0-1 1z" /><path d="M18 9.5a4 4 0 0 1 0 5" /></>,
  chat: <><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" /></>,
  funnel: <><path d="M4 5.5h16l-6 7v5.5l-4 2v-7.5z" /></>,
  doc: <><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4M9.5 12h5M9.5 15.5h5" /></>,
  pen: <><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" /><path d="m14.5 6.5 3 3" /></>,
  list: <><path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20" /><circle cx="4.8" cy="6.5" r="1" /><circle cx="4.8" cy="12" r="1" /><circle cx="4.8" cy="17.5" r="1" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="3" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
};

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {P[name] ?? P.grid}
    </svg>
  );
}
