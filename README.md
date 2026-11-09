# 🏨 Hotel Agentic Voice AI Calling & Payment Gateway System

An end-to-end autonomous Voice AI system designed for hotels that makes outbound calls to prospective guests, answers hotel queries, checks real-time room availability, collects advance payments via dynamic gateway links (WhatsApp/SMS), and compiles daily **End-of-Day (EOD)** performance reports into **Firebase Realtime Database**.

---

## 🚀 Key Features

1. **Multi-Telephony Support (PIOPIY & DotVoice)**
   - Initial integration with **PIOPIY** (TeleCMI) offering 10,000 free calling minutes.
   - Built-in provider abstraction to seamlessly switch or failover to **DotVoice**.
2. **Autonomous Agentic Voice Core**
   - **Tool Calling (Function Calling)**:
     - `check_room_availability`: Real-time room inventory and tariff calculations.
     - `generate_and_send_payment_link`: Dynamic payment link creation with instant WhatsApp/SMS dispatch.
     - `log_guest_interest`: Classifies leads into **Hot**, **Warm**, or **Cold** and records unanswered queries for human follow-up.
3. **Payment Gateway Integration**
   - Integrated with **Razorpay**, **Stripe**, and a built-in **Interactive Payment Simulator** for immediate end-to-end testing without external setup.
4. **Firebase Realtime Database (RTDB)**
   - Connected to `https://telecalling-3bd3e-default-rtdb.firebaseio.com`.
   - Real-time schema for `/hotel_config`, `/contacts_queue`, `/calls`, `/payments`, and `/daily_reports`.
5. **Automated End-of-Day (EOD) Reports**
   - Scheduled nightly via `node-cron` (default: 9:00 PM).
   - Generates executive metrics: Call connection rates, lead conversion rates, revenue collected, and escalated customer queries.
6. **Live Interactive Console**
   - Built-in web UI at `http://localhost:5000` to trigger test calls, chat with the AI, simulate customer checkout, and view reports.

---

## 📂 Project Structure

```
atharva_calling/
├── .env                       # Environment variables with your Firebase config
├── .env.example               # Template environment configuration
├── package.json               # Node.js dependencies and scripts
├── src/
│   ├── config/
│   │   └── firebase.js        # Firebase Realtime Database connection
│   ├── models/
│   │   └── hotelKnowledge.js  # Hotel tariffs, rooms, check-in policies, amenities
│   ├── services/
│   │   ├── piopiy.js          # PIOPIY (TeleCMI) API & Call Action builder
│   │   ├── dotvoice.js        # DotVoice API client
│   │   ├── telephonyAdapter.js# Unified telephony interface (Piopiy <-> DotVoice)
│   │   ├── voiceAgent.js      # Agentic LLM with Function Calling
│   │   ├── paymentGateway.js  # Razorpay & Payment link generator
│   │   └── notificationService.js # WhatsApp/SMS link dispatcher
│   ├── reports/
│   │   └── eodReport.js       # End-of-Day aggregation & Markdown generator
│   ├── routes/
│   │   ├── telephonyRoutes.js # PIOPIY webhooks and outbound triggers
│   │   ├── paymentRoutes.js   # Payment webhooks & checkout page
│   │   └── adminRoutes.js     # Admin endpoints for reports, calls, contacts
│   ├── scripts/
│   │   └── seedHotelData.js   # Seeds initial database in Firebase RTDB
│   └── server.js              # Express app, WebSocket audio bridge, Cron runner
```

---

## ⚡ Quick Start

### 1. Seed Hotel Knowledge & Sample Data into Firebase
```bash
npm run seed
```

### 2. Start the Server & Web Control Console
```bash
npm start
```
Open your browser at **`http://localhost:5000`** to access the interactive control console.

### 3. Generate Today's EOD Report Anytime
```bash
npm run report
```

---

## 📞 Telephony Configuration

### Using PIOPIY (10,000 Free Minutes)
In your `.env` file:
```env
TELEPHONY_PROVIDER=piopiy
PIOPIY_APP_ID=your_piopiy_app_id
PIOPIY_APP_SECRET=your_piopiy_app_secret
PIOPIY_CALLER_ID=+9180XXXXXXXX
```
- Set your webhook URLs in the PIOPIY portal:
  - **Action URL**: `https://<your-domain>/api/telephony/piopiy/action`
  - **Status URL**: `https://<your-domain>/api/telephony/piopiy/status`

### Switching to DotVoice
Change the provider variable in `.env`:
```env
TELEPHONY_PROVIDER=dotvoice
DOTVOICE_API_KEY=your_dotvoice_key
DOTVOICE_API_SECRET=your_dotvoice_secret
```
The unified `telephonyAdapter` automatically delegates calls to DotVoice without touching any agent or booking code.

---

## 💳 Payment Gateway Setup

### Razorpay
Set in `.env`:
```env
PAYMENT_GATEWAY=razorpay
RAZORPAY_KEY_ID=rzp_live_xxxxxx
RAZORPAY_KEY_SECRET=your_secret
```
Set the Razorpay Webhook URL to: `https://<your-domain>/api/payments/webhook` with the event `payment_link.paid`.

---

## 📊 End-of-Day (EOD) Report Schema in Firebase

Every night at 9:00 PM (or when triggered manually), the report is saved under `/daily_reports/YYYY-MM-DD`:

```json
{
  "report_date": "2026-11-09",
  "summary": {
    "total_calls_dialed": 45,
    "connected_calls": 38,
    "connection_rate_pct": "84.4%",
    "avg_duration_seconds": 142,
    "hot_leads": 12,
    "warm_leads": 18,
    "cold_leads": 8,
    "converted_bookings": 7,
    "conversion_rate_pct": "18.4%"
  },
  "financials": {
    "payment_links_generated": 10,
    "payments_completed": 7,
    "total_revenue_collected_inr": 48500,
    "pending_payment_amount_inr": 18200
  },
  "guest_feedback_and_queries": {
    "unanswered_questions_count": 1,
    "escalated_queries": [
      {
        "guest": "Vikram Mehta",
        "question": "Can you arrange early check-in at 6 AM?"
      }
    ]
  }
}
```
