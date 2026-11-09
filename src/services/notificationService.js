import axios from "axios";
import { db, ref, set } from "../config/firebase.js";

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

/**
 * Dispatch booking payment link to caller via WhatsApp or SMS
 */
export async function sendPaymentLinkNotification({
  customerPhone,
  customerName,
  hotelName,
  roomType,
  amount,
  paymentUrl,
  callId = null
}) {
  const notifId = "notif_" + Date.now();
  const cleanPhone = customerPhone.replace(/\D/g, ""); // Strip non-digits

  const messageText = `Namaste ${customerName || "Guest"}! Thank you for speaking with ${hotelName || "The Royal Orchid Grand"}. 
To confirm your reservation for ${roomType}, please click the secure link to pay the booking advance of ₹${amount}:
${paymentUrl}
If you have any questions, feel free to reply to this message.`;

  let deliveryStatus = "simulated";

  // 1. Meta WhatsApp Cloud API (if configured)
  if (WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN) {
    try {
      await axios.post(
        `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "text",
          text: { preview_url: true, body: messageText }
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );
      deliveryStatus = "sent_whatsapp";
    } catch (err) {
      console.warn("WhatsApp dispatch error, logged for manual follow-up:", err.response?.data || err.message);
      deliveryStatus = "failed_whatsapp";
    }
  } else {
    console.log(`[Notification Simulator] Sending WhatsApp/SMS to ${cleanPhone}:`);
    console.log(messageText);
  }

  // Save to Firebase RTDB for tracking
  await set(ref(db, `notifications/${notifId}`), {
    id: notifId,
    customer_phone: customerPhone,
    customer_name: customerName,
    call_id: callId,
    message: messageText,
    payment_url: paymentUrl,
    status: deliveryStatus,
    timestamp: Date.now()
  });

  return { id: notifId, status: deliveryStatus };
}
