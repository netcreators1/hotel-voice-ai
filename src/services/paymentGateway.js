import axios from "axios";
import crypto from "crypto";
import { db, ref, set, update, get } from "../config/firebase.js";

const PAYMENT_GATEWAY = process.env.PAYMENT_GATEWAY || "simulator";
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

/**
 * Generate a dynamic payment link for room booking deposit or full payment
 */
export async function createPaymentLink({
  customerName = "Guest",
  customerPhone = "",
  amount = 1000, // in INR
  description = "Hotel Room Reservation Deposit",
  callId = null,
  roomType = "deluxe",
  nights = 1
}) {
  const paymentId = "pay_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  const now = Date.now();

  let paymentUrl = "";
  let gatewayRefId = "";

  // 1. If Razorpay keys are provided, create live Razorpay Payment Link
  if (PAYMENT_GATEWAY === "razorpay" && RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
    try {
      const authHeader = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
      const response = await axios.post(
        "https://api.razorpay.com/v1/payment_links",
        {
          amount: Math.round(amount * 100), // amount in paise
          currency: "INR",
          accept_partial: false,
          description: description,
          customer: {
            name: customerName,
            contact: customerPhone
          },
          notify: {
            sms: true,
            email: false,
            whatsapp: true
          },
          reminder_enable: true,
          notes: {
            call_id: callId,
            room_type: roomType,
            nights: nights.toString()
          },
          callback_url: `${process.env.PUBLIC_URL || "http://localhost:5000"}/payment-success?payment_id=${paymentId}`,
          callback_method: "get"
        },
        {
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/json"
          }
        }
      );

      paymentUrl = response.data.short_url;
      gatewayRefId = response.data.id;
    } catch (err) {
      console.warn("Razorpay API call failed, falling back to simulator:", err.response?.data || err.message);
    }
  }

  // 2. Fallback / Simulator Mode for local dev & testing
  if (!paymentUrl) {
    const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`;
    paymentUrl = `${baseUrl}/pay/${paymentId}`;
    gatewayRefId = "sim_" + paymentId;
  }

  const paymentRecord = {
    payment_id: paymentId,
    gateway_ref_id: gatewayRefId,
    gateway: PAYMENT_GATEWAY,
    customer_name: customerName,
    customer_phone: customerPhone,
    amount: amount,
    currency: "INR",
    room_type: roomType,
    nights: nights,
    description: description,
    status: "created", // created | paid | failed | expired
    call_id: callId,
    payment_url: paymentUrl,
    created_at: now,
    updated_at: now
  };

  // Save to Firebase RTDB
  await set(ref(db, `payments/${paymentId}`), paymentRecord);

  // Link to call record if callId exists
  if (callId) {
    await update(ref(db, `calls/${callId}`), {
      payment_id: paymentId,
      payment_status: "link_sent",
      payment_amount: amount,
      payment_url: paymentUrl
    });
  }

  console.log(`[Payment] Generated link for ${customerName} (₹${amount}): ${paymentUrl}`);
  return paymentRecord;
}

/**
 * Handle Payment Completion (Webhook or Simulator confirmation)
 */
export async function confirmPayment(paymentId, transactionData = {}) {
  const paymentRef = ref(db, `payments/${paymentId}`);
  const snapshot = await get(paymentRef);

  if (!snapshot.exists()) {
    throw new Error(`Payment record ${paymentId} not found`);
  }

  const existing = snapshot.val();
  const now = Date.now();

  const updatedData = {
    ...existing,
    status: "paid",
    transaction_id: transactionData.transaction_id || `txn_${now}`,
    paid_at: now,
    updated_at: now
  };

  await set(paymentRef, updatedData);

  // Update Call & Lead status to converted
  if (existing.call_id) {
    await update(ref(db, `calls/${existing.call_id}`), {
      payment_status: "paid",
      lead_status: "converted",
      converted_at: now
    });
  }

  console.log(`[Payment] Confirmed payment ${paymentId} of ₹${existing.amount}`);
  return updatedData;
}
