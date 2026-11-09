import axios from "axios";
import { db, ref, set, update } from "../config/firebase.js";

const PIOPIY_APP_ID = process.env.PIOPIY_APP_ID;
const PIOPIY_APP_SECRET = process.env.PIOPIY_APP_SECRET;
const PIOPIY_CALLER_ID = process.env.PIOPIY_CALLER_ID || "+918000000000";
const PIOPIY_API_BASE = "https://api.telecmi.com/v1"; // Standard PIOPIY TeleCMI API endpoint

/**
 * PIOPIY Telephony Service Provider
 */
export class PiopiyService {
  constructor() {
    this.appId = PIOPIY_APP_ID;
    this.appSecret = PIOPIY_APP_SECRET;
    this.callerId = PIOPIY_CALLER_ID;
  }

  /**
   * Initiate an outbound call via PIOPIY REST API
   */
  async makeOutboundCall({ to, customerName, metadata = {} }) {
    const callId = "call_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const publicUrl = process.env.PUBLIC_URL || "http://localhost:5000";

    const webhookActionUrl = `${publicUrl}/api/telephony/piopiy/action?call_id=${callId}`;
    const statusCallbackUrl = `${publicUrl}/api/telephony/piopiy/status?call_id=${callId}`;

    const callRecord = {
      call_id: callId,
      provider: "piopiy",
      to: to,
      from: this.callerId,
      customer_name: customerName || "Guest",
      direction: "outbound",
      status: "initiated", // initiated | ringing | in-progress | completed | failed | busy
      lead_status: "pending",
      payment_status: "none",
      start_time: Date.now(),
      created_at: Date.now(),
      metadata: metadata
    };

    // Store in Firebase Realtime Database
    await set(ref(db, `calls/${callId}`), callRecord);

    console.log(`[PIOPIY] Initiating outbound call to ${to} (${customerName}), Call ID: ${callId}`);

    // If real credentials exist, invoke PIOPIY API
    if (this.appId && this.appId !== "your_piopiy_app_id" && this.appSecret) {
      try {
        const response = await axios.post(
          `${PIOPIY_API_BASE}/call/make_call`,
          {
            appid: this.appId,
            secret: this.appSecret,
            from: this.callerId,
            to: to,
            action_url: webhookActionUrl,
            status_url: statusCallbackUrl
          },
          { headers: { "Content-Type": "application/json" } }
        );

        await update(ref(db, `calls/${callId}`), {
          provider_session_id: response.data.session_id || response.data.call_id || "piopiy_live",
          status: "dialing"
        });

        return { success: true, callId, piopiyResponse: response.data };
      } catch (err) {
        console.error("[PIOPIY] Error calling API:", err.response?.data || err.message);
        await update(ref(db, `calls/${callId}`), {
          status: "failed",
          error: err.message
        });
        return { success: false, callId, error: err.message };
      }
    } else {
      // Local / Simulator mode
      console.log(`[PIOPIY Simulator] Outbound call simulated. Action URL: ${webhookActionUrl}`);
      await update(ref(db, `calls/${callId}`), {
        provider_session_id: "sim_" + callId,
        status: "simulated_connected"
      });
      return { success: true, callId, simulated: true };
    }
  }

  /**
   * Generates PIOPIY Call Action Payload (IVR / Stream / Speak instructions)
   */
  generateCallAction(type, options = {}) {
    switch (type) {
      case "speak":
        return {
          action: "speak",
          text: options.text,
          voice: options.voice || "en-IN",
          speed: 1.0
        };

      case "stream":
        return {
          action: "stream",
          stream_url: options.wsUrl,
          bidirectional: true
        };

      case "hangup":
        return { action: "hangup" };

      default:
        return { action: "speak", text: "Connecting to hotel concierge." };
    }
  }
}

export const piopiyService = new PiopiyService();
