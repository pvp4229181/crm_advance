import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Smartphone } from "lucide-react";
import { WhatsAppIcon } from "../components/WhatsAppIcon";
import { PageHeader } from "../components/Shell";
import { Avatar, Empty, Loading } from "../components/ui";
import { api } from "../lib/api";
import type { Lead, Paged } from "../lib/types";
import { useAuth } from "../context/Auth";
import { WhatsAppPanel } from "./LeadDetail";
import { WhatsAppTemplates } from "./WhatsAppTemplates";
import { WhatsAppBotSettings } from "./WhatsAppBot";

const tabs = {
  conversations: "Conversations",
  templates: "Templates",
  bot: "Bot agent",
} as const;

export default function WhatsAppAutomation() {
  const { user } = useAuth();
  const isAdmin = user?.role.name === "Administrator";
  const [tab, setTab] = useState<keyof typeof tabs>("conversations");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const leads = useQuery({
    queryKey: ["whatsapp-leads"],
    queryFn: () => api<Paged<Lead>>("/leads?page=1&limit=100"),
  });
  const available = useMemo(
    () =>
      (leads.data?.data ?? []).filter((lead) => {
        const term = search.trim().toLowerCase();
        return (
          lead.phone &&
          (!term ||
            lead.title.toLowerCase().includes(term) ||
            lead.contactName?.toLowerCase().includes(term) ||
            lead.companyName?.toLowerCase().includes(term) ||
            lead.phone.includes(term))
        );
      }),
    [leads.data, search],
  );
  const selected =
    available.find((lead) => lead._id === selectedId) ?? available[0];

  return (
    <>
      <PageHeader
        title="WhatsApp Automation"
        subtitle="Chat with leads directly or let the AI bot handle replies"
      >
        <span className="badge bg-emerald-50 text-emerald-700">
          <Smartphone size={13} /> Human + AI modes
        </span>
      </PageHeader>
      <nav className="flex overflow-x-auto border-b bg-white px-4 sm:px-6">
        {(Object.keys(tabs) as (keyof typeof tabs)[]).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={tab === item}
            onClick={() => setTab(item)}
            className={`border-b-2 px-4 py-3 text-xs font-semibold ${tab === item ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500"}`}
          >
            {tabs[item]}
          </button>
        ))}
      </nav>
      {tab === "templates" && (
        <div className="p-4 sm:p-6">
          <WhatsAppTemplates isAdmin={isAdmin} />
        </div>
      )}
      {tab === "bot" && (
        <div className="p-4 sm:p-6">
          <WhatsAppBotSettings isAdmin={isAdmin} />
        </div>
      )}
      {tab === "conversations" && (
        <div className="grid min-h-[calc(100vh-145px)] gap-4 p-4 sm:p-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="panel h-fit overflow-hidden lg:sticky lg:top-20">
            <div className="border-b p-4">
              <h2 className="font-semibold text-slate-900">Lead conversations</h2>
              <p className="mt-1 text-xs text-slate-500">
                Select a lead to open their WhatsApp chat.
              </p>
              <label className="relative mt-3 block">
                <span className="sr-only">Search WhatsApp leads</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={15}
                />
                <input
                  className="field search-field"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search leads..."
                />
              </label>
            </div>
            <div className="max-h-[calc(100vh-310px)] overflow-y-auto p-2">
              {leads.isLoading ? (
                <Loading />
              ) : available.length ? (
                available.map((lead) => {
                  const active = lead._id === selected?._id;
                  return (
                    <button
                      key={lead._id}
                      type="button"
                      onClick={() => setSelectedId(lead._id)}
                      aria-pressed={active}
                      className={`mb-1 flex min-h-16 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${active ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" : "hover:bg-slate-50"}`}
                    >
                      <Avatar name={lead.contactName || lead.title} size={34} />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-sm">
                          {lead.contactName || lead.title}
                        </b>
                        <span className="block truncate text-xs text-slate-500">
                          {lead.companyName || lead.phone}
                        </span>
                      </span>
                      <WhatsAppIcon
                        size={16}
                        className="shrink-0 text-emerald-600"
                      />
                    </button>
                  );
                })
              ) : (
                <Empty
                  title="No WhatsApp leads"
                  detail="Add a phone number to a lead to start chatting."
                />
              )}
            </div>
          </aside>
          <section className="min-w-0">
            {selected ? (
              <WhatsAppPanel leadId={selected._id} phone={selected.phone} />
            ) : leads.isLoading ? (
              <div className="panel">
                <Loading />
              </div>
            ) : (
              <div className="panel">
                <Empty
                  title="Choose a lead"
                  detail="Select a lead with a phone number to open WhatsApp."
                />
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
