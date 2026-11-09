import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import cron from "node-cron";
import dotenv from "dotenv";

import { fileURLToPath } from "url";
dotenv.config();

import telephonyRoutes from "./routes/telephonyRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { generateDailyReport } from "./reports/eodReport.js";
import { getHotelKnowledge } from "./models/hotelKnowledge.js";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/media-stream" });

const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve API Routes
app.use("/api/telephony", telephonyRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/pay", paymentRoutes);
app.use("/api/admin", adminRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    telephony_provider: process.env.TELEPHONY_PROVIDER || "vobiz",
    public_url: process.env.PUBLIC_URL,
    timestamp: new Date().toISOString()
  });
});

// Interactive Web Control Console with Campaigns, Knowledge Base & EOD Reports
app.get("/", async (req, res) => {
  const hotel = await getHotelKnowledge();
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Hotel Voice AI Hub - Campaigns & Knowledge Base</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <style>
      body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; }
      .nav-tabs .nav-link { color: #94a3b8; border: none; font-weight: 600; padding: 12px 20px; }
      .nav-tabs .nav-link.active { background: #1e293b; color: #38bdf8; border-bottom: 3px solid #38bdf8; }
      .chat-box { height: 320px; overflow-y: auto; background: #0b1329; border: 1px solid #334155; border-radius: 8px; padding: 12px; }
      .chat-msg { margin-bottom: 8px; padding: 8px 12px; border-radius: 8px; font-size: 14px; }
      .msg-agent { background: #1e3a8a; color: #93c5fd; margin-right: 40px; }
      .msg-user { background: #065f46; color: #a7f3d0; margin-left: 40px; text-align: right; }
      pre { background: #0b1329; color: #38bdf8; padding: 12px; border-radius: 8px; max-height: 350px; }
      .form-control, .form-select { background: #0b1329; color: #f8fafc; border-color: #334155; }
      .form-control:focus, .form-select:focus { background: #0b1329; color: #fff; border-color: #38bdf8; box-shadow: none; }
    </style>
  </head>
  <body class="py-4">
    <div class="container">
      <!-- Header -->
      <div class="d-flex justify-content-between align-items-center mb-4 pb-3 border-bottom border-secondary">
        <div>
          <h2 class="mb-1 text-white">🏨 ${hotel.hotel_name}</h2>
          <span class="text-secondary">Hotel Agentic Voice AI • Campaigns • Knowledge Base • Firebase RTDB</span>
        </div>
        <div class="d-flex gap-2">
          <span class="badge bg-success p-2">Firebase Connected</span>
          <span class="badge bg-primary p-2">Provider: ${(process.env.TELEPHONY_PROVIDER || "vobiz").toUpperCase()}</span>
          <span class="badge bg-info text-dark p-2">Port: ${PORT}</span>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <ul class="nav nav-tabs mb-4" id="mainTabs" role="tablist">
        <li class="nav-item">
          <button class="nav-link active" id="dialer-tab" data-bs-toggle="tab" data-bs-target="#dialer" type="button">📞 Live Dialer & Chat</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="campaigns-tab" data-bs-toggle="tab" data-bs-target="#campaigns" type="button" onclick="loadQueue()">📢 Campaigns & Bulk Upload</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="kb-tab" data-bs-toggle="tab" data-bs-target="#kb" type="button" onclick="loadKnowledgeBase()">🧠 Knowledge Base & Tariffs</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="reports-tab" data-bs-toggle="tab" data-bs-target="#reports" type="button">📊 EOD Reports</button>
        </li>
      </ul>

      <!-- Tab Content -->
      <div class="tab-content" id="mainTabContent">
        
        <!-- TAB 1: Live Dialer & Simulator -->
        <div class="tab-pane fade show active" id="dialer">
          <div class="row g-4">
            <div class="col-md-5">
              <div class="card p-4 shadow">
                <h5 class="text-info mb-3">📞 Outbound Phone Call</h5>
                <p class="text-secondary small">Triggers a real phone call to the recipient using ${process.env.TELEPHONY_PROVIDER || "Vobiz"}.</p>
                <div class="mb-3">
                  <label class="form-label text-secondary">Guest Phone Number</label>
                  <input type="text" id="dialPhone" class="form-control" value="+919167584555">
                </div>
                <div class="mb-3">
                  <label class="form-label text-secondary">Guest Name</label>
                  <input type="text" id="dialName" class="form-control" value="Guest">
                </div>
                <button class="btn btn-primary w-100 fw-bold py-2" onclick="triggerCall()">Place Call via ${(process.env.TELEPHONY_PROVIDER || "Vobiz").toUpperCase()}</button>
                <div id="callStatus" class="mt-3 text-warning small"></div>
              </div>
            </div>

            <div class="col-md-7">
              <div class="card p-4 shadow h-100">
                <div class="d-flex justify-content-between align-items-center mb-3">
                  <h5 class="text-success mb-0">🎙️ Live Agent Simulation & Testing</h5>
                  <button class="btn btn-sm btn-outline-secondary" onclick="resetChat()">Clear</button>
                </div>
                <div id="chatBox" class="chat-box mb-3">
                  <div class="chat-msg msg-agent"><strong>Aria (AI):</strong> Namaste! Thank you for speaking with ${hotel.hotel_name}. How may I assist your stay or room reservation?</div>
                </div>
                <div class="input-group">
                  <input type="text" id="userQuery" class="form-control" placeholder="Ask questions (e.g. 'What are Deluxe room rates?', 'Do you have pool?')..." onkeypress="if(event.key === 'Enter') sendQuery()">
                  <button class="btn btn-success fw-bold px-4" onclick="sendQuery()">Send</button>
                </div>
                <div class="mt-2 d-flex gap-2">
                  <button class="btn btn-sm btn-outline-info" onclick="quickQuery('What are the room tariffs?')">Rates Inquiry</button>
                  <button class="btn btn-sm btn-outline-info" onclick="quickQuery('Do you have pool and breakfast?')">Amenities</button>
                  <button class="btn btn-sm btn-outline-warning" onclick="quickQuery('Yes, book 1 Deluxe room and send payment link')">Book & Send Payment Link</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: Campaigns & Bulk Upload -->
        <div class="tab-pane fade" id="campaigns">
          <div class="row g-4">
            <div class="col-md-6">
              <div class="card p-4 shadow">
                <h5 class="text-info mb-3">📁 Upload Contact List (CSV / Text)</h5>
                <p class="text-secondary small">Upload a list of guests to dial sequentially for promotions or inquiries.</p>
                <div class="mb-3">
                  <label class="form-label text-secondary">Campaign Name</label>
                  <input type="text" id="campaignName" class="form-control" value="Weekend_Getaway_Promo">
                </div>
                <div class="mb-3">
                  <label class="form-label text-secondary">Paste Contacts (One per line: Name, Phone)</label>
                  <textarea id="bulkContactsText" class="form-control" rows="5" placeholder="Rohan Sharma, +919811122334&#10;Pooja Hegde, +919822233445&#10;Vikram Malhotra, +919833344556"></textarea>
                </div>
                <button class="btn btn-info w-100 fw-bold" onclick="uploadBulkContacts()">Queue Contacts in Firebase RTDB</button>
                <div id="uploadStatus" class="mt-2 text-success small"></div>
              </div>
            </div>

            <div class="col-md-6">
              <div class="card p-4 shadow">
                <div class="d-flex justify-content-between align-items-center mb-3">
                  <h5 class="text-warning mb-0">📋 Outbound Calling Queue</h5>
                  <button class="btn btn-sm btn-outline-secondary" onclick="loadQueue()">Refresh</button>
                </div>
                <div id="queueList" style="max-height: 250px; overflow-y: auto;" class="mb-3">
                  <div class="text-secondary small">Loading queue...</div>
                </div>
                <button class="btn btn-warning w-100 fw-bold py-2" onclick="runCampaign()">🚀 Run Automated Outbound Campaign</button>
                <div id="runStatus" class="mt-2 text-info small"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 3: Knowledge Base & Tariffs -->
        <div class="tab-pane fade" id="kb">
          <div class="card p-4 shadow">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="text-primary mb-0">🧠 Hotel Knowledge Base & Agent Memory</h5>
              <button class="btn btn-success fw-bold" onclick="saveKnowledgeBase()">Save Knowledge Base</button>
            </div>
            <p class="text-secondary small">The AI Voice Agent uses this exact live knowledge base to answer guest queries in real time.</p>
            
            <div class="row g-3">
              <div class="col-md-4">
                <label class="form-label text-secondary">Hotel Name</label>
                <input type="text" id="kbHotelName" class="form-control">
              </div>
              <div class="col-md-4">
                <label class="form-label text-secondary">Location</label>
                <input type="text" id="kbLocation" class="form-control">
              </div>
              <div class="col-md-4">
                <label class="form-label text-secondary">Check-in / Check-out</label>
                <div class="input-group">
                  <input type="text" id="kbCheckIn" class="form-control" placeholder="14:00">
                  <input type="text" id="kbCheckOut" class="form-control" placeholder="11:00">
                </div>
              </div>

              <div class="col-md-4">
                <label class="form-label text-secondary">Deluxe Room Rate (₹)</label>
                <input type="number" id="kbDeluxeRate" class="form-control">
              </div>
              <div class="col-md-4">
                <label class="form-label text-secondary">Executive Suite Rate (₹)</label>
                <input type="number" id="kbSuiteRate" class="form-control">
              </div>
              <div class="col-md-4">
                <label class="form-label text-secondary">Presidential Suite Rate (₹)</label>
                <input type="number" id="kbPresRate" class="form-control">
              </div>

              <div class="col-12">
                <label class="form-label text-secondary">Cancellation Policy</label>
                <input type="text" id="kbCancelPolicy" class="form-control">
              </div>

              <div class="col-12">
                <label class="form-label text-secondary">Amenities (Comma separated)</label>
                <textarea id="kbAmenities" class="form-control" rows="2"></textarea>
              </div>

              <div class="col-12">
                <label class="form-label text-secondary">Frequently Asked Questions (JSON format)</label>
                <textarea id="kbFaqs" class="form-control font-monospace" rows="4"></textarea>
              </div>
            </div>
            <div id="kbStatus" class="mt-3 text-success fw-bold"></div>
          </div>
        </div>

        <!-- TAB 4: EOD Reports -->
        <div class="tab-pane fade" id="reports">
          <div class="card p-4 shadow">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="text-warning mb-0">📈 Daily End-of-Day (EOD) Operations Report</h5>
              <button class="btn btn-warning fw-bold" onclick="generateReport()">Generate Today's Report Now</button>
            </div>
            <p class="text-secondary small">Automatically aggregated every night at ${process.env.EOD_REPORT_CRON || "9:00 PM"} and saved to Firebase RTDB (\`/daily_reports\`).</p>
            <pre id="reportPre">Click 'Generate Today\'s Report Now' to view the operational digest...</pre>
          </div>
        </div>

      </div>
    </div>

    <script>
      let messages = [
        { role: "assistant", content: "Namaste! Thank you for speaking with ${hotel.hotel_name}. How may I assist your stay or room reservation?" }
      ];

      // Tab 1: Single Call
      async function triggerCall() {
        const phone = document.getElementById("dialPhone").value.trim();
        const name = document.getElementById("dialName").value.trim();
        const statusDiv = document.getElementById("callStatus");
        statusDiv.innerText = "Placing outbound call...";

        try {
          const res = await fetch("/api/telephony/outbound", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: phone, customerName: name })
          });
          const data = await res.json();
          statusDiv.innerText = data.success ? "✓ Call dialed! Call ID: " + data.callId : "Error: " + JSON.stringify(data.error);
        } catch(e) {
          statusDiv.innerText = "Error: " + e.message;
        }
      }

      // Tab 1: Chat Simulation
      async function sendQuery() {
        const input = document.getElementById("userQuery");
        const query = input.value.trim();
        if(!query) return;

        appendMsg("You (Caller)", query, "msg-user");
        messages.push({ role: "user", content: query });
        input.value = "";

        try {
          const res = await fetch("/api/telephony/simulate-dialog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages })
          });
          const data = await res.json();
          messages.push({ role: "assistant", content: data.agentReply });
          
          let toolsInfo = "";
          if(data.toolsExecuted && data.toolsExecuted.length > 0) {
            toolsInfo = " <i>[Executed Tool: " + data.toolsExecuted.join(", ") + "]</i>";
          }
          appendMsg("Aria (AI)", data.agentReply + toolsInfo, "msg-agent");
        } catch(e) {
          appendMsg("System", "Error: " + e.message, "msg-agent");
        }
      }

      function quickQuery(text) {
        document.getElementById("userQuery").value = text;
        sendQuery();
      }

      function appendMsg(sender, text, cls) {
        const box = document.getElementById("chatBox");
        const div = document.createElement("div");
        div.className = "chat-msg " + cls;
        div.innerHTML = "<strong>" + sender + ":</strong> " + text;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
      }

      function resetChat() {
        messages = [{ role: "assistant", content: "Namaste! Thank you for speaking with ${hotel.hotel_name}. How may I assist your stay or room reservation?" }];
        document.getElementById("chatBox").innerHTML = '<div class="chat-msg msg-agent"><strong>Aria (AI):</strong> Namaste! Thank you for speaking with ${hotel.hotel_name}. How may I assist your stay or room reservation?</div>';
      }

      // Tab 2: Bulk Upload Contacts
      async function uploadBulkContacts() {
        const campaign = document.getElementById("campaignName").value.trim();
        const text = document.getElementById("bulkContactsText").value.trim();
        const status = document.getElementById("uploadStatus");

        if(!text) { status.innerText = "Please enter at least one contact"; return; }

        const lines = text.split("\\n");
        const contacts = [];
        for (const line of lines) {
          const parts = line.split(",");
          if(parts.length >= 2) {
            contacts.push({ name: parts[0].trim(), phone: parts[1].trim(), campaign: campaign });
          } else if(parts.length === 1 && parts[0].trim()) {
            contacts.push({ name: "Guest", phone: parts[0].trim(), campaign: campaign });
          }
        }

        try {
          const res = await fetch("/api/admin/contacts/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contacts, campaign })
          });
          const data = await res.json();
          status.innerText = "✓ Successfully queued " + data.count + " contacts into Firebase RTDB!";
          loadQueue();
        } catch(e) {
          status.innerText = "Error: " + e.message;
        }
      }

      async function loadQueue() {
        const listDiv = document.getElementById("queueList");
        listDiv.innerHTML = "Loading...";

        try {
          const res = await fetch("/api/admin/contacts/queue");
          const queue = await res.json();

          if(queue.length === 0) {
            listDiv.innerHTML = "<div class='text-secondary small'>Queue is empty. Upload contacts on the left.</div>";
            return;
          }

          let html = "<ul class='list-group bg-dark'>";
          for (const item of queue) {
            const badgeClass = item.status === "pending" ? "bg-warning" : item.status === "dialed" ? "bg-success" : "bg-secondary";
            html += \`<li class='list-group-item bg-dark text-white border-secondary d-flex justify-content-between align-items-center'>
              <div><strong>\${item.name}</strong> (\${item.phone})<br><small class='text-secondary'>Campaign: \${item.campaign || "General"}</small></div>
              <span class='badge \${badgeClass}'>\${item.status.toUpperCase()}</span>
            </li>\`;
          }
          html += "</ul>";
          listDiv.innerHTML = html;
        } catch(e) {
          listDiv.innerText = "Error: " + e.message;
        }
      }

      async function runCampaign() {
        const campaign = document.getElementById("campaignName").value.trim();
        const runStatus = document.getElementById("runStatus");
        runStatus.innerText = "Starting outbound calling campaign...";

        try {
          const res = await fetch("/api/admin/campaigns/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ campaignName: campaign })
          });
          const data = await res.json();
          runStatus.innerText = data.message;
          setTimeout(loadQueue, 2000);
        } catch(e) {
          runStatus.innerText = "Error: " + e.message;
        }
      }

      // Tab 3: Knowledge Base
      let currentKb = {};
      async function loadKnowledgeBase() {
        try {
          const res = await fetch("/api/admin/hotel-config");
          currentKb = await res.json();

          document.getElementById("kbHotelName").value = currentKb.hotel_name || "";
          document.getElementById("kbLocation").value = currentKb.location || "";
          document.getElementById("kbCheckIn").value = currentKb.check_in_time || "14:00";
          document.getElementById("kbCheckOut").value = currentKb.check_out_time || "11:00";
          document.getElementById("kbDeluxeRate").value = currentKb.room_types?.deluxe?.base_rate || 3500;
          document.getElementById("kbSuiteRate").value = currentKb.room_types?.executive_suite?.base_rate || 6000;
          document.getElementById("kbPresRate").value = currentKb.room_types?.presidential_suite?.base_rate || 14000;
          document.getElementById("kbCancelPolicy").value = currentKb.cancellation_policy || "";
          document.getElementById("kbAmenities").value = (currentKb.amenities || []).join(", ");
          document.getElementById("kbFaqs").value = JSON.stringify(currentKb.faqs || {}, null, 2);
        } catch(e) {
          console.error("Error loading KB:", e);
        }
      }

      async function saveKnowledgeBase() {
        const status = document.getElementById("kbStatus");
        status.innerText = "Saving to Firebase Realtime Database...";

        currentKb.hotel_name = document.getElementById("kbHotelName").value;
        currentKb.location = document.getElementById("kbLocation").value;
        currentKb.check_in_time = document.getElementById("kbCheckIn").value;
        currentKb.check_out_time = document.getElementById("kbCheckOut").value;
        currentKb.cancellation_policy = document.getElementById("kbCancelPolicy").value;
        currentKb.amenities = document.getElementById("kbAmenities").value.split(",").map(s => s.trim());
        
        if(!currentKb.room_types) currentKb.room_types = {};
        if(!currentKb.room_types.deluxe) currentKb.room_types.deluxe = { name: "Deluxe Room", tax_percentage: 12 };
        currentKb.room_types.deluxe.base_rate = Number(document.getElementById("kbDeluxeRate").value);

        if(!currentKb.room_types.executive_suite) currentKb.room_types.executive_suite = { name: "Executive Suite", tax_percentage: 18 };
        currentKb.room_types.executive_suite.base_rate = Number(document.getElementById("kbSuiteRate").value);

        if(!currentKb.room_types.presidential_suite) currentKb.room_types.presidential_suite = { name: "Presidential Luxury Suite", tax_percentage: 18 };
        currentKb.room_types.presidential_suite.base_rate = Number(document.getElementById("kbPresRate").value);

        try {
          currentKb.faqs = JSON.parse(document.getElementById("kbFaqs").value);
        } catch(e) {
          alert("Invalid JSON format in FAQs. Please check.");
          return;
        }

        try {
          const res = await fetch("/api/admin/hotel-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentKb)
          });
          const data = await res.json();
          status.innerText = "✓ Knowledge Base updated and synced to Firebase RTDB!";
          setTimeout(() => { status.innerText = ""; }, 3000);
        } catch(e) {
          status.innerText = "Error: " + e.message;
        }
      }

      // Tab 4: EOD Report
      async function generateReport() {
        const pre = document.getElementById("reportPre");
        pre.innerText = "Aggregating today's metrics from Firebase RTDB...";

        try {
          const res = await fetch("/api/admin/report/generate", { method: "POST" });
          const data = await res.json();
          pre.innerText = data.markdownReport || JSON.stringify(data.reportData, null, 2);
        } catch(e) {
          pre.innerText = "Error: " + e.message;
        }
      }
    </script>
  </body>
  </html>
  `;

  res.send(html);
});

// WebSocket Handler for Real-Time Telephony Bidirectional Audio
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const callId = url.searchParams.get("call_id");
  console.log(`[WebSocket Audio Stream] Client connected for Call ID: ${callId}`);

  ws.on("message", (message) => {
    // Media stream packets handler
  });

  ws.on("close", () => {
    console.log(`[WebSocket Audio Stream] Stream closed for Call ID: ${callId}`);
  });
});

// Schedule Daily End-of-Day (EOD) Report via Cron
const cronSchedule = process.env.EOD_REPORT_CRON || "0 21 * * *"; // 9:00 PM daily
cron.schedule(cronSchedule, async () => {
  console.log(`[Cron Scheduler] Running automated daily EOD report at ${new Date().toISOString()}...`);
  try {
    await generateDailyReport();
  } catch (err) {
    console.error("[Cron Scheduler] Error running daily report:", err);
  }
});

export { app, server };

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun && !process.env.FUNCTION_TARGET && !process.env.K_SERVICE) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`=======================================================`);
    console.log(`🏨 Hotel AI Voice Agent & Telephony Gateway is ONLINE!`);
    console.log(`📡 Listening on http://0.0.0.0:${PORT}`);
    console.log(`📞 Telephony Provider: ${process.env.TELEPHONY_PROVIDER || "vobiz"}`);
    console.log(`🔥 Firebase RTDB URL: ${process.env.FIREBASE_DATABASE_URL}`);
    console.log(`🌐 Public Webhook URL: ${process.env.PUBLIC_URL}`);
    console.log(`=======================================================`);
  });
}

