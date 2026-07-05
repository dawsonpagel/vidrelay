import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ---- design tokens ----
const COLORS = {
  ink: "#16211C",
  paper: "#F7F5EF",
  relay: "#E8613C",
  moss: "#3E6B5C",
  line: "#D8D3C4",
};

// ---- Supabase connection ----
const SUPABASE_URL = "https://zyekxsmtancjpvpuuhin.supabase.co";
const SUPABASE_KEY = "sb_publishable_GhRog497alqpD4zMd0uXzg_peuywLlB";

const sbHeaders = {
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function sbGet(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: sbHeaders,
  });
  if (!res.ok) throw new Error(`Failed to load ${table}`);
  return res.json();
}

async function sbInsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Insert into ${table} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function sbUpdate(table, matchColumn, matchValue, body) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${encodeURIComponent(matchValue)}`,
    {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`Failed to update ${table}`);
  return res.json();
}

// ---- row <-> app object mapping ----
function mapUser(row) {
  return {
    username: row.username,
    password: row.password,
    role: row.role,
    commissionRate: row.commission_rate,
  };
}

function mapSubmission(row) {
  return {
    id: row.id,
    creatorName: row.creator_username,
    targetBrand: row.target_brand,
    productName: row.product_name,
    tiktokLink: row.tiktok_link,
    status: row.status,
    approvedBy: row.approved_by,
    commissionRate: row.commission_rate,
    sales: row.sales || [],
  };
}

export default function App() {
  const [role, setRole] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tiktokLink, setTiktokLink] = useState("");
  const [productName, setProductName] = useState("");
  const [targetBrand, setTargetBrand] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const [userRows, subRows] = await Promise.all([sbGet("users"), sbGet("submissions")]);
      setUsers(userRows.map(mapUser));
      setSubmissions(subRows.map(mapSubmission));
    } catch (e) {
      setError("Couldn't connect to the database. Check your connection and try again.");
    }
    setLoading(false);
  }

  async function signUp(username, password) {
    const clean = username.trim();
    if (!clean || !password) {
      setError("Enter a username and password.");
      return;
    }
    const exists = users.find((u) => u.username.toLowerCase() === clean.toLowerCase());
    if (exists) {
      setError("That username is taken. Try logging in instead.");
      return;
    }
    setError("");
    try {
      await sbInsert("users", { username: clean, password, role, commission_rate: null });
      const user = { username: clean, password, role, commissionRate: null };
      setUsers([...users, user]);
      setCurrentUser(user);
    } catch (e) {
      setError(e.message || "Couldn't create your account — try again.");
    }
  }

  function logIn(username, password) {
    const clean = username.trim();
    const user = users.find((u) => u.username.toLowerCase() === clean.toLowerCase());
    if (!user) {
      setError("No account with that username. Sign up instead.");
      return;
    }
    if (user.password !== password) {
      setError("Incorrect password.");
      return;
    }
    if (user.role !== role) {
      setError(`That account is a ${user.role}, not a ${role}. Switch role above.`);
      return;
    }
    setError("");
    setCurrentUser(user);
  }

  function logOut() {
    setCurrentUser(null);
    setRole(null);
    setError("");
  }

  async function setMyCommissionRate(rate) {
    const numRate = parseFloat(rate);
    if (isNaN(numRate) || numRate <= 0) {
      setError("Enter a valid commission rate (e.g. 10 for 10%).");
      return;
    }
    setError("");
    try {
      await sbUpdate("users", "username", currentUser.username, { commission_rate: numRate });
      const nextUsers = users.map((u) =>
        u.username === currentUser.username ? { ...u, commissionRate: numRate } : u
      );
      setUsers(nextUsers);
      setCurrentUser({ ...currentUser, commissionRate: numRate });
    } catch {
      setError("Couldn't save your rate — try again.");
    }
  }

  async function submitVideo() {
    if (!tiktokLink.trim() || !productName.trim() || !targetBrand) {
      setError("Fill in the product name, TikTok link, and pick a brand.");
      return;
    }
    setError("");
    try {
      const rows = await sbInsert("submissions", {
        creator_username: currentUser.username,
        target_brand: targetBrand,
        product_name: productName.trim(),
        tiktok_link: tiktokLink.trim(),
        status: "pending",
        approved_by: null,
        commission_rate: null,
      });
      setSubmissions([mapSubmission(rows[0]), ...submissions]);
      setTiktokLink("");
      setProductName("");
      setTargetBrand("");
    } catch {
      setError("Couldn't submit — try again.");
    }
  }

  async function approve(id) {
    const brandUser = users.find((u) => u.username === currentUser.username);
    const rate = brandUser ? brandUser.commissionRate : null;
    if (!rate) {
      setError("Set your commission rate first (above) before approving.");
      return;
    }
    setError("");
    try {
      await sbUpdate("submissions", "id", id, {
        status: "approved",
        approved_by: currentUser.username,
        commission_rate: rate,
      });
      setSubmissions(
        submissions.map((s) =>
          s.id === id ? { ...s, status: "approved", approvedBy: currentUser.username, commissionRate: rate } : s
        )
      );
    } catch {
      setError("Couldn't approve — try again.");
    }
  }

  async function logSale(id, amount) {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Enter a valid sale amount.");
      return;
    }
    setError("");
    const submission = submissions.find((s) => s.id === id);
    const nextSales = [...(submission.sales || []), { amount: numAmount, date: Date.now() }];
    try {
      await sbUpdate("submissions", "id", id, { sales: nextSales });
      setSubmissions(submissions.map((s) => (s.id === id ? { ...s, sales: nextSales } : s)));
    } catch {
      setError("Couldn't log that sale — try again.");
    }
  }

  if (loading) {
    return (
      <div style={styles.wrap}>
        <p style={{ color: COLORS.paper, fontFamily: "system-ui", padding: 24 }}>Loading…</p>
      </div>
    );
  }

  if (!role) return <RoleScreen onPick={setRole} />;

  if (!currentUser) {
    return (
      <AuthScreen
        role={role}
        error={error}
        onBack={() => {
          setRole(null);
          setError("");
        }}
        onLogin={logIn}
        onSignup={signUp}
      />
    );
  }

  const brands = users.filter((u) => u.role === "brand" && u.commissionRate);

  return (
    <div style={styles.wrap}>
      <TopBar role={role} username={currentUser.username} onLogout={logOut} />

      {error && <div style={styles.error}>{error}</div>}

      {role === "creator" ? (
        <CreatorView
          brands={brands}
          tiktokLink={tiktokLink}
          setTiktokLink={setTiktokLink}
          productName={productName}
          setProductName={setProductName}
          targetBrand={targetBrand}
          setTargetBrand={setTargetBrand}
          onSubmit={submitVideo}
          submissions={submissions.filter((s) => s.creatorName === currentUser.username)}
        />
      ) : (
        <BrandView
          currentUser={currentUser}
          submissions={submissions.filter((s) => s.targetBrand === currentUser.username)}
          onSetRate={setMyCommissionRate}
          onApprove={approve}
          onLogSale={logSale}
        />
      )}
    </div>
  );
}

function commissionEarned(s) {
  if (!s.commissionRate) return 0;
  const sales = s.sales || [];
  const total = sales.reduce((sum, sale) => sum + sale.amount, 0);
  return (total * s.commissionRate) / 100;
}

function totalSales(s) {
  const sales = s.sales || [];
  return sales.reduce((sum, sale) => sum + sale.amount, 0);
}

function buildSeries(submissions, days, useCommission) {
  const map = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const keyFor = (d) => d.toDateString();
  const labelFor = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    map[keyFor(d)] = { date: labelFor(d), value: 0 };
  }

  submissions.forEach((s) => {
    (s.sales || []).forEach((sale) => {
      const d = new Date(sale.date);
      d.setHours(0, 0, 0, 0);
      const key = keyFor(d);
      if (map[key]) {
        const value = useCommission ? (sale.amount * (s.commissionRate || 0)) / 100 : sale.amount;
        map[key].value += value;
      }
    });
  });

  return Object.values(map);
}

function SalesChart({ submissions, useCommission, label }) {
  const [days, setDays] = useState(7);
  const series = buildSeries(submissions, days, useCommission);
  const total = series.reduce((sum, point) => sum + point.value, 0);

  return (
    <div style={styles.card}>
      <div style={styles.chartHeader}>
        <h2 style={{ ...styles.h2, margin: 0 }}>{label}</h2>
        <div style={styles.rangeToggle}>
          {[7, 14, 30, 90].map((d) => (
            <button key={d} style={d === days ? styles.rangeBtnActive : styles.rangeBtn} onClick={() => setDays(d)}>
              {d}D
            </button>
          ))}
        </div>
      </div>
      <div style={styles.chartTotal}>${total.toFixed(2)}</div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.line} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8A8F80" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#8A8F80" }} axisLine={false} tickLine={false} width={50} />
            <Tooltip
              formatter={(value) => [`$${value.toFixed(2)}`, label]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.line}` }}
            />
            <Line type="monotone" dataKey="value" stroke={COLORS.relay} strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RoleScreen({ onPick }) {
  return (
    <div style={styles.wrap}>
      <div style={styles.centerCol}>
        <div style={styles.batonRow}>
          <span style={styles.baton} />
        </div>
        <h1 style={styles.h1}>Vidrelay</h1>
        <p style={styles.sub}>
          Turn your TikTok Shop content into paid ads. Creators submit videos, brands pick the ones they want to run.
        </p>
        <div style={styles.roleButtons}>
          <button style={styles.bigBtn} onClick={() => onPick("creator")}>
            I'm a creator
          </button>
          <button style={{ ...styles.bigBtn, ...styles.bigBtnAlt }} onClick={() => onPick("brand")}>
            I'm a brand
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthScreen({ role, error, onBack, onLogin, onSignup }) {
  const [mode, setMode] = useState("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function submit() {
    if (mode === "signup") onSignup(username, password);
    else onLogin(username, password);
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.centerCol}>
        <div style={styles.batonRow}>
          <span style={styles.baton} />
        </div>
        <h1 style={{ ...styles.h1, fontSize: 28 }}>
          {role === "creator" ? "Creator" : "Brand"} account
        </h1>
        <p style={styles.sub}>
          {mode === "signup" ? "Create an account to start." : "Log in to your account."}
        </p>

        <div style={styles.authCard}>
          <div style={styles.authTabs}>
            <button style={mode === "signup" ? styles.authTabActive : styles.authTab} onClick={() => setMode("signup")}>
              Sign up
            </button>
            <button style={mode === "login" ? styles.authTabActive : styles.authTab} onClick={() => setMode("login")}>
              Log in
            </button>
          </div>

          {error && <div style={styles.authError}>{error}</div>}

          <label style={styles.label}>Username</label>
          <input
            style={styles.input}
            placeholder="e.g. jordan_creates"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button style={styles.primaryBtn} onClick={submit}>
            {mode === "signup" ? "Create account" : "Log in"}
          </button>
        </div>

        <button style={styles.linkBtnLight} onClick={onBack}>
          ← choose a different role
        </button>
      </div>
    </div>
  );
}

function TopBar({ role, username, onLogout }) {
  return (
    <div style={styles.topBar}>
      <div>
        <span style={styles.logo}>Vidrelay</span>
        <span style={styles.roleTag}>{role === "creator" ? "Creator" : "Brand"}</span>
      </div>
      <div style={styles.topBarRight}>
        <span style={styles.usernameTag}>{username}</span>
        <button style={styles.linkBtn} onClick={onLogout}>
          log out
        </button>
      </div>
    </div>
  );
}

function CreatorView({
  brands,
  tiktokLink,
  setTiktokLink,
  productName,
  setProductName,
  targetBrand,
  setTargetBrand,
  onSubmit,
  submissions,
}) {
  const totalEarned = submissions.reduce((sum, s) => sum + commissionEarned(s), 0);

  return (
    <div style={styles.body}>
      <div style={styles.card}>
        <h2 style={styles.h2}>Brands you can submit to</h2>
        {brands.length === 0 ? (
          <EmptyState text="No brands have set a commission rate yet. Check back soon." />
        ) : (
          brands.map((b) => (
            <div key={b.username} style={styles.brandRow}>
              <span style={styles.brandName}>{b.username}</span>
              <span style={styles.statusTag}>{b.commissionRate}% commission</span>
            </div>
          ))
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Submit a video</h2>
        <label style={styles.label}>Brand</label>
        <select style={styles.input} value={targetBrand} onChange={(e) => setTargetBrand(e.target.value)}>
          <option value="">Choose a brand...</option>
          {brands.map((b) => (
            <option key={b.username} value={b.username}>
              {b.username} — {b.commissionRate}% commission
            </option>
          ))}
        </select>
        <label style={styles.label}>Product name</label>
        <input
          style={styles.input}
          placeholder="e.g. Glow Serum"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
        />
        <label style={styles.label}>TikTok video link</label>
        <input
          style={styles.input}
          placeholder="https://tiktok.com/..."
          value={tiktokLink}
          onChange={(e) => setTiktokLink(e.target.value)}
        />
        <button style={styles.primaryBtn} onClick={onSubmit}>
          Submit for review
        </button>
      </div>

      {submissions.length > 0 && (
        <div style={styles.earningsBanner}>
          <span style={styles.earningsLabel}>Total commission earned</span>
          <span style={styles.earningsAmount}>${totalEarned.toFixed(2)}</span>
        </div>
      )}

      {submissions.length > 0 && <SalesChart submissions={submissions} useCommission={true} label="Your earnings" />}

      <div style={styles.card}>
        <h2 style={styles.h2}>Your submissions</h2>
        {submissions.length === 0 ? (
          <EmptyState text="Nothing submitted yet. Add your first video above." />
        ) : (
          submissions.map((s) => <SubmissionRow key={s.id} s={s} />)
        )}
      </div>
    </div>
  );
}

function BrandView({ currentUser, submissions, onSetRate, onApprove, onLogSale }) {
  const [rateInput, setRateInput] = useState("");
  const pending = submissions.filter((s) => s.status === "pending");
  const approved = submissions.filter((s) => s.status === "approved");
  const totalOwed = approved.reduce((sum, s) => sum + commissionEarned(s), 0);

  return (
    <div style={styles.body}>
      <div style={styles.card}>
        <h2 style={styles.h2}>Your commission rate</h2>
        <p style={styles.rateHelp}>This is what creators will see before they choose to submit to you.</p>
        {currentUser.commissionRate ? (
          <div style={styles.currentRate}>
            Currently offering <strong>{currentUser.commissionRate}%</strong> commission
          </div>
        ) : (
          <div style={styles.currentRateEmpty}>You haven't set a rate yet — creators can't find you.</div>
        )}
        <div style={styles.rateRow}>
          <input
            style={styles.rateInput}
            placeholder="e.g. 10"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
          />
          <button
            style={styles.primaryBtnSmall}
            onClick={() => {
              onSetRate(rateInput);
              setRateInput("");
            }}
          >
            {currentUser.commissionRate ? "Update rate" : "Set rate"}
          </button>
        </div>
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Pending submissions</h2>
        {pending.length === 0 ? (
          <EmptyState text="No pending videos right now. Check back soon." />
        ) : (
          pending.map((s) => (
            <div key={s.id} style={styles.rowCol}>
              <div style={styles.rowTop}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.rowTitle}>{s.productName}</div>
                  <div style={styles.rowSub}>
                    by {s.creatorName} ·{" "}
                    <a href={s.tiktokLink} target="_blank" rel="noreferrer" style={styles.rowLink}>
                      view video
                    </a>
                  </div>
                </div>
                <button style={styles.approveBtn} onClick={() => onApprove(s.id)}>
                  Approve
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {approved.length > 0 && (
        <div style={styles.earningsBanner}>
          <span style={styles.earningsLabel}>Total commission owed to creators</span>
          <span style={styles.earningsAmount}>${totalOwed.toFixed(2)}</span>
        </div>
      )}

      {approved.length > 0 && <SalesChart submissions={submissions} useCommission={false} label="Sales" />}

      <div style={styles.card}>
        <h2 style={styles.h2}>Approved by you</h2>
        {approved.length === 0 ? (
          <EmptyState text="Approved videos will show up here, ready to run as ads." />
        ) : (
          approved.map((s) => <ApprovedRow key={s.id} s={s} onLogSale={onLogSale} />)
        )}
      </div>
    </div>
  );
}

function ApprovedRow({ s, onLogSale }) {
  const [amount, setAmount] = useState("");
  const earned = commissionEarned(s);
  const sales = totalSales(s);

  function submitSale() {
    onLogSale(s.id, amount);
    setAmount("");
  }

  return (
    <div style={styles.rowCol}>
      <div style={styles.rowTop}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.rowTitle}>{s.productName}</div>
          <div style={styles.rowSub}>
            by {s.creatorName} ·{" "}
            <a href={s.tiktokLink} target="_blank" rel="noreferrer" style={styles.rowLink}>
              view video
            </a>
          </div>
        </div>
        <span style={styles.statusTag}>{s.commissionRate}% commission</span>
      </div>
      <div style={styles.salesStrip}>
        <span>Sales: ${sales.toFixed(2)}</span>
        <span>Owed: ${earned.toFixed(2)}</span>
      </div>
      <div style={styles.rateRow}>
        <input
          style={styles.rateInput}
          placeholder="Log a sale ($)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button style={styles.logSaleBtn} onClick={submitSale}>
          Log sale
        </button>
      </div>
    </div>
  );
}

function SubmissionRow({ s }) {
  const earned = commissionEarned(s);
  const sales = totalSales(s);
  return (
    <div style={styles.rowCol}>
      <div style={styles.rowTop}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.rowTitle}>{s.productName}</div>
          <div style={styles.rowSub}>
            to {s.targetBrand} ·{" "}
            <a href={s.tiktokLink} target="_blank" rel="noreferrer" style={styles.rowLink}>
              view video
            </a>
          </div>
        </div>
        {s.status === "approved" ? (
          <span style={styles.statusTag}>{s.commissionRate}% commission</span>
        ) : (
          <span style={styles.pendingTag}>pending</span>
        )}
      </div>
      {s.status === "approved" && (
        <div style={styles.salesStrip}>
          <span>Sales driven: ${sales.toFixed(2)}</span>
          <span>You earned: ${earned.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }) {
  return <p style={styles.empty}>{text}</p>;
}

const styles = {
  wrap: { minHeight: "100%", background: COLORS.ink, fontFamily: "'Segoe UI', system-ui, sans-serif", color: COLORS.paper, padding: 0 },
  centerCol: { maxWidth: 440, margin: "0 auto", padding: "72px 24px", textAlign: "center" },
  batonRow: { display: "flex", justifyContent: "center", marginBottom: 20 },
  baton: { width: 60, height: 8, borderRadius: 4, background: COLORS.relay, display: "inline-block" },
  h1: { fontSize: 40, fontWeight: 800, margin: "0 0 12px", letterSpacing: -0.5 },
  sub: { color: "#C9C4B4", fontSize: 15, lineHeight: 1.5, margin: "0 0 32px" },
  roleButtons: { display: "flex", flexDirection: "column", gap: 12 },
  bigBtn: { background: COLORS.relay, color: "#fff", border: "none", borderRadius: 10, padding: "14px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  bigBtnAlt: { background: "transparent", border: `1px solid ${COLORS.line}`, color: COLORS.paper },
  authCard: { background: COLORS.paper, color: "#20261F", borderRadius: 14, padding: 22, textAlign: "left", marginBottom: 20 },
  authTabs: { display: "flex", gap: 6, marginBottom: 16 },
  authTab: { flex: 1, background: "#EFEBDE", border: "none", borderRadius: 8, padding: "9px 0", fontWeight: 700, fontSize: 13, color: "#6C7264", cursor: "pointer" },
  authTabActive: { flex: 1, background: COLORS.moss, border: "none", borderRadius: 8, padding: "9px 0", fontWeight: 700, fontSize: 13, color: "#fff", cursor: "pointer" },
  authError: { background: "#FBE7E2", color: "#A3402A", fontSize: 12.5, borderRadius: 8, padding: "8px 10px", marginBottom: 14 },
  linkBtnLight: { background: "none", border: "none", color: "#9BA79C", fontSize: 13, cursor: "pointer" },
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: `1px solid #2A362F` },
  logo: { fontWeight: 800, fontSize: 16, marginRight: 10 },
  roleTag: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: COLORS.relay, border: `1px solid ${COLORS.relay}`, borderRadius: 20, padding: "3px 8px" },
  topBarRight: { display: "flex", gap: 12, alignItems: "center" },
  usernameTag: { fontSize: 13, fontWeight: 700, color: COLORS.paper },
  linkBtn: { background: "none", border: "none", color: "#9BA79C", fontSize: 12, cursor: "pointer" },
  body: { maxWidth: 640, margin: "0 auto", padding: "28px 24px 60px", display: "flex", flexDirection: "column", gap: 20 },
  card: { background: COLORS.paper, color: "#20261F", borderRadius: 14, padding: 22 },
  h2: { fontSize: 15, fontWeight: 800, margin: "0 0 16px", color: "#20261F" },
  label: { fontSize: 12, fontWeight: 600, color: "#5B6156", display: "block", marginBottom: 6 },
  input: { width: "100%", border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, marginBottom: 14, boxSizing: "border-box", background: "#fff" },
  primaryBtn: { background: COLORS.moss, color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", width: "100%" },
  primaryBtnSmall: { background: COLORS.moss, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
  rateHelp: { fontSize: 12.5, color: "#6C7264", margin: "0 0 12px" },
  currentRate: { fontSize: 13, color: "#20261F", background: "#E4EEE7", borderRadius: 8, padding: "8px 12px", marginBottom: 12 },
  currentRateEmpty: { fontSize: 13, color: "#A3402A", background: "#FBE7E2", borderRadius: 8, padding: "8px 12px", marginBottom: 12 },
  earningsBanner: { background: COLORS.moss, color: "#fff", borderRadius: 12, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  earningsLabel: { fontSize: 12.5, fontWeight: 600, opacity: 0.85 },
  earningsAmount: { fontSize: 18, fontWeight: 800 },
  chartHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  rangeToggle: { display: "flex", gap: 4, background: "#EFEBDE", borderRadius: 8, padding: 3 },
  rangeBtn: { background: "none", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 700, color: "#8A8F80", cursor: "pointer" },
  rangeBtnActive: { background: COLORS.ink, border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer" },
  chartTotal: { fontSize: 24, fontWeight: 800, color: "#20261F", margin: "8px 0 6px" },
  brandRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${COLORS.line}` },
  brandName: { fontWeight: 700, fontSize: 14 },
  rowCol: { padding: "14px 0", borderTop: `1px solid ${COLORS.line}`, display: "flex", flexDirection: "column", gap: 10 },
  rowTop: { display: "flex", alignItems: "flex-start", gap: 12 },
  rateRow: { display: "flex", gap: 8 },
  rateInput: { flex: 1, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" },
  approveBtn: { background: COLORS.relay, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
  logSaleBtn: { background: COLORS.moss, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
  salesStrip: { display: "flex", gap: 16, fontSize: 12.5, fontWeight: 600, color: "#5B6156", background: "#EFEBDE", borderRadius: 8, padding: "8px 12px" },
  rowTitle: { fontWeight: 700, fontSize: 14 },
  rowSub: { fontSize: 12.5, color: "#6C7264", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" },
  rowLink: { color: COLORS.moss, fontWeight: 600 },
  statusTag: { fontSize: 11, fontWeight: 700, color: COLORS.moss, background: "#E4EEE7", borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap" },
  pendingTag: { fontSize: 11, fontWeight: 700, color: "#A3402A", background: "#FBE7E2", borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap" },
  empty: { fontSize: 13, color: "#8A8F80", margin: 0, padding: "10px 0" },
  error: { background: "#3A2320", color: "#F2A99A", padding: "10px 24px", fontSize: 13 },
};
