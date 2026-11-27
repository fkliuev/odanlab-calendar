// The same build can also be served directly by the calendar API.
window.CALENDAR_API = location.hostname.endsWith('.github.io')
  ? 'https://desktop-0l2k3po.taila60572.ts.net:8443'
  : location.origin;
