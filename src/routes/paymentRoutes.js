import express from "express";
import { confirmPayment, createPaymentLink } from "../services/paymentGateway.js";
import { db, ref, get } from "../config/firebase.js";

const router = express.Router();

/**
 * Payment Gateway Webhook (Razorpay / Stripe)
 * POST /api/payments/webhook
 */
router.post("/webhook", async (req, res) => {
  try {
    const event = req.body.event;
    console.log(`[Payment Webhook] Received event: ${event}`);

    // Handle Razorpay payment link paid event
    if (event === "payment_link.paid" || event === "payment.captured") {
      const paymentEntity = req.body.payload?.payment_link?.entity || req.body.payload?.payment?.entity;
      const notes = paymentEntity?.notes || {};
      const callId = notes.call_id;

      // Find payment record matching gateway ref or callId
      const paymentsSnap = await get(ref(db, "payments"));
      if (paymentsSnap.exists()) {
        const payments = paymentsSnap.val();
        for (const [id, record] of Object.entries(payments)) {
          if (record.call_id === callId || record.gateway_ref_id === paymentEntity?.id) {
            await confirmPayment(id, { transaction_id: paymentEntity?.id });
            break;
          }
        }
      }
    }

    res.json({ status: "ok" });
  } catch (err) {
    console.error("[Payment Webhook Error]:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Interactive Checkout Simulation Page
 * GET /pay/:paymentId
 */
router.get("/:paymentId", async (req, res) => {
  const { paymentId } = req.params;
  const snapshot = await get(ref(db, `payments/${paymentId}`));

  if (!snapshot.exists()) {
    return res.status(404).send("<h3>Payment link not found or expired.</h3>");
  }

  const p = snapshot.val();

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Hotel Reservation Checkout</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; }
      .card { max-width: 480px; margin: 40px auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); padding: 30px; }
      .header { text-align: center; border-bottom: 1px solid #eee; padding-bottom: 20px; }
      .hotel-badge { background: #e0f2fe; color: #0284c7; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; display: inline-block; margin-bottom: 8px; }
      .amount { font-size: 36px; font-weight: 700; color: #1e293b; margin: 15px 0; }
      .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; }
      .label { color: #64748b; }
      .val { font-weight: 600; color: #0f172a; }
      .pay-btn { width: 100%; background: #16a34a; color: #fff; border: none; padding: 14px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 25px; transition: 0.2s; }
      .pay-btn:hover { background: #15803d; }
      .success-box { display: none; background: #dcfce7; color: #166534; padding: 15px; border-radius: 8px; margin-top: 20px; text-align: center; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="header">
        <div class="hotel-badge">The Royal Orchid Grand</div>
        <h2 style="margin: 0; color: #1e293b;">Room Booking Deposit</h2>
        <div class="amount">₹${p.amount.toLocaleString("en-IN")}</div>
        <p style="color: #64748b; margin: 0; font-size: 14px;">Instant Confirmation via AI Voice Agent</p>
      </div>

      <div style="margin-top: 20px;">
        <div class="row"><span class="label">Guest Name:</span><span class="val">${p.customer_name}</span></div>
        <div class="row"><span class="label">Contact Phone:</span><span class="val">${p.customer_phone || "Not provided"}</span></div>
        <div class="row"><span class="label">Room Type:</span><span class="val">${p.room_type}</span></div>
        <div class="row"><span class="label">Stay Duration:</span><span class="val">${p.nights} Night(s)</span></div>
        <div class="row"><span class="label">Status:</span><span class="val" id="status-badge" style="color: ${p.status === "paid" ? "#16a34a" : "#ca8a04"}">${p.status.toUpperCase()}</span></div>
      </div>

      ${
        p.status === "paid"
          ? `<div style="background: #dcfce7; color: #166534; padding: 15px; border-radius: 8px; margin-top: 20px; text-align: center; font-weight: 600;">✓ This reservation has already been confirmed and paid.</div>`
          : `
          <button class="pay-btn" id="payBtn" onclick="submitPayment()">Pay ₹${p.amount} Now (Simulate UPI/Card)</button>
          <div class="success-box" id="successBox">✓ Payment Successful! Booking Confirmed and synced to Firebase.</div>
          `
      }
    </div>

    <script>
      async function submitPayment() {
        const btn = document.getElementById("payBtn");
        btn.innerText = "Processing...";
        btn.disabled = true;

        try {
          const res = await fetch("/api/payments/confirm/${paymentId}", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            btn.style.display = "none";
            document.getElementById("successBox").style.display = "block";
            document.getElementById("status-badge").innerText = "PAID";
            document.getElementById("status-badge").style.color = "#16a34a";
          } else {
            alert("Payment failed: " + data.error);
            btn.disabled = false;
          }
        } catch (err) {
          alert("Error: " + err.message);
          btn.disabled = false;
        }
      }
    </script>
  </body>
  </html>
  `;

  res.send(html);
});

/**
 * Confirm simulator payment
 * POST /api/payments/confirm/:paymentId
 */
router.post("/confirm/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const result = await confirmPayment(paymentId, { transaction_id: `txn_sim_${Date.now()}` });
    res.json({ success: true, payment: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
