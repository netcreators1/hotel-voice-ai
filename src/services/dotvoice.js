import axios from "axios";
import { db, ref, set, update } from "../config/firebase.js";

const DOTVOICE_API_KEY = process.env.DOTVOICE_API_KEY;
const DOTVOICE_API_SECRET = process.env.DOTVOICE_API_SECRET;
const DOTVOICE_ENDPOINT = process.env.DOTVOICE_SIP_SERVER || "https://api.dotvoice.com/v1";

/**
 * DotVoice Telephony Service Provider (Scale-up Provider)
 */
export class DotVoiceService {
  constructor() {
    this.apiKey = DOTVOICE_API_KEY;
    this.apiSecret = DOTVOICE_API_SECRET;
    this.endpoint = DOTVOICE_ENDPOINT;
  }

  /**
   * Initiate an outbound call via DotVoice REST API
   */
  async makeOutboundCall({ to, customerName, metadata = {} }) {
    const callId = "call_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const publicUrl = process.env.PUBLIC_URL || "http://localhost:5000";

    const callRecord = {
      call_id: callId,
      provider: "dotvoice",
      to: to,
      customer_name: customerName || "Guest",
      direction: "outbound",
      status: "initiated",
      lead_status: "pending",
      payment_status: "none",
      start_time: Date.now(),
      created_at: Date.now(),
      metadata: metadata
    };

    // Store in Firebase Realtime Database
    await set(ref(db, `calls/${callId}`), callRecord);

    console.log(`[DotVoice] Initiating outbound call to ${to} (${customerName}), Call ID: ${callId}`);

    if (this.apiKey && this.apiKey !== "your_dotvoice_api_key") {
      try {
        const response = await axios.post(
          `${this.endpoint}/calls`,
          {
            to: to,
            webhook_url: `${publicUrl}/api/telephony/dotvoice/events?call_id=${callId}`,
            stream_url: `wss://${publicUrl.replace(/^https?:\/\//, "")}/media-stream?call_id=${callId}`
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json"
            }
          }
        );

        await update(ref(db, `calls/${callId}`), {
          provider_session_id: response.data.id || "dotvoice_session",
          status: "dialing"
        });

        return { success: true, callId, data: response.data };
      } catch (err) {
        console.error("[DotVoice] API call failed:", err.message);
        await update(ref(db, `calls/${callId}`), { status: "failed", error: err.message });
        return { success: false, callId, error: err.message };
      }
    } else {
      console.log(`[DotVoice Simulator] Outbound call simulated for ${to}`);
      await update(ref(db, `calls/${callId}`), {
        provider_session_id: "sim_dotvoice_" + callId,
        status: "simulated_connected"
      });
      return { success: true, callId, simulated: true };
    }
  }
}

export const dotVoiceService = new DotVoiceService();
