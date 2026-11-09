import express from "express";
import { generateDailyReport } from "../reports/eodReport.js";
import { db, ref, get, set, push, update } from "../config/firebase.js";
import { getHotelKnowledge } from "../models/hotelKnowledge.js";
import { telephonyAdapter } from "../services/telephonyAdapter.js";

const router = express.Router();

/**
 * Generate EOD Report on-demand
 */
router.post("/report/generate", async (req, res) => {
  try {
    const targetDate = req.query.date || req.body.date;
    const result = await generateDailyReport(targetDate);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get Today's EOD Report from Firebase RTDB
 */
router.get("/report/today", async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().split("T")[0];
    const snapshot = await get(ref(db, `daily_reports/${dateStr}`));

    if (snapshot.exists()) {
      res.json(snapshot.val());
    } else {
      res.status(404).json({ message: `No report found for ${dateStr}. Run generate first.` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Fetch All Calls & Leads
 */
router.get("/calls", async (req, res) => {
  try {
    const snapshot = await get(ref(db, "calls"));
    const calls = snapshot.exists() ? snapshot.val() : {};
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Bulk Upload Contacts / Leads List (CSV / JSON)
 * POST /api/admin/contacts/bulk
 * Body: { contacts: [{ name: "Raj", phone: "+91...", campaign: "deluxe_promo" }] }
 */
router.post("/contacts/bulk", async (req, res) => {
  try {
    const { contacts, campaign = "general_campaign" } = req.body;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: "Contacts array is required and must not be empty" });
    }

    const inserted = [];
    for (const c of contacts) {
      if (c.phone) {
        const newRef = push(ref(db, "contacts_queue"));
        const record = {
          id: newRef.key,
          name: c.name || "Guest",
          phone: c.phone.trim(),
          campaign: c.campaign || campaign,
          status: "pending",
          notes: c.notes || "",
          created_at: Date.now()
        };
        await set(newRef, record);
        inserted.push(record);
      }
    }

    res.json({ success: true, count: inserted.length, contacts: inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get All Contacts in Queue
 * GET /api/admin/contacts/queue
 */
router.get("/contacts/queue", async (req, res) => {
  try {
    const snap = await get(ref(db, "contacts_queue"));
    const queue = snap.exists() ? Object.values(snap.val()) : [];
    res.json(queue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Run Automated Outbound Calling Campaign
 * Iterates through pending contacts in the queue and dials them
 * POST /api/admin/campaigns/run
 */
router.post("/campaigns/run", async (req, res) => {
  try {
    const { campaignName } = req.body;
    const snap = await get(ref(db, "contacts_queue"));
    if (!snap.exists()) {
      return res.json({ message: "No contacts in queue" });
    }

    const contacts = snap.val();
    const pendingContacts = Object.entries(contacts).filter(([id, c]) => {
      if (c.status !== "pending") return false;
      if (campaignName && c.campaign !== campaignName) return false;
      return true;
    });

    if (pendingContacts.length === 0) {
      return res.json({ message: "No pending contacts to dial in this campaign" });
    }

    console.log(`[Campaign Runner] Starting outbound campaign with ${pendingContacts.length} contacts...`);

    // Asynchronously trigger calls with delays between each
    (async () => {
      for (const [id, c] of pendingContacts) {
        try {
          console.log(`[Campaign] Dialing ${c.name} (${c.phone})...`);
          await update(ref(db, `contacts_queue/${id}`), { status: "calling", called_at: Date.now() });

          const result = await telephonyAdapter.makeCall({
            to: c.phone,
            customerName: c.name,
            metadata: { campaign: c.campaign, queue_id: id }
          });

          await update(ref(db, `contacts_queue/${id}`), {
            status: result.success ? "dialed" : "failed",
            call_id: result.callId || null
          });

          // Wait 15 seconds before dialing next contact to respect telecom concurrency
          await new Promise(resolve => setTimeout(resolve, 15000));
        } catch (callErr) {
          console.error(`[Campaign Dial Error] for ${c.phone}:`, callErr.message);
        }
      }
    })();

    res.json({
      success: true,
      message: `Campaign started for ${pendingContacts.length} contacts`,
      totalQueued: pendingContacts.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get & Update Hotel Knowledge Base
 * GET /api/admin/hotel-config
 * POST /api/admin/hotel-config
 */
router.get("/hotel-config", async (req, res) => {
  const config = await getHotelKnowledge();
  res.json(config);
});

router.post("/hotel-config", async (req, res) => {
  try {
    await set(ref(db, "hotel_config"), req.body);
    console.log("[Knowledge Base] Hotel configuration updated in Firebase RTDB");
    res.json({ success: true, updated: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
