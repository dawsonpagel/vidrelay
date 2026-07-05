import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ---- design tokens ----
const COLORS = {
  ink: "#16211C",
  sidebar: "#1C2A22",
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, { headers: sbHeaders });
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
    { method: "PATCH", headers: sbHeaders, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update ${table} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ---- row <-> app object mapping ----
function mapUser(row) {
  return { username: row.username, password: row.password, role: row.role, commissionRate: row.commission_rate };
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
    createdAt: row.created_at,
  };
}

function mapMessage(row) {
  return { id: row.id, sender: row.sender, receiver: row.receiver, content: row.content, createdAt: row.created_at };
}

function timeAgo(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function App() {
  const [role, setRole] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage] = useState("overview");
  const [users, setUsers] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [messages, setMessages] = useState([]);
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
      const [userRows, subRows, msgRows] = await Promise.all([sbGet("users"), sbGet("submissions"), sbGet("messages")]);
      setUsers(userRows.map(mapUser));
      setSubmissions(subRows.map(mapSubmission));
      setMessages(msgRows.map(mapMessage));
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
    setPage("overview");
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
    } catch (e) {
      setError(e.message || "Couldn't save your rate — try again.");
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
    } catch (e) {
      setError(e.message || "Couldn't submit — try again.");
    }
  }

  async function approve(id) {
    const brandUser = users.find((u) => u.username === currentUser.username);
    const rate = brandUser ? brandUser.commissionRate : null;
    if (!rate) {
      setError("Set your commission rate first before approving.");
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
    } catch (e) {
      setError(e.message || "Couldn't approve — try again.");
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
    } catch (e) {
      setError(e.message || "Couldn't log that sale — try again.");
    }
  }

  async function sendMessage(receiver, content) {
    if (!content.trim()) return;
    try {
      const rows = await sbInsert("messages", {
        sender: currentUser.username,
        receiver,
        content: content.trim(),
      });
      setMessages([...messages, mapMessage(rows[0])]);
    } catch (e) {
      setError(e.message || "Couldn't send that message — try again.");
    }
  }

  useEffect(() => {
    if (page !== "chat" || !currentUser) return;
    const interval = setInterval(async () => {
      try {
        const msgRows = await sbGet("messages");
        setMessages(msgRows.map(mapMessage));
      } catch {
        // silent — next poll will retry
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [page, currentUser]);

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
  const mySubmissions =
    role === "creator"
      ? submissions.filter((s) => s.creatorName === currentUser.username)
      : submissions.filter((s) => s.targetBrand === currentUser.username);
  const pendingCount = mySubmissions.filter((s) => s.status === "pending").length;

  const chatPartners =
    role === "creator"
      ? [...new Set([...brands.map((b) => b.username), ...mySubmissions.map((s) => s.targetBrand)])]
      : [...new Set(mySubmissions.map((s) => s.creatorName))];

  return (
    <div style={styles.wrap}>
      <style>{`
        @media (max-width: 720px) {
          .shell-body { flex-direction: column !important; }
          .sidebar { width: 100% !important; flex-direction: row !important; padding: 8px 16px !important; gap: 8px !important; }
          .sidebar-item { flex: 1; text-align: center; }
        }
      `}</style>
      <TopBar role={role} username={currentUser.username} onLogout={logOut} />
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.shellBody} className="shell-body">
        <Sidebar page={page} setPage={setPage} pendingCount={pendingCount} role={role} />
        <div style={styles.mainArea}>
          {page === "overview" ? (
            role === "creator" ? (
              <CreatorOverview
                currentUser={currentUser}
                submissions={mySubmissions}
                brands={brands}
                pendingCount={pendingCount}
                onGoToSubmissions={() => setPage("submissions")}
              />
            ) : (
              <OverviewPage
                role={role}
                currentUser={currentUser}
                submissions={mySubmissions}
                pendingCount={pendingCount}
                onGoToSubmissions={() => setPage("submissions")}
              />
            )
          ) : page === "chat" ? (
            <ChatPage
              currentUser={currentUser}
              partners={chatPartners}
              messages={messages}
              onSend={sendMessage}
              role={role}
            />
          ) : role === "creator" ? (
            <CreatorSubmissionsPage
              brands={brands}
              tiktokLink={tiktokLink}
              setTiktokLink={setTiktokLink}
              productName={productName}
              setProductName={setProductName}
              targetBrand={targetBrand}
              setTargetBrand={setTargetBrand}
              onSubmit={submitVideo}
              submissions={mySubmissions}
            />
          ) : (
            <BrandSubmissionsPage
              currentUser={currentUser}
              submissions={mySubmissions}
              onSetRate={setMyCommissionRate}
              onApprove={approve}
              onLogSale={logSale}
            />
          )}
        </div>
      </div>
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

function buildActivity(submissions) {
  const events = [];
  submissions.forEach((s) => {
    events.push({
      key: `sub-${s.id}`,
      text: `${s.creatorName} submitted "${s.productName}"`,
      time: s.createdAt,
    });
    if (s.status === "approved") {
      events.push({
        key: `appr-${s.id}`,
        text: `${s.approvedBy} approved "${s.productName}"`,
        time: s.createdAt,
      });
    }
    (s.sales || []).forEach((sale, i) => {
      events.push({
        key: `sale-${s.id}-${i}`,
        text: `$${sale.amount.toFixed(2)} sale logged for "${s.productName}"`,
        time: new Date(sale.date).toISOString(),
      });
    });
  });
  return events.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 6);
}

// ---- Sidebar & Shell ----
function Sidebar({ page, setPage, pendingCount, role }) {
  return (
    <div style={styles.sidebar} className="sidebar">
      <SidebarItem label="Overview" active={page === "overview"} onClick={() => setPage("overview")} />
      <SidebarItem
        label={role === "creator" ? "Submit & track" : "Submissions"}
        active={page === "submissions"}
        onClick={() => setPage("submissions")}
        badge={pendingCount > 0 ? pendingCount : null}
      />
      <SidebarItem label="Chat" active={page === "chat"} onClick={() => setPage("chat")} />
    </div>
  );
}

function SidebarItem({ label, active, onClick, badge }) {
  return (
    <button style={active ? styles.sidebarItemActive : styles.sidebarItem} className="sidebar-item" onClick={onClick}>
      <span>{label}</span>
      {badge && <span style={styles.sidebarBadge}>{badge}</span>}
    </button>
  );
}

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

function CreatorOverview({ currentUser, submissions, brands, pendingCount, onGoToSubmissions }) {
  const totalEarned = submissions.reduce((sum, s) => sum + commissionEarned(s), 0);
  const activity = buildActivity(submissions);

  return (
    <div style={styles.page}>
      <div style={styles.creatorHeader}>
        <div style={styles.creatorHeaderLeft}>
          <div style={styles.avatarCircle}>{initials(currentUser.username)}</div>
          <div>
            <div style={styles.creatorGreeting}>Welcome 👋</div>
            <div style={styles.creatorName}>{currentUser.username}</div>
          </div>
        </div>
        <div style={styles.walletPill}>${totalEarned.toFixed(2)}</div>
      </div>

      <SparkEarningsCard submissions={submissions} />

      <div style={styles.card}>
        <h2 style={styles.h2}>My brands</h2>
        {brands.length === 0 ? (
          <EmptyState text="No brands have set a commission rate yet. Check back soon." />
        ) : (
          <div style={styles.brandScrollRow}>
            {brands.map((b) => (
              <div key={b.username} style={styles.brandChip}>
                <div style={styles.brandChipAvatar}>{initials(b.username)}</div>
                <div style={styles.brandChipName}>{b.username}</div>
                <div style={styles.brandChipRate}>{b.commissionRate}%</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.ctaBanner}>
        <div>
          <div style={styles.ctaTitle}>Let's submit something today</div>
          <div style={styles.ctaSub}>
            {pendingCount > 0 ? `${pendingCount} submission${pendingCount > 1 ? "s" : ""} pending review` : "Pick a brand and share your next video"}
          </div>
        </div>
        <button style={styles.ctaBtn} onClick={onGoToSubmissions}>
          Submit a video
        </button>
      </div>

      {activity.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>Recent activity</h2>
          {activity.map((a) => (
            <div key={a.key} style={styles.activityRow}>
              <span style={styles.activityDot} />
              <div>
                <div style={styles.activityText}>{a.text}</div>
                <div style={styles.activityTime}>{timeAgo(a.time)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SparkEarningsCard({ submissions }) {
  const [days, setDays] = useState(7);
  const series = buildSeries(submissions, days, true);
  const total = series.reduce((sum, point) => sum + point.value, 0);
  const rangeLabel = { 7: "Last 7 days", 14: "Last 14 days", 30: "Last 30 days", 90: "Last 90 days" }[days];

  return (
    <div style={styles.card}>
      <div style={styles.sparkHeader}>
        <span style={styles.sparkLabel}>Earnings</span>
        <select style={styles.sparkSelect} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>{rangeLabel}</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      <div style={styles.sparkTotal}>${total.toFixed(2)}</div>
      <div style={{ width: "100%", height: 130 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 10, right: 6, left: 6, bottom: 0 }}>
            <Tooltip
              formatter={(value) => [`$${value.toFixed(2)}`, "Earnings"]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.line}` }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={COLORS.relay}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: COLORS.relay }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function OverviewPage({ role, currentUser, submissions, pendingCount, onGoToSubmissions }) {
  const approvedCount = submissions.filter((s) => s.status === "approved").length;
  const isCreator = role === "creator";
  const totalEarned = submissions.reduce((sum, s) => sum + commissionEarned(s), 0);
  const activity = buildActivity(submissions);

  return (
    <div style={styles.page}>
      <div style={styles.welcomeRow}>
        <div>
          <h1 style={styles.welcomeH1}>Welcome back, {currentUser.username}!</h1>
          <p style={styles.welcomeSub}>
            {isCreator ? "Track your submissions and earnings" : "Manage your creators and submissions"}
          </p>
        </div>
        {pendingCount > 0 && (
          <button style={styles.pendingPill} onClick={onGoToSubmissions}>
            {pendingCount} pending submission{pendingCount > 1 ? "s" : ""} →
          </button>
        )}
      </div>

      <div style={styles.statRow}>
        <StatCard label={isCreator ? "Total earned" : "Owed to creators"} value={`$${totalEarned.toFixed(2)}`} />
        <StatCard label="Approved" value={approvedCount} />
        <StatCard label="Pending" value={pendingCount} />
        {!isCreator && (
          <StatCard
            label="Your rate"
            value={currentUser.commissionRate ? `${currentUser.commissionRate}%` : "Not set"}
          />
        )}
      </div>

      <div style={styles.twoCol}>
        <SalesChart submissions={submissions} useCommission={isCreator} label={isCreator ? "Your earnings" : "Sales"} />
        <div style={styles.card}>
          <h2 style={styles.h2}>Recent activity</h2>
          {activity.length === 0 ? (
            <EmptyState text="Nothing yet — activity will show up here as things happen." />
          ) : (
            activity.map((a) => (
              <div key={a.key} style={styles.activityRow}>
                <span style={styles.activityDot} />
                <div>
                  <div style={styles.activityText}>{a.text}</div>
                  <div style={styles.activityTime}>{timeAgo(a.time)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
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
      <div style={{ width: "100%", height: 200 }}>
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
        <p style={styles.sub}>{mode === "signup" ? "Create an account to start." : "Log in to your account."}</p>

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

function CreatorSubmissionsPage({
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
  return (
    <div style={styles.page}>
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

function BrandSubmissionsPage({ currentUser, submissions, onSetRate, onApprove, onLogSale }) {
  const [rateInput, setRateInput] = useState("");
  const pending = submissions.filter((s) => s.status === "pending");
  const approved = submissions.filter((s) => s.status === "approved");

  return (
    <div style={styles.page}>
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

function ChatPage({ currentUser, partners, messages, onSend, role }) {
  const [activePartner, setActivePartner] = useState(partners[0] || null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");

  const thread = activePartner
    ? messages
        .filter(
          (m) =>
            (m.sender === currentUser.username && m.receiver === activePartner) ||
            (m.sender === activePartner && m.receiver === currentUser.username)
        )
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    : [];

  function lastMessageFor(partner) {
    const msgs = messages.filter(
      (m) =>
        (m.sender === currentUser.username && m.receiver === partner) ||
        (m.sender === partner && m.receiver === currentUser.username)
    );
    if (msgs.length === 0) return null;
    return msgs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  }

  function submit() {
    if (!activePartner || !draft.trim()) return;
    onSend(activePartner, draft);
    setDraft("");
  }

  const isCreator = role === "creator";
  const visiblePartners = partners.filter((p) => p.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={styles.page}>
      <div style={styles.chatShell}>
        <div style={styles.chatList}>
          {isCreator && (
            <div style={styles.chatListHeader}>
              <div style={styles.chatListTitle}>Conversations</div>
              <input
                style={styles.chatSearchInput}
                placeholder="Search chat"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {partners.length > 0 && (
                <div style={styles.chatChipRow}>
                  <button
                    style={!activePartner || activePartner === "" ? styles.chatChipActive : styles.chatChip}
                    onClick={() => setSearch("")}
                  >
                    All
                  </button>
                  {partners.map((p) => (
                    <button
                      key={p}
                      style={activePartner === p ? styles.chatChipActive : styles.chatChip}
                      onClick={() => setActivePartner(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {visiblePartners.length === 0 ? (
            <EmptyState text="No conversations yet." />
          ) : (
            visiblePartners.map((p) => {
              const last = lastMessageFor(p);
              return (
                <button
                  key={p}
                  style={activePartner === p ? styles.chatListItemActive : styles.chatListItem}
                  onClick={() => setActivePartner(p)}
                >
                  <div style={styles.chatListAvatar}>{initials(p)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={styles.chatListTopRow}>
                      <span style={styles.chatListName}>{p}</span>
                      {last && <span style={styles.chatListTime}>{timeAgo(last.createdAt)}</span>}
                    </div>
                    <div style={styles.chatListPreview}>{last ? last.content : "Say hello"}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div style={styles.chatThread}>
          {!activePartner ? (
            <div style={styles.chatEmptyThread}>Pick a conversation to start chatting.</div>
          ) : (
            <>
              <div style={styles.chatThreadHeader}>{activePartner}</div>
              <div style={styles.chatMessages}>
                {thread.length === 0 ? (
                  <div style={styles.chatEmptyThread}>No messages yet — say hello.</div>
                ) : (
                  thread.map((m) => (
                    <div
                      key={m.id}
                      style={
                        m.sender === currentUser.username ? styles.bubbleMine : styles.bubbleTheirs
                      }
                    >
                      {m.content}
                    </div>
                  ))
                )}
              </div>
              <div style={styles.chatInputRow}>
                <input
                  style={styles.chatInput}
                  placeholder="Write a message..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
                <button style={styles.chatSendBtn} onClick={submit}>
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
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
  shellBody: { display: "flex", alignItems: "flex-start" },
  sidebar: { width: 200, flexShrink: 0, background: COLORS.sidebar, minHeight: "calc(100vh - 57px)", display: "flex", flexDirection: "column", padding: "20px 12px", gap: 4 },
  sidebarItem: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", color: "#9BA79C", textAlign: "left", padding: "10px 14px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  sidebarItemActive: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#2A3A30", border: "none", color: COLORS.paper, textAlign: "left", padding: "10px 14px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  sidebarBadge: { background: COLORS.relay, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 10, padding: "1px 7px" },
  mainArea: { flex: 1, minWidth: 0 },
  page: { maxWidth: 900, margin: "0 auto", padding: "28px 24px 60px", display: "flex", flexDirection: "column", gap: 20 },
  welcomeRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 },
  welcomeH1: { fontSize: 26, fontWeight: 800, margin: 0 },
  welcomeSub: { color: "#9BA79C", fontSize: 14, margin: "4px 0 0" },
  pendingPill: { background: COLORS.relay, color: "#fff", border: "none", borderRadius: 20, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" },
  statRow: { display: "flex", gap: 12, flexWrap: "wrap" },
  statCard: { background: COLORS.paper, color: "#20261F", borderRadius: 14, padding: "16px 18px", flex: "1 1 140px" },
  statLabel: { fontSize: 12, color: "#6C7264", fontWeight: 600, marginBottom: 6 },
  statValue: { fontSize: 22, fontWeight: 800 },
  twoCol: { display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" },
  card: { background: COLORS.paper, color: "#20261F", borderRadius: 14, padding: 22, flex: "1 1 380px", minWidth: 0 },
  h2: { fontSize: 15, fontWeight: 800, margin: "0 0 16px", color: "#20261F" },
  label: { fontSize: 12, fontWeight: 600, color: "#5B6156", display: "block", marginBottom: 6 },
  input: { width: "100%", border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, marginBottom: 14, boxSizing: "border-box", background: "#fff" },
  primaryBtn: { background: COLORS.moss, color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", width: "100%" },
  primaryBtnSmall: { background: COLORS.moss, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
  rateHelp: { fontSize: 12.5, color: "#6C7264", margin: "0 0 12px" },
  currentRate: { fontSize: 13, color: "#20261F", background: "#E4EEE7", borderRadius: 8, padding: "8px 12px", marginBottom: 12 },
  currentRateEmpty: { fontSize: 13, color: "#A3402A", background: "#FBE7E2", borderRadius: 8, padding: "8px 12px", marginBottom: 12 },
  chartHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  rangeToggle: { display: "flex", gap: 4, background: "#EFEBDE", borderRadius: 8, padding: 3 },
  rangeBtn: { background: "none", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 700, color: "#8A8F80", cursor: "pointer" },
  rangeBtnActive: { background: COLORS.ink, border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer" },
  chartTotal: { fontSize: 22, fontWeight: 800, color: "#20261F", margin: "8px 0 6px" },
  activityRow: { display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderTop: `1px solid ${COLORS.line}` },
  activityDot: { width: 6, height: 6, borderRadius: "50%", background: COLORS.relay, marginTop: 6, flexShrink: 0 },
  activityText: { fontSize: 13, fontWeight: 600, color: "#20261F" },
  activityTime: { fontSize: 11.5, color: "#8A8F80", marginTop: 1 },
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
  creatorHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 },
  creatorHeaderLeft: { display: "flex", alignItems: "center", gap: 14 },
  avatarCircle: { width: 48, height: 48, borderRadius: "50%", background: COLORS.relay, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, flexShrink: 0 },
  creatorGreeting: { fontSize: 12.5, color: "#9BA79C" },
  creatorName: { fontSize: 19, fontWeight: 800, color: COLORS.paper },
  walletPill: { background: COLORS.paper, color: "#20261F", borderRadius: 20, padding: "9px 18px", fontWeight: 800, fontSize: 15 },
  sparkHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  sparkLabel: { fontSize: 13, fontWeight: 700, color: "#6C7264" },
  sparkSelect: { border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "5px 8px", fontSize: 12, background: "#fff", color: "#20261F" },
  sparkTotal: { fontSize: 30, fontWeight: 800, color: "#20261F", margin: "6px 0 2px" },
  brandScrollRow: { display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 },
  brandChip: { flex: "0 0 auto", background: "#EFEBDE", borderRadius: 12, padding: "14px 16px", textAlign: "center", minWidth: 96 },
  brandChipAvatar: { width: 36, height: 36, borderRadius: "50%", background: COLORS.moss, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, margin: "0 auto 8px" },
  brandChipName: { fontSize: 12, fontWeight: 700, color: "#20261F", whiteSpace: "nowrap" },
  brandChipRate: { fontSize: 11, color: COLORS.moss, fontWeight: 700, marginTop: 2 },
  ctaBanner: { background: COLORS.moss, borderRadius: 14, padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 },
  ctaTitle: { color: "#fff", fontWeight: 800, fontSize: 16 },
  ctaSub: { color: "#D7E4DD", fontSize: 12.5, marginTop: 3 },
  ctaBtn: { background: COLORS.relay, color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" },
  chatShell: { display: "flex", background: COLORS.paper, borderRadius: 14, overflow: "hidden", minHeight: 480, height: "70vh" },
  chatList: { width: 240, flexShrink: 0, borderRight: `1px solid ${COLORS.line}`, overflowY: "auto", display: "flex", flexDirection: "column" },
  chatListHeader: { padding: "16px 14px 10px", borderBottom: `1px solid ${COLORS.line}`, display: "flex", flexDirection: "column", gap: 10 },
  chatListTitle: { fontSize: 17, fontWeight: 800, color: "#20261F" },
  chatSearchInput: { border: `1px solid ${COLORS.line}`, borderRadius: 20, padding: "7px 14px", fontSize: 12.5, background: "#F1EDE3" },
  chatChipRow: { display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 },
  chatChip: { flex: "0 0 auto", background: "#EFEBDE", border: "none", borderRadius: 20, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, color: "#6C7264", cursor: "pointer", whiteSpace: "nowrap" },
  chatChipActive: { flex: "0 0 auto", background: COLORS.relay, border: "none", borderRadius: 20, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, color: "#fff", cursor: "pointer", whiteSpace: "nowrap" },
  chatListTopRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 },
  chatListTime: { fontSize: 10.5, color: "#8A8F80", flexShrink: 0 },
  chatListItem: { display: "flex", gap: 10, alignItems: "center", padding: "12px 14px", background: "none", border: "none", borderBottom: `1px solid ${COLORS.line}`, cursor: "pointer", textAlign: "left" },
  chatListItemActive: { display: "flex", gap: 10, alignItems: "center", padding: "12px 14px", background: "#EFEBDE", border: "none", borderBottom: `1px solid ${COLORS.line}`, cursor: "pointer", textAlign: "left" },
  chatListAvatar: { width: 32, height: 32, borderRadius: "50%", background: COLORS.moss, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, flexShrink: 0 },
  chatListName: { fontSize: 13, fontWeight: 700, color: "#20261F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  chatListPreview: { fontSize: 11.5, color: "#8A8F80", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  chatThread: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  chatThreadHeader: { padding: "14px 18px", fontWeight: 800, fontSize: 14, color: "#20261F", borderBottom: `1px solid ${COLORS.line}` },
  chatMessages: { flex: 1, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" },
  chatEmptyThread: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#8A8F80", fontSize: 13, textAlign: "center", padding: 20 },
  bubbleMine: { alignSelf: "flex-end", background: COLORS.moss, color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "9px 14px", fontSize: 13.5, maxWidth: "70%" },
  bubbleTheirs: { alignSelf: "flex-start", background: "#EFEBDE", color: "#20261F", borderRadius: "14px 14px 14px 4px", padding: "9px 14px", fontSize: 13.5, maxWidth: "70%" },
  chatInputRow: { display: "flex", gap: 8, padding: "12px 16px", borderTop: `1px solid ${COLORS.line}` },
  chatInput: { flex: 1, border: `1px solid ${COLORS.line}`, borderRadius: 20, padding: "9px 16px", fontSize: 13.5, boxSizing: "border-box" },
  chatSendBtn: { background: COLORS.relay, color: "#fff", border: "none", borderRadius: 20, padding: "9px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  error: { background: "#3A2320", color: "#F2A99A", padding: "10px 24px", fontSize: 13 },
};
