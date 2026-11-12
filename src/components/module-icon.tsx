export type ModuleIconName =
  | "dashboard"
  | "collaboration"
  | "finance"
  | "hr"
  | "business"
  | "marketing"
  | "operations"
  | "store"
  | "approvals"
  | "reports";

export function isModuleIconName(value: string): value is ModuleIconName {
  return [
    "dashboard",
    "collaboration",
    "finance",
    "hr",
    "business",
    "marketing",
    "operations",
    "store",
    "approvals",
    "reports",
  ].includes(value);
}

export function ModuleIcon({ name }: { name: ModuleIconName }) {
  return (
    <span className={`nav-icon module-icon module-icon-${name}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        {name === "dashboard" && (
          <>
            <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
            <rect x="13.5" y="3.5" width="7" height="4" rx="1.5" />
            <rect x="13.5" y="10.5" width="7" height="10" rx="2" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
          </>
        )}
        {name === "collaboration" && (
          <>
            <path d="M4 5.5h11a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-5l-4.5 3v-3.3A3 3 0 0 1 3 12.5v-4a3 3 0 0 1 1-3Z" />
            <path d="M9 5.5V4.8A2.8 2.8 0 0 1 11.8 2h6.4A2.8 2.8 0 0 1 21 4.8v5.4a2.8 2.8 0 0 1-2.8 2.8H18" />
            <path d="M7.5 10.5h.01M11 10.5h.01M14.5 10.5h.01" />
          </>
        )}
        {name === "finance" && (
          <>
            <rect x="3" y="5" width="18" height="15" rx="3" />
            <path d="M3.5 9h17M15 14h3" />
            <path d="M6 5V4a2 2 0 0 1 2-2h8" />
            <circle cx="7" cy="14.5" r=".7" />
          </>
        )}
        {name === "hr" && (
          <>
            <circle cx="9" cy="8" r="3.2" />
            <path d="M3 20v-1.4a5.6 5.6 0 0 1 11.2 0V20M15.5 5.1a3.1 3.1 0 0 1 0 5.9M17.2 14a4.8 4.8 0 0 1 3.8 4.7V20" />
          </>
        )}
        {name === "business" && (
          <>
            <rect x="3" y="7" width="18" height="13" rx="2.5" />
            <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7M3.5 12h17M10 12v2h4v-2" />
          </>
        )}
        {name === "marketing" && (
          <>
            <path d="M4 10v4h4l9 5V5l-9 5H4Z" />
            <path d="m8 14 2 5h3l-2.2-3.8M20 9a4 4 0 0 1 0 6M18 7a7 7 0 0 1 0 10" />
          </>
        )}
        {name === "operations" && (
          <>
            <path d="M5 5h14M5 12h14M5 19h14" />
            <circle cx="9" cy="5" r="2" />
            <circle cx="15" cy="12" r="2" />
            <circle cx="8" cy="19" r="2" />
          </>
        )}
        {name === "store" && (
          <>
            <path d="M4 9h16l-1.2 11H5.2L4 9Z" />
            <path d="m3 9 2-5h14l2 5M9 9a3 3 0 0 0 6 0M9 14v3M15 14v3" />
          </>
        )}
        {name === "approvals" && (
          <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="m8 12.2 2.6 2.6 5.5-5.7M12 1.5v2M22.5 12h-2M3.5 12h-2M12 22.5v-2" />
          </>
        )}
        {name === "reports" && (
          <>
            <path d="M4 20V4M4 20h17" />
            <rect x="7" y="12" width="3" height="5" rx="1" />
            <rect x="12" y="8" width="3" height="9" rx="1" />
            <rect x="17" y="5" width="3" height="12" rx="1" />
          </>
        )}
      </svg>
    </span>
  );
}
