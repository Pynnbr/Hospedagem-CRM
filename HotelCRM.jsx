import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

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
  novo:    { label: "Novo",            chip: "bg-sky-100 text-sky-700 ring-sky-300" },
  cotacao: { label: "Cotação enviada", chip: "bg-amber-100 text-amber-800 ring-amber-300" },
  sinal:   { label: "Sinal pago",      chip: "bg-violet-100 text-violet-700 ring-violet-300" },
  fechado: { label: "Fechado",         chip: "bg-emerald-100 text-emerald-700 ring-emerald-300" },
};
const KEYS = Object.keys(STATUS);
const ROOMS = ["Standard", "Superior", "Suíte", "Família"];
const PAGE_SIZE = 6;
const DAY = 86400000;

// data local (toISOString usaria UTC e erraria o dia à noite no Brasil)
const iso = (offset) => {
  const d = new Date(Date.now() + offset * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtD = (d) => (d ? d.split("-").reverse().slice(0, 2).join("/") : "—");
const nights = (l) => Math.max(0, Math.round((new Date(l.checkout) - new Date(l.checkin)) / DAY)) || 0;
const total = (l) => nights(l) * Number(l.rate || 0);
const stale = (l) =>
  (l.status === "novo" || l.status === "cotacao") && Date.now() - new Date(l.updated_at) > DAY;

// Busca sem acento/maiúscula; todas as palavras precisam combinar
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const haystack = (l) =>
  norm([l.name, l.phone, String(l.phone || "").replace(/\D/g, ""), l.room, STATUS[l.status].label,
    fmtD(l.checkin), fmtD(l.checkout), l.checkin, l.checkout].join(" "));
const matches = (l, terms) => { const h = haystack(l); return terms.every((t) => h.includes(t)); };

const emptyForm = () => ({ name: "", phone: "", checkin: iso(7), checkout: iso(9), guests: 2, room: "Standard", rate: "", status: "novo" });

export default function HotelCRM() {
  return supabase ? <CRM /> : <SetupNotice />;
}

function CRM() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("todos");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);

  useEffect(() => {
    let active = true;
    supabase.from("reservas").select("*").order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message); else setRows(data);
        setLoading(false);
      });

    const channel = supabase.channel("reservas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservas" }, (p) => {
        setRows((cur) => {
          if (p.eventType === "DELETE") return cur.filter((r) => r.id !== p.old.id);
          return [p.new, ...cur.filter((r) => r.id !== p.new.id)];
        });
      }).subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  const terms = useMemo(() => norm(query).split(/\s+/).filter(Boolean), [query]);
  const closed = rows.filter((r) => r.status === "fechado");
  const late = rows.filter(stale).length;
  const stats = {
    consultas: rows.length,
    fechadas: closed.length,
    conversao: rows.length ? Math.round((closed.length / rows.length) * 100) : 0,
    receita: closed.reduce((s, r) => s + total(r), 0),
  };

  const count = (k) => rows.filter((r) => (k === "todos" || r.status === k) && matches(r, terms)).length;
  const list = useMemo(
    () => rows.filter((r) => (filter === "todos" || r.status === filter) && matches(r, terms)),
    [rows, filter, terms]
  );
  useEffect(() => setPage(1), [filter, query]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const cur = Math.min(page, pages); // evita página vazia depois de excluir
  const items = list.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const emptyMsg = query.trim()
    ? `Nenhum resultado para “${query.trim()}”. Tente outro nome, telefone ou data.`
    : "Nenhuma consulta encontrada. Cadastre uma ou mude os filtros.";

  const save = async (f) => {
    const payload = {
      name: f.name.trim(), phone: f.phone, checkin: f.checkin, checkout: f.checkout,
      guests: Number(f.guests) || 1, room: f.room, rate: Number(f.rate) || 0, status: f.status,
    };
    const q = supabase.from("reservas");
    const { data, error } = f.id
      ? await q.update(payload).eq("id", f.id).select().single()
      : await q.insert(payload).select().single();
    if (error) { setError(error.message); return false; }
    // atualiza a tela na hora, mesmo se o realtime estiver desligado
    setRows((cur) => [data, ...cur.filter((r) => r.id !== data.id)]);
    setError(""); setModal(null); return true;
  };

  const remove = async (r) => {
    if (!confirm(`Excluir ${r.name}?`)) return false;
    const { error } = await supabase.from("reservas").delete().eq("id", r.id);
    if (error) { setError(error.message); return false; }
    setRows((cur) => cur.filter((x) => x.id !== r.id));
    return true;
  };

  const cards = [
    ["Consultas", stats.consultas, "border-t-sky-500 bg-sky-50", "text-sky-700"],
    ["Reservas fechadas", stats.fechadas, "border-t-emerald-500 bg-emerald-50", "text-emerald-700"],
    ["Taxa de conversão", `${stats.conversao}%`, "border-t-violet-500 bg-violet-50", "text-violet-700"],
    ["Receita fechada", brl(stats.receita), "border-t-amber-500 bg-amber-50", "text-amber-700"],
  ];

  return (
    <div className="min-h-screen bg-[#f4faf6] text-slate-800 antialiased">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-emerald-800">Reservas diretas</h1>
            <p className="text-sm text-slate-500">Responda rápido e feche sem comissão de OTA.</p>
          </div>
          <button onClick={() => setModal(emptyForm())}
            className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2">
            Nova consulta
          </button>
        </header>

        {error && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Fechar aviso">✕</button>
          </div>
        )}

        <section className="mb-6 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {cards.map(([t, v, box, txt]) => (
            <div key={t} className={`rounded-xl border border-slate-200 border-t-4 p-4 shadow-sm ${box}`}>
              <div className={`mb-2 text-sm font-medium ${txt}`}>{t}</div>
              <div className="break-words text-lg font-semibold leading-tight text-slate-900 sm:text-2xl">{v}</div>
            </div>
          ))}
        </section>

        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
            {["todos", ...KEYS].map((k) => {
              const on = filter === k;
              return (
                <button key={k} onClick={() => setFilter(k)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${on
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700"}`}>
                  {k === "todos" ? "Todos" : STATUS[k].label}
                  <span className={`ml-1.5 text-xs ${on ? "text-emerald-100" : "text-slate-400"}`}>{count(k)}</span>
                </button>
              );
            })}
            {late > 0 && (
              <span className="ml-1 shrink-0 self-center whitespace-nowrap text-sm text-rose-600">
                {late} sem retorno há mais de 24h
              </span>
            )}
          </div>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, telefone, quarto ou data"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none md:w-80" />
        </div>

        {loading ? (
          <p className="py-20 text-center text-sm text-slate-500">Carregando reservas…</p>
        ) : (
          <>
            {/* Celular: cartões */}
            <div className="grid gap-3 md:hidden">
              {items.length ? items.map((l) => (
                <div key={l.id} role="button" tabIndex={0} onClick={() => setModal(l)}
                  onKeyDown={(e) => e.key === "Enter" && setModal(l)}
                  className={`cursor-pointer rounded-xl border p-4 text-left shadow-sm ${stale(l) ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{l.name}</div>
                      <div className="text-xs text-slate-500">{l.phone}</div>
                    </div>
                    <Badge s={l.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-slate-700">{fmtD(l.checkin)} a {fmtD(l.checkout)}</div>
                      <div className="text-xs text-slate-500">{nights(l)} noite(s), {l.guests} hóspede(s)</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-slate-900">{brl(total(l))}</div>
                      <div className="text-xs text-slate-500">{l.room}</div>
                    </div>
                  </div>
                  {stale(l) && <div className="mt-2 text-xs text-rose-600">Sem retorno há 24h+</div>}
                </div>
              )) : <p className="py-12 text-center text-sm text-slate-500">{emptyMsg}</p>}
            </div>

            {/* Tablet e desktop: tabela */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
              {items.length ? (
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-emerald-50 text-emerald-800">
                    <tr>{["Hóspede", "Estadia", "Quarto", "Total", "Status"].map((h) => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((l) => (
                      <tr key={l.id} onClick={() => setModal(l)}
                        className={`cursor-pointer hover:bg-emerald-50/60 ${stale(l) ? "bg-rose-50" : ""}`}>
                        <td className="px-4 py-3"><div className="font-medium text-slate-900">{l.name}</div><div className="text-xs text-slate-500">{l.phone}</div></td>
                        <td className="px-4 py-3 text-slate-600">{fmtD(l.checkin)} a {fmtD(l.checkout)}<div className="text-xs text-slate-500">{nights(l)} noite(s), {l.guests} hóspede(s)</div></td>
                        <td className="px-4 py-3 text-slate-600">{l.room}<div className="text-xs text-slate-500">{brl(l.rate)} por diária</div></td>
                        <td className="px-4 py-3 text-slate-700">{brl(total(l))}</td>
                        <td className="px-4 py-3"><Badge s={l.status} />{stale(l) && <div className="mt-1 text-xs text-rose-600">Sem retorno há 24h+</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="py-16 text-center text-sm text-slate-500">{emptyMsg}</p>}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
              <span>{list.length} resultado{list.length !== 1 && "s"}</span>
              <div className="flex items-center gap-3">
                <button disabled={cur === 1} onClick={() => setPage(cur - 1)} className="rounded-md px-2 py-1 hover:bg-emerald-50 disabled:opacity-30">Anterior</button>
                <span>{cur} de {pages}</span>
                <button disabled={cur === pages} onClick={() => setPage(cur + 1)} className="rounded-md px-2 py-1 hover:bg-emerald-50 disabled:opacity-30">Próxima</button>
              </div>
            </div>
          </>
        )}
      </div>

      {modal && <Modal initial={modal} onClose={() => setModal(null)} onSave={save} onDelete={remove} />}
    </div>
  );
}

function Badge({ s }) {
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${STATUS[s].chip}`}>{STATUS[s].label}</span>;
}

function Field({ label, className = "", children }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm text-slate-600">{label}</span>{children}
    </label>
  );
}

function Modal({ initial, onClose, onSave, onDelete }) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    if (f.checkout < f.checkin) return alert("O check-out precisa ser depois do check-in.");
    setSaving(true);
    if (!(await onSave(f))) setSaving(false);
  };

  const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} role="dialog" aria-modal="true"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{f.id ? "Editar consulta" : "Nova consulta"}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-slate-500 hover:text-slate-900">✕</button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2"><input required autoFocus value={f.name} onChange={set("name")} className={input} /></Field>
          <Field label="Telefone" className="sm:col-span-2"><input type="tel" value={f.phone || ""} onChange={set("phone")} className={input} /></Field>
          <Field label="Check-in"><input required type="date" value={f.checkin} onChange={set("checkin")} className={input} /></Field>
          <Field label="Check-out"><input required type="date" value={f.checkout} onChange={set("checkout")} className={input} /></Field>
          <Field label="Hóspedes"><input type="number" min="1" value={f.guests} onChange={set("guests")} className={input} /></Field>
          <Field label="Tipo de quarto">
            <select value={f.room} onChange={set("room")} className={input}>{ROOMS.map((r) => <option key={r}>{r}</option>)}</select>
          </Field>
          <Field label="Valor da diária (R$)"><input required type="number" min="0" step="0.01" value={f.rate} onChange={set("rate")} className={input} /></Field>
          <Field label="Status">
            <select value={f.status} onChange={set("status")} className={input}>
              {KEYS.map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-6 flex items-center justify-between">
          {f.id ? (
            <button type="button" onClick={async () => { if (await onDelete(f)) onClose(); }} className="text-sm text-rose-600 hover:text-rose-500">Excluir</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancelar</button>
            <button disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              {saving ? "Salvando…" : "Salvar consulta"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
