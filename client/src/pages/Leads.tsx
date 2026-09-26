import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCoreRowModel,
  useReactTable,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  Mail,
  Phone,
  Upload,
} from "lucide-react";
import { WhatsAppIcon } from "../components/WhatsAppIcon";
import { api, date, money } from "../lib/api";
import type { Lead, Metadata, Paged } from "../lib/types";
import {
  PageHeader,
  SearchToolbar,
  type ToolbarState,
} from "../components/Shell";
import { Button, Empty, Loading, Modal, RowMenu } from "../components/ui";
import { RecordForm, type FormValues } from "../components/RecordForm";
import { useNavigate } from "react-router-dom";

function ContactAction({label,icon,href,missing,external=false}:{label:string;icon:React.ReactNode;href?:string;missing:string;external?:boolean}) {
  if (href) return <a className="grid h-8 w-8 place-items-center rounded-md border text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700" href={href} target={external?"_blank":undefined} rel={external?"noreferrer":undefined} aria-label={`${label} lead`} title={label}>{icon}</a>;
  return <button type="button" className="grid h-8 w-8 place-items-center rounded-md border text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700" onClick={()=>alert(missing)} aria-label={`${label} lead`} title={label}>{icon}</button>;
}

function BulkSelect({label,value,set,options,placeholder}:{label:string;value:string;set:(value:string)=>void;options:[string,string][];placeholder?:string}) {
  return <label className="block"><span className="label">{label}</span><select className="field" value={value} onChange={event=>set(event.target.value)}>{placeholder&&<option value="">{placeholder}</option>}{options.map(([option,label])=><option key={`${option}-${label}`} value={option}>{label}</option>)}</select></label>;
}

const columns: ColumnDef<Lead>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <input
        type="checkbox"
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
      />
    ),
  },
  {
    accessorKey: "title",
    header: "Lead",
    cell: ({ row, table }) => (
      <button
        className="font-semibold text-blue-700 hover:underline"
        onClick={() =>
          (
            table.options.meta as { onOpen: (lead: Lead) => void }
          ).onOpen(row.original)
        }
      >
        {row.original.title}
      </button>
    ),
  },
  { accessorKey: "contactName", header: "Contact" },
  { accessorKey: "companyName", header: "Company" },
  { accessorKey: "email", header: "Email" },
  { accessorKey: "phone", header: "Phone" },
  {
    id: "contactActions",
    header: "Contact",
    cell: ({ row }) => {
      const lead = row.original;
      return (
        <div className="flex items-center gap-1">
          <ContactAction
            label="Call"
            icon={<Phone size={14} />}
            href={lead.phone ? `tel:${lead.phone}` : undefined}
            missing="Add a phone number to this lead before calling."
          />
          <ContactAction
            label="WhatsApp"
            icon={<WhatsAppIcon size={14} />}
            href={
              lead.phone
                ? `https://wa.me/${lead.phone.replace(/\D/g, "")}`
                : undefined
            }
            missing="Add a phone number to this lead before opening WhatsApp."
            external
          />
          <ContactAction
            label="Email"
            icon={<Mail size={14} />}
            href={lead.email ? `mailto:${lead.email}` : undefined}
            missing="Add an email address to this lead before sending email."
          />
        </div>
      );
    },
  },
  { accessorKey: "salesperson.name", header: "Salesperson" },
  { accessorKey: "salesTeam.name", header: "Sales Team" },
  { accessorKey: "source.name", header: "Source" },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: (x) => "★".repeat(Number(x.getValue())),
  },
  {
    accessorKey: "expectedRevenue",
    header: "Revenue",
    cell: (x) => money(Number(x.getValue())),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row, table }) => {
      const lead = row.original;
      const onStatus = (
        table.options.meta as { onStatus: (lead: Lead, next: string) => void }
      ).onStatus;
      if (lead.converted) {
        const deal = lead.convertedOpportunity;
        const stages = (
          table.options.meta as { stages: { _id: string; name: string }[] }
        ).stages;
        if (!deal)
          return (
            <span className="badge border border-[#e8d9a8] bg-[#fdf3d7] font-semibold text-[#8a6d1f]">
              Converted
            </span>
          );
        const onStage = (
          table.options.meta as {
            onStage: (dealId: string, stageId: string) => void;
          }
        ).onStage;
        return (
          <select
            title="Stage of the opportunity this lead became"
            className="rounded border border-[#e8d9a8] bg-[#fdf3d7] px-1.5 py-1 text-xs font-semibold text-[#8a6d1f]"
            value={deal.stage?._id ?? ""}
            onChange={(event) => onStage(deal._id, event.target.value)}
          >
            {!deal.stage && <option value="">Converted</option>}
            {stages.map((stage) => (
              <option key={stage._id} value={stage._id}>
                {stage.name}
              </option>
            ))}
          </select>
        );
      }
      const tone =
        lead.status === "qualified"
          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
          : lead.status === "disqualified"
            ? "border-red-300 bg-red-100 text-red-800"
            : "border-slate-300 bg-slate-100 text-slate-700";
      return (
        <select
          className={`rounded border px-1.5 py-1 text-xs font-semibold ${tone}`}
          value={lead.status}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onStatus(lead, event.target.value)}
        >
          <option value="new">New</option>
          <option value="qualified">Qualified</option>
          <option value="disqualified">Disqualified</option>
        </select>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: (x) => date(String(x.getValue())),
  },
];
export default function Leads() {
  const qc = useQueryClient(),
    nav = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [rowSelection, setRowSelection] = useState({});
  const [toolbar, setToolbar] = useState<ToolbarState>({
    filters: {},
    groupBy: "",
  });
  const [disqualify, setDisqualify] = useState<Lead | null>(null);
  const [reason, setReason] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState("status");
  const [bulkValue, setBulkValue] = useState("new");
  const meta = useQuery({
    queryKey: ["metadata"],
    queryFn: () => api<Metadata>("/metadata"),
  });
  const params = new URLSearchParams({
    page: String(page),
    limit: "20",
    search,
  });
  for (const [key, val] of Object.entries(toolbar.filters))
    if (val) params.set(key, val);
  const q = useQuery({
    queryKey: ["leads", page, search, toolbar.filters],
    queryFn: () => api<Paged<Lead>>(`/leads?${params.toString()}`),
  });
  const convert = useMutation({
    mutationFn: (id: string) =>
      api<{ _id: string }>(`/leads/${id}/convert`, { method: "POST" }),
    onMutate: () => setError(""),
    onSuccess: (x) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      nav(`/opportunities/${x._id}`);
    },
    onError: (e: any) => setError(e?.message ?? "Could not convert this lead."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/leads/${id}`, { method: "DELETE" }),
    onMutate: () => setError(""),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
    onError: (e: any) => setError(e?.message ?? "Could not delete this lead."),
  });
  const priorityNames = ["Normal", "Medium", "High", "Very high"];
  const moveConverted = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      api(`/opportunities/${dealId}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: stageId }),
      }),
    onMutate: () => setError(""),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
    },
    onError: (e: any) =>
      setError(e?.message ?? "Could not move this opportunity."),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onMutate: () => setError(""),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      setDisqualify(null);
      setReason("");
      setReasonNote("");
    },
    onError: (e: any) => setError(e?.message ?? "Could not update this lead."),
  });
  const bulk = useMutation({
    mutationFn: (payload: { ids: string[]; action: string; value?: unknown }) =>
      api<{ matched: number; modified: number; message: string; errors?: { id: string; message: string }[] }>("/leads/bulk", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onMutate: () => { setError(""); setNotice(""); },
    onSuccess: (result) => {
      setNotice(`${result.message}.${result.errors?.length ? ` ${result.errors.length} records could not be processed.` : ""}`);
      setBulkOpen(false);
      setRowSelection({});
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (cause: any) => setError(cause?.message ?? "Bulk action failed."),
  });
  const table = useReactTable({
    data: q.data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      onOpen: (lead: Lead) => nav(`/leads/${lead._id}`),
      stages: meta.data?.stages ?? [],
      onStage: (dealId: string, stageId: string) =>
        moveConverted.mutate({ dealId, stageId }),
      onStatus: (lead: Lead, next: string) => {
        if (next === "disqualified") {
          setReason("");
          setReasonNote("");
          setDisqualify(lead);
        } else setStatus.mutate({ id: lead._id, body: { status: next } });
      },
    },
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
  });
  if (q.isLoading || meta.isLoading) return <Loading />;
  const selectedLeads = (q.data?.data ?? []).filter((_, index) => Boolean((rowSelection as Record<string, boolean>)[String(index)]));
  const allRows = table.getRowModel().rows;
  const groupName = (lead: Lead) =>
    toolbar.groupBy === "status"
      ? lead.status
      : toolbar.groupBy === "priority"
        ? (priorityNames[lead.priority] ?? "Unset")
        : toolbar.groupBy === "salesperson"
          ? (lead.salesperson?.name ?? "Unassigned")
          : toolbar.groupBy === "source"
            ? (lead.source?.name ?? "No source")
            : toolbar.groupBy === "companyName"
              ? lead.companyName || "No company"
              : "";
  const groupedRows: [string, typeof allRows][] = toolbar.groupBy
    ? Object.entries(
        allRows.reduce<Record<string, typeof allRows>>((acc, row) => {
          const key = groupName(row.original);
          (acc[key] ??= []).push(row);
          return acc;
        }, {}),
      ).sort((a, b) => a[0].localeCompare(b[0]))
    : [["", allRows]];
  function exportSelected() {
    const safe = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lines = [["Lead", "Contact", "Company", "Email", "Phone", "Status", "Deal Value"], ...selectedLeads.map(lead => [lead.title, lead.contactName, lead.companyName, lead.email, lead.phone, lead.status, lead.expectedRevenue])];
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([lines.map(row => row.map(safe).join(",")).join("\r\n")], { type: "text/csv" }));
    link.download = `selected-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  function applyBulk() {
    const ids = selectedLeads.map(lead => lead._id);
    if (!ids.length) return;
    if (bulkAction === "export") { exportSelected(); setNotice(`Exported ${ids.length} selected leads.`); setBulkOpen(false); return; }
    if ((bulkAction === "delete" || bulkAction === "convert") && !confirm(`${bulkAction === "delete" ? "Permanently delete" : "Convert"} ${ids.length} selected leads?`)) return;
    bulk.mutate({ ids, action: bulkAction, ...(!["delete", "convert"].includes(bulkAction) ? { value: bulkValue } : {}) });
  }
  return (
    <>
      <PageHeader title="Leads" onNew={() => setOpen(true)}>
        <Button onClick={() => nav("/leads/import")}>
          <Upload size={15} /> Import CSV
        </Button>
      </PageHeader>
      <SearchToolbar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        resource="leads"
        state={toolbar}
        onState={(next) => {
          setToolbar(next);
          setPage(1);
        }}
        filterGroups={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "new", label: "New" },
              { value: "qualified", label: "Qualified" },
              { value: "disqualified", label: "Disqualified" },
              { value: "converted", label: "Converted" },
            ],
          },
          {
            key: "priority",
            label: "Priority",
            options: [
              { value: "0", label: "Normal" },
              { value: "1", label: "Medium" },
              { value: "2", label: "High" },
              { value: "3", label: "Very high" },
            ],
          },
          {
            key: "salesperson",
            label: "Salesperson",
            options: (meta.data?.users ?? []).map((u) => ({
              value: u._id,
              label: u.name,
            })),
          },
          {
            key: "team",
            label: "Sales team",
            options: (meta.data?.teams ?? []).map((t) => ({
              value: t._id,
              label: t.name,
            })),
          },
          {
            key: "source",
            label: "Source",
            options: (meta.data?.sources ?? []).map((x) => ({
              value: x._id,
              label: x.name,
            })),
          },
          {
            key: "campaign",
            label: "Campaign",
            options: (meta.data?.campaigns ?? []).map((c) => ({
              value: c._id,
              label: c.name,
            })),
          },
        ]}
        groupOptions={[
          { value: "status", label: "Status" },
          { value: "priority", label: "Priority" },
          { value: "salesperson", label: "Salesperson" },
          { value: "source", label: "Source" },
          { value: "companyName", label: "Company" },
        ]}
      >
        {Object.keys(rowSelection).length > 0 && (
          <Button onClick={() => setBulkOpen(true)}>
            <CheckSquare size={14} />
            Bulk actions ({selectedLeads.length})
          </Button>
        )}
      </SearchToolbar>
      {notice && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      <div className="overflow-x-auto bg-white">
        <table className="w-full min-w-[1300px] text-left text-xs">
          <thead className="border-b bg-slate-50 text-slate-500">
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => (
                  <th
                    className="h-9 whitespace-nowrap px-3 font-semibold"
                    key={h.id}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
                <th />
              </tr>
            ))}
          </thead>
          <tbody>
            {groupedRows.map(([groupName, rows]) => (
              <Fragment key={groupName}>
                {groupName && (
                  <tr className="bg-slate-100">
                    <td
                      className="px-3 py-1.5 text-[11px] font-semibold text-slate-600"
                      colSpan={99}
                    >
                      {groupName} ({rows.length})
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr className="border-b hover:bg-[#f0f9ff]" key={row.id}>
                    {row.getVisibleCells().map((c) => (
                      <td className="h-10 max-w-52 truncate px-3" key={c.id}>
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    ))}
                    <td>
                      <button
                        title="Convert to opportunity"
                        disabled={row.original.converted || convert.isPending}
                        onClick={() =>
                          confirm("Convert this lead into an opportunity?") &&
                          convert.mutate(row.original._id)
                        }
                        className="btn mr-2 h-7"
                      >
                        Convert
                      </button>
                      <RowMenu
                        label="Delete lead"
                        busy={remove.isPending}
                        onDelete={() => {
                          if (
                            confirm("Delete this lead? This cannot be undone.")
                          )
                            remove.mutate(row.original._id);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!q.data?.data.length && (
          <Empty
            title="No leads found"
            detail="Try another search or create a new lead."
          />
        )}
      </div>
      <div className="flex h-11 items-center justify-end gap-3 border-t bg-white px-4 text-xs">
        <span>
          {(page - 1) * 20 + 1}–{Math.min(page * 20, q.data!.pagination.total)}{" "}
          of {q.data!.pagination.total}
        </span>
        <button disabled={page === 1} onClick={() => setPage((x) => x - 1)}>
          <ArrowLeft size={16} />
        </button>
        <button
          disabled={page >= q.data!.pagination.pages}
          onClick={() => setPage((x) => x + 1)}
        >
          <ArrowRight size={16} />
        </button>
      </div>
      {bulkOpen && (
        <Modal title={`Bulk actions · ${selectedLeads.length} leads`} width="max-w-lg" onClose={() => setBulkOpen(false)}>
          <div className="space-y-4 p-5">
            <p className="text-xs text-slate-500">The action will only affect records you have permission to update.</p>
            <label className="block">
              <span className="label">Action</span>
              <select className="field" value={bulkAction} onChange={event => { const action = event.target.value; setBulkAction(action); setBulkValue(action === "status" ? "new" : action === "priority" ? "1" : ""); }}>
                <optgroup label="Update">
                  <option value="status">Change status</option>
                  <option value="salesperson">Assign salesperson</option>
                  <option value="salesTeam">Assign sales team</option>
                  <option value="priority">Change priority</option>
                  <option value="source">Change lead source</option>
                  <option value="addTag">Add tag</option>
                  <option value="removeTag">Remove tag</option>
                </optgroup>
                <optgroup label="Other">
                  <option value="export">Export selected CSV</option>
                  <option value="convert">Convert to opportunities</option>
                  <option value="delete">Delete selected leads</option>
                </optgroup>
              </select>
            </label>
            {bulkAction === "status" && <BulkSelect label="New status" value={bulkValue} set={setBulkValue} options={[["new","New"],["qualified","Qualified"],["disqualified","Disqualified"]]}/>} 
            {bulkAction === "priority" && <BulkSelect label="Priority" value={bulkValue} set={setBulkValue} options={[["0","Normal"],["1","Medium"],["2","High"],["3","Very high"]]}/>} 
            {bulkAction === "salesperson" && <BulkSelect label="Salesperson" value={bulkValue} set={setBulkValue} options={[["","Unassigned"],...(meta.data?.users??[]).map(x=>[x._id,x.name] as [string,string])]}/>} 
            {bulkAction === "salesTeam" && <BulkSelect label="Sales team" value={bulkValue} set={setBulkValue} options={[["","Unassigned"],...(meta.data?.teams??[]).map(x=>[x._id,x.name] as [string,string])]}/>} 
            {bulkAction === "source" && <BulkSelect label="Lead source" value={bulkValue} set={setBulkValue} options={[["","No source"],...(meta.data?.sources??[]).map(x=>[x._id,x.name] as [string,string])]}/>} 
            {(bulkAction === "addTag" || bulkAction === "removeTag") && <BulkSelect label="Tag" value={bulkValue} set={setBulkValue} placeholder="Select a tag" options={(meta.data?.tags??[]).map(x=>[x._id,x.name] as [string,string])}/>} 
            {bulkAction === "delete" && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">This permanently deletes the selected leads and their related lead activities.</div>}
            {bulkAction === "convert" && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">Each eligible lead will become an opportunity in the first active pipeline stage. Already converted leads will be skipped.</div>}
            <div className="flex justify-end gap-2 border-t pt-4"><Button onClick={() => setBulkOpen(false)}>Cancel</Button><Button className={bulkAction === "delete" ? "btn-danger" : "btn-primary"} disabled={bulk.isPending || ((bulkAction === "addTag" || bulkAction === "removeTag") && !bulkValue)} onClick={applyBulk}>{bulk.isPending ? "Applying…" : bulkAction === "export" ? "Download CSV" : "Apply action"}</Button></div>
          </div>
        </Modal>
      )}
      {disqualify && (
        <Modal
          title="Disqualify lead"
          width="max-w-md"
          onClose={() => setDisqualify(null)}
        >
          <div className="space-y-4 p-5">
            <p className="text-xs text-slate-500">
              Why is <b>{disqualify.title}</b> not going forward?
            </p>
            <label className="block">
              <span className="label">Reason</span>
              <select
                className="field"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                <option value="">Select a reason</option>
                {(meta.data?.lostReasons ?? []).map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
                <option value="other">Other…</option>
              </select>
            </label>
            {reason === "other" && (
              <label className="block">
                <span className="label">Tell us more (optional)</span>
                <textarea
                  className="field"
                  rows={3}
                  value={reasonNote}
                  onChange={(event) => setReasonNote(event.target.value)}
                  placeholder="Add any detail you want to keep"
                />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setDisqualify(null)}>
                Cancel
              </Button>
              <Button
                className="btn-primary"
                disabled={!reason || setStatus.isPending}
                onClick={() =>
                  setStatus.mutate({
                    id: disqualify._id,
                    body: {
                      status: "disqualified",
                      lostReason: reason === "other" ? "" : reason,
                      lostNotes: reason === "other" ? reasonNote.trim() : "",
                    },
                  })
                }
              >
                Disqualify
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {open && (
        <Modal title="New Lead" onClose={() => setOpen(false)}>
          <RecordForm
            kind="lead"
            metadata={meta.data!}
            onCancel={() => setOpen(false)}
            onSubmit={async (v: FormValues) => {
              await api("/leads", { method: "POST", body: JSON.stringify(v) });
              setOpen(false);
              qc.invalidateQueries({ queryKey: ["leads"] });
            }}
          />
        </Modal>
      )}
    </>
  );
}
