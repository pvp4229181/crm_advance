import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  ContactRound,
  Gauge,
  KanbanSquare,
  Mail,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  UsersRound,
  Workflow,
  X,
} from "lucide-react";
import { WhatsAppIcon } from "./WhatsAppIcon";
import { useAuth } from "../context/Auth";
import { api, money } from "../lib/api";
import type { Lead, Opportunity, Paged } from "../lib/types";
import { prefetchRoute, warmRouteChunks } from "../lib/routes";
import { Avatar } from "./ui";

// Each item carries its icon colour for the light and dark themes.
const groups = [
  { label: "", items: [["Dashboard", "/", Gauge, "#2563eb", "#60a5fa"]] },
  {
    label: "Sales",
    items: [
      ["Leads", "/leads", ContactRound, "#7c3aed", "#a78bfa"],
      ["Pipeline", "/pipeline", KanbanSquare, "#ea580c", "#fb923c"],
      ["Contacts & companies", "/contacts", UsersRound, "#0d9488", "#2dd4bf"],
    ],
  },
  {
    label: "Work",
    items: [
      ["Activities", "/activities", ClipboardCheck, "#059669", "#34d399"],
      ["Calendar", "/calendar", CalendarDays, "#e11d48", "#fb7185"],
      ["Inbox", "/inbox", Mail, "#0284c7", "#38bdf8"],
    ],
  },
  {
    label: "Automation",
    items: [
      ["Workflows", "/automation", Workflow, "#d97706", "#fbbf24"],
      ["WhatsApp", "/whatsapp", WhatsAppIcon, "#16a34a", "#25d366"],
      ["AI Assistant", "/ai", Sparkles, "#c026d3", "#e879f9"],
    ],
  },
  { label: "Insights", items: [["Reporting", "/reporting", BarChart3, "#4f46e5", "#818cf8"]] },
  { label: "Admin", items: [["Configuration", "/configuration", Settings, "#0891b2", "#22d3ee"]] },
] as const;

// Lets pages adapt to the desktop sidebar, e.g. the dashboard shortens money figures while it is open.
const SidebarContext = createContext({ collapsed: false });
export const useSidebar = () => useContext(SidebarContext);

export function Shell({ children }: { children: ReactNode }) {
  const [mobile, setMobile] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [userMenu, setUserMenu] = useState(false),
    [command, setCommand] = useState(false);
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ read: boolean }[]>("/notifications"),
  });
  useEffect(warmRouteChunks, []);
  useEffect(() => setMobile(false), [location.pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommand(true);
      }
      if (event.key === "Escape") {
        setCommand(false);
        setUserMenu(false);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const warm = (to: string) => ({
    onMouseEnter: () => prefetchRoute(to, queryClient),
    onFocus: () => prefetchRoute(to, queryClient),
  });
  const unread = (notifications.data ?? []).filter((x) => !x.read).length;
  const visible = groups.map((group) => ({
    ...group,
    items: group.items.filter(
      ([, to]) =>
        to !== "/configuration" ||
        ["Administrator", "Sales Manager"].includes(user?.role.name ?? ""),
    ),
  }));
  const sidebar = (
    <div className="flex h-full flex-col border-r border-blue-100 bg-[#f8fbff] text-slate-700">
      <div className="flex h-16 items-center border-b border-blue-100 px-4">
        <NavLink
          to="/"
          className="flex min-w-0 items-center gap-3 text-slate-950"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-sm font-bold text-white shadow-sm">
            L
          </span>
          {!collapsed && (
            <span className="truncate text-[17px] font-bold tracking-tight">
              LeadCRM
            </span>
          )}
        </NavLink>
        {!collapsed && (
          <button
            onClick={() => setMobile(false)}
            className="ml-auto grid h-9 w-9 place-items-center rounded-lg hover:bg-blue-50 md:hidden"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        )}
      </div>
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2.5 py-3">
        {visible.map((group) => (
          <div className="mb-4" key={group.label || "primary"}>
            {group.label && !collapsed && (
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[.1em] text-slate-400">
                {group.label}
              </div>
            )}
            {group.items.map(([label, to, Icon, light, dark]) => (
              <NavLink
                key={to}
                to={to}
                {...warm(to)}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  `mb-0.5 flex min-h-9 items-center gap-3 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${isActive ? "nav-active bg-blue-100 text-blue-700" : "hover:bg-blue-50 hover:text-blue-700"} ${collapsed ? "justify-center" : ""}`
                }
              >
                <span
                  className="nav-icon grid shrink-0 place-items-center"
                  style={{ "--icon": light, "--icon-dark": dark } as CSSProperties}
                >
                  <Icon size={16} />
                </span>
                {!collapsed && label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="relative border-t border-white/10 p-3">
        <button
          className={`mb-1 flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] hover:bg-white/[.07] hover:text-white ${collapsed ? "justify-center" : ""}`}
        >
          <CircleHelp size={18} className="nav-icon" style={{ "--icon": "#2563eb", "--icon-dark": "#60a5fa" } as CSSProperties} />
          {!collapsed && "Help & support"}
        </button>
        <button
          onClick={() => setUserMenu(!userMenu)}
          className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-2 hover:bg-white/[.07] ${collapsed ? "justify-center" : ""}`}
        >
          <Avatar name={user?.name} size={30} />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 text-left">
                <b className="block truncate text-xs text-white">
                  {user?.name}
                </b>
                <span className="block truncate text-[10px] text-slate-400">
                  {user?.role.name}
                </span>
              </span>
              <ChevronDown size={14} />
            </>
          )}
        </button>
        {userMenu && (
          <div className="absolute bottom-16 left-3 z-50 w-52 rounded-xl border bg-white p-1.5 text-slate-700 shadow-xl">
            <button
              className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50"
              onClick={logout}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="min-h-screen bg-[#f7f8fa]">
      <aside
        className={`fixed inset-y-0 left-0 z-50 hidden transition-[width] duration-200 md:block ${collapsed ? "w-[72px]" : "w-[240px]"}`}
      >
        {sidebar}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-[76px] grid h-7 w-7 place-items-center rounded-full border bg-white text-slate-500 shadow-sm"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>
      {mobile && (
        <>
          <button
            className="fixed inset-0 z-40 bg-slate-950/40 md:hidden"
            onClick={() => setMobile(false)}
            aria-label="Close navigation overlay"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-[280px] md:hidden">
            {sidebar}
          </aside>
        </>
      )}
      <div
        className={`transition-[padding] duration-200 ${collapsed ? "md:pl-[72px]" : "md:pl-[240px]"}`}
      >
        <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-white/95 px-4 backdrop-blur sm:px-6">
          <button
            className="mr-2 grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden"
            onClick={() => setMobile(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <button
            onClick={() => setCommand(true)}
            className="flex h-10 min-w-0 max-w-md flex-1 items-center gap-2 rounded-lg border bg-slate-50 px-3 text-left text-sm text-slate-500 hover:bg-white"
          >
            <Search size={16} />
            <span className="truncate">Search leads, deals, contacts…</span>
            <kbd className="ml-auto hidden rounded border bg-white px-1.5 py-0.5 text-[10px] text-slate-400 sm:block">
              ⌘ K
            </kbd>
          </button>
          <div className="ml-auto flex items-center gap-2 pl-3">
            <button
              onClick={() => setCommand(true)}
              className="btn btn-primary hidden sm:flex"
            >
              <Plus size={16} />
              Create
            </button>
            <NavLink
              to="/notifications"
              {...warm("/notifications")}
              className="relative grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label={
                unread ? `${unread} unread notifications` : "Notifications"
              }
            >
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {Math.min(unread, 9)}
                </span>
              )}
            </NavLink>
          </div>
        </header>
        <main className="min-h-[calc(100vh-64px)]">
          <SidebarContext.Provider value={{ collapsed }}>{children}</SidebarContext.Provider>
        </main>
      </div>
      {command && <CommandPalette onClose={() => setCommand(false)} />}
    </div>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const search = useQuery({
    queryKey: ["global-search", query],
    enabled: query.trim().length >= 2,
    queryFn: () =>
      api<{
        leads: Lead[];
        deals: Opportunity[];
        contacts: any[];
        companies: any[];
      }>(`/search?q=${encodeURIComponent(query.trim())}`),
  });
  const go = (path: string) => {
    navigate(path);
    onClose();
  };
  const actions = [
    ["Add lead", "/leads?create=1"],
    ["Import leads from CSV", "/leads/import"],
    ["Create deal", "/pipeline?create=1"],
    ["Create task", "/activities"],
    ["Schedule meeting", "/calendar"],
  ] as const;
  const resultGroups = useMemo(
    () =>
      search.data
        ? [
            [
              "Leads",
              search.data.leads.map((x) => ({
                name: x.title,
                detail: x.companyName,
                path: `/leads/${x._id}`,
              })),
            ],
            [
              "Deals",
              search.data.deals.map((x) => ({
                name: x.title,
                detail: money(x.expectedRevenue),
                path: `/opportunities/${x._id}`,
              })),
            ],
            [
              "Contacts",
              search.data.contacts.map((x) => ({
                name: x.name,
                detail: x.email,
                path: "/contacts",
              })),
            ],
            [
              "Companies",
              search.data.companies.map((x) => ({
                name: x.name,
                detail: x.industry,
                path: "/contacts",
              })),
            ],
          ]
        : [],
    [search.data],
  );
  return (
    <div
      className="fixed inset-0 z-[70] flex justify-center bg-slate-950/45 p-3 pt-[8vh] sm:p-6 sm:pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="h-fit max-h-[78vh] w-full max-w-2xl overflow-hidden rounded-2xl border bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Global command palette"
      >
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <Search className="text-slate-400" size={19} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-full min-w-0 flex-1 border-0 text-sm outline-none"
            placeholder="Search people, companies, deals…"
          />
          <button
            onClick={onClose}
            className="rounded border px-2 py-1 text-[10px] text-slate-500"
          >
            ESC
          </button>
        </div>
        <div className="scrollbar-thin max-h-[calc(78vh-56px)] overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <>
              <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Quick create
              </div>
              {actions.map(([label, path]) => (
                <button
                  key={label}
                  onClick={() => go(path)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-indigo-50 hover:text-indigo-700"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
                    <Plus size={15} />
                  </span>
                  {label}
                </button>
              ))}
            </>
          ) : search.isLoading ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Searching CRM…
            </div>
          ) : (
            resultGroups.map(([label, items]: any) => (
              <div key={label}>
                {items.length > 0 && (
                  <>
                    <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {label}
                    </div>
                    {items.map((item: any, index: number) => (
                      <button
                        key={`${item.name}-${index}`}
                        onClick={() => go(item.path)}
                        className="flex w-full items-center rounded-lg px-3 py-2.5 text-left hover:bg-slate-50"
                      >
                        <span className="text-sm font-medium">{item.name}</span>
                        <span className="ml-auto max-w-[45%] truncate text-xs text-slate-400">
                          {item.detail}
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            ))
          )}
          {query.length >= 2 &&
            !search.isLoading &&
            resultGroups.every(([, items]: any) => !items.length) && (
              <div className="p-10 text-center text-sm text-slate-500">
                No matching records found.
              </div>
            )}
        </div>
      </section>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  onNew,
  children,
}: {
  title: string;
  subtitle?: string;
  onNew?: () => void;
  children?: ReactNode;
}) {
  const loc = useLocation();
  return (
    <div className="border-b bg-white px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <div className="mb-1 text-[11px] font-medium capitalize text-slate-400">
            Workspace / {loc.pathname.split("/")[1] || "Dashboard"}
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          )}
        </div>
        {onNew && (
          <button className="btn btn-primary" onClick={onNew}>
            <Plus size={15} />
            New
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

export type FilterGroup = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};
export type ToolbarState = { filters: Record<string, string>; groupBy: string };
type SavedView = {
  _id: string;
  name: string;
  resource: string;
  query: {
    search?: string;
    filters?: Record<string, string>;
    groupBy?: string;
  };
};
const menuItem =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50";
function ToolbarMenu({
  label,
  count,
  width = "w-60",
  children,
}: {
  label: string;
  count?: number;
  width?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className="btn" onClick={() => setOpen(!open)}>
        {label}
        {count ? (
          <span className="ml-1 rounded bg-indigo-600 px-1.5 text-[10px] text-white">
            {count}
          </span>
        ) : null}
        <ChevronDown size={13} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onMouseDown={() => setOpen(false)}
          />
          <div
            className={`absolute left-0 top-11 z-50 max-h-80 overflow-auto rounded-xl border bg-white py-1 shadow-xl ${width}`}
          >
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}
export function SearchToolbar({
  value,
  onChange,
  view,
  children,
  filterGroups = [],
  groupOptions = [],
  state,
  onState,
  resource,
}: {
  value: string;
  onChange: (v: string) => void;
  view?: ReactNode;
  children?: ReactNode;
  filterGroups?: FilterGroup[];
  groupOptions?: { value: string; label: string }[];
  state?: ToolbarState;
  onState?: (next: ToolbarState) => void;
  resource?: string;
}) {
  const qc = useQueryClient(),
    filters = state?.filters ?? {},
    groupBy = state?.groupBy ?? "";
  const views = useQuery({
      queryKey: ["filters"],
      queryFn: () => api<SavedView[]>("/filters"),
      enabled: Boolean(resource),
    }),
    saved = (views.data ?? []).filter((x) => x.resource === resource);
  const saveView = useMutation({
      mutationFn: (name: string) =>
        api("/filters", {
          method: "POST",
          body: JSON.stringify({
            name,
            resource,
            query: { search: value, filters, groupBy },
          }),
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
    }),
    dropView = useMutation({
      mutationFn: (id: string) => api(`/filters/${id}`, { method: "DELETE" }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
    }),
    activeCount = Object.values(filters).filter(Boolean).length;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-white px-4 py-3 sm:px-6">
      <div className="relative min-w-52 max-w-xl flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          size={15}
        />
        <input
          className="field search-field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search records…"
        />
      </div>
      {children}
      {filterGroups.length > 0 && (
        <ToolbarMenu label="Filters" count={activeCount}>
          {(close) => (
            <>
              {filterGroups
                .filter((g) => g.options.length)
                .map((g) => (
                  <div key={g.key}>
                    <div className="px-3 pt-2 text-[10px] font-semibold uppercase text-slate-400">
                      {g.label}
                    </div>
                    {g.options.map((o) => {
                      const on = filters[g.key] === o.value;
                      return (
                        <button
                          key={o.value}
                          className={`${menuItem} ${on ? "font-semibold text-indigo-700" : ""}`}
                          onClick={() =>
                            onState?.({
                              filters: {
                                ...filters,
                                [g.key]: on ? "" : o.value,
                              },
                              groupBy,
                            })
                          }
                        >
                          <Check size={13} className={on ? "" : "invisible"} />
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
              {activeCount > 0 && (
                <button
                  className={`${menuItem} mt-1 border-t text-red-600`}
                  onClick={() => {
                    onState?.({ filters: {}, groupBy });
                    close();
                  }}
                >
                  Clear all filters
                </button>
              )}
            </>
          )}
        </ToolbarMenu>
      )}
      {groupOptions.length > 0 && (
        <ToolbarMenu label="Group by" count={groupBy ? 1 : 0} width="w-52">
          {(close) => (
            <>
              {groupOptions.map((o) => {
                const on = groupBy === o.value;
                return (
                  <button
                    key={o.value}
                    className={`${menuItem} ${on ? "font-semibold text-indigo-700" : ""}`}
                    onClick={() => {
                      onState?.({ filters, groupBy: on ? "" : o.value });
                      close();
                    }}
                  >
                    <Check size={13} className={on ? "" : "invisible"} />
                    {o.label}
                  </button>
                );
              })}
            </>
          )}
        </ToolbarMenu>
      )}
      {resource && (
        <ToolbarMenu label="Saved views" count={saved.length} width="w-64">
          {(close) => (
            <>
              {!saved.length && (
                <div className="px-3 py-2 text-xs text-slate-400">
                  No saved views yet.
                </div>
              )}
              {saved.map((item) => (
                <div className="flex" key={item._id}>
                  <button
                    className={`${menuItem} flex-1`}
                    onClick={() => {
                      onChange(item.query.search ?? "");
                      onState?.({
                        filters: item.query.filters ?? {},
                        groupBy: item.query.groupBy ?? "",
                      });
                      close();
                    }}
                  >
                    <Star size={13} />
                    {item.name}
                  </button>
                  <button
                    className="px-2 text-slate-400 hover:text-red-600"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => dropView.mutate(item._id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button
                className={`${menuItem} mt-1 border-t`}
                disabled={saveView.isPending}
                onClick={() => {
                  const name = prompt("Name this view");
                  if (name?.trim()) saveView.mutate(name.trim());
                  close();
                }}
              >
                <Star size={13} />
                Save current view
              </button>
            </>
          )}
        </ToolbarMenu>
      )}
      {view}
    </div>
  );
}
