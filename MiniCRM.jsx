import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Plus, Search, X, Pencil, Trash2, LayoutGrid, Table2, Users, Sparkles,
  TrendingUp, Wallet, ChevronLeft, ChevronRight, Mail, Phone,
} from "lucide-react";

const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

function SetupNotice() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-6 text-slate-800">
      <div className="max-w-md rounded-xl bg-white p-6 shadow">
        <h1 className="mb-2 text-lg font-semibold">Falta conectar o Supabase</h1>
        <p className="text-sm text-slate-600">
          Crie o arquivo <code>.env</code> com <code>VITE_SUPABASE_URL</code> e{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> e reinicie o <code>npm run dev</code>.
        </p>
      </div>
    </div>
  );
}

const STATUS = {
  novo:        { label: "Novo",           dot: "bg-sky-400",     chip: "bg-sky-400/10 text-sky-300 ring-sky-400/20" },
  atendimento: { label: "Em atendimento", dot: "bg-amber-400",   chip: "bg-amber-400/10 text-amber-300 ring-amber-400/20" },
  proposta:    { label: "Proposta",       dot: "bg-violet-400",  chip: "bg-violet-400/10 text-violet-300 ring-violet-400/20" },
  fechado:     { label: "Fechado",        dot: "bg-emerald-400", chip: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20" },
};
const KEYS = Object.keys(STATUS);
const PAGE_SIZE = 8;
const brl = (v) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const EMPTY = { name: "", phone: "", email: "", service: "", value: "", status: "novo" };

export default function MiniCRM() {
  return supabase ? <CRM /> : <SetupNotice />;
}

function CRM() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("kanban");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("todos");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null); // null | lead (novo = EMPTY)

  // Carga inicial + realtime
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("leads").select("*").order("created_at", { ascending: false });
      if (!active) return;
      if (error) setError(error.message);
      else setLeads(data);
      setLoading(false);
    })();

    const channel = supabase
      .channel("leads-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, (p) => {
        setLeads((cur) => {
          if (p.eventType === "DELETE") return cur.filter((l) => l.id !== p.old.id);
          const without = cur.filter((l) => l.id !== p.new.id);
          return p.eventType === "INSERT" || !cur.some((l) => l.id === p.new.id)
            ? [p.new, ...without]
            : cur.map((l) => (l.id === p.new.id ? p.new : l));
        });
      })
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  // Estatísticas
  const stats = useMemo(() => {
    const total = leads.length;
    const novos = leads.filter((l) => l.status === "novo").length;
    const fechados = leads.filter((l) => l.status === "fechado");
    return {
      total, novos,
      taxa: total ? Math.round((fechados.length / total) * 100) : 0,
      receita: fechados.reduce((s, l) => s + Number(l.value || 0), 0),
    };
  }, [leads]);

  // Busca + filtro
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter(
      (l) =>
        (filter === "todos" || l.status === filter) &&
        (!q || [l.name, l.email, l.phone, l.service].some((f) => (f || "").toLowerCase().includes(q)))
    );
  }, [leads, query, filter]);

  useEffect(() => setPage(1), [query, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Ações
  const save = async (form) => {
    const payload = {
      name: form.name.trim(), phone: form.phone, email: form.email,
      service: form.service, value: Number(form.value) || 0, status: form.status,
    };
    const q = supabase.from("leads");
    const { data, error } = form.id
      ? await q.update(payload).eq("id", form.id).select().single()
      : await q.insert(payload).select().single();
    if (error) { setError(error.message); return false; }
    // atualiza a tela na hora, mesmo se o realtime estiver desligado
    setLeads((cur) => cur.some((l) => l.id === data.id)
      ? cur.map((l) => (l.id === data.id ? data : l)) : [data, ...cur]);
    setError(""); setModal(null); return true;
  };

  const remove = async (lead) => {
    if (!confirm(`Excluir ${lead.name}?`)) return false;
    const { error } = await supabase.from("leads").delete().eq("id", lead.id);
    if (error) { setError(error.message); return false; }
    setLeads((cur) => cur.filter((l) => l.id !== lead.id));
    return true;
  };

  const move = async (id, status) => {
    const prev = leads;
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, status } : l)));
    const { error } = await supabase.from("leads").update({ status }).eq("id", id);
    if (error) { setLeads(prev); setError(error.message); }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 antialiased">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Cabeçalho */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">Clientes</h1>
            <p className="text-sm text-slate-500">Acompanhe cada contato até o fechamento.</p>
          </div>
          <button
            onClick={() => setModal({ ...EMPTY })}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            <Plus size={16} /> Novo lead
          </button>
        </header>

        {error && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button>
          </div>
        )}

        {/* Dashboard */}
        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={Users} label="Total de leads" value={stats.total} />
          <Stat icon={Sparkles} label="Leads novos" value={stats.novos} />
          <Stat icon={TrendingUp} label="Taxa de conversão" value={`${stats.taxa}%`} />
          <Stat icon={Wallet} label="Receita fechada" value={brl(stats.receita)} />
        </section>

        {/* Barra de ferramentas */}
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {["todos", ...KEYS].map((k) => {
              const count = k === "todos" ? leads.length : leads.filter((l) => l.status === k).length;
              const on = filter === k;
              return (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`rounded-full px-3 py-1.5 text-sm transition ${
                    on ? "bg-slate-100 text-slate-900" : "bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {k === "todos" ? "Todos" : STATUS[k].label}
                  <span className={`ml-1.5 text-xs ${on ? "text-slate-500" : "text-slate-600"}`}>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1 lg:w-72">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nome, e-mail ou serviço"
                className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-sm placeholder:text-slate-600 focus:border-teal-400/60 focus:outline-none"
              />
            </div>
            <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5">
              {[["kanban", LayoutGrid, "Kanban"], ["tabela", Table2, "Tabela"]].map(([k, Icon, l]) => (
                <button
                  key={k}
                  onClick={() => setView(k)}
                  aria-label={l}
                  title={l}
                  className={`rounded-md px-2.5 py-1.5 transition ${view === k ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Conteúdo */}
        {loading ? (
          <p className="py-20 text-center text-sm text-slate-500">Carregando leads…</p>
        ) : leads.length === 0 ? (
          <Empty onAdd={() => setModal({ ...EMPTY })} />
        ) : view === "kanban" ? (
          <Kanban leads={filtered} onMove={move} onEdit={setModal} />
        ) : (
          <>
            <Tabela items={pageItems} onEdit={setModal} onDelete={remove} />
            <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
              <span>{filtered.length} resultado{filtered.length !== 1 && "s"}</span>
              <div className="flex items-center gap-2">
                <button disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Página anterior"
                  className="rounded-md p-1.5 hover:bg-slate-900 disabled:opacity-30"><ChevronLeft size={18} /></button>
                <span>{page} de {pages}</span>
                <button disabled={page === pages} onClick={() => setPage(page + 1)} aria-label="Próxima página"
                  className="rounded-md p-1.5 hover:bg-slate-900 disabled:opacity-30"><ChevronRight size={18} /></button>
              </div>
            </div>
          </>
        )}
      </div>

      {modal && <LeadModal initial={modal} onClose={() => setModal(null)} onSave={save} onDelete={remove} />}
    </div>
  );
}

/* ---------- Componentes ---------- */

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
        <Icon size={15} /> {label}
      </div>
      <div className="truncate text-2xl font-semibold tracking-tight text-white">{value}</div>
    </div>
  );
}

function Kanban({ leads, onMove, onEdit }) {
  const [over, setOver] = useState(null);
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {KEYS.map((k) => {
        const col = leads.filter((l) => l.status === k);
        return (
          <div
            key={k}
            onDragOver={(e) => { e.preventDefault(); setOver(k); }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault(); setOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) onMove(id, k);
            }}
            className={`rounded-xl border p-2 transition ${over === k ? "border-teal-400/50 bg-teal-400/5" : "border-slate-800 bg-slate-900/40"}`}
          >
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <span className={`h-2 w-2 rounded-full ${STATUS[k].dot}`} /> {STATUS[k].label}
              </div>
              <span className="text-xs text-slate-600">{col.length}</span>
            </div>
            <div className="flex min-h-24 flex-col gap-2">
              {col.map((l) => (
                <div
                  key={l.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                  onClick={() => onEdit(l)}
                  onKeyDown={(e) => e.key === "Enter" && onEdit(l)}
                  className="cursor-grab rounded-lg border border-slate-800 bg-slate-900 p-3 text-left transition hover:border-slate-700 active:cursor-grabbing"
                >
                  <div className="truncate text-sm font-medium text-white">{l.name}</div>
                  {l.service && <div className="mt-0.5 truncate text-xs text-slate-500">{l.service}</div>}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-sm text-teal-300">{brl(l.value)}</span>
                    <select
                      value={l.status}
                      aria-label="Mover para"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onMove(l.id, e.target.value)}
                      className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-300"
                    >
                      {KEYS.map((x) => <option key={x} value={x}>{STATUS[x].label}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              {col.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-600">Arraste um lead para cá</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Tabela({ items, onEdit, onDelete }) {
  if (!items.length) return <p className="py-16 text-center text-sm text-slate-500">Nenhum lead encontrado com esses filtros.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-slate-800 bg-slate-900/60 text-slate-500">
          <tr>
            {["Nome", "Contato", "Serviço", "Valor", "Status", ""].map((h) => (
              <th key={h} className="px-4 py-3 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {items.map((l) => (
            <tr key={l.id} className="transition hover:bg-slate-900/50">
              <td className="px-4 py-3 font-medium text-white">{l.name}</td>
              <td className="px-4 py-3 text-slate-400">
                <div className="flex flex-col gap-0.5">
                  {l.email && <span className="flex items-center gap-1.5"><Mail size={13} />{l.email}</span>}
                  {l.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{l.phone}</span>}
                </div>
              </td>
              <td className="px-4 py-3 text-slate-400">{l.service || "—"}</td>
              <td className="px-4 py-3 text-slate-300">{brl(l.value)}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${STATUS[l.status].chip}`}>{STATUS[l.status].label}</span>
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  <button onClick={() => onEdit(l)} aria-label={`Editar ${l.name}`} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"><Pencil size={15} /></button>
                  <button onClick={() => onDelete(l)} aria-label={`Excluir ${l.name}`} className="rounded-md p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"><Trash2 size={15} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ onAdd }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-800 py-20 text-center">
      <p className="text-slate-300">Você ainda não tem leads.</p>
      <p className="mt-1 text-sm text-slate-500">Cadastre o primeiro contato para começar o funil.</p>
      <button onClick={onAdd} className="mt-5 rounded-lg bg-teal-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-teal-300">
        Cadastrar lead
      </button>
    </div>
  );
}

function LeadModal({ initial, onClose, onSave, onDelete }) {
  const [f, setF] = useState({ ...initial, value: initial.value ?? "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const submit = async () => {
    if (!f.name.trim()) return;
    setSaving(true);
    const ok = await onSave(f);
    if (!ok) setSaving(false);
  };

  const input =
    "w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-teal-400/60 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{f.id ? "Editar lead" : "Novo lead"}</h2>
          <button onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2">
            <input autoFocus value={f.name} onChange={set("name")} placeholder="Ex.: Marina Souza" className={input} />
          </Field>
          <Field label="Telefone"><input value={f.phone || ""} onChange={set("phone")} placeholder="(11) 99999-0000" className={input} /></Field>
          <Field label="E-mail"><input type="email" value={f.email || ""} onChange={set("email")} placeholder="marina@email.com" className={input} /></Field>
          <Field label="Serviço desejado" className="sm:col-span-2">
            <input value={f.service || ""} onChange={set("service")} placeholder="Ex.: Consultoria mensal" className={input} />
          </Field>
          <Field label="Valor estimado (R$)">
            <input type="number" min="0" step="0.01" value={f.value} onChange={set("value")} placeholder="0,00" className={input} />
          </Field>
          <Field label="Status">
            <select value={f.status} onChange={set("status")} className={input}>
              {KEYS.map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
            </select>
          </Field>
        </div>

        <div className="mt-6 flex items-center justify-between">
          {f.id ? (
            <button onClick={async () => { if (await onDelete(f)) onClose(); }} className="text-sm text-rose-400 hover:text-rose-300">Excluir</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-800">Cancelar</button>
            <button onClick={submit} disabled={saving || !f.name.trim()}
              className="rounded-lg bg-teal-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-teal-300 disabled:opacity-40">
              {saving ? "Salvando…" : "Salvar lead"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, className = "", children }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm text-slate-400">{label}</span>
      {children}
    </label>
  );
}
