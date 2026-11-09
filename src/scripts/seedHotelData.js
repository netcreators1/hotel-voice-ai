import { db, ref, set } from "../config/firebase.js";
import { defaultHotelConfig } from "../models/hotelKnowledge.js";
import { getFormattedDate } from "../reports/eodReport.js";

async function seed() {
  console.log("Seeding Firebase Realtime Database with initial hotel and sample data...");

  // 1. Hotel Config
  await set(ref(db, "hotel_config"), defaultHotelConfig);
  console.log("✓ Hotel configuration seeded.");

  // 2. Contacts Queue
  const contacts = {
    c1: {
      id: "c1",
      name: "Rohan Verma",
      phone: "+919811122334",
      campaign: "weekend_getaway",
      status: "pending",
      created_at: Date.now()
    },
    c2: {
      id: "c2",
      name: "Pooja Hegde",
      phone: "+919822233445",
      campaign: "corporate_retreat",
      status: "pending",
      created_at: Date.now()
    }
  };
  await set(ref(db, "contacts_queue"), contacts);
  console.log("✓ Contacts queue seeded.");

  // 3. Sample Call & Payment for Today to demonstrate EOD report
  const now = Date.now();
  const sampleCallId = "call_sample_101";
  const samplePaymentId = "pay_sample_101";

  await set(ref(db, `calls/${sampleCallId}`), {
    call_id: sampleCallId,
    customer_name: "Amitabh Sen",
    to: "+919899988776",
    provider: "piopiy",
    status: "completed",
    lead_status: "converted",
    intent: "Booked Deluxe Room for 2 nights",
    duration_seconds: 165,
    payment_id: samplePaymentId,
    payment_status: "paid",
    created_at: now,
    start_time: now - 180000,
    ended_at: now
  });

  await set(ref(db, `payments/${samplePaymentId}`), {
    payment_id: samplePaymentId,
    customer_name: "Amitabh Sen",
    customer_phone: "+919899988776",
    amount: 7840,
    currency: "INR",
    room_type: "Deluxe Room",
    nights: 2,
    status: "paid",
    call_id: sampleCallId,
    created_at: now,
    paid_at: now
  });

  console.log("✓ Sample converted call & payment seeded.");
  console.log("Firebase seeding complete!");
  process.exit(0);
}

seed().catch(err => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
