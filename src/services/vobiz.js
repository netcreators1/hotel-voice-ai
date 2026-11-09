import axios from "axios";
import { db, ref, set, update } from "../config/firebase.js";

const VOBIZ_AUTH_ID = process.env.VOBIZ_AUTH_ID || "MA_UQ3I13SF";
const VOBIZ_AUTH_SECRET = process.env.VOBIZ_AUTH_SECRET || "GpkMfgbwbCSO0CZZJeA9E2jARLRuOq0jJ3Pj55wo3BfFIDrRtJfU9btQ4XG9m1V2";
const VOBIZ_PHONE_NUMBER = process.env.VOBIZ_PHONE_NUMBER || "+918065354620";
const VOBIZ_API_BASE = "https://api.vobiz.ai/api/v1";

/**
 * Vobiz Direct Cloud Telephony Provider with 2-Way Speech Recognition & Amazon Polly Neural Voice
 */
export class VobizService {
  constructor() {
    this.authId = VOBIZ_AUTH_ID;
    this.authSecret = VOBIZ_AUTH_SECRET;
    this.fromNumber = VOBIZ_PHONE_NUMBER;
  }

  /**
   * Place an outbound call via Vobiz REST API
   */
  async makeOutboundCall({ to, customerName, metadata = {} }) {
    const callId = "vobiz_" + Date.now();
    const publicUrl = process.env.PUBLIC_URL || "http://localhost:5050";
    const answerUrl = `${publicUrl}/api/telephony/vobiz/answer?call_id=${callId}`;
    const hangupUrl = `${publicUrl}/api/telephony/vobiz/hangup?call_id=${callId}`;

    const cleanTo = to.startsWith("+") ? to : `+${to}`;

    // Record initial call session in Firebase RTDB
    await set(ref(db, `calls/${callId}`), {
      call_id: callId,
      provider: "vobiz",
      from: this.fromNumber,
      to: cleanTo,
      customer_name: customerName || "Guest",
      direction: "outbound",
      status: "initiated",
      lead_status: "pending",
      payment_status: "none",
      conversation_history: [],
      start_time: Date.now(),
      created_at: Date.now(),
      metadata: metadata
    });

    console.log(`[Vobiz] Placing outbound call from ${this.fromNumber} to ${cleanTo}...`);

    try {
      const response = await axios.post(
        `${VOBIZ_API_BASE}/Account/${this.authId}/Call/`,
        {
          from: this.fromNumber,
          to: cleanTo,
          answer_url: answerUrl,
          answer_method: "POST",
          hangup_url: hangupUrl,
          hangup_method: "POST"
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-Auth-ID": this.authId,
            "X-Auth-Token": this.authSecret
          }
        }
      );

      console.log(`[Vobiz Call Success]:`, response.data);

      await update(ref(db, `calls/${callId}`), {
        provider_session_id: response.data.request_uuid || response.data.api_id,
        status: "ringing"
      });

      return { success: true, callId, data: response.data };
    } catch (err) {
      console.error("[Vobiz Call Error]:", err.response?.status, err.response?.data || err.message);
      await update(ref(db, `calls/${callId}`), {
        status: "failed",
        error: err.response?.data || err.message
      });
      return { success: false, callId, error: err.response?.data || err.message };
    }
  }

  /**
   * Initial Welcome & Speech Listening XML
   */
  generateAnswerXML(hotelName, guestName, callId) {
    const publicUrl = process.env.PUBLIC_URL || "http://localhost:5050";
    const gatherAction = `${publicUrl}/api/telephony/vobiz/gather?call_id=${callId}`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="${gatherAction}" method="POST" inputType="speech" language="en-IN" speechEndTimeout="auto" executionTimeout="15">
        <Speak voice="Polly.Raveena" language="en-IN">
            Namaste ${guestName || ""}! This is Aria calling from ${hotelName || "The Royal Orchid Grand"}. How can I assist you with your room reservation or stay today?
        </Speak>
    </Gather>
    <Speak voice="Polly.Raveena" language="en-IN">
        I did not catch that. Please feel free to ask about our room tariffs or amenities anytime. Have a wonderful day!
    </Speak>
    <Hangup/>
</Response>`;
  }

  /**
   * Conversational turn XML: speaks the AI reply and listens for the next guest input
   */
  generateConversationalXML(replyText, callId, isFinal = false) {
    const publicUrl = process.env.PUBLIC_URL || "http://localhost:5050";
    const gatherAction = `${publicUrl}/api/telephony/vobiz/gather?call_id=${callId}`;

    if (isFinal) {
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Speak voice="Polly.Raveena" language="en-IN">
        ${replyText}
    </Speak>
    <Hangup/>
</Response>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="${gatherAction}" method="POST" inputType="speech" language="en-IN" speechEndTimeout="auto" executionTimeout="15">
        <Speak voice="Polly.Raveena" language="en-IN">
            ${replyText}
        </Speak>
    </Gather>
    <Speak voice="Polly.Raveena" language="en-IN">
        Thank you for speaking with us. Have a wonderful day!
    </Speak>
    <Hangup/>
</Response>`;
  }
}

export const vobizService = new VobizService();
