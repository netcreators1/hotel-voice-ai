import { db, ref, get, set } from "../config/firebase.js";

/**
 * Format date to YYYY-MM-DD
 */
export function getFormattedDate(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Generate End-of-Day (EOD) Report for a specific date
 */
export async function generateDailyReport(targetDate = null) {
  const dateStr = targetDate || getFormattedDate();
  console.log(`[EOD Report] Generating report for date: ${dateStr}...`);

  // Define day start and end timestamps (IST or local)
  const startOfDay = new Date(`${dateStr}T00:00:00`).getTime();
  const endOfDay = new Date(`${dateStr}T23:59:59.999`).getTime();

  // 1. Fetch Calls from Firebase RTDB
  const callsSnapshot = await get(ref(db, "calls"));
  const allCalls = callsSnapshot.exists() ? Object.values(callsSnapshot.val()) : [];

  // Filter calls for target date
  const todaysCalls = allCalls.filter(c => {
    const time = c.created_at || c.start_time;
    return time >= startOfDay && time <= endOfDay;
  });

  // 2. Fetch Payments from Firebase RTDB
  const paymentsSnapshot = await get(ref(db, "payments"));
  const allPayments = paymentsSnapshot.exists() ? Object.values(paymentsSnapshot.val()) : [];

  const todaysPayments = allPayments.filter(p => {
    const time = p.created_at;
    return time >= startOfDay && time <= endOfDay;
  });

  // 3. Compute Metrics
  let totalCalls = todaysCalls.length;
  let connectedCalls = 0;
  let hotLeads = 0;
  let warmLeads = 0;
  let coldLeads = 0;
  let convertedLeads = 0;
  let totalDurationSec = 0;
  const unansweredQuestions = [];

  for (const call of todaysCalls) {
    if (call.status === "completed" || call.status === "simulated_connected" || call.lead_status) {
      connectedCalls++;
    }

    if (call.duration_seconds) {
      totalDurationSec += call.duration_seconds;
    }

    if (call.lead_status === "converted" || call.payment_status === "paid") {
      convertedLeads++;
    } else if (call.lead_status === "hot") {
      hotLeads++;
    } else if (call.lead_status === "warm") {
      warmLeads++;
    } else if (call.lead_status === "cold") {
      coldLeads++;
    }

    if (call.unanswered_question) {
      unansweredQuestions.push({
        guest: call.customer_name || call.to,
        question: call.unanswered_question
      });
    }
  }

  // Payment statistics
  const paymentLinksGenerated = todaysPayments.length;
  const paidPayments = todaysPayments.filter(p => p.status === "paid");
  const totalRevenueCollected = paidPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const pendingAmount = todaysPayments
    .filter(p => p.status !== "paid")
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const avgCallDuration = connectedCalls > 0 ? Math.round(totalDurationSec / connectedCalls) : 0;
  const conversionRate = connectedCalls > 0 ? ((convertedLeads / connectedCalls) * 100).toFixed(1) : 0;

  // 4. Compile Structured Report Object
  const reportData = {
    report_date: dateStr,
    generated_at: Date.now(),
    summary: {
      total_calls_dialed: totalCalls,
      connected_calls: connectedCalls,
      connection_rate_pct: totalCalls > 0 ? ((connectedCalls / totalCalls) * 100).toFixed(1) : 0,
      avg_duration_seconds: avgCallDuration,
      hot_leads: hotLeads,
      warm_leads: warmLeads,
      cold_leads: coldLeads,
      converted_bookings: convertedLeads,
      conversion_rate_pct: `${conversionRate}%`
    },
    financials: {
      payment_links_generated: paymentLinksGenerated,
      payments_completed: paidPayments.length,
      total_revenue_collected_inr: totalRevenueCollected,
      pending_payment_amount_inr: pendingAmount
    },
    guest_feedback_and_queries: {
      unanswered_questions_count: unansweredQuestions.length,
      escalated_queries: unansweredQuestions
    }
  };

  // 5. Save Report to Firebase RTDB under /daily_reports/{YYYY-MM-DD}
  await set(ref(db, `daily_reports/${dateStr}`), reportData);

  // 6. Generate Clean Markdown Summary
  const markdownReport = `
# 🏨 Hotel AI Voice Agent - End of Day Report
**Date:** ${dateStr}
**Generated At:** ${new Date().toLocaleTimeString()}

---

### 📊 Call Operations Summary
- **Total Calls Dialed:** ${totalCalls}
- **Calls Connected:** ${connectedCalls} (${reportData.summary.connection_rate_pct}%)
- **Average Call Duration:** ${avgCallDuration} seconds
- **Hot Leads (Ready to Book):** ${hotLeads} 🔥
- **Warm Leads (Inquired):** ${warmLeads}
- **Cold Leads (Not Interested):** ${coldLeads}
- **Confirmed Bookings Converted:** ${convertedLeads} ✅

---

### 💳 Payment & Revenue Metrics
- **Payment Links Dispatched:** ${paymentLinksGenerated}
- **Payments Successfully Settled:** ${paidPayments.length}
- **Total Direct Revenue Collected:** ₹${totalRevenueCollected.toLocaleString("en-IN")}
- **Pending Revenue Follow-up:** ₹${pendingAmount.toLocaleString("en-IN")}
- **Direct Voice Conversion Rate:** ${conversionRate}%

---

### ❓ Escalated Customer Queries & Unanswered Questions
${
  unansweredQuestions.length === 0
    ? "_None! All queries were resolved by the AI._"
    : unansweredQuestions.map(q => `- **${q.guest}:** "${q.question}"`).join("\n")
}

---
*Report automatically logged to Firebase Realtime Database at \`/daily_reports/${dateStr}\`.*
`;

  console.log(markdownReport);
  return { reportData, markdownReport };
}

// Allow running directly from CLI: `node src/reports/eodReport.js`
if (process.argv[1]?.includes("eodReport.js")) {
  generateDailyReport()
    .then(() => {
      console.log("EOD report generation finished.");
      process.exit(0);
    })
    .catch(err => {
      console.error("Error generating report:", err);
      process.exit(1);
    });
}
