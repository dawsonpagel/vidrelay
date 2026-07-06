import { useState, useEffect, useRef } from "react";
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

async function sbUploadFile(bucket, path, file) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": file.type || "video/mp4",
    },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

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

async function sbDelete(table, matchColumn, matchValue) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${encodeURIComponent(matchValue)}`,
    { method: "DELETE", headers: sbHeaders }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete from ${table} failed (${res.status}): ${text}`);
  }
}

// ---- row <-> app object mapping ----
function mapPayoutRecord(row) {
  return {
    id: row.id,
    creatorName: row.creator_username,
    brandUsername: row.brand_username,
    amount: row.amount,
    createdAt: row.created_at,
  };
}

function mapSampleRequest(row) {
  return {
    id: row.id,
    creatorName: row.creator_username,
    brandUsername: row.brand_username,
    productName: row.product_name,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapProduct(row) {
  return {
    id: row.id,
    brandUsername: row.brand_username,
    productName: row.product_name,
    imageUrl: row.image_url,
  };
}

function mapUser(row) {
  return {
    username: row.username,
    password: row.password,
    role: row.role,
    commissionRate: row.commission_rate,
    metaAccessToken: row.meta_access_token,
    metaAdAccountId: row.meta_ad_account_id,
    logoUrl: row.logo_url,
  };
}

function mapSubmission(row) {
  return {
    id: row.id,
    creatorName: row.creator_username,
    targetBrand: row.target_brand,
    productName: row.product_name,
    tiktokLink: row.tiktok_link,
    videoFileUrl: row.video_file_url,
    metaAdId: row.meta_ad_id,
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

function saveSession(username, role) {
  try {
    localStorage.setItem("vidrelay_session", JSON.stringify({ username, role }));
  } catch {
    // if storage is unavailable, just skip persisting — login still works normally
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem("vidrelay_session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem("vidrelay_session");
  } catch {
    // nothing to clean up
  }
}

function playDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const notes = [
      { freq: 1046.5, start: 0, dur: 0.14 }, // C6
      { freq: 1568.0, start: 0.1, dur: 0.28 }, // G6
    ];
    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0.0001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.3, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.05);
    });
  } catch {
    // audio not supported/blocked — fail silently
  }
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
  const [products, setProducts] = useState([]);
  const [sampleRequests, setSampleRequests] = useState([]);
  const [payoutRecords, setPayoutRecords] = useState([]);
  const [saleToast, setSaleToast] = useState(null);
  const seenSalesRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [videoFile, setVideoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [productName, setProductName] = useState("");
  const [targetBrand, setTargetBrand] = useState("");
  const [error, setError] = useState("");
  const [metaStatus] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("meta_connected")) return "connected";
    if (params.get("meta_error")) return "error";
    return null;
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const [userRows, subRows, msgRows, productRows, sampleRows, payoutRows] = await Promise.all([
        sbGet("users"),
        sbGet("submissions"),
        sbGet("messages"),
        sbGet("products"),
        sbGet("sample_requests"),
        sbGet("payout_records"),
      ]);
      const mappedUsers = userRows.map(mapUser);
      setUsers(mappedUsers);
      setSubmissions(subRows.map(mapSubmission));
      setMessages(msgRows.map(mapMessage));
      setProducts(productRows.map(mapProduct));
      setSampleRequests(sampleRows.map(mapSampleRequest));
      setPayoutRecords(payoutRows.map(mapPayoutRecord));

      const session = loadSession();
      if (session) {
        const match = mappedUsers.find(
          (u) => u.username === session.username && u.role === session.role
        );
        if (match) {
          setRole(match.role);
          setCurrentUser(match);
        } else {
          clearSession();
        }
      }
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
      saveSession(clean, role);
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
    saveSession(user.username, user.role);
  }

  function logOut() {
    setCurrentUser(null);
    setRole(null);
    setPage("overview");
    setError("");
    clearSession();
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

  async function addProduct(name) {
    const clean = name.trim();
    if (!clean) {
      setError("Enter a product name.");
      return;
    }
    setError("");
    try {
      const rows = await sbInsert("products", {
        brand_username: currentUser.username,
        product_name: clean,
      });
      setProducts([...products, mapProduct(rows[0])]);
    } catch (e) {
      setError(e.message || "Couldn't add that product — try again.");
    }
  }

  async function removeProduct(id) {
    setError("");
    try {
      await sbDelete("products", "id", id);
      setProducts(products.filter((p) => p.id !== id));
    } catch (e) {
      setError(e.message || "Couldn't remove that product — try again.");
    }
  }

  async function requestSample(brandUsername, productName) {
    if (!brandUsername || !productName) {
      setError("Pick a brand and a product to request a sample of.");
      return;
    }
    setError("");
    try {
      const rows = await sbInsert("sample_requests", {
        creator_username: currentUser.username,
        brand_username: brandUsername,
        product_name: productName,
        status: "pending",
      });
      setSampleRequests([mapSampleRequest(rows[0]), ...sampleRequests]);
    } catch (e) {
      setError(e.message || "Couldn't request that sample — try again.");
    }
  }

  async function updateSampleStatus(id, status) {
    setError("");
    try {
      await sbUpdate("sample_requests", "id", id, { status });
      setSampleRequests(sampleRequests.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e) {
      setError(e.message || "Couldn't update that request — try again.");
    }
  }

  async function markAsPaid(creatorName, amount) {
    setError("");
    try {
      const rows = await sbInsert("payout_records", {
        creator_username: creatorName,
        brand_username: currentUser.username,
        amount,
      });
      setPayoutRecords([mapPayoutRecord(rows[0]), ...payoutRecords]);
    } catch (e) {
      setError(e.message || "Couldn't record that payout — try again.");
    }
  }

  async function uploadLogo(file) {
    if (!file) return;
    setError("");
    try {
      const safeName = `${currentUser.username.replace(/[^a-zA-Z0-9]/g, "_")}-${Date.now()}-${file.name.replace(
        /[^a-zA-Z0-9.]/g,
        "_"
      )}`;
      const logoUrl = await sbUploadFile("brand-logos", safeName, file);
      await sbUpdate("users", "username", currentUser.username, { logo_url: logoUrl });
      const nextUsers = users.map((u) => (u.username === currentUser.username ? { ...u, logoUrl } : u));
      setUsers(nextUsers);
      setCurrentUser({ ...currentUser, logoUrl });
    } catch (e) {
      setError(e.message || "Couldn't upload your logo — try again.");
    }
  }

  async function syncShopify(storeUrl) {
    try {
      const res = await fetch(
        "https://zyekxsmtancjpvpuuhin.supabase.co/functions/v1/shopify-sync",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: currentUser.username, storeUrl }),
        }
      );
      const data = await res.json();
      if (data.error) return { ok: false, message: data.error };

      const productRows = await sbGet("products");
      setProducts(productRows.map(mapProduct));
      return { ok: true, message: `Synced ${data.count} product(s) from your store.` };
    } catch (e) {
      return { ok: false, message: "Couldn't sync your store right now." };
    }
  }

  async function submitVideo() {
    if (!productName.trim() || !targetBrand) {
      setError("Fill in the product name and pick a brand.");
      return;
    }
    if (!videoFile) {
      setError("Upload your video from your camera roll — this is what gets used to build the ad.");
      return;
    }
    setError("");
    setUploading(true);
    try {
      const safeName = `${Date.now()}-${videoFile.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;
      const videoUrl = await sbUploadFile("creator-videos", safeName, videoFile);

      const rows = await sbInsert("submissions", {
        creator_username: currentUser.username,
        target_brand: targetBrand,
        product_name: productName.trim(),
        video_file_url: videoUrl,
        status: "pending",
        approved_by: null,
        commission_rate: null,
      });
      setSubmissions([mapSubmission(rows[0]), ...submissions]);
      setProductName("");
      setTargetBrand("");
      setVideoFile(null);
    } catch (e) {
      setError(e.message || "Couldn't submit — try again.");
    }
    setUploading(false);
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

  async function disapprove(id) {
    setError("");
    try {
      await sbUpdate("submissions", "id", id, {
        status: "disapproved",
        approved_by: currentUser.username,
      });
      setSubmissions(
        submissions.map((s) =>
          s.id === id ? { ...s, status: "disapproved", approvedBy: currentUser.username } : s
        )
      );
    } catch (e) {
      setError(e.message || "Couldn't disapprove — try again.");
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

  function checkForNewSales(subRows) {
    if (role !== "creator" || !currentUser) return;
    const mySubs = subRows.filter((s) => s.creatorName === currentUser.username);
    const currentKeys = new Map();
    mySubs.forEach((s) => {
      (s.sales || []).forEach((sale) => {
        currentKeys.set(`${s.id}-${sale.date}`, { productName: s.productName, commissionRate: s.commissionRate, sale });
      });
    });

    if (seenSalesRef.current === null) {
      seenSalesRef.current = new Set(currentKeys.keys());
      return;
    }

    const newKeys = [...currentKeys.keys()].filter((k) => !seenSalesRef.current.has(k));
    if (newKeys.length > 0) {
      const first = currentKeys.get(newKeys[0]);
      const earned = (first.sale.amount * (first.commissionRate || 0)) / 100;
      playDing();
      setSaleToast({ productName: first.productName, earned });
      setTimeout(() => setSaleToast(null), 6000);
    }
    seenSalesRef.current = new Set(currentKeys.keys());
  }

  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(async () => {
      try {
        const [userRows, productRows, subRows] = await Promise.all([
          sbGet("users"),
          sbGet("products"),
          sbGet("submissions"),
        ]);
        setUsers(userRows.map(mapUser));
        setProducts(productRows.map(mapProduct));
        const mappedSubs = subRows.map(mapSubmission);
        setSubmissions(mappedSubs);
        checkForNewSales(mappedSubs);
      } catch {
        // silent — next poll will retry
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [currentUser, role]);

  if (loading) {
    return (
      <div style={styles.wrap}>
        <p style={{ color: COLORS.paper, fontFamily: "system-ui", padding: 24 }}>Loading…</p>
      </div>
    );
  }

  if (!role) return <RoleScreen onPick={setRole} metaStatus={metaStatus} />;

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

  const mySampleRequests =
    role === "creator"
      ? sampleRequests.filter((r) => r.creatorName === currentUser.username)
      : sampleRequests.filter((r) => r.brandUsername === currentUser.username);

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
      {saleToast && (
        <div style={styles.saleToast}>
          <span style={styles.saleToastEmoji}>🎉</span>
          <div>
            <div style={styles.saleToastTitle}>New sale on "{saleToast.productName}"!</div>
            <div style={styles.saleToastSub}>You earned ${saleToast.earned.toFixed(2)}</div>
          </div>
        </div>
      )}
      <div style={styles.shellBody} className="shell-body">
        <Sidebar
          page={page}
          setPage={setPage}
          pendingCount={pendingCount}
          role={role}
          samplePendingCount={mySampleRequests.filter((r) => r.status === "pending").length}
        />
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
              users={users}
            />
          ) : page === "samples" ? (
            <SamplesPage
              role={role}
              currentUser={currentUser}
              brands={brands}
              products={products}
              requests={mySampleRequests}
              onRequestSample={requestSample}
              onUpdateStatus={updateSampleStatus}
              allSampleRequests={sampleRequests}
              allSubmissions={submissions}
            />
          ) : page === "payouts" ? (
            <PayoutsPage submissions={mySubmissions} users={users} />
          ) : page === "ads" ? (
            <AdsPage currentUser={currentUser} submissions={mySubmissions} />
          ) : page === "creators" ? (
            <CreatorsRosterPage
              submissions={mySubmissions}
              payoutRecords={payoutRecords.filter((p) => p.brandUsername === currentUser.username)}
              onMarkAsPaid={markAsPaid}
            />
          ) : role === "creator" ? (
            <CreatorSubmissionsPage
              brands={brands}
              productName={productName}
              setProductName={setProductName}
              targetBrand={targetBrand}
              setTargetBrand={setTargetBrand}
              videoFile={videoFile}
              setVideoFile={setVideoFile}
              uploading={uploading}
              onSubmit={submitVideo}
              submissions={mySubmissions}
              products={products}
            />
          ) : (
            <BrandSubmissionsPage
              currentUser={currentUser}
              submissions={mySubmissions}
              onSetRate={setMyCommissionRate}
              onApprove={approve}
              onDisapprove={disapprove}
              onLogSale={logSale}
              products={products.filter((p) => p.brandUsername === currentUser.username)}
              onAddProduct={addProduct}
              onRemoveProduct={removeProduct}
              onSyncShopify={syncShopify}
              onUploadLogo={uploadLogo}
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
function Sidebar({ page, setPage, pendingCount, role, samplePendingCount }) {
  return (
    <div style={styles.sidebar} className="sidebar">
      <SidebarItem label="Overview" active={page === "overview"} onClick={() => setPage("overview")} />
      <SidebarItem
        label={role === "creator" ? "Submit & track" : "Submissions"}
        active={page === "submissions"}
        onClick={() => setPage("submissions")}
        badge={pendingCount > 0 ? pendingCount : null}
      />
      <SidebarItem
        label="Samples"
        active={page === "samples"}
        onClick={() => setPage("samples")}
        badge={role === "brand" && samplePendingCount > 0 ? samplePendingCount : null}
      />
      <SidebarItem label="Chat" active={page === "chat"} onClick={() => setPage("chat")} />
      {role === "creator" && (
        <SidebarItem label="Payouts" active={page === "payouts"} onClick={() => setPage("payouts")} />
      )}
      {role === "brand" && (
        <SidebarItem label="Ads" active={page === "ads"} onClick={() => setPage("ads")} />
      )}
      {role === "brand" && (
        <SidebarItem label="Creators" active={page === "creators"} onClick={() => setPage("creators")} />
      )}
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
                {b.logoUrl ? (
                  <img src={b.logoUrl} alt={b.username} style={styles.brandChipAvatarImg} />
                ) : (
                  <div style={styles.brandChipAvatar}>{initials(b.username)}</div>
                )}
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

function RoleScreen({ onPick, metaStatus }) {
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
        {metaStatus === "connected" && (
          <div style={styles.metaBanner}>Meta Ads connected! Log back in to see it on your Ads page.</div>
        )}
        {metaStatus === "error" && (
          <div style={styles.metaBannerError}>Something went wrong connecting Meta Ads. Try again from the Ads page.</div>
        )}
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
  productName,
  setProductName,
  targetBrand,
  setTargetBrand,
  videoFile,
  setVideoFile,
  uploading,
  onSubmit,
  submissions,
  products,
}) {
  const [step, setStep] = useState("upload");
  const brandProducts = products.filter((p) => p.brandUsername === targetBrand);

  function handleFilePicked(e) {
    const file = e.target.files[0];
    if (file) setVideoFile(file);
  }

  function submitAndReset() {
    onSubmit();
    setStep("upload");
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.h2}>Brands you can submit to</h2>
        {brands.length === 0 ? (
          <EmptyState text="No brands have set a commission rate yet. Check back soon." />
        ) : (
          brands.map((b) => (
            <div key={b.username} style={styles.brandRow}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {b.logoUrl ? (
                  <img src={b.logoUrl} alt={b.username} style={styles.productThumbSmall} />
                ) : (
                  <div style={styles.productThumbSmallPlaceholder}>{initials(b.username)}</div>
                )}
                <span style={styles.brandName}>{b.username}</span>
              </div>
              <span style={styles.statusTag}>{b.commissionRate}% commission</span>
            </div>
          ))
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Submit a video</h2>

        {step === "upload" ? (
          <>
            <label htmlFor="videoUploadInput" style={styles.addFileTile}>
              {videoFile ? (
                <>
                  <div style={styles.addFileTileTitle}>{videoFile.name}</div>
                  <div style={styles.addFileTileSub}>Tap to choose a different file</div>
                </>
              ) : (
                <>
                  <div style={styles.addFileTilePlus}>+</div>
                  <div style={styles.addFileTileTitle}>Add file</div>
                  <div style={styles.addFileTileSub}>Record a video, take a photo, or choose from your gallery</div>
                </>
              )}
            </label>
            <input
              id="videoUploadInput"
              type="file"
              accept="video/*,image/*"
              style={styles.hiddenFileInput}
              onChange={handleFilePicked}
            />
            <button
              style={{ ...styles.primaryBtn, opacity: videoFile ? 1 : 0.5 }}
              disabled={!videoFile}
              onClick={() => setStep("details")}
            >
              Continue
            </button>
          </>
        ) : (
          <>
            <div style={styles.fileSelected}>Video: {videoFile.name}</div>
            <label style={styles.label}>Brand</label>
            <select
              style={styles.input}
              value={targetBrand}
              onChange={(e) => {
                setTargetBrand(e.target.value);
                setProductName("");
              }}
            >
              <option value="">Choose a brand...</option>
              {brands.map((b) => (
                <option key={b.username} value={b.username}>
                  {b.username} — {b.commissionRate}% commission
                </option>
              ))}
            </select>
            <label style={styles.label}>Select featured product(s)</label>
            {!targetBrand ? (
              <p style={styles.uploadHelp}>Choose a brand first to see their products.</p>
            ) : brandProducts.length === 0 ? (
              <p style={styles.uploadHelp}>This brand hasn't added any products yet.</p>
            ) : (
              <div style={styles.productGrid}>
                {brandProducts.map((p) => (
                  <button
                    key={p.id}
                    style={
                      productName === p.productName ? styles.productTileActive : styles.productTile
                    }
                    onClick={() => setProductName(p.productName)}
                  >
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.productName} style={styles.productTileImg} />
                    ) : (
                      <div style={styles.productTileImgPlaceholder}>{initials(p.productName)}</div>
                    )}
                    <div style={styles.productTileName}>{p.productName}</div>
                  </button>
                ))}
              </div>
            )}
            <div style={styles.rateRow}>
              <button style={styles.linkBtnLight} onClick={() => setStep("upload")}>
                ← back
              </button>
            </div>
            <button style={styles.primaryBtn} onClick={submitAndReset} disabled={uploading}>
              {uploading ? "Uploading..." : "Submit for review"}
            </button>
          </>
        )}
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

function BrandSubmissionsPage({
  currentUser,
  submissions,
  onSetRate,
  onApprove,
  onDisapprove,
  onLogSale,
  products,
  onAddProduct,
  onRemoveProduct,
  onSyncShopify,
  onUploadLogo,
}) {
  const [rateInput, setRateInput] = useState("");
  const [productInput, setProductInput] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [showExportModal, setShowExportModal] = useState(false);
  const pending = submissions.filter((s) => s.status === "pending");
  const approved = submissions.filter((s) => s.status === "approved");

  function toggleSelected(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function exportCsv() {
    const rows = approved.filter((s) => selected.has(s.id));
    const header = "Product,Creator,Commission Rate,Total Sales,Commission Earned,Video URL\n";
    const lines = rows.map((s) => {
      const sales = totalSales(s);
      const earned = commissionEarned(s);
      return [s.productName, s.creatorName, `${s.commissionRate}%`, sales.toFixed(2), earned.toFixed(2), s.videoFileUrl || ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = header + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vidrelay-submissions.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSync() {
    if (!storeUrl.trim()) return;
    setSyncing(true);
    setSyncResult(null);
    const result = await onSyncShopify(storeUrl.trim());
    setSyncResult(result);
    setSyncing(false);
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.h2}>Your brand logo</h2>
        <p style={styles.rateHelp}>Shown to creators when they browse brands to submit to.</p>
        <div style={styles.logoRow}>
          {currentUser.logoUrl ? (
            <img src={currentUser.logoUrl} alt="Your logo" style={styles.logoPreview} />
          ) : (
            <div style={styles.logoPreviewPlaceholder}>{initials(currentUser.username)}</div>
          )}
          <label htmlFor="logoUploadInput" style={styles.logoUploadBtn}>
            {currentUser.logoUrl ? "Change logo" : "Upload logo"}
          </label>
          <input
            id="logoUploadInput"
            type="file"
            accept="image/*"
            style={styles.hiddenFileInput}
            onChange={(e) => onUploadLogo(e.target.files[0] || null)}
          />
        </div>
      </div>

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
        <h2 style={styles.h2}>Sync products from your store</h2>
        <p style={styles.rateHelp}>
          Works with Shopify stores — pulls in your product names automatically.
        </p>
        <div style={styles.rateRow}>
          <input
            style={styles.rateInput}
            placeholder="yourstore.com"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
          />
          <button style={styles.primaryBtnSmall} onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync products"}
          </button>
        </div>
        {syncResult && (
          <div style={syncResult.ok ? styles.metaBanner : styles.metaBannerError}>{syncResult.message}</div>
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Your products</h2>
        <p style={styles.rateHelp}>
          Creators will pick from this list when submitting a video for you.
        </p>
        {products.length === 0 ? (
          <EmptyState text="No products added yet — creators won't be able to pick one." />
        ) : (
          products.map((p) => (
            <div key={p.id} style={styles.brandRow}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.productName} style={styles.productThumbSmall} />
                ) : (
                  <div style={styles.productThumbSmallPlaceholder}>{initials(p.productName)}</div>
                )}
                <span style={styles.brandName}>{p.productName}</span>
              </div>
              <button style={styles.linkBtnLight} onClick={() => onRemoveProduct(p.id)}>
                remove
              </button>
            </div>
          ))
        )}
        <div style={{ ...styles.rateRow, marginTop: 12 }}>
          <input
            style={styles.rateInput}
            placeholder="e.g. Glow Serum"
            value={productInput}
            onChange={(e) => setProductInput(e.target.value)}
          />
          <button
            style={styles.primaryBtnSmall}
            onClick={() => {
              onAddProduct(productInput);
              setProductInput("");
            }}
          >
            Add product
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
                    by {s.creatorName}
                    {s.videoFileUrl && (
                      <>
                        {" · "}
                        <a href={s.videoFileUrl} target="_blank" rel="noreferrer" style={styles.rowLink}>
                          view video
                        </a>
                      </>
                    )}
                    {s.tiktokLink && (
                      <>
                        {" · "}
                        <a href={s.tiktokLink} target="_blank" rel="noreferrer" style={styles.rowLink}>
                          TikTok
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <div style={styles.decisionBtnRow}>
                  <button style={styles.disapproveBtn} onClick={() => onDisapprove(s.id)}>
                    Disapprove
                  </button>
                  <button style={styles.approveBtn} onClick={() => onApprove(s.id)}>
                    Approve
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={styles.card}>
        <div style={styles.reviewHeader}>
          <h2 style={{ ...styles.h2, margin: 0 }}>Approved by you</h2>
          <label style={styles.reviewToggleRow}>
            <span style={styles.reviewToggleLabel}>Review mode</span>
            <input
              type="checkbox"
              checked={reviewMode}
              onChange={(e) => {
                setReviewMode(e.target.checked);
                setSelected(new Set());
              }}
              style={styles.reviewToggleInput}
            />
          </label>
        </div>

        {reviewMode && approved.length > 0 && (
          <div style={styles.reviewActionBar}>
            <label style={styles.selectAllRow}>
              <input
                type="checkbox"
                checked={selected.size === approved.length}
                onChange={(e) => {
                  if (e.target.checked) setSelected(new Set(approved.map((s) => s.id)));
                  else setSelected(new Set());
                }}
              />
              Select All
            </label>
            <span style={styles.selectedCount}>{selected.size} selected</span>
            <button style={styles.exportCsvBtn} onClick={exportCsv} disabled={selected.size === 0}>
              Export CSV
            </button>
            <button
              style={styles.uploadMetaBtn}
              onClick={() => setShowExportModal(true)}
              disabled={selected.size === 0}
            >
              Upload to Meta
            </button>
          </div>
        )}

        {approved.length === 0 ? (
          <EmptyState text="Approved videos will show up here, ready to run as ads." />
        ) : (
          approved.map((s) => (
            <ApprovedRow
              key={s.id}
              s={s}
              reviewMode={reviewMode}
              checked={selected.has(s.id)}
              onToggle={() => toggleSelected(s.id)}
            />
          ))
        )}
      </div>

      {showExportModal && (
        <ExportCreativesModal
          count={selected.size}
          selectedSubmissions={approved.filter((s) => selected.has(s.id))}
          currentUser={currentUser}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}

function ApprovedRow({ s, reviewMode, checked, onToggle }) {
  const earned = commissionEarned(s);
  const sales = totalSales(s);

  return (
    <div style={reviewMode && checked ? styles.rowColSelected : styles.rowCol}>
      <div style={styles.rowTop}>
        {reviewMode && (
          <input type="checkbox" checked={checked} onChange={onToggle} style={styles.rowCheckbox} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.rowTitle}>{s.productName}</div>
          <div style={styles.rowSub}>
            by {s.creatorName} ·{" "}
            <a href={s.videoFileUrl || s.tiktokLink} target="_blank" rel="noreferrer" style={styles.rowLink}>
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

function ChatPage({ currentUser, partners, messages, onSend, role, users }) {
  const [activePartner, setActivePartner] = useState(partners[0] || null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");

  function logoFor(partner) {
    const u = users.find((u) => u.username === partner);
    return u ? u.logoUrl : null;
  }

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
                  {logoFor(p) ? (
                    <img src={logoFor(p)} alt={p} style={styles.chatListAvatarImg} />
                  ) : (
                    <div style={styles.chatListAvatar}>{initials(p)}</div>
                  )}
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


function PayoutsPage({ submissions, users }) {
  const [showWithdrawNote, setShowWithdrawNote] = useState(false);
  const totalEarned = submissions.reduce((sum, s) => sum + commissionEarned(s), 0);

  function logoFor(brandUsername) {
    const u = users.find((u) => u.username === brandUsername);
    return u ? u.logoUrl : null;
  }

  const history = [];
  submissions.forEach((s) => {
    (s.sales || []).forEach((sale) => {
      history.push({
        key: `${s.id}-${sale.date}`,
        brand: s.targetBrand,
        product: s.productName,
        amount: (sale.amount * (s.commissionRate || 0)) / 100,
        date: sale.date,
      });
    });
  });
  history.sort((a, b) => b.date - a.date);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.payoutLabel}>Total earned</div>
        <div style={styles.payoutBig}>${totalEarned.toFixed(2)}</div>

        <div style={styles.payoutBreakdownRow}>
          <div style={styles.payoutBreakdownItem}>
            <div style={styles.payoutBreakdownLabel}>Upcoming</div>
            <div style={styles.payoutBreakdownValue}>$0.00</div>
          </div>
          <div style={styles.payoutBreakdownItem}>
            <div style={styles.payoutBreakdownLabel}>Processing</div>
            <div style={styles.payoutBreakdownValue}>$0.00</div>
          </div>
          <div style={styles.payoutBreakdownItem}>
            <div style={styles.payoutBreakdownLabel}>Available</div>
            <div style={styles.payoutBreakdownValue}>${totalEarned.toFixed(2)}</div>
          </div>
        </div>

        <button style={styles.withdrawBtn} onClick={() => setShowWithdrawNote(true)}>
          Withdraw
        </button>
        {showWithdrawNote && (
          <div style={styles.withdrawNote}>
            Withdrawals aren't connected yet — Vidrelay doesn't have a bank or PayPal payout method
            set up. Once that's added, you'll be able to withdraw your available balance from here.
          </div>
        )}
      </div>

      <div style={styles.card}>
        <div style={styles.payoutHistoryHeader}>
          <h2 style={{ ...styles.h2, margin: 0 }}>Earnings history</h2>
        </div>
        {history.length === 0 ? (
          <EmptyState text="Once a brand logs a sale on your videos, it'll show up here." />
        ) : (
          <>
            <div style={styles.payoutTotalRow}>
              <span>Total recorded</span>
              <strong>${totalEarned.toFixed(2)}</strong>
            </div>
            {history.map((h) => (
              <div key={h.key} style={styles.payoutRow}>
                <div style={styles.payoutRowLeft}>
                  {logoFor(h.brand) ? (
                    <img src={logoFor(h.brand)} alt={h.brand} style={styles.chatListAvatarImg} />
                  ) : (
                    <div style={styles.chatListAvatar}>{initials(h.brand)}</div>
                  )}
                  <div>
                    <div style={styles.payoutRowBrand}>{h.brand}</div>
                    <div style={styles.payoutRowMeta}>
                      {h.product} · {new Date(h.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  </div>
                </div>
                <div style={styles.payoutRowAmount}>${h.amount.toFixed(2)}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function sampleScoreFor(creatorName, allSampleRequests, allSubmissions) {
  const approved = allSampleRequests.filter((r) => r.creatorName === creatorName && r.status === "approved");
  if (approved.length === 0) return null;
  const fulfilled = approved.filter((r) =>
    allSubmissions.some(
      (s) => s.creatorName === creatorName && s.targetBrand === r.brandUsername && s.productName === r.productName
    )
  ).length;
  return Math.round((fulfilled / approved.length) * 100);
}

function SampleScoreTag({ score }) {
  if (score === null) return <span style={styles.sampleScoreNew}>New creator</span>;
  const color = score >= 70 ? styles.sampleScoreGood : score >= 40 ? styles.sampleScoreMid : styles.sampleScoreLow;
  return <span style={color}>{score}% follow-through</span>;
}

function SamplesPage({
  role,
  currentUser,
  brands,
  products,
  requests,
  onRequestSample,
  onUpdateStatus,
  allSampleRequests,
  allSubmissions,
}) {
  const [requestBrand, setRequestBrand] = useState("");
  const [requestProduct, setRequestProduct] = useState("");
  const brandProducts = products.filter((p) => p.brandUsername === requestBrand);

  if (role === "creator") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h2 style={styles.h2}>Request a free sample</h2>
          <label style={styles.label}>Brand</label>
          <div style={styles.productGrid}>
            {brands.map((b) => (
              <button
                key={b.username}
                style={requestBrand === b.username ? styles.productTileActive : styles.productTile}
                onClick={() => {
                  setRequestBrand(b.username);
                  setRequestProduct("");
                }}
              >
                {b.logoUrl ? (
                  <img src={b.logoUrl} alt={b.username} style={styles.productTileImg} />
                ) : (
                  <div style={styles.productTileImgPlaceholder}>{initials(b.username)}</div>
                )}
                <div style={styles.productTileName}>{b.username}</div>
              </button>
            ))}
          </div>
          <label style={styles.label}>Product</label>
          {!requestBrand ? (
            <p style={styles.uploadHelp}>Choose a brand first.</p>
          ) : brandProducts.length === 0 ? (
            <p style={styles.uploadHelp}>This brand hasn't added any products yet.</p>
          ) : (
            <div style={styles.productGrid}>
              {brandProducts.map((p) => (
                <button
                  key={p.id}
                  style={requestProduct === p.productName ? styles.productTileActive : styles.productTile}
                  onClick={() => setRequestProduct(p.productName)}
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.productName} style={styles.productTileImg} />
                  ) : (
                    <div style={styles.productTileImgPlaceholder}>{initials(p.productName)}</div>
                  )}
                  <div style={styles.productTileName}>{p.productName}</div>
                </button>
              ))}
            </div>
          )}
          <button
            style={styles.primaryBtn}
            onClick={() => {
              onRequestSample(requestBrand, requestProduct);
              setRequestBrand("");
              setRequestProduct("");
            }}
          >
            Request sample
          </button>
        </div>

        <div style={styles.card}>
          <h2 style={styles.h2}>Your requests</h2>
          {requests.length === 0 ? (
            <EmptyState text="Nothing requested yet." />
          ) : (
            requests.map((r) => (
              <div key={r.id} style={styles.rowCol}>
                <div style={styles.rowTop}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.rowTitle}>{r.productName}</div>
                    <div style={styles.rowSub}>from {r.brandUsername}</div>
                  </div>
                  <span
                    style={
                      r.status === "approved"
                        ? styles.statusTag
                        : r.status === "rejected"
                        ? styles.pendingTag
                        : styles.pendingTag
                    }
                  >
                    {r.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.h2}>Sample requests</h2>
        {pending.length === 0 ? (
          <EmptyState text="No pending sample requests right now." />
        ) : (
          pending.map((r) => (
            <div key={r.id} style={styles.rowCol}>
              <div style={styles.rowTop}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.rowTitle}>{r.productName}</div>
                  <div style={styles.rowSub}>requested by {r.creatorName}</div>
                  <SampleScoreTag score={sampleScoreFor(r.creatorName, allSampleRequests, allSubmissions)} />
                </div>
                <div style={styles.decisionBtnRow}>
                  <button style={styles.disapproveBtn} onClick={() => onUpdateStatus(r.id, "rejected")}>
                    Reject
                  </button>
                  <button style={styles.approveBtn} onClick={() => onUpdateStatus(r.id, "approved")}>
                    Approve
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Past requests</h2>
        {decided.length === 0 ? (
          <EmptyState text="Decided requests will show up here." />
        ) : (
          decided.map((r) => (
            <div key={r.id} style={styles.rowCol}>
              <div style={styles.rowTop}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.rowTitle}>{r.productName}</div>
                  <div style={styles.rowSub}>requested by {r.creatorName}</div>
                  <SampleScoreTag score={sampleScoreFor(r.creatorName, allSampleRequests, allSubmissions)} />
                </div>
                <span style={r.status === "approved" ? styles.statusTag : styles.pendingTag}>{r.status}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CreatorsRosterPage({ submissions, payoutRecords, onMarkAsPaid }) {
  const byCreator = {};
  submissions.forEach((s) => {
    if (!byCreator[s.creatorName]) {
      byCreator[s.creatorName] = {
        creatorName: s.creatorName,
        total: 0,
        approved: 0,
        sales: 0,
        earned: 0,
        joined: s.createdAt,
      };
    }
    const c = byCreator[s.creatorName];
    c.total += 1;
    if (s.status === "approved") {
      c.approved += 1;
      c.sales += totalSales(s);
      c.earned += commissionEarned(s);
    }
    if (new Date(s.createdAt) < new Date(c.joined)) c.joined = s.createdAt;
  });
  const creators = Object.values(byCreator).sort((a, b) => b.earned - a.earned);
  const totalCreators = creators.length;
  const totalSubs = submissions.length;
  const approvedCount = submissions.filter((s) => s.status === "approved").length;
  const approvalRate = totalSubs > 0 ? Math.round((approvedCount / totalSubs) * 100) : 0;

  function paidSoFar(creatorName) {
    return payoutRecords
      .filter((p) => p.creatorName === creatorName)
      .reduce((sum, p) => sum + p.amount, 0);
  }

  function lastPayoutDate(creatorName) {
    const records = payoutRecords.filter((p) => p.creatorName === creatorName);
    if (records.length === 0) return null;
    return records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].createdAt;
  }

  return (
    <div style={styles.page}>
      <div style={styles.statRow}>
        <StatCard label="Total creators" value={totalCreators} />
        <StatCard label="Submissions" value={totalSubs} />
        <StatCard label="Approval rate" value={`${approvalRate}%`} />
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Creator roster</h2>
        {creators.length === 0 ? (
          <EmptyState text="Once creators submit videos to you, they'll show up here." />
        ) : (
          <>
            <div style={styles.rosterHeadRow}>
              <span style={{ flex: 2 }}>Creator</span>
              <span style={{ flex: 1, textAlign: "right" }}>Submissions</span>
              <span style={{ flex: 1, textAlign: "right" }}>Approved</span>
              <span style={{ flex: 1, textAlign: "right" }}>Sales</span>
              <span style={{ flex: 1, textAlign: "right" }}>Earnings</span>
            </div>
            {creators.map((c) => (
              <div key={c.creatorName} style={styles.rosterRow}>
                <div style={{ flex: 2, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={styles.chatListAvatar}>{initials(c.creatorName)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.rosterName}>{c.creatorName}</div>
                    <div style={styles.rosterJoined}>Joined {new Date(c.joined).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                  </div>
                </div>
                <span style={{ flex: 1, textAlign: "right", fontWeight: 700 }}>{c.total}</span>
                <span style={{ flex: 1, textAlign: "right", fontWeight: 700 }}>
                  {c.approved} ({c.total > 0 ? Math.round((c.approved / c.total) * 100) : 0}%)
                </span>
                <span style={{ flex: 1, textAlign: "right", fontWeight: 700 }}>${c.sales.toFixed(2)}</span>
                <span style={{ flex: 1, textAlign: "right", fontWeight: 700, color: COLORS.moss }}>
                  ${c.earned.toFixed(2)}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Payout cycle (every 7 days)</h2>
        <p style={styles.rateHelp}>
          Vidrelay tracks what's owed and when it's due — payments happen outside Vidrelay (bank, PayPal,
          etc.), and you mark them paid here to keep the record straight.
        </p>
        {creators.filter((c) => c.earned > 0).length === 0 ? (
          <EmptyState text="Once creators earn commission, their payout cycle shows up here." />
        ) : (
          creators
            .filter((c) => c.earned > 0)
            .map((c) => {
              const paid = paidSoFar(c.creatorName);
              const owed = Math.max(0, c.earned - paid);
              const last = lastPayoutDate(c.creatorName);
              const cycleStart = last ? new Date(last) : new Date(c.joined);
              const nextDue = new Date(cycleStart);
              nextDue.setDate(nextDue.getDate() + 7);
              const daysLeft = Math.ceil((nextDue - new Date()) / (1000 * 60 * 60 * 24));
              const overdue = daysLeft < 0;

              return (
                <div key={c.creatorName} style={styles.payoutCycleRow}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <div style={styles.chatListAvatar}>{initials(c.creatorName)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={styles.rosterName}>{c.creatorName}</div>
                      <div style={styles.rosterJoined}>
                        {overdue
                          ? `Payout overdue by ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? "s" : ""}`
                          : `Next payout in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`}
                      </div>
                    </div>
                  </div>
                  <div style={styles.payoutCycleRight}>
                    <div style={styles.payoutOwedAmount}>${owed.toFixed(2)} owed</div>
                    <button
                      style={styles.primaryBtnSmall}
                      onClick={() => onMarkAsPaid(c.creatorName, owed)}
                      disabled={owed <= 0}
                    >
                      Mark as paid
                    </button>
                  </div>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}

function AdsPage({ currentUser, submissions }) {
  const isConnected = !!currentUser.metaAdAccountId;
  const connectUrl = `https://zyekxsmtancjpvpuuhin.supabase.co/functions/v1/meta-oauth?action=start&username=${encodeURIComponent(
    currentUser.username
  )}`;
  const approved = submissions.filter((s) => s.status === "approved");

  const [ads, setAds] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isConnected) return;
    setAdsLoading(true);
    fetch(
      `https://zyekxsmtancjpvpuuhin.supabase.co/functions/v1/meta-ads?username=${encodeURIComponent(
        currentUser.username
      )}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setAdsError(data.error);
        else setAds(data.ads || []);
      })
      .catch(() => setAdsError("Couldn't load your ads right now."))
      .finally(() => setAdsLoading(false));
  }, [isConnected, currentUser.username]);

  const activeCount = ads.filter((a) => a.status === "ACTIVE").length;
  const visibleAds = ads.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.h2}>Meta Ads</h2>
        {isConnected ? (
          <div style={styles.metaConnectedRow}>
            <div>
              <div style={styles.metaConnectedLabel}>Connected ad account</div>
              <div style={styles.metaConnectedValue}>{currentUser.metaAdAccountId}</div>
            </div>
            <span style={styles.statusTag}>Connected</span>
          </div>
        ) : (
          <>
            <p style={styles.rateHelp}>
              Connect your Meta Ads account to run approved creator videos as ads directly from here.
            </p>
            <a href={connectUrl} style={styles.connectMetaBtn}>
              Connect Meta Ads
            </a>
          </>
        )}
      </div>

      {isConnected && (
        <div style={styles.card}>
          <div style={styles.adsTableHeader}>
            <h2 style={{ ...styles.h2, margin: 0 }}>Active ads</h2>
          </div>

          {activeCount > 0 && <div style={styles.activePill}>{activeCount} active ad{activeCount > 1 ? "s" : ""}</div>}

          <input
            style={{ ...styles.input, marginTop: 12 }}
            placeholder="Search by ad name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {adsLoading ? (
            <EmptyState text="Loading your ads..." />
          ) : adsError ? (
            <EmptyState text={adsError} />
          ) : visibleAds.length === 0 ? (
            <EmptyState text="No ads found in your connected account yet." />
          ) : (
            <div style={styles.adsTable}>
              <div style={styles.adsTableRowHead}>
                <span style={{ flex: 2 }}>Name</span>
                <span style={{ flex: 1, textAlign: "right" }}>Spend (7d)</span>
                <span style={{ flex: 1, textAlign: "right" }}>ROAS (7d)</span>
              </div>
              {visibleAds.map((ad) => (
                <div key={ad.id} style={styles.adsTableRow}>
                  <span style={{ flex: 2, display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: ad.status === "ACTIVE" ? COLORS.moss : "#B9B4A5",
                        flexShrink: 0,
                      }}
                    />
                    {ad.name}
                  </span>
                  <span style={{ flex: 1, textAlign: "right", fontWeight: 700 }}>${ad.spend.toFixed(2)}</span>
                  <span style={{ flex: 1, textAlign: "right", fontWeight: 700 }}>
                    {ad.roas ? `${ad.roas.toFixed(2)}x` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={styles.card}>
        <h2 style={styles.h2}>Videos ready to run as ads</h2>
        {approved.length === 0 ? (
          <EmptyState text="Approved creator videos will show up here, ready to turn into ads." />
        ) : (
          approved.map((s) => (
            <BuildAdRow key={s.id} s={s} isConnected={isConnected} currentUser={currentUser} />
          ))
        )}
      </div>
    </div>
  );
}

function ExportCreativesModal({ count, selectedSubmissions, currentUser, onClose }) {
  const [path, setPath] = useState("choose"); // choose | launchAds | mediaLibrary
  const [adNamePrefix, setAdNamePrefix] = useState("");
  const [separator, setSeparator] = useState("_");
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [landingUrl, setLandingUrl] = useState("");
  const [cta, setCta] = useState("SHOP_NOW");
  const [launchStatus, setLaunchStatus] = useState("paused");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);

  const [campaignMode, setCampaignMode] = useState("new"); // new | existing
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [selectedAdsetId, setSelectedAdsetId] = useState("");

  useEffect(() => {
    if (path !== "launchAds" || campaigns.length > 0) return;
    setCampaignsLoading(true);
    fetch(
      `https://zyekxsmtancjpvpuuhin.supabase.co/functions/v1/meta-campaigns?username=${encodeURIComponent(
        currentUser.username
      )}`
    )
      .then((res) => res.json())
      .then((data) => setCampaigns(data.campaigns || []))
      .catch(() => setCampaigns([]))
      .finally(() => setCampaignsLoading(false));
  }, [path]);

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);

  async function runLaunchAds() {
    setRunning(true);
    const outcomes = [];
    for (const s of selectedSubmissions) {
      try {
        const res = await fetch("https://zyekxsmtancjpvpuuhin.supabase.co/functions/v1/meta-build-ad", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: currentUser.username,
            submissionId: s.id,
            adNamePrefix: adNamePrefix || s.productName,
            separator,
            primaryText,
            headline,
            landingUrl,
            cta,
            launchStatus,
            existingCampaignId: campaignMode === "existing" ? selectedCampaignId : null,
            existingAdsetId: campaignMode === "existing" ? selectedAdsetId : null,
          }),
        });
        const data = await res.json();
        outcomes.push({ id: s.id, name: s.productName, ok: !data.error, message: data.error || `Ad ${data.adId} created` });
      } catch (e) {
        outcomes.push({ id: s.id, name: s.productName, ok: false, message: "Something went wrong." });
      }
    }
    setResults(outcomes);
    setRunning(false);
  }

  async function runMediaLibrary() {
    setRunning(true);
    const outcomes = [];
    for (const s of selectedSubmissions) {
      try {
        const res = await fetch("https://zyekxsmtancjpvpuuhin.supabase.co/functions/v1/meta-upload-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: currentUser.username, submissionId: s.id }),
        });
        const data = await res.json();
        outcomes.push({ id: s.id, name: s.productName, ok: !data.error, message: data.error || "Uploaded to media library" });
      } catch (e) {
        outcomes.push({ id: s.id, name: s.productName, ok: false, message: "Something went wrong." });
      }
    }
    setResults(outcomes);
    setRunning(false);
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Export Creatives</h2>
          <button style={styles.modalClose} onClick={onClose}>
            ×
          </button>
        </div>

        {results.length > 0 ? (
          <div>
            <p style={styles.rateHelp}>Results:</p>
            {results.map((r) => (
              <div key={r.id} style={r.ok ? styles.metaBanner : styles.metaBannerError}>
                {r.name}: {r.message}
              </div>
            ))}
            <button style={styles.primaryBtn} onClick={onClose}>
              Done
            </button>
          </div>
        ) : path === "choose" ? (
          <>
            <p style={styles.rateHelp}>
              Choose how to use the {count} creative{count > 1 ? "s" : ""} you selected.
            </p>
            <button style={styles.exportOptionCard} onClick={() => setPath("launchAds")}>
              <div style={styles.exportOptionTitleRow}>
                <span style={styles.exportOptionTitle}>Launch Ads</span>
                <span style={styles.exportRecommendedTag}>Recommended</span>
              </div>
              <div style={styles.exportOptionSub}>
                Build and launch ads for these {count} creative{count > 1 ? "s" : ""} using Vidrelay's ad
                builder — campaign setup, copy, and creator attribution all wired up automatically.
              </div>
            </button>
            <button style={styles.exportOptionCardAlt} onClick={() => setPath("mediaLibrary")}>
              <div style={styles.exportOptionTitle}>Send to Media Library</div>
              <div style={styles.exportOptionSub}>
                Uploads raw video assets to your Meta media library. You'll build the ads yourself in
                Ads Manager and will need to manually add attribution to each ad for tracking to work.
              </div>
            </button>
          </>
        ) : path === "mediaLibrary" ? (
          <>
            <p style={styles.rateHelp}>
              This uploads {count} video{count > 1 ? "s" : ""} directly into your connected Meta account's
              media library. No campaigns or ads are created.
            </p>
            <button style={styles.primaryBtn} onClick={runMediaLibrary} disabled={running}>
              {running ? "Uploading..." : `Upload ${count} video${count > 1 ? "s" : ""}`}
            </button>
            <button style={styles.linkBtnLight} onClick={() => setPath("choose")}>
              ← back
            </button>
          </>
        ) : (
          <>
            <label style={styles.label}>Campaign & ad set</label>
            <div style={styles.launchStatusRow}>
              <button
                style={campaignMode === "new" ? styles.launchStatusBtnActive : styles.launchStatusBtn}
                onClick={() => setCampaignMode("new")}
              >
                Create a new campaign
              </button>
              <button
                style={campaignMode === "existing" ? styles.launchStatusBtnActive : styles.launchStatusBtn}
                onClick={() => setCampaignMode("existing")}
              >
                Use an existing campaign
              </button>
            </div>

            {campaignMode === "existing" && (
              <>
                {campaignsLoading ? (
                  <p style={styles.uploadHelp}>Loading your campaigns...</p>
                ) : campaigns.length === 0 ? (
                  <p style={styles.uploadHelp}>No existing campaigns found in your connected account.</p>
                ) : (
                  <>
                    <select
                      style={styles.input}
                      value={selectedCampaignId}
                      onChange={(e) => {
                        setSelectedCampaignId(e.target.value);
                        setSelectedAdsetId("");
                      }}
                    >
                      <option value="">Choose a campaign...</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.status})
                        </option>
                      ))}
                    </select>
                    {selectedCampaign && (
                      <select
                        style={styles.input}
                        value={selectedAdsetId}
                        onChange={(e) => setSelectedAdsetId(e.target.value)}
                      >
                        <option value="">Choose an ad set...</option>
                        {selectedCampaign.adsets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.status})
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                )}
              </>
            )}

            <label style={styles.label}>Ad name</label>
            <input
              style={styles.input}
              placeholder="e.g. Glow Serum launch"
              value={adNamePrefix}
              onChange={(e) => setAdNamePrefix(e.target.value)}
            />
            <p style={styles.uploadHelp}>
              Every ad name automatically ends with <code>vidrelay=&lt;submission id&gt;</code> so Vidrelay
              can match Meta performance back to the submission.
            </p>
            <label style={styles.label}>Separator</label>
            <input
              style={{ ...styles.input, maxWidth: 80 }}
              value={separator}
              onChange={(e) => setSeparator(e.target.value)}
            />

            <div style={styles.currentRateEmpty}>
              Partnership ads not available — no selected creators have partnership ads enabled yet.
            </div>

            <label style={styles.label}>Primary text</label>
            <input
              style={styles.input}
              placeholder="Add primary text"
              value={primaryText}
              onChange={(e) => setPrimaryText(e.target.value)}
            />
            <label style={styles.label}>Headline</label>
            <input
              style={styles.input}
              placeholder="Add headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
            <label style={styles.label}>Landing page URL</label>
            <input
              style={styles.input}
              placeholder="https://yourstore.com/product"
              value={landingUrl}
              onChange={(e) => setLandingUrl(e.target.value)}
            />
            <label style={styles.label}>Call to action</label>
            <select style={styles.input} value={cta} onChange={(e) => setCta(e.target.value)}>
              <option value="SHOP_NOW">Shop Now</option>
              <option value="LEARN_MORE">Learn More</option>
              <option value="SIGN_UP">Sign Up</option>
              <option value="WATCH_MORE">Watch More</option>
            </select>

            <label style={styles.label}>Launch as</label>
            <div style={styles.launchStatusRow}>
              <button
                style={launchStatus === "paused" ? styles.launchStatusBtnActive : styles.launchStatusBtn}
                onClick={() => setLaunchStatus("paused")}
              >
                Paused — review before it runs
              </button>
              <button
                style={launchStatus === "active" ? styles.launchStatusBtnActive : styles.launchStatusBtn}
                onClick={() => setLaunchStatus("active")}
              >
                Active — starts running immediately
              </button>
            </div>

            <button style={styles.primaryBtn} onClick={runLaunchAds} disabled={running}>
              {running ? "Launching..." : `Launch ${count} ad${count > 1 ? "s" : ""}`}
            </button>
            <button style={styles.linkBtnLight} onClick={() => setPath("choose")}>
              ← back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function BuildAdRow({ s, isConnected, currentUser }) {
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState(null);

  async function buildAd() {
    setBuilding(true);
    setResult(null);
    try {
      const res = await fetch(
        "https://zyekxsmtancjpvpuuhin.supabase.co/functions/v1/meta-build-ad",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: currentUser.username, submissionId: s.id }),
        }
      );
      const data = await res.json();
      if (data.error) setResult({ ok: false, message: data.error });
      else setResult({ ok: true, message: `Ad created (paused) — ID ${data.adId}. Review and activate it in Meta Ads Manager.` });
    } catch (e) {
      setResult({ ok: false, message: "Something went wrong building this ad." });
    }
    setBuilding(false);
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
            {!s.videoFileUrl && " · no video file uploaded"}
          </div>
        </div>
        {s.metaAdId ? (
          <span style={styles.statusTag}>Ad built</span>
        ) : isConnected && s.videoFileUrl ? (
          <button style={styles.buildAdsBtn} onClick={buildAd} disabled={building}>
            {building ? "Building..." : "Build ad"}
          </button>
        ) : (
          <span style={styles.pendingTag}>{isConnected ? "No video file" : "Connect Meta first"}</span>
        )}
      </div>
      {result && (
        <div style={result.ok ? styles.metaBanner : styles.metaBannerError}>{result.message}</div>
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
  disapproveBtn: { background: "transparent", color: "#A3402A", border: "1px solid #D9A594", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
  decisionBtnRow: { display: "flex", gap: 8, flexShrink: 0 },
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
  brandChipAvatarImg: { width: 36, height: 36, borderRadius: "50%", objectFit: "cover", margin: "0 auto 8px" },
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
  payoutLabel: { fontSize: 12.5, color: "#6C7264", fontWeight: 600 },
  payoutBig: { fontSize: 34, fontWeight: 800, color: "#20261F", margin: "4px 0 18px" },
  payoutBreakdownRow: { display: "flex", gap: 12, marginBottom: 18 },
  payoutBreakdownItem: { flex: 1, background: "#EFEBDE", borderRadius: 10, padding: "10px 12px" },
  payoutBreakdownLabel: { fontSize: 11, color: "#8A8F80", fontWeight: 600, marginBottom: 4 },
  payoutBreakdownValue: { fontSize: 15, fontWeight: 800, color: "#20261F" },
  withdrawBtn: { width: "100%", background: COLORS.moss, color: "#fff", border: "none", borderRadius: 24, padding: "13px 0", fontWeight: 700, fontSize: 14.5, cursor: "pointer" },
  withdrawNote: { marginTop: 12, fontSize: 12.5, color: "#5B6156", background: "#EFEBDE", borderRadius: 10, padding: "10px 14px", lineHeight: 1.5 },
  payoutHistoryHeader: { marginBottom: 6 },
  payoutTotalRow: { display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#20261F", padding: "8px 0", borderTop: `1px solid ${COLORS.line}`, marginTop: 4 },
  payoutRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${COLORS.line}` },
  payoutRowLeft: { display: "flex", alignItems: "center", gap: 10 },
  payoutRowBrand: { fontSize: 13.5, fontWeight: 700, color: "#20261F" },
  payoutRowMeta: { fontSize: 11.5, color: "#8A8F80", marginTop: 1 },
  payoutRowAmount: { fontSize: 14, fontWeight: 800, color: COLORS.moss },
  metaBanner: { background: "#E4EEE7", color: COLORS.moss, fontSize: 13, borderRadius: 10, padding: "10px 14px", marginBottom: 20, textAlign: "left" },
  metaBannerError: { background: "#FBE7E2", color: "#A3402A", fontSize: 13, borderRadius: 10, padding: "10px 14px", marginBottom: 20, textAlign: "left" },
  connectMetaBtn: { display: "inline-block", background: "#1877F2", color: "#fff", border: "none", borderRadius: 10, padding: "11px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer", textDecoration: "none" },
  metaConnectedRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  metaConnectedLabel: { fontSize: 12, color: "#6C7264", fontWeight: 600 },
  metaConnectedValue: { fontSize: 14, fontWeight: 700, color: "#20261F", marginTop: 2 },
  adsTableHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  buildAdsBtn: { background: "#1877F2", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" },
  activePill: { display: "inline-block", background: "#E4EEE7", color: COLORS.moss, fontSize: 12, fontWeight: 700, borderRadius: 20, padding: "5px 12px", marginBottom: 4 },
  adsTable: { marginTop: 14 },
  adsTableRowHead: { display: "flex", fontSize: 11.5, fontWeight: 700, color: "#8A8F80", padding: "8px 0", borderBottom: `1px solid ${COLORS.line}` },
  adsTableRow: { display: "flex", fontSize: 13.5, color: "#20261F", padding: "11px 0", borderBottom: `1px solid ${COLORS.line}`, alignItems: "center" },
  uploadHelp: { fontSize: 12, color: "#6C7264", margin: "0 0 8px" },
  fileInput: { width: "100%", marginBottom: 12, fontSize: 13 },
  fileSelected: { fontSize: 12.5, color: COLORS.moss, fontWeight: 600, marginBottom: 12 },
  hiddenFileInput: { display: "none" },
  addFileTile: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    border: `2px dashed ${COLORS.line}`,
    borderRadius: 14,
    padding: "36px 20px",
    marginBottom: 16,
    cursor: "pointer",
    background: "#F1EDE3",
  },
  addFileTilePlus: { fontSize: 30, fontWeight: 800, color: COLORS.relay, marginBottom: 4, lineHeight: 1 },
  addFileTileTitle: { fontSize: 15, fontWeight: 800, color: "#20261F" },
  addFileTileSub: { fontSize: 12, color: "#8A8F80", marginTop: 4, maxWidth: 260 },
  productGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 10, marginBottom: 14 },
  productTile: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "#F1EDE3", border: `2px solid transparent`, borderRadius: 12, padding: "10px 8px", cursor: "pointer" },
  productTileActive: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "#F1EDE3", border: `2px solid ${COLORS.relay}`, borderRadius: 12, padding: "10px 8px", cursor: "pointer" },
  productTileImg: { width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 },
  productTileImgPlaceholder: { width: "100%", aspectRatio: "1", borderRadius: 8, background: COLORS.moss, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14 },
  productTileName: { fontSize: 11, fontWeight: 700, color: "#20261F", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" },
  productThumbSmall: { width: 32, height: 32, borderRadius: 6, objectFit: "cover" },
  productThumbSmallPlaceholder: { width: 32, height: 32, borderRadius: 6, background: COLORS.moss, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10 },
  reviewHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  reviewToggleRow: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" },
  reviewToggleLabel: { fontSize: 12.5, fontWeight: 700, color: "#5B6156" },
  reviewToggleInput: { width: 18, height: 18, cursor: "pointer" },
  reviewActionBar: { display: "flex", alignItems: "center", gap: 14, background: "#EFEBDE", borderRadius: 10, padding: "10px 14px", margin: "10px 0", flexWrap: "wrap" },
  selectAllRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#20261F", cursor: "pointer" },
  selectedCount: { fontSize: 12.5, color: "#6C7264" },
  exportCsvBtn: { background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" },
  uploadMetaBtn: { background: "#1877F2", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" },
  rowColSelected: { padding: "14px 0", borderTop: `1px solid ${COLORS.line}`, display: "flex", flexDirection: "column", gap: 10, background: "#F1EDE3", margin: "0 -22px", padding: "14px 22px" },
  rowCheckbox: { width: 18, height: 18, marginTop: 2, cursor: "pointer", flexShrink: 0 },
  modalOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 },
  modalBox: { background: COLORS.paper, borderRadius: 16, padding: 26, maxWidth: 460, width: "100%", maxHeight: "85vh", overflowY: "auto" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: 800, color: "#20261F", margin: 0 },
  modalClose: { background: "none", border: "none", fontSize: 22, color: "#8A8F80", cursor: "pointer", lineHeight: 1 },
  exportOptionCard: { display: "block", width: "100%", textAlign: "left", background: "#E4EEE7", border: `2px solid ${COLORS.moss}`, borderRadius: 12, padding: 16, marginBottom: 12, cursor: "pointer" },
  exportOptionCardAlt: { display: "block", width: "100%", textAlign: "left", background: "#F1EDE3", border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: 16, marginBottom: 12, cursor: "pointer" },
  exportOptionTitleRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  exportOptionTitle: { fontSize: 14.5, fontWeight: 800, color: "#20261F" },
  exportRecommendedTag: { fontSize: 10.5, fontWeight: 700, color: "#fff", background: COLORS.moss, borderRadius: 20, padding: "2px 8px" },
  exportOptionSub: { fontSize: 12.5, color: "#5B6156", lineHeight: 1.5 },
  launchStatusRow: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 },
  launchStatusBtn: { textAlign: "left", background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, color: "#5B6156", cursor: "pointer" },
  launchStatusBtnActive: { textAlign: "left", background: "#E4EEE7", border: `2px solid ${COLORS.moss}`, borderRadius: 10, padding: "9px 13px", fontSize: 12.5, fontWeight: 700, color: "#20261F", cursor: "pointer" },
  rosterHeadRow: { display: "flex", fontSize: 11.5, fontWeight: 700, color: "#8A8F80", padding: "8px 0", borderBottom: `1px solid ${COLORS.line}` },
  rosterRow: { display: "flex", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${COLORS.line}` },
  rosterName: { fontSize: 13.5, fontWeight: 700, color: "#20261F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rosterJoined: { fontSize: 11, color: "#8A8F80", marginTop: 1 },
  sampleScoreNew: { display: "inline-block", fontSize: 10.5, fontWeight: 700, color: "#8A8F80", background: "#EFEBDE", borderRadius: 20, padding: "2px 8px", marginTop: 4 },
  sampleScoreGood: { display: "inline-block", fontSize: 10.5, fontWeight: 700, color: COLORS.moss, background: "#E4EEE7", borderRadius: 20, padding: "2px 8px", marginTop: 4 },
  sampleScoreMid: { display: "inline-block", fontSize: 10.5, fontWeight: 700, color: "#9A7B1F", background: "#FBEFD2", borderRadius: 20, padding: "2px 8px", marginTop: 4 },
  sampleScoreLow: { display: "inline-block", fontSize: 10.5, fontWeight: 700, color: "#A3402A", background: "#FBE7E2", borderRadius: 20, padding: "2px 8px", marginTop: 4 },
  payoutCycleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderTop: `1px solid ${COLORS.line}`, gap: 12, flexWrap: "wrap" },
  payoutCycleRight: { display: "flex", alignItems: "center", gap: 12 },
  payoutOwedAmount: { fontSize: 13.5, fontWeight: 800, color: "#20261F", whiteSpace: "nowrap" },
  logoRow: { display: "flex", alignItems: "center", gap: 14 },
  logoPreview: { width: 56, height: 56, borderRadius: 12, objectFit: "cover", border: `1px solid ${COLORS.line}` },
  logoPreviewPlaceholder: { width: 56, height: 56, borderRadius: 12, background: COLORS.moss, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 },
  logoUploadBtn: { background: COLORS.moss, color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" },
  saleToast: { position: "fixed", top: 20, right: 20, zIndex: 200, background: COLORS.paper, borderRadius: 14, padding: "14px 18px", boxShadow: "0 8px 30px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", gap: 12, maxWidth: 320, border: `2px solid ${COLORS.relay}` },
  saleToastEmoji: { fontSize: 26 },
  saleToastTitle: { fontSize: 13.5, fontWeight: 800, color: "#20261F" },
  saleToastSub: { fontSize: 12.5, color: COLORS.moss, fontWeight: 700, marginTop: 2 },
  chatListItem: { display: "flex", gap: 10, alignItems: "center", padding: "12px 14px", background: "none", border: "none", borderBottom: `1px solid ${COLORS.line}`, cursor: "pointer", textAlign: "left" },
  chatListItemActive: { display: "flex", gap: 10, alignItems: "center", padding: "12px 14px", background: "#EFEBDE", border: "none", borderBottom: `1px solid ${COLORS.line}`, cursor: "pointer", textAlign: "left" },
  chatListAvatar: { width: 32, height: 32, borderRadius: "50%", background: COLORS.moss, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, flexShrink: 0 },
  chatListAvatarImg: { width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
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
