import { db, ref, get, set } from "../config/firebase.js";

// Default hotel knowledge base
export const defaultHotelConfig = {
  hotel_name: "The Royal Orchid Grand",
  location: "Banjara Hills, Hyderabad, India",
  contact_number: "+91-40-23456789",
  check_in_time: "14:00 (2:00 PM)",
  check_out_time: "11:00 (11:00 AM)",
  early_checkin_policy: "Subject to availability. Early check-in before 9 AM is charged 50% of the room rate.",
  cancellation_policy: "100% refund if cancelled 24 hours prior to check-in. Non-refundable after that.",
  amenities: [
    "Complimentary High-Speed Wi-Fi",
    "Buffet Breakfast included in Executive & Suite rooms",
    "Infinity Rooftop Swimming Pool (6:00 AM - 9:00 PM)",
    "24/7 Multi-Cuisine Dining & Room Service",
    "Fitness Center & Luxury Spa",
    "Airport Pickup & Drop on request (Chargeable: ₹1,200)",
    "Valet Parking"
  ],
  room_types: {
    deluxe: {
      name: "Deluxe Room",
      capacity: "2 Adults, 1 Child",
      bed_type: "King Size or Twin Beds",
      base_rate: 3500,
      tax_percentage: 12,
      total_inventory: 15,
      features: "City view, 43-inch smart TV, work desk, walk-in rain shower."
    },
    executive_suite: {
      name: "Executive Suite",
      capacity: "2 Adults, 2 Children",
      bed_type: "King Size Bed + Living Area",
      base_rate: 6000,
      tax_percentage: 18,
      total_inventory: 8,
      features: "Panoramic balcony, jacuzzi bathtub, complimentary breakfast & cocktail hours."
    },
    presidential_suite: {
      name: "Presidential Luxury Suite",
      capacity: "4 Adults",
      bed_type: "2 Master Bedrooms",
      base_rate: 14000,
      tax_percentage: 18,
      total_inventory: 2,
      features: "Private butler service, private dining room, lounge area, airport luxury transfer included."
    }
  },
  faqs: {
    "is_breakfast_included": "Buffet breakfast is included with Executive and Presidential suites, and can be added for Deluxe rooms at ₹550 per person.",
    "pet_friendly": "We are a pet-friendly hotel for small pets up to 12kg with a refundable deposit.",
    "payment_methods": "We accept UPI, Credit/Debit cards, Net Banking, and cash at check-in (with advance token).",
    "conference_hall": "Yes, we have 2 banquet halls with seating capacity of 50 to 300 guests for corporate and wedding events."
  }
};

/**
 * Fetch hotel knowledge base from Firebase RTDB or fallback to default
 */
export async function getHotelKnowledge() {
  try {
    const snapshot = await get(ref(db, "hotel_config"));
    if (snapshot.exists()) {
      return snapshot.val();
    }
    // If not seeded yet, seed default configuration
    await set(ref(db, "hotel_config"), defaultHotelConfig);
    return defaultHotelConfig;
  } catch (error) {
    console.error("Error fetching hotel config from Firebase, using fallback:", error.message);
    return defaultHotelConfig;
  }
}
