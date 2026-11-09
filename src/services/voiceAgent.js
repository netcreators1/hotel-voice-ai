import axios from "axios";
import { getHotelKnowledge } from "../models/hotelKnowledge.js";
import { createPaymentLink } from "./paymentGateway.js";
import { sendPaymentLinkNotification } from "./notificationService.js";
import { db, ref, update } from "../config/firebase.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

/**
 * Available Agent Tools (Function Calling definitions)
 */
export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "check_room_availability",
      description: "Check if a specific room type is available for the given dates and get pricing.",
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
      description: "Generates a secure payment link for room booking deposit and sends it via WhatsApp/SMS to the guest.",
      parameters: {
        type: "object",
        properties: {
          room_type: {
            type: "string",
            description: "Room category booked."
          },
          nights: {
            type: "integer",
            description: "Number of nights."
          },
          amount: {
            type: "number",
            description: "Total or deposit amount in INR to collect."
          }
        },
        required: ["room_type", "amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "log_guest_interest",
      description: "Records the lead qualification status, dates, and special requests from the guest.",
      parameters: {
        type: "object",
        properties: {
          interest_level: {
            type: "string",
            enum: ["hot", "warm", "cold"],
            description: "Hot = wants to book, warm = considering/inquiring, cold = not interested."
          },
          intent: {
            type: "string",
            description: "Summary of guest intent, e.g., 'weekend stay with family', 'corporate inquiry'."
          },
          unanswered_question: {
            type: "string",
            description: "Any query the agent could not confidently answer, to escalate to human front-desk."
          }
        },
        required: ["interest_level", "intent"]
      }
    }
  }
];

/**
 * Execute a tool called by the LLM
 */
export async function executeTool(name, args, sessionContext) {
  const hotel = await getHotelKnowledge();
  const { callId, customerName, customerPhone } = sessionContext;

  console.log(`[Agent Tool Call] ${name}:`, JSON.stringify(args));

  switch (name) {
    case "check_room_availability": {
      const roomKey = (args.room_type || "deluxe").toLowerCase().replace(" ", "_");
      const room = hotel.room_types[roomKey] || hotel.room_types.deluxe;
      const nights = args.nights || 1;
      const totalAmount = room.base_rate * nights * (1 + room.tax_percentage / 100);

      return {
        available: true,
        room_name: room.name,
        base_rate_per_night: room.base_rate,
        tax_percentage: room.tax_percentage,
        nights: nights,
        total_estimated_amount: Math.round(totalAmount),
        features: room.features,
        cancellation: hotel.cancellation_policy
      };
    }

    case "generate_and_send_payment_link": {
      const paymentRecord = await createPaymentLink({
        customerName: customerName || "Guest",
        customerPhone: customerPhone,
        amount: args.amount,
        description: `Booking deposit for ${args.room_type} (${args.nights || 1} nights)`,
        callId: callId,
        roomType: args.room_type,
        nights: args.nights || 1
      });

      // Dispatch via WhatsApp/SMS
      await sendPaymentLinkNotification({
        customerPhone: customerPhone,
        customerName: customerName,
        hotelName: hotel.hotel_name,
        roomType: args.room_type,
        amount: args.amount,
        paymentUrl: paymentRecord.payment_url,
        callId: callId
      });

      return {
        success: true,
        payment_id: paymentRecord.payment_id,
        payment_url: paymentRecord.payment_url,
        status: "link_sent_to_customer_whatsapp"
      };
    }

    case "log_guest_interest": {
      if (callId) {
        await update(ref(db, `calls/${callId}`), {
          lead_status: args.interest_level,
          intent: args.intent,
          unanswered_question: args.unanswered_question || null,
          updated_at: Date.now()
        });
      }
      return { success: true, recorded: args };
    }

    default:
      return { error: `Tool ${name} not found` };
  }
}

/**
 * Core Agent Conversation Step
 * Generates natural, concise voice-friendly responses and triggers tool calls
 */
export async function processConversationStep(messages, sessionContext) {
  const hotel = await getHotelKnowledge();

  const systemPrompt = `You are "Aria", a warm, polite, and professional reservation specialist calling on behalf of ${hotel.hotel_name} in ${hotel.location}.
Your goal:
1. Greet the guest warmly and introduce yourself and the hotel.
2. Answer guest questions accurately regarding room tariffs, check-in (${hotel.check_in_time}), check-out (${hotel.check_out_time}), pool, dining, amenities, and policies.
3. Keep spoken replies short, natural, and conversational (1 to 2 sentences per turn) since this is a phone call.
4. When the guest expresses interest in booking, call the tool 'check_room_availability'.
5. Once they agree on room and pricing, offer to send a secure booking link and execute 'generate_and_send_payment_link'.
6. If the guest asks something unknown, assure them front-desk will assist and call 'log_guest_interest' with the unanswered question.
7. Call 'log_guest_interest' to keep lead quality updated.

Current Hotel Knowledge:
${JSON.stringify(hotel, null, 2)}
`;

  // 1. OpenAI GPT-4o-mini Integration (if valid key is provided)
  if (OPENAI_API_KEY && OPENAI_API_KEY.startsWith("sk-")) {
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          tools: AGENT_TOOLS,
          tool_choice: "auto",
          temperature: 0.6,
          max_tokens: 200
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      const choice = response.data.choices[0];
      const message = choice.message;

      // Handle tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolResponses = [];
        for (const tc of message.tool_calls) {
          const fnName = tc.function.name;
          const fnArgs = JSON.parse(tc.function.arguments);
          const toolResult = await executeTool(fnName, fnArgs, sessionContext);

          toolResponses.push({
            tool_call_id: tc.id,
            role: "tool",
            name: fnName,
            content: JSON.stringify(toolResult)
          });
        }

        // Get final conversational response after tool execution
        const followUp = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              ...messages,
              message,
              ...toolResponses
            ],
            temperature: 0.6,
            max_tokens: 150
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json"
            }
          }
        );

        return {
          reply: followUp.data.choices[0].message.content,
          toolCallsExecuted: message.tool_calls.map(tc => tc.function.name)
        };
      }

      return {
        reply: message.content,
        toolCallsExecuted: []
      };
    } catch (err) {
      console.warn("OpenAI API call failed, using intelligent rule agent:", err.response?.data || err.message);
    }
  }

  // 2. Intelligent Built-in Hospitality Agent Fallback (Works zero-config)
  const lastUserMsg = messages.filter(m => m.role === "user").pop()?.content?.toLowerCase() || "";
  let reply = "";
  const toolCallsExecuted = [];

  if (lastUserMsg.includes("price") || lastUserMsg.includes("tariff") || lastUserMsg.includes("rate") || lastUserMsg.includes("cost") || lastUserMsg.includes("room")) {
    const avail = await executeTool("check_room_availability", { room_type: "deluxe", nights: 1 }, sessionContext);
    reply = `Our Deluxe rooms start at ₹${avail.base_rate_per_night} plus taxes per night, including high-speed Wi-Fi and pool access. Would you like me to send you a secure reservation link to confirm your stay?`;
    toolCallsExecuted.push("check_room_availability");
    await executeTool("log_guest_interest", { interest_level: "warm", intent: "Inquired room tariffs" }, sessionContext);
  } else if (lastUserMsg.includes("yes") || lastUserMsg.includes("book") || lastUserMsg.includes("send link") || lastUserMsg.includes("pay")) {
    const pay = await executeTool("generate_and_send_payment_link", { room_type: "Deluxe Room", nights: 1, amount: 3920 }, sessionContext);
    reply = `I have just sent your secure reservation payment link via WhatsApp to your number. Once completed, your room is instantly confirmed!`;
    toolCallsExecuted.push("generate_and_send_payment_link");
    await executeTool("log_guest_interest", { interest_level: "hot", intent: "Requested booking payment link" }, sessionContext);
  } else if (lastUserMsg.includes("check in") || lastUserMsg.includes("check out") || lastUserMsg.includes("timing")) {
    reply = `Our check-in time is 2:00 PM and check-out is 11:00 AM. Early check-in can also be arranged subject to availability.`;
  } else if (lastUserMsg.includes("pool") || lastUserMsg.includes("breakfast") || lastUserMsg.includes("amenities") || lastUserMsg.includes("food")) {
    reply = `Yes, we feature an infinity rooftop swimming pool, 24/7 multi-cuisine dining, and complimentary high-speed Wi-Fi throughout the property.`;
  } else if (lastUserMsg.includes("no") || lastUserMsg.includes("not interested") || lastUserMsg.includes("bye")) {
    reply = `Thank you for your time! Please feel free to reach out whenever you visit our city. Have a wonderful day!`;
    await executeTool("log_guest_interest", { interest_level: "cold", intent: "Not interested currently" }, sessionContext);
  } else {
    reply = `Namaste! I am calling from ${hotel.hotel_name}. We would be delighted to host your upcoming stay or event. Are you planning any travel dates soon?`;
  }

  return { reply, toolCallsExecuted };
}
