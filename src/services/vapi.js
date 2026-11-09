import axios from "axios";
import { db, ref, set, update } from "../config/firebase.js";
import { executeTool } from "./voiceAgent.js";
import { getHotelKnowledge } from "../models/hotelKnowledge.js";

const VAPI_API_KEY = process.env.VAPI_API_KEY || "";
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID || "";
const VAPI_BASE_URL = "https://api.vapi.ai";

/**
 * Vapi.ai Telephony & Voice Agent Service
 */
export class VapiService {
  constructor() {
    this.apiKey = VAPI_API_KEY;
    this.phoneNumberId = VAPI_PHONE_NUMBER_ID;
  }

  /**
   * Generates the dynamic Hotel Assistant definition for Vapi
   */
  async getHotelAssistantConfig() {
    const hotel = await getHotelKnowledge();
    const publicUrl = process.env.PUBLIC_URL || "http://localhost:5050";

    return {
      name: "Aria - Hotel Reservation Specialist",
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are Aria, a warm, polite, and professional reservation specialist calling on behalf of ${hotel.hotel_name} in ${hotel.location}.
Your goal:
1. Greet the guest warmly and introduce yourself and the hotel.
2. Answer guest questions accurately regarding room tariffs, check-in (${hotel.check_in_time}), check-out (${hotel.check_out_time}), pool, dining, amenities, and policies.
3. Keep spoken replies short, natural, and conversational (1 to 2 sentences per turn) since this is a phone call.
4. When the guest expresses interest in booking, call the tool 'check_room_availability'.
5. Once they agree on room and pricing, offer to send a secure booking link and execute 'generate_and_send_payment_link'.
6. If the guest asks something unknown, assure them front-desk will assist and call 'log_guest_interest' with the unanswered question.

Current Hotel Knowledge:
${JSON.stringify(hotel, null, 2)}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "check_room_availability",
              description: "Check if a specific room type is available and get pricing.",
              parameters: {
                type: "object",
                properties: {
                  room_type: {
                    type: "string",
                    enum: ["deluxe", "executive_suite", "presidential_suite"],
                    description: "The category of room requested."
                  },
                  nights: {
                    type: "integer",
                    description: "Number of nights stay."
                  }
                },
                required: ["room_type"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "generate_and_send_payment_link",
              description: "Generates a secure payment link for room booking deposit and sends it via WhatsApp/SMS.",
              parameters: {
                type: "object",
                properties: {
                  room_type: { type: "string", description: "Room category booked." },
                  nights: { type: "integer", description: "Number of nights." },
                  amount: { type: "number", description: "Total or deposit amount in INR to collect." }
                },
                required: ["room_type", "amount"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "log_guest_interest",
              description: "Records lead status and special requests.",
              parameters: {
                type: "object",
                properties: {
                  interest_level: { type: "string", enum: ["hot", "warm", "cold"] },
                  intent: { type: "string", description: "Summary of intent." },
                  unanswered_question: { type: "string", description: "Any unresolved question." }
                },
                required: ["interest_level", "intent"]
              }
            }
          }
        ]
      },
      voice: {
        provider: "cartesia",
        voiceId: "a0e99841-438c-4a64-b679-ae501e7d6091" // Natural conversational voice
      },
      firstMessage: `Namaste! This is Aria calling from ${hotel.hotel_name}. Am I speaking with the guest regarding your upcoming stay?`,
      serverUrl: `${publicUrl}/api/telephony/vapi/webhook`
    };
  }

  /**
   * Place an outbound phone call via Vapi REST API
   */
  async makeOutboundCall({ to, customerName, metadata = {} }) {
    const callId = "vapi_" + Date.now();
    const cleanTo = to.startsWith("+") ? to : `+${to}`;
    const assistantConfig = await this.getHotelAssistantConfig();

    // Save call session to Firebase RTDB
    await set(ref(db, `calls/${callId}`), {
      call_id: callId,
      provider: "vapi",
      to: cleanTo,
      customer_name: customerName || "Guest",
      direction: "outbound",
      status: "initiated",
      lead_status: "pending",
      payment_status: "none",
      start_time: Date.now(),
      created_at: Date.now(),
      metadata: metadata
    });

    if (!this.apiKey || this.apiKey === "your_vapi_api_key") {
      console.log(`[Vapi Simulator] Call simulated for ${cleanTo}`);
      await update(ref(db, `calls/${callId}`), {
        status: "simulated_connected",
        provider_session_id: "sim_" + callId
      });
      return { success: true, callId, simulated: true };
    }

    try {
      console.log(`[Vapi] Placing outbound call to ${cleanTo}...`);
      const payload = {
        customer: {
          number: cleanTo,
          name: customerName || "Guest"
        },
        assistant: assistantConfig
      };

      if (this.phoneNumberId) {
        payload.phoneNumberId = this.phoneNumberId;
      }

      const response = await axios.post(`${VAPI_BASE_URL}/call/phone`, payload, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        }
      });

      const vapiCallId = response.data.id;
      await update(ref(db, `calls/${callId}`), {
        provider_session_id: vapiCallId,
        status: "ringing"
      });

      return { success: true, callId, vapiCallId, data: response.data };
    } catch (err) {
      console.error("[Vapi Call Error]:", err.response?.data || err.message);
      await update(ref(db, `calls/${callId}`), { status: "failed", error: err.message });
      return { success: false, callId, error: err.response?.data || err.message };
    }
  }

  /**
   * Handle Vapi Webhooks (Tool calls, call status, and EOD transcript reports)
   */
  async handleWebhook(body) {
    const messageType = body.message?.type;
    console.log(`[Vapi Webhook] Received message type: ${messageType}`);

    // 1. Tool / Function Calls requested by Vapi Agent
    if (messageType === "tool-calls") {
      const toolCalls = body.message.toolCalls || [];
      const call = body.message.call;
      const callId = "vapi_" + (call?.id || "unknown");
      const customerPhone = call?.customer?.number || "";
      const customerName = call?.customer?.name || "Guest";

      const sessionContext = { callId, customerName, customerPhone };
      const results = [];

      for (const tc of toolCalls) {
        const fnName = tc.function.name;
        const fnArgs = tc.function.arguments || {};
        const result = await executeTool(fnName, fnArgs, sessionContext);

        results.push({
          toolCallId: tc.id,
          result: JSON.stringify(result)
        });
      }

      return { results };
    }

    // 2. End of Call Report (Transcript, recording, duration, cost)
    if (messageType === "end-of-call-report") {
      const call = body.message.call;
      const vapiId = call?.id;
      const durationSeconds = body.message.durationSeconds || Math.round((call?.endedAt - call?.startedAt) / 1000) || 0;
      const transcript = body.message.transcript || "";
      const recordingUrl = body.message.recordingUrl || "";
      const summary = body.message.summary || "";

      // Look up call in Firebase RTDB
      const callsSnap = await db.ref ? db.ref("calls").once("value") : null;
      // Update by provider_session_id or recent call
      console.log(`[Vapi Call Ended] Duration: ${durationSeconds}s, Summary: ${summary}`);
      return { status: "recorded" };
    }

    return { status: "ok" };
  }
}

export const vapiService = new VapiService();
