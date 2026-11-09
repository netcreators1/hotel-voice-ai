import express from "express";
import { telephonyAdapter } from "../services/telephonyAdapter.js";
import { piopiyService } from "../services/piopiy.js";
import { processConversationStep } from "../services/voiceAgent.js";
import { db, ref, update, get } from "../config/firebase.js";

const router = express.Router();

/**
 * Trigger an outbound AI call to a customer
 * POST /api/telephony/outbound
 * Body: { to: "+919876543210", customerName: "Aman", metadata: {} }
 */
router.post("/outbound", async (req, res) => {
  try {
    const { to, customerName, metadata } = req.body;
    if (!to) {
      return res.status(400).json({ error: "Phone number 'to' is required" });
    }

    const result = await telephonyAdapter.makeCall({ to, customerName, metadata });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PIOPIY Webhook: Action handler when call connects
 * GET or POST /api/telephony/piopiy/action
 */
router.all("/piopiy/action", async (req, res) => {
  const callId = req.query.call_id || req.body.call_id;
  console.log(`[PIOPIY Webhook] Action requested for Call ID: ${callId}`);

  if (callId) {
    await update(ref(db, `calls/${callId}`), {
      status: "connected",
      connected_at: Date.now()
    });
  }

  // PIOPIY action: Welcome greeting
  const greeting = piopiyService.generateCallAction("speak", {
    text: "Namaste! Thank you for answering. This is Aria from The Royal Orchid Grand. How may I assist your stay?",
    voice: "en-IN"
  });

  res.json([greeting]);
});

/**
 * PIOPIY Webhook: Call Status Events (answered, ringing, completed)
 * POST /api/telephony/piopiy/status
 */
router.post("/piopiy/status", async (req, res) => {
  const callId = req.query.call_id || req.body.call_id;
  const status = req.body.status || req.body.event;
  const duration = req.body.duration || req.body.billsec || 0;

  console.log(`[PIOPIY Webhook] Status update for ${callId}: ${status} (duration: ${duration}s)`);

  if (callId) {
    await update(ref(db, `calls/${callId}`), {
      status: status,
      duration_seconds: Number(duration),
      ended_at: Date.now()
    });
  }

  res.json({ status: "acknowledged" });
});

/**
 * Vobiz Webhook: Triggered when customer answers the outbound call
 * GET or POST /api/telephony/vobiz/answer
 */
router.all("/vobiz/answer", async (req, res) => {
  try {
    const callId = req.query?.call_id || req.body?.call_id;
    console.log(`[Vobiz Webhook] Call answered for Call ID: ${callId}`);

    if (callId) {
      await update(ref(db, `calls/${callId}`), {
        status: "connected",
        connected_at: Date.now()
      });
    }

    const { vobizService } = await import("../services/vobiz.js");
    const { getHotelKnowledge } = await import("../models/hotelKnowledge.js");
    const hotel = await getHotelKnowledge();

    const customerName = req.body?.customer_name || req.query?.customer_name || "";
    const xml = vobizService.generateAnswerXML(hotel.hotel_name, customerName, callId);

    res.set("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    console.error("[Vobiz Answer Error]:", err);
    res.set("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="Polly.Raveena" language="en-IN">Namaste! Welcome to The Royal Orchid Grand. How can I assist you today?</Speak></Response>`);
  }
});

/**
 * Vobiz Webhook: Process Live Caller Speech & Return Intelligent AI Reply
 * GET or POST /api/telephony/vobiz/gather
 */
router.all("/vobiz/gather", async (req, res) => {
  try {
    const callId = req.query?.call_id || req.body?.call_id;
    const userSpeech = req.body?.Speech || req.query?.Speech || req.body?.Digits || "";
    console.log(`[Vobiz Live Speech] Caller said: "${userSpeech}" for Call ID: ${callId}`);

    const { vobizService } = await import("../services/vobiz.js");
    const { processConversationStep } = await import("../services/voiceAgent.js");

    // Fetch call state from Firebase
    let callData = {};
    if (callId) {
      const snap = await get(ref(db, `calls/${callId}`));
      if (snap.exists()) callData = snap.val();
    }

    const customerPhone = callData.to || "";
    const customerName = callData.customer_name || "Guest";
    const history = callData.conversation_history || [];

    // Append user input to history
    if (userSpeech) {
      history.push({ role: "user", content: userSpeech });
    }

    const sessionContext = { callId, customerName, customerPhone };
    const result = await processConversationStep(history, sessionContext);

    // Append AI reply to history & save to Firebase
    history.push({ role: "assistant", content: result.reply });
    if (callId) {
      await update(ref(db, `calls/${callId}`), {
        conversation_history: history,
        last_agent_reply: result.reply,
        updated_at: Date.now()
      });
    }

    // Check if conversation concluded
    const isGoodbye = userSpeech.toLowerCase().includes("bye") || userSpeech.toLowerCase().includes("thank you");
    const xml = vobizService.generateConversationalXML(result.reply, callId, isGoodbye);

    res.set("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    console.error("[Vobiz Gather Error]:", err);
    res.set("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="Polly.Raveena" language="en-IN">I would be delighted to assist. Could you please repeat that?</Speak></Response>`);
  }
});

/**
 * Vobiz Webhook: Triggered on call completion/hangup
 * GET or POST /api/telephony/vobiz/hangup
 */
router.all("/vobiz/hangup", async (req, res) => {
  try {
    const callId = req.query?.call_id || req.body?.call_id;
    const duration = req.body?.Duration || req.body?.BillDuration || req.query?.Duration || 0;
    console.log(`[Vobiz Webhook] Call ended for ${callId}, duration: ${duration}s`);

    if (callId) {
      await update(ref(db, `calls/${callId}`), {
        status: "completed",
        duration_seconds: Number(duration),
        ended_at: Date.now()
      });
    }

    res.set("Content-Type", "application/xml");
    res.send("<Response></Response>");
  } catch (err) {
    res.set("Content-Type", "application/xml");
    res.send("<Response></Response>");
  }
});

/**
 * Vapi.ai Webhook (Function/Tool calls & Call End reports)
 * POST /api/telephony/vapi/webhook
 */
router.post("/vapi/webhook", async (req, res) => {
  try {
    const { vapiService } = await import("../services/vapi.js");
    const response = await vapiService.handleWebhook(req.body);
    res.json(response);
  } catch (err) {
    console.error("[Vapi Webhook Error]:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Test & Interactive Simulator Endpoint
 * Simulates a voice dialog turn and runs tools (check availability, generate payment link)
 * POST /api/telephony/simulate-dialog
 */
router.post("/simulate-dialog", async (req, res) => {
  try {
    const { messages, callId = "sim_call_001", customerName = "Rahul Sharma", customerPhone = "+919876543210" } = req.body;

    const sessionContext = { callId, customerName, customerPhone };
    const result = await processConversationStep(messages || [], sessionContext);

    res.json({
      success: true,
      agentReply: result.reply,
      toolsExecuted: result.toolCallsExecuted
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
